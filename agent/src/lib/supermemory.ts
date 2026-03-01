import Supermemory from 'supermemory';
import { emitLedgerEvent, storeArtifact } from './ledger.js';
import { withRetry } from './retry.js';
import type { AgentName, StepSummary } from '@agent-dsa/shared';

// ── Configuration ──────────────────────────────────────────────

const TAG_PREFIX = () => process.env.SUPERMEMORY_TAG_PREFIX || 'nimble_agents';
const DEFAULT_TAGS = (): string[] => {
  const raw = process.env.SUPERMEMORY_DEFAULT_TAGS;
  return raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : [];
};

// ── Singleton client ───────────────────────────────────────────

let _client: Supermemory | null = null;
let _startupLogged = false;

export function isMemoryEnabled(): boolean {
  return process.env.SUPERMEMORY_ENABLED === 'true' && !!process.env.SUPERMEMORY_API_KEY;
}

/**
 * Initialize (or re-initialize) the Supermemory client.
 * Called lazily on first use, but can be called explicitly at startup.
 */
export function initClient(apiKey?: string): Supermemory {
  const key = apiKey ?? process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error('Missing SUPERMEMORY_API_KEY');
  _client = new Supermemory({ apiKey: key });
  return _client;
}

function getClient(): Supermemory {
  if (!_client) return initClient();
  return _client;
}

/**
 * Log Supermemory status once at startup. Safe to call multiple times.
 */
export function logMemoryStatus(): void {
  if (_startupLogged) return;
  _startupLogged = true;
  const enabled = isMemoryEnabled();
  const hasKey = !!process.env.SUPERMEMORY_API_KEY;
  console.log(
    `[supermemory] enabled=${enabled}, api_key_present=${hasKey}, tag_prefix=${TAG_PREFIX()}`
  );
}

// ── Redaction helper ────────────────────────────────────────────

const REDACT_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,  // emails
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,                          // phone numbers
  /\b(?:sk-|pk_|rk_|key-|sm_)[A-Za-z0-9_-]{20,}\b/g,        // API keys (incl. sm_ prefix)
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g,                        // bearer tokens
];

