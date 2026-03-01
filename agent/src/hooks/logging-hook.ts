import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';
import {
  generateTaskId,
  storeArtifact,
  emitLedgerEvent,
} from '../lib/ledger.js';
import type { AgentName, NextActionHint } from '@agent-dsa/shared';
import type { RunEventBus } from '../lib/run-events.js';

// Allowed tools per agent (tool-door policy)
const ALLOWED_TOOLS: Record<AgentName, Set<string>> = {
  webops: new Set([
    'serp_search',
    'pdp_fetch',
    'web_search_fallback',
    'url_extract_fallback',
    'find_template',
    'write_observation',
    'write_serp_candidates',
    'dedup_and_write',
  ]),
  dsa: new Set([
    'read_config',
    'read_observations',
    'read_candidates',
    'write_answer',
  ]),
};

/**
 * PostToolUse hook that emits ledger events for every tool call.
 * Detects tool-door violations, stores artifacts with dedup,
 * and links completed/failed events back to their started span.
 *
 * IMPORTANT: This fires AFTER tool execution — it is observability-only
 * and cannot block or prevent tool calls. Real enforcement is done by
 * separating tools into distinct MCP servers in tools/index.ts:
 * WebOps gets collection tools, DSA gets analysis tools.
 * The tool-door check here is a secondary audit trail.
 */
export function createLoggingHook(
  runId: string,
  agentName: AgentName,
  stepName: string,
  eventBus?: RunEventBus
): HookCallback {
  return async (input) => {
    // Fire-and-forget wrapper
    void (async () => {
      try {
        const db = getSupabase();
        const hookInput = input as Record<string, unknown>;

        const toolName = (hookInput.tool_name as string) ?? '';
        const toolInput = hookInput.tool_input as Record<string, unknown> | undefined;
        const toolResponse = hookInput.tool_response as Record<string, unknown> | undefined;

        // ── Tool-door violation check ──
        const allowedSet = ALLOWED_TOOLS[agentName];
        if (allowedSet && !allowedSet.has(toolName)) {
          emitLedgerEvent({
            run_id: runId,
            event_type: 'tool_door_violation',
            agent_name: agentName,
            step_name: stepName,
            task_id: `violation:${toolName}`,
            attempt: 1,
            status: 'failed',
            tool_name: toolName,
            error: {
              code: 'TOOL_DOOR_VIOLATION',
              message: `Agent "${agentName}" attempted to use disallowed tool "${toolName}"`,
            },
          });
          // Legacy agent_logs writes removed — the agent_logs_v2 view
          // reconstructs this data from ledger_events + ledger_artifacts.
          return;
        }

        // ── Store artifacts (with dedup) ──
        const [inputRefId, outputRefId] = await Promise.all([
          toolInput ? storeArtifact(runId, toolInput) : undefined,
          toolResponse ? storeArtifact(runId, toolResponse) : undefined,
        ]);

        // ── Determine status ──
        const isError =
          toolResponse?.success === false ||
          toolResponse?.error != null;
        const status = isError ? 'failed' : 'completed';

        // ── Generate task_id from tool input args ──
        const retailerId = (toolInput?.retailer_id as string) ?? '';
        const keyword =
          (toolInput?.keyword as string) ??
          (toolInput?.query as string) ??
          (toolInput?.product_id as string) ??
          (toolInput?.url as string) ??
          toolName;
        const location = (toolInput?.zip_code as string) ?? undefined;
        const taskId = generateTaskId(runId, retailerId, toolName, keyword, location);

        // ── Resolve started event for span linkage ──
        let parentSpanId: string | undefined;
        let attempt = 1;
        try {
          const { data: startedEvent } = await db
            .from('ledger_events')
            .select('span_id, attempt')
            .eq('task_id', taskId)
            .eq('status', 'started')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (startedEvent) {
            parentSpanId = startedEvent.span_id as string;
            attempt = startedEvent.attempt as number;
          }
        } catch {
          // No started event found — tool was called without our wrapper
        }

        // ── Determine next_action_hint for failures ──
        let nextActionHint: NextActionHint | undefined;
        if (isError) {
          const errMsg = String(toolResponse?.error ?? '').toLowerCase();
          if (errMsg.includes('timeout')) {
            nextActionHint = 'retry';
          } else if (errMsg.includes('404') || errMsg.includes('not_found')) {
            nextActionHint = 'skip';
          } else if (errMsg.includes('rate_limit') || errMsg.includes('429')) {
            nextActionHint = 'retry';
          } else {
            nextActionHint = 'fallback';
          }
        }

        // ── Extract metrics ──
        const latencyMs = (toolResponse?.latency_ms as number) ?? undefined;

        // ── Emit terminal ledger event ──
        emitLedgerEvent({
          run_id: runId,
          event_type: 'task',
          agent_name: agentName,
          step_name: stepName,
          task_id: taskId,
          attempt,
          status,
          parent_span_id: parentSpanId,
          tool_name: toolName,
          input_ref: inputRefId,
          output_ref: outputRefId,
          error: isError
            ? {
                code: 'TOOL_ERROR',
                message: (toolResponse?.error as string) ?? 'Tool execution failed',
              }
            : undefined,
          metrics: latencyMs != null ? { latency_ms: latencyMs } : undefined,
          provenance: toolInput?.collection_tier
            ? { collection_tier: toolInput.collection_tier }
            : undefined,
          next_action_hint: nextActionHint,
        });

        // ── Emit run event ──
        if (eventBus) {
          if (isError) {
            eventBus.send({
              event_type: nextActionHint === 'retry' ? 'retrying' : 'task_failed',
              agent_name: agentName,
              step_name: stepName,
              tool_name: toolName,
              task_id: taskId,
              attempt,
              status: nextActionHint === 'retry' ? 'retrying' : 'failed',
              message: `${toolName} ${nextActionHint === 'retry' ? 'retrying' : 'failed'} (attempt ${attempt})`,
              error: { code: 'TOOL_ERROR', message: (toolResponse?.error as string) ?? 'Tool execution failed' },
              next_action_hint: nextActionHint,
            });
          } else {
            eventBus.send({
              event_type: 'task_completed',
              agent_name: agentName,
              step_name: stepName,
              tool_name: toolName,
              task_id: taskId,
              attempt,
              status: 'completed',
              message: `${toolName} completed (attempt ${attempt})`,
            });
          }
        }

        // Legacy agent_logs writes removed — the agent_logs_v2 view
        // reconstructs this data from ledger_events + ledger_artifacts.
      } catch {
        // Don't let logging failures break the agent
      }
    })();

    return {};
  };
}
