export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

const DEFAULTS: Required<RetryOptions> = {
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

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<RetryResult<T>> {
  const options = { ...DEFAULTS, ...opts };
  const errors: RetryResult<T>['errors'] = [];

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const data = await fn();
      return { success: true, data, attempts: attempt, errors };
    } catch (err) {
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

      if (attempt < options.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  return { success: false, attempts: options.maxAttempts, errors };
}
