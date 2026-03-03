import type { CircuitBreakerState } from '@agent-dsa/shared';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  /** Circuit breaker key (e.g. `${retailerId}:${toolName}`). If set, checks before each attempt. */
  circuitBreakerKey?: string;
  /** Skip circuit breaker checks entirely. Useful for batch scripts that control retry behavior themselves. */
  skipCircuitBreaker?: boolean;
}

const DEFAULTS: Required<Omit<RetryOptions, 'circuitBreakerKey' | 'skipCircuitBreaker'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterMs: 500,
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  attempts: number;
  errors: Array<{ attempt: number; error: string; backoffMs: number }>;
}

// ── Circuit Breaker ─────────────────────────────────────────────

// In-memory circuit breaker state is intentional: the daemon runs as a single
// long-lived process, so volatile state gives us per-process isolation without
// needing a shared store. State resets naturally on restart, which is desirable
// since transient failures (e.g. network blips) shouldn't persist across deploys.
const circuitBreakers = new Map<string, CircuitBreakerState>();

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60_000;

export function isCircuitOpen(key: string): boolean {
  const state = circuitBreakers.get(key);
  if (!state || !state.isOpen) return false;
  // Auto-reset after cooldown
  if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    state.isOpen = false;
    state.failures = 0;
    return false;
  }
  return true;
}

export function recordSuccess(key: string): void {
  const state = circuitBreakers.get(key);
  if (state) {
    state.failures = 0;
    state.isOpen = false;
  }
}

export function recordFailure(key: string): void {
  let state = circuitBreakers.get(key);
  if (!state) {
    state = { failures: 0, lastFailure: 0, isOpen: false };
    circuitBreakers.set(key, state);
  }
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.isOpen = true;
  }
}

// ── Retry with circuit breaker integration ──────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<RetryResult<T>> {
  const { circuitBreakerKey, skipCircuitBreaker, ...rest } = opts ?? {};
  const options = { ...DEFAULTS, ...rest };
  const errors: RetryResult<T>['errors'] = [];
  const useCb = circuitBreakerKey && !skipCircuitBreaker;

  // Circuit breaker pre-check
  if (useCb && isCircuitOpen(circuitBreakerKey)) {
    return {
      success: false,
      attempts: 0,
      errors: [{ attempt: 0, error: `Circuit open for ${circuitBreakerKey}`, backoffMs: 0 }],
    };
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const data = await fn();
      if (useCb) recordSuccess(circuitBreakerKey);
      return { success: true, data, attempts: attempt, errors };
    } catch (err) {
      if (useCb) recordFailure(circuitBreakerKey);

      const backoffMs = Math.min(
        options.baseDelayMs * Math.pow(2, attempt - 1) +
          Math.floor(Math.random() * options.jitterMs * 2 - options.jitterMs),
        options.maxDelayMs
      );
      errors.push({
        attempt,
        error: err instanceof Error ? err.message : String(err),
        backoffMs,
      });

      // Check if circuit opened after this failure
      if (useCb && isCircuitOpen(circuitBreakerKey)) {
        return { success: false, attempts: attempt, errors };
      }

      if (attempt < options.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  return { success: false, attempts: options.maxAttempts, errors };
}
