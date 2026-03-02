import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildWebOpsPrompt } from './agents/webops-prompt.js';
import { buildDsaPrompt } from './agents/dsa-prompt.js';
import { buildPlannerPrompt } from './agents/planner-prompt.js';
import type { CollectionSummary } from './agents/dsa-prompt.js';
import { createWebOpsToolServer, createDsaAnalysisToolServer, createPlannerToolServer } from './tools/index.js';
import { createLoggingHook } from './hooks/logging-hook.js';
import { getSupabase, withTimeout } from './lib/supabase.js';
import {
  resolveStuckTasks,
  computeStepSummary,
  writeStepSummary,
  checkCompletionCriteria,
} from './lib/ledger.js';
import {
  isMemoryEnabled,
  memorySearch,
  memoryAdd,
  addFinalAnswerMemory,
  buildMemoryPayload,
  buildSummaryMetadata,
} from './lib/supermemory.js';
import type { RunEventBus } from './lib/run-events.js';
import type { Run, Location, Retailer, NimbleAgent, StepSummary, CollectionPlan } from '@agent-dsa/shared';

interface ExecuteResult {
  success: boolean;
  answerId?: string;
  totalCostUsd?: number;
  numTurns?: number;
  error?: string;
}

export async function executeQuestion(runId: string, eventBus?: RunEventBus): Promise<ExecuteResult> {
  const db = getSupabase();
  const overallTimeoutMs = parseInt(process.env.OVERALL_TIMEOUT_MS || '2700000', 10);

  // Mutable state shared between inner function (via closure) and outer error handler
  let totalCostUsd = 0;
  let totalTurns = 0;
  let webOpsSummary: StepSummary | undefined;
  let dsaSummary: StepSummary | undefined;

  async function executeQuestionInner(): Promise<ExecuteResult> {
    // ── Load run context ──────────────────────────────────────────────

    const { data: run, error: runErr } = await withTimeout(
      db
        .from('runs')
        .select('*')
        .eq('id', runId)
        .single(),
      15_000,
      'init: load run'
    );

    if (runErr || !run) {
      return { success: false, error: `Run not found: ${runErr?.message}` };
    }

    // Load location
    let location: Location | undefined;
    if (run.location_id) {
      const { data } = await withTimeout(
        db
          .from('locations')
          .select('*')
          .eq('id', run.location_id)
          .single(),
        15_000,
        'init: load location'
      );
      if (data) location = data as Location;
    }

    // Load retailers with their agents
    const retailerIds: string[] = run.retailer_ids || [];
    const retailers: Array<
      Retailer & { serp_agent?: NimbleAgent; pdp_agent?: NimbleAgent }
    > = [];

    const retailerQuery = retailerIds.length > 0
      ? db.from('retailers').select('*').in('id', retailerIds)
      : db.from('retailers').select('*').eq('is_active', true);

    const { data: retailerRows } = await withTimeout(
      retailerQuery,
      15_000,
      'init: load retailers'
    );

    if (retailerRows && retailerRows.length > 0) {
      const allAgentIds = [
        ...new Set(
          retailerRows
            .flatMap((r) => [r.serp_agent_id, r.pdp_agent_id])
            .filter((id): id is string => id != null)
        ),
      ];

      const agentMap = new Map<string, NimbleAgent>();
      if (allAgentIds.length > 0) {
        const { data: agents } = await withTimeout(
          db
            .from('nimble_agents')
            .select('*')
            .in('id', allAgentIds),
          15_000,
          'init: load nimble_agents'
        );
        if (agents) {
          for (const a of agents) {
            agentMap.set(a.id, a as NimbleAgent);
          }
        }
      }

      for (const r of retailerRows) {
        const retailer = r as Retailer & {
          serp_agent?: NimbleAgent;
          pdp_agent?: NimbleAgent;
        };
        if (r.serp_agent_id) retailer.serp_agent = agentMap.get(r.serp_agent_id);
        if (r.pdp_agent_id) retailer.pdp_agent = agentMap.get(r.pdp_agent_id);
        retailers.push(retailer);
      }
    }

    const model = process.env.AGENT_MODEL || 'claude-sonnet-4-6';
    const webOpsMaxTurns = parseInt(process.env.WEBOPS_MAX_TURNS || '20', 10);
    const dsaMaxTurns = parseInt(process.env.DSA_MAX_TURNS || '10', 10);
    const webOpsHook = createLoggingHook(runId, 'webops', 'collection', eventBus);
    const dsaHook = createLoggingHook(runId, 'dsa', 'analysis', eventBus);

    // ── Phase watchdog: activity-aware timeout ────────────────────────
    interface PhaseWatchdogConfig {
      phaseName: string;
      hardTimeoutMs: number;      // absolute maximum (existing env-var caps)
      inactivityMs: number;       // rolling window — reset on each tool call
      stuckThreshold: number;     // consecutive identical calls before abort
    }

    interface PhaseWatchdog {
      abort: AbortController;
      recordToolUse(toolName: string, toolInput: unknown): 'ok' | 'stuck';
      dispose(): void;
    }

    function createPhaseWatchdog(config: PhaseWatchdogConfig): PhaseWatchdog {
      const { phaseName, hardTimeoutMs, inactivityMs, stuckThreshold } = config;
      const abort = new AbortController();
      let lastActivityTime = Date.now();

      // Hard timeout (safety net)
      const hardTimer = setTimeout(() => {
        console.warn(`[${phaseName}] Hard timeout reached (${hardTimeoutMs}ms), aborting`);
        abort.abort();
      }, hardTimeoutMs);

      // Rolling inactivity check
      const pollInterval = Math.min(10_000, Math.floor(inactivityMs / 3));
      const inactivityTimer = setInterval(() => {
        const idleMs = Date.now() - lastActivityTime;
        if (idleMs >= inactivityMs) {
          console.warn(`[${phaseName}] Inactive for ${Math.round(idleMs / 1000)}s — aborting`);
          abort.abort();
        }
      }, pollInterval);

      // Stuck-loop tracking
      let lastFingerprint = '';
      let repeatCount = 0;

      function recordToolUse(toolName: string, toolInput: unknown): 'ok' | 'stuck' {
        lastActivityTime = Date.now();
        const fingerprint = toolName + ':' + JSON.stringify(toolInput, Object.keys((toolInput ?? {}) as Record<string, unknown>).sort());
        if (fingerprint === lastFingerprint) {
          repeatCount++;
          if (repeatCount >= stuckThreshold) {
            console.warn(`[${phaseName}] Stuck loop detected: ${toolName} called ${repeatCount} times with identical input — aborting`);
            abort.abort();
            return 'stuck';
          }
        } else {
          lastFingerprint = fingerprint;
          repeatCount = 1;
        }
        return 'ok';
      }

      function dispose() {
        clearTimeout(hardTimer);
        clearInterval(inactivityTimer);
      }

      return { abort, recordToolUse, dispose };
    }

    // ── Phase 0: Planner ──────────────────────────────────────────────

    let plan: CollectionPlan | null = null;

    if (run.question_text) {
      await withTimeout(
        db
          .from('runs')
          .update({
            status: 'planning',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId),
        10_000,
        'status update: planning'
      );

      eventBus?.send({
        event_type: 'step_started',
        agent_name: 'planner',
        step_name: 'planning',
        message: 'Starting planner agent',
      });

      const plannerHook = createLoggingHook(runId, 'planner', 'planning', eventBus);
      const plannerPrompt = buildPlannerPrompt({
        run: run as Run,
        location,
        retailers,
      });

      const plannerToolServer = createPlannerToolServer();
      const retailerNames = retailers.map((r) => r.name).join(', ');

      const plannerUserPrompt = `Plan data collection for: ${run.question_text}\n\nTarget retailers: ${retailerNames || 'none configured'}. Read the config tables to understand what's available, then submit_plan.`;

      const plannerWatchdog = createPhaseWatchdog({
        phaseName: 'planner',
        hardTimeoutMs: 60_000,
        inactivityMs: parseInt(process.env.PLANNER_INACTIVITY_MS || '30000', 10),
        stuckThreshold: 3,
      });

      try {
        for await (const message of query({
          prompt: plannerUserPrompt,
          options: {
            model,
            maxTurns: 5,
            systemPrompt: plannerPrompt,
            tools: [],
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            mcpServers: { 'planner-tools': plannerToolServer.server },
            abortController: plannerWatchdog.abort,
            hooks: {
              PostToolUse: [{ hooks: [plannerHook] }],
            },
          },
        })) {
          const msg = message as SDKMessage;

          if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
            const init = msg as Extract<SDKMessage, { type: 'system'; subtype: 'init' }>;
            console.log(`[planner] init: model=${init.model}, tools=[${init.tools.join(', ')}] (${init.tools.length})`);
          }

          if (msg.type === 'assistant' && 'content' in msg) {
            const content = msg.content as Array<Record<string, unknown>>;
            const toolUseCalls = content
              .filter((c) => c.type === 'tool_use')
              .map((c) => ({ name: c.name as string, input: c.input }));
            if (toolUseCalls.length > 0) {
              for (const call of toolUseCalls) {
                const status = plannerWatchdog.recordToolUse(call.name, call.input);
                eventBus?.send({
                  event_type: 'task_started',
                  agent_name: 'planner',
                  step_name: 'planning',
                  tool_name: call.name,
                  message: `planner: ${call.name}`,
                });
                if (status === 'stuck') break;
              }
            }
          }

          if (msg.type === 'result') {
            const result = msg as Record<string, unknown>;
            if ('total_cost_usd' in result) {
              totalCostUsd += result.total_cost_usd as number;
            }
            if ('num_turns' in result) {
              totalTurns += result.num_turns as number;
            }
          }
        }
      } finally {
        plannerWatchdog.dispose();
      }

      // Resolve stuck tasks + compute step summary for planner
      await withTimeout(
        resolveStuckTasks(runId, 'planner', 'planning'),
        30_000,
        'resolveStuckTasks: planner'
      );
      const plannerSummary = await withTimeout(
        computeStepSummary(runId, 'planner', 'planning'),
        30_000,
        'computeStepSummary: planner'
      );

      eventBus?.send({
        event_type: 'step_summary',
        agent_name: 'planner',
        step_name: 'planning',
        message: `Planning complete: ${plannerSummary.completed}/${plannerSummary.total_tasks} tasks`,
        summary: plannerSummary,
      });

      plan = plannerToolServer.getPlan();
      if (plan) {
        console.log(`[planner] Plan submitted: type=${plan.question_type}, keywords=${plan.keywords.length}, retailers=${plan.retailers.length}`);
      } else {
        console.warn('[planner] No plan submitted — falling back to unplanned collection');
      }
    }

    // ── Phase 1: WebOps Collection ────────────────────────────────────

    const webOpsStartedAt = new Date().toISOString();
    await withTimeout(
      db
        .from('runs')
        .update({
          status: 'collecting',
          ...(!plan ? { started_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId),
      10_000,
      'status update: collecting'
    );

    eventBus?.send({
      event_type: 'step_started',
      agent_name: 'webops',
      step_name: 'collection',
      message: 'Starting WebOps data collection',
    });

    const webOpsPrompt = buildWebOpsPrompt({
      run: run as Run,
      location,
      retailers,
      plan: plan ?? undefined,
    });

    const hasConfiguredRetailers = retailers.length > 0;

    let webOpsUserPrompt: string;
    if (!run.question_text) {
      // No question — discover broadly
      webOpsUserPrompt = `Run ${runId}. No specific question — use find_wsa_template to discover agents, then collect broadly.`;
    } else if (plan && hasConfiguredRetailers) {
      // Planned path — follow the planner's collection plan
      const firstKeyword = plan.keywords[0]?.keyword ?? run.question_text;
      webOpsUserPrompt = `Collect data for run ${runId}: ${run.question_text}\n\nA collection plan is in your system prompt. Follow it — start with keyword "${firstKeyword}" on the highest-priority retailer. Execute keywords in priority order. Start NOW.`;
    } else if (hasConfiguredRetailers) {
      // Happy path — retailers available but no plan
      webOpsUserPrompt = `Collect data for run ${runId}: ${run.question_text}\n\nAll ${retailers.length} retailer agents are listed in your system prompt. Use the fast path — serp_search → pdp_fetch → write_observation. Start NOW.`;
    } else {
      // Bootstrap — no retailers
      webOpsUserPrompt = `Collect data for run ${runId}: ${run.question_text}\n\nNo retailers are pre-configured. Use web_search_fallback with focus="shopping" to find this product. Your first call should be: web_search_fallback(query="${run.question_text}", focus="shopping", run_id="${runId}"). Then url_extract_fallback on product URLs, then write_observation for each price found.`;
    }

    const webOpsTools = createWebOpsToolServer();
    let webOpsTurnCounter = 0;
    let webOpsConsecutiveTextOnlyTurns = 0;

    const webOpsWatchdog = createPhaseWatchdog({
      phaseName: 'webops',
      hardTimeoutMs: parseInt(process.env.WEBOPS_TIMEOUT_MS || '2100000', 10),
      inactivityMs: parseInt(process.env.WEBOPS_INACTIVITY_MS || '180000', 10),
      stuckThreshold: 3,
    });

    try {
      for await (const message of query({
        prompt: webOpsUserPrompt,
        options: {
          model,
          maxTurns: webOpsMaxTurns,
          systemPrompt: webOpsPrompt,
          tools: [],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          mcpServers: { 'webops-tools': webOpsTools },
          abortController: webOpsWatchdog.abort,
          hooks: {
            PostToolUse: [{ hooks: [webOpsHook] }],
          },
        },
      })) {
        const msg = message as SDKMessage;

        // ── Init message: log tools & MCP status, fail fast if disconnected ──
        if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
          const init = msg as Extract<SDKMessage, { type: 'system'; subtype: 'init' }>;
          console.log(`[webops] init: model=${init.model}, tools=[${init.tools.join(', ')}] (${init.tools.length})`);
          for (const srv of init.mcp_servers) {
            console.log(`[webops] mcp_server: ${srv.name} → ${srv.status}`);
          }
          eventBus?.send({
            event_type: 'step_started',
            agent_name: 'webops',
            step_name: 'collection',
            message: `Init: ${init.tools.length} tools, MCP servers: ${init.mcp_servers.map((s) => `${s.name}=${s.status}`).join(', ')}`,
          });
          // Only check our own MCP server, not unrelated session servers
          const ownServer = init.mcp_servers.find((s) => s.name === 'webops-tools');
          if (ownServer && ownServer.status !== 'connected') {
            throw new Error(`WebOps MCP server not connected: webops-tools=${ownServer.status}`);
          }
          if (!ownServer) {
            throw new Error('WebOps MCP server "webops-tools" not found in init');
          }
          const webOpsToolCount = init.tools.filter((t) => t.startsWith('mcp__webops-tools__')).length;
          if (webOpsToolCount === 0) {
            throw new Error('WebOps init reported 0 webops-tools — MCP server likely failed to register tools');
          }
        }

        if (msg.type === 'assistant' && 'content' in msg) {
          webOpsTurnCounter++;
          const content = msg.content as Array<Record<string, unknown>>;
          const toolUseCalls = content
            .filter((c) => c.type === 'tool_use')
            .map((c) => ({ name: c.name as string, input: c.input }));
          if (toolUseCalls.length > 0) {
            webOpsConsecutiveTextOnlyTurns = 0;
            for (const call of toolUseCalls) {
              const status = webOpsWatchdog.recordToolUse(call.name, call.input);
              eventBus?.send({
                event_type: 'task_started',
                agent_name: 'webops',
                step_name: 'collection',
                tool_name: call.name,
                message: `turn ${webOpsTurnCounter}: ${call.name}`,
              });
              if (status === 'stuck') break;
            }
          } else {
            webOpsConsecutiveTextOnlyTurns++;
            const textContent = content
              .filter((c) => c.type === 'text')
              .map((c) => String(c.text ?? '').slice(0, 200))
              .join(' ');
            console.warn(`[webops] WARNING: text-only turn ${webOpsTurnCounter} (${webOpsConsecutiveTextOnlyTurns} consecutive, no tool calls): ${textContent}`);
            if (webOpsConsecutiveTextOnlyTurns >= 2) {
              console.warn(`[webops] Aborting: ${webOpsConsecutiveTextOnlyTurns} consecutive text-only turns`);
              webOpsWatchdog.abort.abort();
              break;
            }
          }
        }

        if (msg.type === 'result') {
          const result = msg as Record<string, unknown>;
          if ('total_cost_usd' in result) {
            totalCostUsd += result.total_cost_usd as number;
          }
          if ('num_turns' in result) {
            totalTurns += result.num_turns as number;
          }
          // Log error details from result
          const subtype = result.subtype as string | undefined;
          if (subtype && subtype !== 'success') {
            console.warn(`[webops] result subtype: ${subtype}`);
          }
          const errors = result.errors as string[] | undefined;
          if (errors && errors.length > 0) {
            console.warn(`[webops] errors:`, errors);
          }
          const permDenials = result.permission_denials as Array<{ tool_name: string }> | undefined;
          if (permDenials && permDenials.length > 0) {
            console.warn(`[webops] permission_denials:`, permDenials.map((d) => d.tool_name));
          }
        }
      }
    } finally {
      webOpsWatchdog.dispose();
    }

    // ── WebOps step summary ───────────────────────────────────────────
    const webOpsTimedOut = await withTimeout(
      resolveStuckTasks(runId, 'webops', 'collection'),
      30_000,
      'resolveStuckTasks: webops'
    );
    if (webOpsTimedOut > 0) {
      eventBus?.send({
        event_type: 'skipped',
        agent_name: 'webops',
        step_name: 'collection',
        message: `Watchdog: ${webOpsTimedOut} stuck tasks timed out`,
      });
    }
    webOpsSummary = await withTimeout(
      computeStepSummary(runId, 'webops', 'collection'),
      30_000,
      'computeStepSummary: webops'
    );
    await withTimeout(
      writeStepSummary(runId, 'webops', 'collection', webOpsSummary, webOpsStartedAt),
      30_000,
      'writeStepSummary: webops'
    );
    eventBus?.send({
      event_type: 'step_summary',
      agent_name: 'webops',
      step_name: 'collection',
      message: `Collection complete: ${webOpsSummary.completed}/${webOpsSummary.total_tasks} tasks`,
      summary: webOpsSummary,
    });

    // ── Store WebOps summary in long-term memory (fire-and-forget) ──
    const retailerNames = retailers.map((r) => r.name);
    memoryAdd({
      runId,
      agentName: 'webops',
      stepName: 'collection',
      content: buildMemoryPayload(runId, 'webops', 'collection', webOpsSummary, run.question_text, retailerNames),
      retailerIds: retailerIds.length > 0 ? retailerIds : undefined,
      metadata: buildSummaryMetadata(webOpsSummary),
    });

    // ── Build collection summary ──────────────────────────────────────

    const { data: observations } = await withTimeout(
      db
        .from('observations')
        .select('*')
        .eq('run_id', runId),
      15_000,
      'load observations'
    );

    const { data: candidates } = await withTimeout(
      db
        .from('serp_candidates')
        .select('id')
        .eq('run_id', runId),
      15_000,
      'load serp_candidates'
    );

    const collectionSummary: CollectionSummary = {
      observation_count: observations?.length ?? 0,
      candidate_count: candidates?.length ?? 0,
      retailers_covered: [
        ...new Set(observations?.map((o) => o.retailer_id as string) ?? []),
      ],
      has_validation_warnings: observations?.some(
        (o) => o.validation_status === 'warn'
      ) ?? false,
    };

    // ── Phase 2: DSA Analysis ─────────────────────────────────────────

    const dsaStartedAt = new Date().toISOString();
    await withTimeout(
      db
        .from('runs')
        .update({
          status: 'analyzing',
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId),
      10_000,
      'status update: analyzing'
    );

    eventBus?.send({
      event_type: 'step_started',
      agent_name: 'dsa',
      step_name: 'analysis',
      message: 'Starting DSA analysis',
    });

    // ── Memory retrieval (best-effort) ────────────────────────────
    let priorKnowledge = '';
    if (isMemoryEnabled() && run.question_text) {
      try {
        priorKnowledge = await withTimeout(
          memorySearch({
            runId,
            query: run.question_text,
            retailerIds: retailerIds.length > 0 ? retailerIds : undefined,
            agentName: 'dsa',
          }),
          10_000,
          'memorySearch'
        );
        if (priorKnowledge) {
          eventBus?.send({
            event_type: 'task_completed',
            agent_name: 'dsa',
            step_name: 'analysis',
            tool_name: 'memory_search',
            message: `Retrieved ${priorKnowledge.split('\n').length} prior insights`,
          });
        }
      } catch (memErr) {
        console.warn('[dsa] memorySearch failed or timed out, continuing without prior knowledge:', memErr);
        priorKnowledge = '';
      }
    }

    const dsaPrompt = buildDsaPrompt(
      { run: run as Run, location, retailers },
      collectionSummary,
      priorKnowledge
    );

    const dsaUserPrompt = run.question_text
      ? `Analyze collected data and answer: ${run.question_text}\n\nRun ID: ${runId}. Read the observations, compute the answer, and call write_answer.`
      : `Run ${runId}. Analyze all collected observations and write a summary answer.`;

    const dsaTools = createDsaAnalysisToolServer();
    let dsaTurnCounter = 0;
    let dsaConsecutiveTextOnlyTurns = 0;

    const dsaWatchdog = createPhaseWatchdog({
      phaseName: 'dsa',
      hardTimeoutMs: parseInt(process.env.DSA_TIMEOUT_MS || '300000', 10),
      inactivityMs: parseInt(process.env.DSA_INACTIVITY_MS || '120000', 10),
      stuckThreshold: 3,
    });

    try {
      for await (const message of query({
        prompt: dsaUserPrompt,
        options: {
          model,
          maxTurns: dsaMaxTurns,
          systemPrompt: dsaPrompt,
          tools: [],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          mcpServers: { 'dsa-tools': dsaTools },
          abortController: dsaWatchdog.abort,
          hooks: {
            PostToolUse: [{ hooks: [dsaHook] }],
          },
        },
      })) {
        const msg = message as SDKMessage;

        // ── Init message: log tools & MCP status, fail fast if disconnected ──
        if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
          const init = msg as Extract<SDKMessage, { type: 'system'; subtype: 'init' }>;
          console.log(`[dsa] init: model=${init.model}, tools=[${init.tools.join(', ')}] (${init.tools.length})`);
          for (const srv of init.mcp_servers) {
            console.log(`[dsa] mcp_server: ${srv.name} → ${srv.status}`);
          }
          eventBus?.send({
            event_type: 'step_started',
            agent_name: 'dsa',
            step_name: 'analysis',
            message: `Init: ${init.tools.length} tools, MCP servers: ${init.mcp_servers.map((s) => `${s.name}=${s.status}`).join(', ')}`,
          });
          // Only check our own MCP server, not unrelated session servers
          const ownDsaServer = init.mcp_servers.find((s) => s.name === 'dsa-tools');
          if (ownDsaServer && ownDsaServer.status !== 'connected') {
            throw new Error(`DSA MCP server not connected: dsa-tools=${ownDsaServer.status}`);
          }
          if (!ownDsaServer) {
            throw new Error('DSA MCP server "dsa-tools" not found in init');
          }
          const dsaToolCount = init.tools.filter((t) => t.startsWith('mcp__dsa-tools__')).length;
          if (dsaToolCount === 0) {
            throw new Error('DSA init reported 0 dsa-tools — MCP server likely failed to register tools');
          }
        }

        if (msg.type === 'assistant' && 'content' in msg) {
          dsaTurnCounter++;
          const content = msg.content as Array<Record<string, unknown>>;
          const toolUseCalls = content
            .filter((c) => c.type === 'tool_use')
            .map((c) => ({ name: c.name as string, input: c.input }));
          if (toolUseCalls.length > 0) {
            dsaConsecutiveTextOnlyTurns = 0;
            for (const call of toolUseCalls) {
              const status = dsaWatchdog.recordToolUse(call.name, call.input);
              eventBus?.send({
                event_type: 'task_started',
                agent_name: 'dsa',
                step_name: 'analysis',
                tool_name: call.name,
                message: `turn ${dsaTurnCounter}: ${call.name}`,
              });
              if (status === 'stuck') break;
            }
          } else {
            dsaConsecutiveTextOnlyTurns++;
            const textContent = content
              .filter((c) => c.type === 'text')
              .map((c) => String(c.text ?? '').slice(0, 200))
              .join(' ');
            console.warn(`[dsa] WARNING: text-only turn ${dsaTurnCounter} (${dsaConsecutiveTextOnlyTurns} consecutive, no tool calls): ${textContent}`);
            if (dsaConsecutiveTextOnlyTurns >= 2) {
              console.warn(`[dsa] Aborting: ${dsaConsecutiveTextOnlyTurns} consecutive text-only turns`);
              dsaWatchdog.abort.abort();
              break;
            }
          }
        }

        if (msg.type === 'result') {
          const result = msg as Record<string, unknown>;
          if ('total_cost_usd' in result) {
            totalCostUsd += result.total_cost_usd as number;
          }
          if ('num_turns' in result) {
            totalTurns += result.num_turns as number;
          }
          // Log error details from result
          const subtype = result.subtype as string | undefined;
          if (subtype && subtype !== 'success') {
            console.warn(`[dsa] result subtype: ${subtype}`);
          }
          const errors = result.errors as string[] | undefined;
          if (errors && errors.length > 0) {
            console.warn(`[dsa] errors:`, errors);
          }
          const permDenials = result.permission_denials as Array<{ tool_name: string }> | undefined;
          if (permDenials && permDenials.length > 0) {
            console.warn(`[dsa] permission_denials:`, permDenials.map((d) => d.tool_name));
          }
        }
      }
    } finally {
      dsaWatchdog.dispose();
    }

    // ── DSA step summary ──────────────────────────────────────────────
    const dsaTimedOut = await withTimeout(
      resolveStuckTasks(runId, 'dsa', 'analysis'),
      30_000,
      'resolveStuckTasks: dsa'
    );
    if (dsaTimedOut > 0) {
      eventBus?.send({
        event_type: 'skipped',
        agent_name: 'dsa',
        step_name: 'analysis',
        message: `Watchdog: ${dsaTimedOut} stuck tasks timed out`,
      });
    }
    dsaSummary = await withTimeout(
      computeStepSummary(runId, 'dsa', 'analysis'),
      30_000,
      'computeStepSummary: dsa'
    );
    await withTimeout(
      writeStepSummary(runId, 'dsa', 'analysis', dsaSummary, dsaStartedAt),
      30_000,
      'writeStepSummary: dsa'
    );
    eventBus?.send({
      event_type: 'step_summary',
      agent_name: 'dsa',
      step_name: 'analysis',
      message: `Analysis complete: ${dsaSummary.completed}/${dsaSummary.total_tasks} tasks`,
      summary: dsaSummary,
    });

    // ── Store DSA summary in long-term memory (fire-and-forget) ──
    memoryAdd({
      runId,
      agentName: 'dsa',
      stepName: 'analysis',
      content: buildMemoryPayload(runId, 'dsa', 'analysis', dsaSummary, run.question_text, retailerNames),
      retailerIds: retailerIds.length > 0 ? retailerIds : undefined,
      metadata: buildSummaryMetadata(dsaSummary),
    });

    // ── Finalize ──────────────────────────────────────────────────────

    // Update run with total cost
    await withTimeout(
      db
        .from('runs')
        .update({
          total_cost_usd: totalCostUsd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId),
      10_000,
      'finalize: update cost'
    );

    // Check completion criteria (answer exists, no stuck tasks, summaries written)
    const { isComplete, reason } = await withTimeout(
      checkCompletionCriteria(runId),
      30_000,
      'checkCompletionCriteria'
    );

    if (!isComplete) {
      await withTimeout(
        db
          .from('runs')
          .update({
            status: 'completed_with_errors',
            finished_at: new Date().toISOString(),
            summary: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId),
        10_000,
        'finalize: update completed_with_errors'
      );

      eventBus?.send({
        event_type: 'run_complete',
        agent_name: 'dsa',
        step_name: 'analysis',
        message: `Run completed with errors: ${reason}`,
        final: {
          success: false,
          total_cost_usd: totalCostUsd,
          num_turns: totalTurns,
          webops_summary: webOpsSummary,
          dsa_summary: dsaSummary,
        },
      });
      eventBus?.dispose();

      return {
        success: false,
        totalCostUsd,
        numTurns: totalTurns,
        error: reason,
      };
    }

    // Mark run as completed now that all post-processing is done
    await withTimeout(
      db
        .from('runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId),
      10_000,
      'finalize: update completed'
    );

    // Get the answer for the response + memory storage
    const { data: answer } = await withTimeout(
      db
        .from('answers')
        .select('id, answer_text, confidence, sources_count')
        .eq('run_id', runId)
        .limit(1)
        .single(),
      15_000,
      'finalize: load answer'
    );

    // ── Store final answer in long-term memory (fire-and-forget) ──
    if (answer?.answer_text) {
      addFinalAnswerMemory({
        runId,
        answerText: answer.answer_text as string,
        confidence: answer.confidence as number | undefined,
        sourcesCount: answer.sources_count as number | undefined,
        retailerIds: retailerIds.length > 0 ? retailerIds : undefined,
      });
    }

    eventBus?.send({
      event_type: 'run_complete',
      agent_name: 'dsa',
      step_name: 'analysis',
      message: 'Run completed successfully',
      final: {
        success: true,
        answer_id: answer?.id,
        total_cost_usd: totalCostUsd,
        num_turns: totalTurns,
        webops_summary: webOpsSummary,
        dsa_summary: dsaSummary,
      },
    });
    eventBus?.dispose();

    return {
      success: true,
      answerId: answer?.id,
      totalCostUsd,
      numTurns: totalTurns,
    };
  }

  // ── Outer: race inner logic against overall timeout ──────────────────
  try {
    return await withTimeout(executeQuestionInner(), overallTimeoutMs, 'overall run timeout');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    try {
      await withTimeout(
        db
          .from('runs')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            summary: `Agent error: ${errorMsg}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId),
        10_000,
        'error handler: update status'
      );
    } catch (dbErr) {
      console.error('Failed to update run status:', dbErr);
    }

    try {
      await withTimeout(
        db.from('run_errors').insert({
          run_id: runId,
          error_code: 'AGENT_ERROR',
          error_message: errorMsg,
          error_type: 'agent_execution',
        }),
        10_000,
        'error handler: insert error'
      );
    } catch (dbErr) {
      console.error('Failed to insert run error:', dbErr);
    }

    eventBus?.send({
      event_type: 'run_complete',
      agent_name: 'dsa',
      step_name: 'analysis',
      message: `Run failed: ${errorMsg}`,
      error: { code: 'AGENT_ERROR', message: errorMsg },
      final: {
        success: false,
        total_cost_usd: totalCostUsd,
        num_turns: totalTurns,
        webops_summary: webOpsSummary,
        dsa_summary: dsaSummary,
      },
    });
    eventBus?.dispose();

    return { success: false, error: errorMsg };
  }
}