export function redact(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ── Canonical tagging ──────────────────────────────────────────

export interface TagInput {
  env?: string;
  userId?: string;
  retailerId?: string;
  agentName?: string;
  stepName?: string;
  runId?: string;
}

/**
 * Build canonical memory tags. Used for both add and search to ensure consistency.
 * Always includes env + org tags. Includes others when values are provided.
 */
export function buildMemoryTags(input: TagInput): string[] {
  const prefix = TAG_PREFIX();
  const env = input.env || process.env.NODE_ENV || 'dev';

  const tags: string[] = [
    `${prefix}:env:${env}`,
    `${prefix}:org:nimble`,
    ...DEFAULT_TAGS(),
  ];

  if (input.userId) tags.push(`${prefix}:user:${input.userId}`);
  if (input.retailerId) tags.push(`${prefix}:retailer:${input.retailerId}`);
  if (input.agentName) tags.push(`${prefix}:agent:${input.agentName}`);
  if (input.stepName) tags.push(`${prefix}:step:${input.stepName}`);
  if (input.runId) tags.push(`${prefix}:run:${input.runId}`);

  return tags;
}

/**
 * Build tags for multiple retailers (adds one tag per retailer).
 */
function buildMultiRetailerTags(
  base: Omit<TagInput, 'retailerId'>,
  retailerIds?: string[]
): string[] {
  const tags = buildMemoryTags(base);
  const prefix = TAG_PREFIX();
  if (retailerIds) {
    for (const id of retailerIds) tags.push(`${prefix}:retailer:${id}`);
  }
  return tags;
}

// ── Health check ───────────────────────────────────────────────

export interface HealthCheckResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

/**
 * Lightweight connectivity check against Supermemory.
 * Returns ok/error — never throws.
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  if (!isMemoryEnabled()) {
    return { ok: false, latency_ms: 0, error: 'Supermemory disabled' };
  }

  const start = Date.now();
  try {
    const client = getClient();
    // Use a minimal search as a health probe
    await client.search.documents({ q: '__healthcheck__', limit: 1 });
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Memory search ──────────────────────────────────────────────

interface SearchOptions {
  runId: string;
  query: string;
  retailerIds?: string[];
  userId?: string;
  agentName?: AgentName;
  limit?: number;
}

/**
 * Search long-term memory with dual-scope strategy:
 *   A) user+retailer scoped (narrower, higher relevance)
 *   B) retailer-only fallback (broader, catches cross-user data)
 * Results are merged and deduplicated by documentId.
 * Returns '' on failure (never throws).
 */
export async function memorySearch(opts: SearchOptions): Promise<string> {
  if (!isMemoryEnabled()) return '';

  const { runId, query, retailerIds, userId, agentName, limit = 5 } = opts;
  const taskId = `memory:search:${runId}`;
  const start = Date.now();

  const spanId = emitLedgerEvent({
    run_id: runId,
    event_type: 'task',
    agent_name: agentName ?? 'dsa',
    step_name: 'memory_retrieval',
    task_id: taskId,
    attempt: 1,
    status: 'started',
    tool_name: 'memory_search',
  });

  try {
    const client = getClient();
    const env = process.env.NODE_ENV || 'dev';
    const prefix = TAG_PREFIX();

    // Build tag sets for dual search
    const baseTags = [`${prefix}:env:${env}`, `${prefix}:org:nimble`];
    const retailerTags = retailerIds?.map((id) => `${prefix}:retailer:${id}`) ?? [];

    // Search A: user+retailer scoped (narrower)
    const searchATags = [...baseTags, ...retailerTags];
    if (userId) searchATags.push(`${prefix}:user:${userId}`);

    // Search B: retailer-only fallback (broader, no user filter)
    const searchBTags = [...baseTags, ...retailerTags];

    const [resultsA, resultsB] = await Promise.all([
      client.search.documents({
        q: query,
        containerTags: searchATags,
        limit,
        chunkThreshold: 0.7,
      }).catch(() => ({ results: [] as unknown[] })),
      // Only run B if user was specified (otherwise A and B would be identical)
      userId
        ? client.search.documents({
            q: query,
            containerTags: searchBTags,
            limit,
            chunkThreshold: 0.7,
          }).catch(() => ({ results: [] as unknown[] }))
        : Promise.resolve({ results: [] as unknown[] }),
    ]);

    // Merge and deduplicate by documentId
    const seen = new Set<string>();
    const merged: Array<{ documentId: string; content: string }> = [];

    for (const item of [...(resultsA.results ?? []), ...(resultsB.results ?? [])]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = item as any;
      const docId: string = raw.documentId ?? raw.customId ?? '';
      if (docId && seen.has(docId)) continue;
      if (docId) seen.add(docId);
      const text: string = raw.chunks?.[0]?.content ?? raw.content ?? '';
      merged.push({ documentId: docId, content: text });
      if (merged.length >= limit) break;
    }

    const latencyMs = Date.now() - start;

    // Store search request/response as artifact (redact query for safety)
    const artifactId = await storeArtifact(runId, {
      type: 'memory_search',
      search_a_tags: searchATags,
      search_b_tags: userId ? searchBTags : null,
      results_a_count: (resultsA.results ?? []).length,
      results_b_count: (resultsB.results ?? []).length,
      merged_count: merged.length,
      latency_ms: latencyMs,
    });

    if (merged.length === 0) {
      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: agentName ?? 'dsa',
        step_name: 'memory_retrieval',
        task_id: taskId,
        attempt: 1,
        status: 'completed',
        span_id: spanId,
        tool_name: 'memory_search',
        output_ref: artifactId,
        metrics: { latency_ms: latencyMs },
        provenance: { results_count: 0 },
      });
      return '';
    }

    const formatted = merged
      .map((item, i) => `[${i + 1}] ${item.content}`)
      .join('\n');

    emitLedgerEvent({
      run_id: runId,
      event_type: 'task',
      agent_name: agentName ?? 'dsa',
      step_name: 'memory_retrieval',
      task_id: taskId,
      attempt: 1,
      status: 'completed',
      span_id: spanId,
      tool_name: 'memory_search',
      output_ref: artifactId,
      metrics: { latency_ms: latencyMs },
      provenance: { results_count: merged.length },
    });

    return formatted;
  } catch (err) {
    const latencyMs = Date.now() - start;
    emitLedgerEvent({
      run_id: runId,
      event_type: 'task',
      agent_name: agentName ?? 'dsa',
      step_name: 'memory_retrieval',
      task_id: taskId,
      attempt: 1,
      status: 'failed',
      span_id: spanId,
      tool_name: 'memory_search',
      metrics: { latency_ms: latencyMs },
      error: {
        code: 'MEMORY_SEARCH_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
      next_action_hint: 'skip',
    });
    return '';
  }
}

// ── Memory add ─────────────────────────────────────────────────

interface AddMemoryOptions {
  runId: string;
  agentName: AgentName;
  stepName: string;
  content: string;
  retailerIds?: string[];
  userId?: string;
  metadata?: Record<string, unknown>;
  customId?: string;
}

/**
 * Store content in long-term memory.
 * Fire-and-forget — never blocks or throws.
 */
