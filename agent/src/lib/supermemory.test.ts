import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isMemoryEnabled,
  buildMemoryTags,
  buildMemoryPayload,
  buildSummaryMetadata,
  redact,
} from './supermemory.js';
import type { StepSummary } from '@agent-dsa/shared';

// ── isMemoryEnabled ────────────────────────────────────────────

describe('isMemoryEnabled', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns false when SUPERMEMORY_ENABLED is not set', () => {
    delete process.env.SUPERMEMORY_ENABLED;
    delete process.env.SUPERMEMORY_API_KEY;
    expect(isMemoryEnabled()).toBe(false);
  });

  it('returns false when SUPERMEMORY_ENABLED=false', () => {
    process.env.SUPERMEMORY_ENABLED = 'false';
    process.env.SUPERMEMORY_API_KEY = 'sm_test123';
    expect(isMemoryEnabled()).toBe(false);
  });

  it('returns false when SUPERMEMORY_ENABLED=true but no API key', () => {
    process.env.SUPERMEMORY_ENABLED = 'true';
    delete process.env.SUPERMEMORY_API_KEY;
    expect(isMemoryEnabled()).toBe(false);
  });

  it('returns true when both SUPERMEMORY_ENABLED=true and API key present', () => {
    process.env.SUPERMEMORY_ENABLED = 'true';
    process.env.SUPERMEMORY_API_KEY = 'sm_test123';
    expect(isMemoryEnabled()).toBe(true);
  });
});

// ── buildMemoryTags ────────────────────────────────────────────

describe('buildMemoryTags', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('always includes env and org tags', () => {
    process.env.SUPERMEMORY_TAG_PREFIX = 'nimble_agents';
    const tags = buildMemoryTags({ env: 'prod' });
    expect(tags).toContain('nimble_agents:env:prod');
    expect(tags).toContain('nimble_agents:org:nimble');
  });

  it('uses default prefix when not configured', () => {
    delete process.env.SUPERMEMORY_TAG_PREFIX;
    const tags = buildMemoryTags({ env: 'dev' });
    expect(tags[0]).toBe('nimble_agents:env:dev');
  });

  it('uses custom prefix from env', () => {
    process.env.SUPERMEMORY_TAG_PREFIX = 'custom_prefix';
    const tags = buildMemoryTags({ env: 'staging' });
    expect(tags).toContain('custom_prefix:env:staging');
    expect(tags).toContain('custom_prefix:org:nimble');
  });

  it('includes optional tags when provided', () => {
    process.env.SUPERMEMORY_TAG_PREFIX = 'nimble_agents';
    const tags = buildMemoryTags({
      env: 'prod',
      userId: 'user-123',
      retailerId: 'ret-456',
      agentName: 'dsa',
      stepName: 'analysis',
      runId: 'run-789',
    });
    expect(tags).toContain('nimble_agents:user:user-123');
    expect(tags).toContain('nimble_agents:retailer:ret-456');
    expect(tags).toContain('nimble_agents:agent:dsa');
    expect(tags).toContain('nimble_agents:step:analysis');
    expect(tags).toContain('nimble_agents:run:run-789');
  });

  it('omits optional tags when values are undefined', () => {
    process.env.SUPERMEMORY_TAG_PREFIX = 'nimble_agents';
    const tags = buildMemoryTags({ env: 'dev' });
    expect(tags.length).toBe(2); // only env + org
  });

  it('includes SUPERMEMORY_DEFAULT_TAGS when set', () => {
    process.env.SUPERMEMORY_TAG_PREFIX = 'nimble_agents';
    process.env.SUPERMEMORY_DEFAULT_TAGS = 'extra_a,extra_b';
    const tags = buildMemoryTags({ env: 'dev' });
    expect(tags).toContain('extra_a');
    expect(tags).toContain('extra_b');
  });

  it('handles empty/whitespace DEFAULT_TAGS gracefully', () => {
    process.env.SUPERMEMORY_DEFAULT_TAGS = ' , ';
    const tags = buildMemoryTags({ env: 'dev' });
    // Empty strings should be filtered
    expect(tags.every((t) => t.length > 0)).toBe(true);
  });
});

