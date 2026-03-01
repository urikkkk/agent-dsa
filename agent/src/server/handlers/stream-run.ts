import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteParams } from '../router.js';
import type { RunStatus, StepSummary, Answer } from '@agent-dsa/shared';
import { createSSEWriter } from '../sse.js';
import { getSupabase } from '../../lib/supabase.js';
import { buildSuggestedNextActions } from '../next-actions.js';

const POLL_INTERVAL_MS = 750;
const HEARTBEAT_TIMEOUT_MS = 10_000;

const TERMINAL_STATUSES: Set<RunStatus> = new Set([
  'completed',
  'completed_with_errors',
  'partial_success',
  'failed',
  'cancelled',
]);

export async function handleStreamRun(
  _req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
): Promise<void> {
  const runId = params.runId;
  const db = getSupabase();

  // Validate run exists
  const { data: run, error: runErr } = await db
    .from('runs')
    .select('id, status')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Run not found' }));
    return;
  }

  const sse = createSSEWriter(res);
  let cursor = '1970-01-01T00:00:00.000Z';
  let lastSendTime = Date.now();

  const poll = async (): Promise<void> => {
    while (!sse.isClosed()) {
      // Fetch new ledger events since cursor
      const { data: events } = await db
        .from('ledger_events')
        .select('*')
        .eq('run_id', runId)
        .gt('created_at', cursor)
        .order('created_at', { ascending: true })
        .limit(100);

      if (events && events.length > 0) {
        for (const event of events) {
          sse.sendEvent('ledger_event', event);
          cursor = event.created_at as string;
        }
        lastSendTime = Date.now();
      } else if (Date.now() - lastSendTime >= HEARTBEAT_TIMEOUT_MS) {
        sse.sendHeartbeat();
        lastSendTime = Date.now();
      }

      // Check if run has reached terminal state
      const { data: currentRun } = await db
        .from('runs')
        .select('*')
        .eq('id', runId)
        .single();

      if (currentRun && TERMINAL_STATUSES.has(currentRun.status as RunStatus)) {
        // Final drain of remaining events
        const { data: remaining } = await db
          .from('ledger_events')
          .select('*')
          .eq('run_id', runId)
          .gt('created_at', cursor)
          .order('created_at', { ascending: true })
          .limit(500);

        if (remaining) {
          for (const event of remaining) {
            sse.sendEvent('ledger_event', event);
          }
        }

        // Build run_complete event
        const { data: answer } = await db
          .from('answers')
          .select('*')
          .eq('run_id', runId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        const { data: stepRows } = await db
          .from('run_steps')
          .select('*')
          .eq('run_id', runId);

        const summaries = (stepRows ?? []) as Record<string, unknown>[];
        const stepSummaryObjects: StepSummary[] = summaries
          .map((s) => s.summary as StepSummary | undefined)
          .filter((s): s is StepSummary => !!s);

        const suggestedNextActions = buildSuggestedNextActions(
          currentRun,
          stepSummaryObjects,
          (answer as Answer) ?? null,
        );

        sse.sendEvent('run_complete', {
          run_id: runId,
          status: currentRun.status,
          final_answer: (answer as Answer)?.answer_text ?? null,
          confidence: (answer as Answer)?.confidence ?? null,
          summaries,
          suggested_next_actions: suggestedNextActions,
          total_cost_usd: currentRun.total_cost_usd ?? null,
        });

        sse.close();
        return;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  // Don't await — let the poll loop run until client disconnects or run completes
  poll().catch((err) => {
    console.error(`[stream-run] Poll error for ${runId}:`, err);
    if (!sse.isClosed()) sse.close();
  });
}