export function memoryAdd(opts: AddMemoryOptions): void {
  if (!isMemoryEnabled()) return;

  const { runId, agentName, stepName, content, retailerIds, userId, metadata, customId } = opts;
  const taskId = `memory:store:${runId}:${agentName}:${stepName}`;
  const start = Date.now();

  const spanId = emitLedgerEvent({
    run_id: runId,
    event_type: 'task',
    agent_name: agentName,
    step_name: 'memory_storage',
    task_id: taskId,
    attempt: 1,
    status: 'started',
    tool_name: 'memory_add',
  });

  void (async () => {
    try {
      const client = getClient();
      const redacted = redact(content);

      const tags = buildMultiRetailerTags(
        { env: process.env.NODE_ENV || 'dev', userId, agentName, stepName, runId },
        retailerIds
      );

      const docCustomId = customId ?? `${runId}:${agentName}:${stepName}:summary`;

      const docMetadata = {
        run_id: runId,
        agent_name: agentName,
        step_name: stepName,
        timestamp: new Date().toISOString(),
        ...metadata,
      };

      await withRetry(
        () =>
          client.documents.add({
            content: redacted,
            customId: docCustomId,
            containerTags: tags,
            metadata: docMetadata,
          }),
        { maxAttempts: 2, baseDelayMs: 500 }
      );

      const latencyMs = Date.now() - start;

      const artifactId = await storeArtifact(runId, {
        type: 'memory_add',
        custom_id: docCustomId,
        container_tags: tags,
        metadata: docMetadata,
        content_length: redacted.length,
        latency_ms: latencyMs,
      });

      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: agentName,
        step_name: 'memory_storage',
        task_id: taskId,
        attempt: 1,
        status: 'completed',
        span_id: spanId,
        tool_name: 'memory_add',
        output_ref: artifactId,
        metrics: { latency_ms: latencyMs },
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      emitLedgerEvent({
        run_id: runId,
        event_type: 'task',
        agent_name: agentName,
        step_name: 'memory_storage',
        task_id: taskId,
        attempt: 1,
        status: 'failed',
        span_id: spanId,
        tool_name: 'memory_add',
        metrics: { latency_ms: latencyMs },
        error: {
          code: 'MEMORY_STORE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
        next_action_hint: 'skip',
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

/**
 * Build summary metadata for inclusion in memory document metadata.
 */
export function buildSummaryMetadata(
  summary: StepSummary
): Record<string, unknown> {
  return {
    coverage_pct: summary.coverage_pct,
    fallback_rate: summary.fallback_rate,
    error_codes: summary.error_clusters.map((c) => c.code),
  };
}

// ── Convenience: store final answer in memory ──────────────────

export function addFinalAnswerMemory(opts: {
  runId: string;
  answerText: string;
  confidence?: number;
  sourcesCount?: number;
  retailerIds?: string[];
  userId?: string;
}): void {
  memoryAdd({
    runId: opts.runId,
    agentName: 'dsa',
    stepName: 'analysis',
    content: opts.answerText,
    retailerIds: opts.retailerIds,
    userId: opts.userId,
    customId: `${opts.runId}:final_answer`,
    metadata: {
      type: 'final_answer',
      confidence: opts.confidence,
      sources_count: opts.sourcesCount,
    },
  });
}

// ── Debug helper ───────────────────────────────────────────────

export interface MemoryDebugResult {
  enabled: boolean;
  health: HealthCheckResult | null;
  search_a: { tags: string[]; count: number; snippets: string[] };
  search_b: { tags: string[]; count: number; snippets: string[] };
  merged_count: number;
}

/**
 * Run diagnostic searches and return structured debug output.
 * Used by the debug endpoint and CLI tool.
 */
export async function debugMemory(opts: {
  runId?: string;
  retailerId?: string;
  userId?: string;
  query?: string;
}): Promise<MemoryDebugResult> {
  const result: MemoryDebugResult = {
    enabled: isMemoryEnabled(),
    health: null,
    search_a: { tags: [], count: 0, snippets: [] },
    search_b: { tags: [], count: 0, snippets: [] },
    merged_count: 0,
  };

  if (!result.enabled) return result;

  result.health = await healthCheck();
  if (!result.health.ok) return result;

  const client = getClient();
  const env = process.env.NODE_ENV || 'dev';
  const prefix = TAG_PREFIX();
  const q = opts.query || '*';

  // Search A: user+retailer scoped
  const tagsA = [`${prefix}:env:${env}`, `${prefix}:org:nimble`];
  if (opts.retailerId) tagsA.push(`${prefix}:retailer:${opts.retailerId}`);
  if (opts.userId) tagsA.push(`${prefix}:user:${opts.userId}`);
  result.search_a.tags = tagsA;

  try {
    const resA = await client.search.documents({ q, containerTags: tagsA, limit: 5 });
    const items = resA.results ?? [];
    result.search_a.count = items.length;
    result.search_a.snippets = items
      .slice(0, 2)
      .map((item) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = item as any;
        const text: string = raw.chunks?.[0]?.content ?? raw.content ?? '';
        return text.slice(0, 200);
      });
  } catch { /* non-fatal */ }

  // Search B: retailer-only (no user)
  if (opts.userId && opts.retailerId) {
    const tagsB = [`${prefix}:env:${env}`, `${prefix}:org:nimble`];
    if (opts.retailerId) tagsB.push(`${prefix}:retailer:${opts.retailerId}`);
    result.search_b.tags = tagsB;

    try {
      const resB = await client.search.documents({ q, containerTags: tagsB, limit: 5 });
      const items = resB.results ?? [];
      result.search_b.count = items.length;
      result.search_b.snippets = items
        .slice(0, 2)
        .map((item) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = item as any;
          const text: string = raw.chunks?.[0]?.content ?? raw.content ?? '';
          return text.slice(0, 200);
        });
    } catch { /* non-fatal */ }
  }

  // Merged count (dedupe by position since we don't have full merge here)
  result.merged_count = result.search_a.count + result.search_b.count;

  return result;
}