// ── redact ──────────────────────────────────────────────────────

describe('redact', () => {
  it('redacts email addresses', () => {
    expect(redact('contact test@example.com for info')).toBe(
      'contact [REDACTED] for info'
    );
  });

  it('redacts phone numbers', () => {
    expect(redact('call 123-456-7890')).toBe('call [REDACTED]');
    expect(redact('call 123.456.7890')).toBe('call [REDACTED]');
    expect(redact('call 1234567890')).toBe('call [REDACTED]');
  });

  it('redacts API keys with common prefixes', () => {
    expect(redact('key: sk-abc123456789012345678901')).toBe('key: [REDACTED]');
    expect(redact('key: pk_abc123456789012345678901')).toBe('key: [REDACTED]');
    expect(redact('key: sm_abc123456789012345678901')).toBe('key: [REDACTED]');
  });

  it('redacts bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.abc')).toContain(
      '[REDACTED]'
    );
  });

  it('does not modify clean text', () => {
    const clean = 'Cheerios costs $4.99 at Walmart';
    expect(redact(clean)).toBe(clean);
  });
});

// ── buildMemoryPayload ──────────────────────────────────────────

describe('buildMemoryPayload', () => {
  const summary: StepSummary = {
    total_tasks: 10,
    completed: 8,
    failed: 1,
    skipped: 1,
    coverage_pct: 80,
    fallback_rate: 0.2,
    validation_breakdown: { pass: 6, warn: 1, fail: 1 },
    error_clusters: [{ code: 'TIMEOUT', count: 1, sample_task_id: 'abc' }],
    rerun_plan: [],
  };

  it('includes question text when provided', () => {
    const payload = buildMemoryPayload('run1', 'webops', 'collection', summary, 'Best price?');
    expect(payload).toContain('Question: Best price?');
  });

  it('includes coverage and task counts', () => {
    const payload = buildMemoryPayload('run1', 'webops', 'collection', summary);
    expect(payload).toContain('8/10 tasks completed');
    expect(payload).toContain('80% coverage');
    expect(payload).toContain('1 failed');
  });

  it('includes retailer names', () => {
    const payload = buildMemoryPayload('run1', 'webops', 'collection', summary, undefined, [
      'Walmart',
      'Amazon',
    ]);
    expect(payload).toContain('Retailers: Walmart, Amazon');
  });

  it('includes error clusters', () => {
    const payload = buildMemoryPayload('run1', 'dsa', 'analysis', summary);
    expect(payload).toContain('TIMEOUT x1');
  });

  it('includes fallback rate', () => {
    const payload = buildMemoryPayload('run1', 'webops', 'collection', summary);
    expect(payload).toContain('Fallback rate: 20%');
  });

  it('includes validation breakdown', () => {
    const payload = buildMemoryPayload('run1', 'webops', 'collection', summary);
    expect(payload).toContain('6 pass, 1 warn, 1 fail');
  });
});

// ── buildSummaryMetadata ────────────────────────────────────────

describe('buildSummaryMetadata', () => {
  it('extracts key metrics from StepSummary', () => {
    const summary: StepSummary = {
      total_tasks: 5,
      completed: 4,
      failed: 1,
      skipped: 0,
      coverage_pct: 80,
      fallback_rate: 0.1,
      validation_breakdown: { pass: 3, warn: 1, fail: 0 },
      error_clusters: [{ code: 'API_ERROR', count: 1, sample_task_id: 'x' }],
      rerun_plan: [],
    };
    const meta = buildSummaryMetadata(summary);
    expect(meta.coverage_pct).toBe(80);
    expect(meta.fallback_rate).toBe(0.1);
    expect(meta.error_codes).toEqual(['API_ERROR']);
  });
});
