import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from '../lib/supabase.js';
import {
  generateTaskId,
  storeArtifact,
  emitLedgerEvent,
} from '../lib/ledger.js';
import type { AgentName, NextActionHint } from '@agent-dsa/shared';

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
 */
export function createLoggingHook(
  runId: string,
  agentName: AgentName,
  stepName: string
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
          // Also write to legacy agent_logs for backward compat
          await db.from('agent_logs').insert({
            run_id: runId,
            session_id: agentName,
            tool_name: toolName,
            tool_input: toolInput ?? null,
            tool_output: toolResponse ?? null,
          });
          return;
        }

        // ── Store artifacts (with dedup) ──
        const [inputRefId, outputRefId] = await Promise.all([
          toolInput ? storeArtifact(runId, toolInput) : undefined,
          toolResponse ? storeArtifact(runId, toolResponse) : undefined,
        ]);

        // ── Determine status ──
        const responseStr = JSON.stringify(toolResponse ?? {});
        const isError =
          responseStr.includes('"success":false') ||
          responseStr.includes('"error"') ||
          responseStr.includes('failed');
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
          if (responseStr.includes('timeout') || responseStr.includes('TIMEOUT')) {
            nextActionHint = 'retry';
          } else if (responseStr.includes('404') || responseStr.includes('not_found')) {
            nextActionHint = 'skip';
          } else if (responseStr.includes('rate_limit') || responseStr.includes('429')) {
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

        // ── Also write to legacy agent_logs for backward compat ──
        await db.from('agent_logs').insert({
          run_id: runId,
          session_id: agentName,
          tool_name: toolName,
          tool_input: toolInput ?? null,
          tool_output: toolResponse ?? null,
        });
      } catch {
        // Don't let logging failures break the agent
      }
    })();

    return {};
  };
}
