import type { EnrichedRunResult, Answer, Run, StepSummary } from '@agent-dsa/shared';
import { RunEventBus } from '../lib/run-events.js';
import { executeQuestion } from '../execute-question.js';
import { getSupabase } from '../lib/supabase.js';
import { buildSuggestedNextActions } from './next-actions.js';

/**
 * Wraps executeQuestion: runs the agent, then fetches final state from DB
 * to build an EnrichedRunResult with suggested next actions.
 */
export async function executeAndEnrich(runId: string): Promise<EnrichedRunResult> {
  const eventBus = new RunEventBus(runId);
  eventBus.startHeartbeat(10_000);

  let execResult: Awaited<ReturnType<typeof executeQuestion>>;
  try {
    execResult = await executeQuestion(runId, eventBus);
  } finally {
    eventBus.dispose();
  }

  const db = getSupabase();

  // Fetch the run record
  const { data: run } = await db
    .from('runs')
    .select('*')
    .eq('id', runId)
    .single();

  // Fetch answer
  const { data: answer } = await db
    .from('answers')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Fetch step summaries
  const { data: stepRows } = await db
    .from('run_steps')
    .select('*')
    .eq('run_id', runId);

  const summaries = (stepRows ?? []) as Record<string, unknown>[];
  const stepSummaryObjects: StepSummary[] = summaries
    .map((s) => s.summary as StepSummary | undefined)
    .filter((s): s is StepSummary => !!s);

  const suggestedNextActions = buildSuggestedNextActions(
    (run as Run) ?? { id: runId, status: 'failed', retailer_ids: [], parameters: {} },
    stepSummaryObjects,
    (answer as Answer) ?? null,
  );

  return {
    run_id: runId,
    success: execResult.success,
    final_answer: (answer as Answer)?.answer_text ?? null,
    confidence: (answer as Answer)?.confidence ?? null,
    summaries,
    suggested_next_actions: suggestedNextActions,
    total_cost_usd: execResult.totalCostUsd ?? null,
    num_turns: execResult.numTurns ?? null,
    error: execResult.error ?? null,
  };
}
