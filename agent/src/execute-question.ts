import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildWebOpsPrompt } from './agents/webops-prompt.js';
import { buildDsaPrompt } from './agents/dsa-prompt.js';
import type { CollectionSummary } from './agents/dsa-prompt.js';
import { createWebOpsToolServer, createDsaAnalysisToolServer } from './tools/index.js';
import { createLoggingHook } from './hooks/logging-hook.js';
import { getSupabase } from './lib/supabase.js';
import {
  resolveStuckTasks,
  computeStepSummary,
  writeStepSummary,
  checkCompletionCriteria,
} from './lib/ledger.js';
import { isMemoryEnabled, memorySearch, memoryAdd, buildMemoryPayload } from './lib/supermemory.js';
import type { Run, Location, Retailer, NimbleAgent } from '@agent-dsa/shared';

interface ExecuteResult {
  success: boolean;
  answerId?: string;
  totalCostUsd?: number;
  numTurns?: number;
  error?: string;
}

export async function executeQuestion(runId: string): Promise<ExecuteResult> {
  const db = getSupabase();

  // ── Load run context ──────────────────────────────────────────────

  const { data: run, error: runErr } = await db
    .from('runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    return { success: false, error: `Run not found: ${runErr?.message}` };
  }

  // Load location
  let location: Location | undefined;
  if (run.location_id) {
    const { data } = await db
      .from('locations')
      .select('*')
      .eq('id', run.location_id)
      .single();
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

  const { data: retailerRows } = await retailerQuery;

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
      const { data: agents } = await db
        .from('nimble_agents')
        .select('*')
        .in('id', allAgentIds);
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
  const webOpsHook = createLoggingHook(runId, 'webops', 'collection');
  const dsaHook = createLoggingHook(runId, 'dsa', 'analysis');

  let totalCostUsd = 0;
  let totalTurns = 0;

  try {
    // ── Phase 1: WebOps Collection ────────────────────────────────────

    await db
      .from('runs')
      .update({
        status: 'collecting',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    const webOpsPrompt = buildWebOpsPrompt({
      run: run as Run,
      location,
      retailers,
    });

    const webOpsUserPrompt = run.question_text
      ? `Collect data for run ${runId}: ${run.question_text}\n\nAll retailer agents are in your system prompt. Use the fast path — serp_search → pdp_fetch → write_observation. Collect from ALL target retailers.`
      : `Run ${runId}. No specific question — use find_wsa_template to discover agents, then collect broadly.`;

    const webOpsTools = createWebOpsToolServer();
    let webOpsTurnCounter = 0;

    for await (const message of query({
      prompt: webOpsUserPrompt,
      options: {
        model,
        maxTurns: webOpsMaxTurns,
        systemPrompt: webOpsPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'webops-tools': webOpsTools },
        hooks: {
          PostToolUse: [{ hooks: [webOpsHook] }],
        },
      },
    })) {
      const msg = message as SDKMessage;

      if (msg.type === 'assistant' && 'content' in msg) {
        webOpsTurnCounter++;
        const content = msg.content as Array<Record<string, unknown>>;
        const toolUses = content
          .filter((c) => c.type === 'tool_use')
          .map((c) => c.name as string);
        if (toolUses.length > 0) {
          console.log(`  [collecting] turn ${webOpsTurnCounter}: ${toolUses.join(', ')}`);
        }
      }

      if (msg.type === 'result') {
        const result = msg as Extract<SDKMessage, { type: 'result' }>;
        if ('total_cost_usd' in result) {
          totalCostUsd += (result as Record<string, unknown>).total_cost_usd as number;
        }
        if ('num_turns' in result) {
          totalTurns += (result as Record<string, unknown>).num_turns as number;
        }
      }
    }

    // ── WebOps step summary ───────────────────────────────────────────
    const webOpsTimedOut = await resolveStuckTasks(runId, 'webops', 'collection');
    if (webOpsTimedOut > 0) console.log(`  [collecting] watchdog: ${webOpsTimedOut} stuck tasks timed out`);
    const webOpsSummary = await computeStepSummary(runId, 'webops', 'collection');
    await writeStepSummary(runId, 'webops', 'collection', webOpsSummary);
    console.log(`  [collecting] summary: ${webOpsSummary.completed}/${webOpsSummary.total_tasks} tasks, ${webOpsSummary.coverage_pct.toFixed(0)}% coverage`);

    // ── Store WebOps summary in long-term memory (fire-and-forget) ──
    const retailerNames = retailers.map((r) => r.name);
    memoryAdd(
      runId, 'webops', 'webops-summary',
      buildMemoryPayload(runId, 'webops', 'collection', webOpsSummary, run.question_text, retailerNames),
      retailerIds.length > 0 ? retailerIds : undefined
    );

    // ── Build collection summary ──────────────────────────────────────

    const { data: observations } = await db
      .from('observations')
      .select('*')
      .eq('run_id', runId);

    const { data: candidates } = await db
      .from('serp_candidates')
      .select('id')
      .eq('run_id', runId);

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

    await db
      .from('runs')
      .update({
        status: 'analyzing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    // ── Memory retrieval (best-effort) ────────────────────────────
    let priorKnowledge = '';
    if (isMemoryEnabled() && run.question_text) {
      priorKnowledge = await memorySearch(
        runId,
        run.question_text,
        retailerIds.length > 0 ? retailerIds : undefined
      );
      if (priorKnowledge) {
        console.log(`  [memory] retrieved ${priorKnowledge.split('\n').length} prior insights`);
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

    for await (const message of query({
      prompt: dsaUserPrompt,
      options: {
        model,
        maxTurns: dsaMaxTurns,
        systemPrompt: dsaPrompt,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'dsa-tools': dsaTools },
        hooks: {
          PostToolUse: [{ hooks: [dsaHook] }],
        },
      },
    })) {
      const msg = message as SDKMessage;

      if (msg.type === 'assistant' && 'content' in msg) {
        dsaTurnCounter++;
        const content = msg.content as Array<Record<string, unknown>>;
        const toolUses = content
          .filter((c) => c.type === 'tool_use')
          .map((c) => c.name as string);
        if (toolUses.length > 0) {
          console.log(`  [analyzing] turn ${dsaTurnCounter}: ${toolUses.join(', ')}`);
        }
      }

      if (msg.type === 'result') {
        const result = msg as Extract<SDKMessage, { type: 'result' }>;
        if ('total_cost_usd' in result) {
          totalCostUsd += (result as Record<string, unknown>).total_cost_usd as number;
        }
        if ('num_turns' in result) {
          totalTurns += (result as Record<string, unknown>).num_turns as number;
        }
      }
    }

    // ── DSA step summary ──────────────────────────────────────────────
    const dsaTimedOut = await resolveStuckTasks(runId, 'dsa', 'analysis');
    if (dsaTimedOut > 0) console.log(`  [analyzing] watchdog: ${dsaTimedOut} stuck tasks timed out`);
    const dsaSummary = await computeStepSummary(runId, 'dsa', 'analysis');
    await writeStepSummary(runId, 'dsa', 'analysis', dsaSummary);
    console.log(`  [analyzing] summary: ${dsaSummary.completed}/${dsaSummary.total_tasks} tasks, ${dsaSummary.coverage_pct.toFixed(0)}% coverage`);

    // ── Store DSA summary in long-term memory (fire-and-forget) ──
    memoryAdd(
      runId, 'dsa', 'dsa-summary',
      buildMemoryPayload(runId, 'dsa', 'analysis', dsaSummary, run.question_text, retailerNames),
      retailerIds.length > 0 ? retailerIds : undefined
    );

    // ── Finalize ──────────────────────────────────────────────────────

    // Update run with total cost
    await db
      .from('runs')
      .update({
        total_cost_usd: totalCostUsd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    // Check completion criteria (answer exists, no stuck tasks, summaries written)
    const { isComplete, reason } = await checkCompletionCriteria(runId);

    if (!isComplete) {
      await db
        .from('runs')
        .update({
          status: 'completed_with_errors',
          finished_at: new Date().toISOString(),
          summary: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);

      return {
        success: false,
        totalCostUsd,
        numTurns: totalTurns,
        error: reason,
      };
    }

    // Get the answer ID for the response
    const { data: answer } = await db
      .from('answers')
      .select('id')
      .eq('run_id', runId)
      .limit(1)
      .single();

    return {
      success: true,
      answerId: answer?.id,
      totalCostUsd,
      numTurns: totalTurns,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await db
      .from('runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary: `Agent error: ${errorMsg}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    await db.from('run_errors').insert({
      run_id: runId,
      error_code: 'AGENT_ERROR',
      error_message: errorMsg,
      error_type: 'agent_execution',
    });

    return { success: false, error: errorMsg };
  }
}
