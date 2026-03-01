import Supermemory from 'supermemory';
import { emitLedgerEvent } from './ledger.js';
import { withRetry } from './retry.js';
import type { AgentName, StepSummary } from '@agent-dsa/shared';

// ── Singleton client (follows supabase.ts pattern) ──────────────

let _client: Supermemory | null = null;

export function isMemoryEnabled(): boolean {
  return process.env.SUPERMEMORY_ENABLED === 'true' && !!process.env.SUPERMEMORY_API_KEY;
}

function getClient(): Supermemory {
  if (!_client) {
    const apiKey = process.env.SUPERMEMORY_API_KEY;
    if (!apiKey) throw new Error('Missing SUPERMEMORY_API_KEY');
    _client = new Supermemory({ apiKey });
  }
  return _client;
}

// ── Redaction helper ────────────────────────────────────────────

const REDACT_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,  // emails
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                          // phone numbers
  /\b(?:sk-|pk_|rk_|key-)[A-Za-z0-9_-]{20,}\b/g,             // API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g,                        // bearer tokens
];

export function redact(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ── Container tags ──────────────────────────────────────────────

function containerTags(runId: string, retailerIds?: string[]): string[] {
  const tags = ['dsa', `dsa:run:${runId}`];
  if (retailerIds) {
    for (const id of retailerIds) tags.push(`dsa:retailer:${id}`);
  }
  return tags;
}

// ── Memory search ───────────────────────────────────────────────

/**
 * Search long-term memory for prior insights relevant to the query.
 * Awaited — result is needed for prompt injection.
 * Returns '' on failure (never throws).
 */
export async function memorySearch(
  runId: string,
  query: string,
  retailerIds?: string[]
): Promise<string> {
  if (!isMemoryEnabled()) return '';

  const taskId = `memory:search:${runId}`;
  const spanId = emitLedgerEvent({
    run_id: runId,
    event_type: 'task',
    agent_name: 'dsa',
    step_name: 'memory_retrieval',
    task_id: taskId,
    attempt: 1,
    status: 'started',
  });

  try {
    const client = getClient();
    const retailerTags = retailerIds?.map((id) => `dsa:retailer:${id}`) ?? [];
    const results = await client.search.documents({
      q: query,
      containerTags: ['dsa', ...retailerTags],
      limit: 5,
      chunkThreshold: 0.7,
    });

    const items = results.results ?? [];
    if (items.length === 0) {
      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: 'dsa',
        step_name: 'memory_retrieval',
        task_id: taskId,
        attempt: 1,
        status: 'completed',
        span_id: spanId,
        provenance: { results_count: 0 },
      });
      return '';
    }

    const formatted = items
      .map((item, i) => {
        const text = item.chunks?.[0]?.content ?? item.content ?? '';
        return `[${i + 1}] ${text}`;
      })
      .join('\n');

    emitLedgerEvent({
      run_id: runId,
      event_type: 'task',
      agent_name: 'dsa',
      step_name: 'memory_retrieval',
      task_id: taskId,
      attempt: 1,
      status: 'completed',
      span_id: spanId,
      provenance: { results_count: items.length },
    });

    return formatted;
  } catch (err) {
    emitLedgerEvent({
      run_id: runId,
      event_type: 'task',
      agent_name: 'dsa',
      step_name: 'memory_retrieval',
      task_id: taskId,
      attempt: 1,
      status: 'failed',
      span_id: spanId,
      error: {
        code: 'MEMORY_SEARCH_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return '';
  }
}

// ── Memory add ──────────────────────────────────────────────────

/**
 * Store content in long-term memory.
 * Fire-and-forget — never blocks or throws.
 */
export function memoryAdd(
  runId: string,
  agentName: AgentName,
  phase: string,
  content: string,
  retailerIds?: string[]
): void {
  if (!isMemoryEnabled()) return;

  const taskId = `memory:store:${runId}:${phase}`;
  const spanId = emitLedgerEvent({
    run_id: runId,
    event_type: 'task',
    agent_name: agentName,
    step_name: 'memory_storage',
    task_id: taskId,
    attempt: 1,
    status: 'started',
  });

  // Fire-and-forget (same pattern as emitLedgerEvent in ledger.ts:116)
  void (async () => {
    try {
      const client = getClient();
      const redacted = redact(content);
      await withRetry(
        () =>
          client.documents.add({
            content: redacted,
            customId: `${runId}:${phase}`,
            containerTags: containerTags(runId, retailerIds),
            metadata: {
              runId,
              agentName,
              phase,
              createdAt: new Date().toISOString(),
            },
          }),
        { maxAttempts: 2, baseDelayMs: 500 }
      );

      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: agentName,
        step_name: 'memory_storage',
        task_id: taskId,
        attempt: 1,
        status: 'completed',
        span_id: spanId,
      });
    } catch (err) {
      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: agentName,
        step_name: 'memory_storage',
        task_id: taskId,
        attempt: 1,
        status: 'failed',
        span_id: spanId,
        error: {
          code: 'MEMORY_STORE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  })();
}

// ── Build memory payload ────────────────────────────────────────

/**
 * Compact human-readable summary from StepSummary for memory storage.
 */
export function buildMemoryPayload(
  runId: string,
  agentName: AgentName,
  stepName: string,
  summary: StepSummary,
  questionText?: string,
  retailerNames?: string[]
): string {
  const lines: string[] = [];

  if (questionText) {
    lines.push(`Question: ${questionText}`);
  }

  lines.push(
    `${agentName} ${stepName} for run ${runId}: ${summary.completed}/${summary.total_tasks} tasks completed (${summary.coverage_pct.toFixed(0)}% coverage), ${summary.failed} failed.`
  );

  if (retailerNames && retailerNames.length > 0) {
    lines.push(`Retailers: ${retailerNames.join(', ')}.`);
  }

  if (summary.error_clusters.length > 0) {
    const errors = summary.error_clusters
      .map((c) => `${c.code} x${c.count}`)
      .join(', ');
    lines.push(`Errors: ${errors}.`);
  }

  if (summary.fallback_rate > 0) {
    lines.push(`Fallback rate: ${(summary.fallback_rate * 100).toFixed(0)}%.`);
  }

  const v = summary.validation_breakdown;
  if (v.pass + v.warn + v.fail > 0) {
    lines.push(`Validation: ${v.pass} pass, ${v.warn} warn, ${v.fail} fail.`);
  }

  return lines.join(' ');
}
