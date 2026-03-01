import type {
  Run,
  StepSummary,
  Answer,
  SuggestedAction,
} from '@agent-dsa/shared';

/**
 * Pure function — no DB access.
 * Builds deterministic suggested next actions from run outcome.
 */
export function buildSuggestedNextActions(
  run: Run,
  steps: StepSummary[],
  answer: Answer | null,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // 1. retry_failed — if any rerun_plan entry has retry/fallback hint
  const retryable = steps.flatMap((s) =>
    s.rerun_plan.filter(
      (r) => r.next_action_hint === 'retry' || r.next_action_hint === 'fallback',
    ),
  );
  if (retryable.length > 0) {
    actions.push({
      action: 'retry_failed',
      label: `Retry ${retryable.length} failed task${retryable.length > 1 ? 's' : ''}`,
      description:
        'Re-run tasks that failed during collection, using fallback strategies where available.',
      payload: {
        task_ids: retryable.map((r) => r.task_id),
        rerun_plan: retryable,
      },
    });
  }

  // 2. show_debug — always available for terminal runs
  actions.push({
    action: 'show_debug',
    label: 'Show debug data',
    description:
      'View ledger events, artifacts, step summaries, and retry history for this run.',
    payload: { run_id: run.id },
  });

  // 3. rerun_with_location — if run had no location
  if (!run.location_id) {
    actions.push({
      action: 'rerun_with_location',
      label: 'Re-run with location',
      description:
        'Re-run this question targeting a specific geographic location for localized pricing.',
      payload: { original_run_id: run.id, question_text: run.question_text },
    });
  }

  // 4. rerun_broader — if webops coverage < 50% and there were skipped tasks
  const webopsStep = steps.find(
    (s) => s.total_tasks > 0 && s.coverage_pct < 50,
  );
  const hasSkipped = steps.some((s) => s.skipped > 0);
  if (webopsStep && hasSkipped) {
    actions.push({
      action: 'rerun_broader',
      label: 'Re-run with broader scope',
      description:
        `Coverage was only ${webopsStep.coverage_pct.toFixed(0)}% with skipped tasks. ` +
        'Re-run with relaxed parameters to improve data collection.',
      payload: {
        original_run_id: run.id,
        question_text: run.question_text,
        coverage_pct: webopsStep.coverage_pct,
      },
    });
  }

  return actions;
}
