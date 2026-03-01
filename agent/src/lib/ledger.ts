import { createHash } from 'crypto';
import { getSupabase } from './supabase.js';
import type {
  AgentName,
  LedgerEvent,
  LedgerEventType,
  LedgerEventStatus,
  NextActionHint,
  StepSummary,
} from '@agent-dsa/shared';

// ── Task ID generation ──────────────────────────────────────────

/**
 * Deterministic task ID from run context.
 * Same inputs always produce the same hash → idempotent tracking.
 */
export function generateTaskId(
  runId: string,
  retailerId: string,
  operation: string,
  keyword: string,
  location?: string
): string {
  const input = `${runId}:${retailerId}:${operation}:${keyword}:${location ?? ''}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ── Attempt tracking ────────────────────────────────────────────

/**
 * Query ledger_events for prior 'started' events for this task_id.
 * Returns count + 1 (the next attempt number).
 */
export async function getAttemptNumber(taskId: string): Promise<number> {
  try {
    const db = getSupabase();
    const { count } = await db
      .from('ledger_events')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('status', 'started');
    return (count ?? 0) + 1;
  } catch {
    return 1;
  }
}

// ── Artifact storage ────────────────────────────────────────────

const MAX_INLINE_BYTES = 256_000;

/**
 * Store an artifact with SHA-256 deduplication.
 * Payloads < 256KB are stored inline; larger payloads would go to Storage (not implemented yet).
 * Fire-and-forget — errors are swallowed.
 */
export async function storeArtifact(
  runId: string,
  payload: unknown
): Promise<string | undefined> {
  try {
    const db = getSupabase();
    const jsonStr = JSON.stringify(payload);
    const sha256 = createHash('sha256').update(jsonStr).digest('hex');
    const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

    const inlinePayload = sizeBytes < MAX_INLINE_BYTES ? payload : null;
    const storageRef = sizeBytes >= MAX_INLINE_BYTES
      ? `ledger-artifacts/${runId}/${sha256.slice(0, 12)}.json`
      : null;

    // Hash-first dedup: try insert, on conflict do nothing
    const { data: inserted } = await db
      .from('ledger_artifacts')
      .insert({
        run_id: runId,
        content_type: 'application/json',
        payload: inlinePayload as Record<string, unknown> | null,
        storage_ref: storageRef,
        size_bytes: sizeBytes,
        sha256,
      })
      .select('id')
      .single();

    if (inserted?.id) return inserted.id;

    // Conflict — artifact already exists, fetch its ID
    const { data: existing } = await db
      .from('ledger_artifacts')
      .select('id')
      .eq('sha256', sha256)
      .single();

    return existing?.id;
  } catch {
    return undefined;
  }
}

// ── Event emission ──────────────────────────────────────────────

type EmitInput = Omit<LedgerEvent, 'id' | 'created_at' | 'span_id'> & {
  span_id?: string;
};

/**
 * Insert a ledger event. Returns the generated span_id.
 * Fire-and-forget — never blocks or throws.
 */
export function emitLedgerEvent(event: EmitInput): string {
  const spanId = event.span_id ?? crypto.randomUUID();

  // Fire-and-forget
  void (async () => {
    try {
      const db = getSupabase();
      await db.from('ledger_events').insert({
        run_id: event.run_id,
        event_type: event.event_type,
        agent_name: event.agent_name,
        step_name: event.step_name,
        task_id: event.task_id,
        attempt: event.attempt,
        status: event.status,
        span_id: spanId,
        parent_span_id: event.parent_span_id ?? null,
        tool_name: event.tool_name ?? null,
        input_ref: event.input_ref ?? null,
        output_ref: event.output_ref ?? null,
        error: event.error ?? null,
        metrics: event.metrics ?? null,
        provenance: event.provenance ?? null,
        next_action_hint: event.next_action_hint ?? null,
      });
    } catch {
      // Never let event emission break the agent
    }
  })();

  return spanId;
}

// ── Step summary computation ────────────────────────────────────

/**
 * Compute a step summary by aggregating ledger events for a given run+agent+step.
 */
export async function computeStepSummary(
  runId: string,
  agentName: AgentName,
  stepName: string
): Promise<StepSummary> {
  const db = getSupabase();

  // Fetch all task events for this step
  const { data: events } = await db
    .from('ledger_events')
    .select('task_id, status, error, next_action_hint, provenance')
    .eq('run_id', runId)
    .eq('agent_name', agentName)
    .eq('step_name', stepName)
    .eq('event_type', 'task');

  const allEvents = events ?? [];

  // Get unique task IDs
  const taskIds = new Set(allEvents.map((e) => e.task_id as string));

  // For each task, find its terminal status (last event)
  const taskTerminalStatus = new Map<string, string>();
  for (const taskId of taskIds) {
    const taskEvents = allEvents
      .filter((e) => e.task_id === taskId)
      .filter((e) => (e.status as string) !== 'started' && (e.status as string) !== 'retrying');

    if (taskEvents.length > 0) {
      // Use the last terminal event
      taskTerminalStatus.set(taskId, taskEvents[taskEvents.length - 1].status as string);
    }
    // If no terminal event → stuck task (handled below)
  }

  const completed = [...taskTerminalStatus.values()].filter((s) => s === 'completed').length;
  const failed = [...taskTerminalStatus.values()].filter((s) => s === 'failed').length;
  const skipped = [...taskTerminalStatus.values()].filter((s) => s === 'skipped').length;
  const totalTasks = taskIds.size;
  const coveragePct = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;

  // Fallback rate: events with provenance.collection_tier = 'search_extract'
  const fallbackEvents = allEvents.filter(
    (e) => (e.provenance as Record<string, unknown> | null)?.collection_tier === 'search_extract'
  );
  const totalTerminal = completed + failed + skipped;
  const fallbackRate = totalTerminal > 0 ? fallbackEvents.length / totalTerminal : 0;

  // Error clusters
  const errorMap = new Map<string, { count: number; sampleTaskId: string }>();
  for (const e of allEvents) {
    if ((e.status as string) === 'failed' && e.error) {
      const code = (e.error as { code?: string }).code ?? 'UNKNOWN';
      const existing = errorMap.get(code);
      if (existing) {
        existing.count++;
      } else {
        errorMap.set(code, { count: 1, sampleTaskId: e.task_id as string });
      }
    }
  }
  const errorClusters = [...errorMap.entries()].map(([code, v]) => ({
    code,
    count: v.count,
    sample_task_id: v.sampleTaskId,
  }));

  // Rerun plan: failed tasks with next_action_hint
  const rerunPlan: StepSummary['rerun_plan'] = [];
  for (const e of allEvents) {
    if ((e.status as string) === 'failed' && e.next_action_hint) {
      rerunPlan.push({
        task_id: e.task_id as string,
        next_action_hint: e.next_action_hint as NextActionHint,
        reason: (e.error as { message?: string })?.message ?? 'unknown',
      });
    }
  }

  // Stuck tasks: started with no terminal event
  for (const taskId of taskIds) {
    if (!taskTerminalStatus.has(taskId)) {
      rerunPlan.push({
        task_id: taskId,
        next_action_hint: 'retry',
        reason: 'watchdog_timeout',
      });
    }
  }

  // Validation breakdown from observations
  const { data: observations } = await db
    .from('observations')
    .select('validation_status')
    .eq('run_id', runId);

  const validationBreakdown = { pass: 0, warn: 0, fail: 0 };
  for (const obs of observations ?? []) {
    const vs = obs.validation_status as string;
    if (vs === 'pass') validationBreakdown.pass++;
    else if (vs === 'warn') validationBreakdown.warn++;
    else if (vs === 'fail') validationBreakdown.fail++;
  }

  return {
    total_tasks: totalTasks,
    completed,
    failed,
    skipped,
    coverage_pct: coveragePct,
    fallback_rate: fallbackRate,
    validation_breakdown: validationBreakdown,
    error_clusters: errorClusters,
    rerun_plan: rerunPlan,
  };
}

// ── Write step summary ──────────────────────────────────────────

export async function writeStepSummary(
  runId: string,
  agentName: AgentName,
  stepName: string,
  summary: StepSummary
): Promise<void> {
  try {
    const db = getSupabase();
    // Map step_name to run_step_type
    const stepType = stepName === 'collection' ? 'serp' : 'aggregation';
    await db.from('run_steps').insert({
      run_id: runId,
      step_type: stepType,
      agent_name: agentName,
      status: summary.failed > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      request_count: summary.total_tasks,
      success_count: summary.completed,
      failure_count: summary.failed,
      summary: summary as unknown as Record<string, unknown>,
      coverage_pct: summary.coverage_pct,
      fallback_rate: summary.fallback_rate,
      error_clusters: summary.error_clusters,
      rerun_plan: summary.rerun_plan,
    });
  } catch {
    // Don't let summary writes break the agent
  }
}

// ── Watchdog: resolve stuck tasks ───────────────────────────────

/**
 * Find 'started' events without a terminal event older than timeoutMs.
 * Emit a watchdog_timeout event for each. Returns count of timed-out tasks.
 */
export async function resolveStuckTasks(
  runId: string,
  agentName: AgentName,
  stepName: string,
  timeoutMs = 120_000
): Promise<number> {
  try {
    const db = getSupabase();
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();

    // Get all started events for this step
    const { data: startedEvents } = await db
      .from('ledger_events')
      .select('task_id, attempt, span_id, created_at')
      .eq('run_id', runId)
      .eq('agent_name', agentName)
      .eq('step_name', stepName)
      .eq('status', 'started')
      .lt('created_at', cutoff);

    if (!startedEvents || startedEvents.length === 0) return 0;

    // Get all terminal events for this step
    const { data: terminalEvents } = await db
      .from('ledger_events')
      .select('task_id, attempt')
      .eq('run_id', runId)
      .eq('agent_name', agentName)
      .eq('step_name', stepName)
      .in('status', ['completed', 'failed', 'skipped']);

    const terminalSet = new Set(
      (terminalEvents ?? []).map((e) => `${e.task_id}:${e.attempt}`)
    );

    let timedOut = 0;
    for (const event of startedEvents) {
      const key = `${event.task_id}:${event.attempt}`;
      if (!terminalSet.has(key)) {
        emitLedgerEvent({
          run_id: runId,
          event_type: 'watchdog_timeout',
          agent_name: agentName,
          step_name: stepName,
          task_id: event.task_id as string,
          attempt: event.attempt as number,
          status: 'failed',
          parent_span_id: event.span_id as string,
          error: { code: 'WATCHDOG_TIMEOUT', message: `Task stuck for >${timeoutMs}ms` },
          next_action_hint: 'retry',
        });
        timedOut++;
      }
    }

    return timedOut;
  } catch {
    return 0;
  }
}

// ── Debug data ──────────────────────────────────────────────────

export async function getRunDebugData(runId: string) {
  const db = getSupabase();

  const [eventsResult, artifactsResult, stepsResult] = await Promise.all([
    db.from('ledger_events').select('*').eq('run_id', runId).order('created_at'),
    db.from('ledger_artifacts').select('*').eq('run_id', runId),
    db.from('run_steps').select('*').eq('run_id', runId),
  ]);

  const events = eventsResult.data ?? [];
  const artifacts = artifactsResult.data ?? [];
  const summaries = stepsResult.data ?? [];

  // Group events by task_id to show attempt chains
  const retryHistory = new Map<string, typeof events>();
  for (const event of events) {
    const taskId = event.task_id as string;
    if (!retryHistory.has(taskId)) retryHistory.set(taskId, []);
    retryHistory.get(taskId)!.push(event);
  }

  return {
    events,
    artifacts,
    summaries,
    retryHistory: Object.fromEntries(retryHistory),
  };
}

// ── Completion criteria ─────────────────────────────────────────

export async function checkCompletionCriteria(
  runId: string
): Promise<{ isComplete: boolean; reason: string }> {
  const db = getSupabase();

  // Check if answer exists
  const { data: answer } = await db
    .from('answers')
    .select('id')
    .eq('run_id', runId)
    .limit(1)
    .single();

  if (!answer) {
    return { isComplete: false, reason: 'No answer produced' };
  }

  // Check for unresolved stuck tasks
  const { data: startedEvents } = await db
    .from('ledger_events')
    .select('task_id, attempt')
    .eq('run_id', runId)
    .eq('status', 'started');

  const { data: terminalEvents } = await db
    .from('ledger_events')
    .select('task_id, attempt')
    .eq('run_id', runId)
    .in('status', ['completed', 'failed', 'skipped']);

  const terminalSet = new Set(
    (terminalEvents ?? []).map((e) => `${e.task_id}:${e.attempt}`)
  );

  const stuckCount = (startedEvents ?? []).filter(
    (e) => !terminalSet.has(`${e.task_id}:${e.attempt}`)
  ).length;

  if (stuckCount > 0) {
    return { isComplete: false, reason: `${stuckCount} stuck tasks without terminal events` };
  }

  // Check for step summaries
  const { data: steps } = await db
    .from('run_steps')
    .select('agent_name')
    .eq('run_id', runId)
    .not('agent_name', 'is', null);

  const stepAgents = new Set((steps ?? []).map((s) => s.agent_name as string));
  if (!stepAgents.has('webops')) {
    return { isComplete: false, reason: 'Missing WebOps step summary' };
  }
  if (!stepAgents.has('dsa')) {
    return { isComplete: false, reason: 'Missing DSA step summary' };
  }

  return { isComplete: true, reason: 'All criteria met' };
}
