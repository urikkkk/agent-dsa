import { describe, it, expect, beforeEach } from 'vitest';
import { withRetry, isCircuitOpen, recordFailure, recordSuccess } from './retry.js';

describe('withRetry', () => {
  it('returns success on first try', async () => {
    const result = await withRetry(() => Promise.resolve('ok'));
    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw new Error('fail');
        return Promise.resolve('ok');
      },
      { maxAttempts: 3, baseDelayMs: 10, jitterMs: 0 }
    );
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.errors).toHaveLength(2);
  });

  it('fails after max attempts', async () => {
    const result = await withRetry(
      () => Promise.reject(new Error('always fail')),
      { maxAttempts: 2, baseDelayMs: 10, jitterMs: 0 }
    );
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  it('skips execution when circuit is open', async () => {
    const key = 'test-circuit-open';
    // Trip the circuit (3 failures = threshold)
    recordFailure(key);
    recordFailure(key);
    recordFailure(key);
    expect(isCircuitOpen(key)).toBe(true);

    const result = await withRetry(() => Promise.resolve('ok'), {
      circuitBreakerKey: key,
    });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
  });
});

describe('circuit breaker', () => {
  const key = 'test-cb';

  beforeEach(() => {
    // Reset by recording success
    recordSuccess(key);
  });

  it('opens after threshold failures', () => {
    recordFailure(key);
    recordFailure(key);
    expect(isCircuitOpen(key)).toBe(false);
    recordFailure(key);
    expect(isCircuitOpen(key)).toBe(true);
  });

  it('resets on success', () => {
    recordFailure(key);
    recordFailure(key);
    recordFailure(key);
    expect(isCircuitOpen(key)).toBe(true);
    recordSuccess(key);
    expect(isCircuitOpen(key)).toBe(false);
  });
});
