/**
 * Spaces outbound calls so every worker shares one global rate limit.
 * Pure mechanics, no Nest — unit-tested in rate-limiter.spec.ts.
 */
export class RateLimiter {
  private next = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  static forQps(qps: number): RateLimiter {
    if (!(qps > 0)) throw new RangeError('qps must be positive');
    return new RateLimiter(1000 / qps);
  }

  /** Resolves when the caller is allowed to make its request. */
  async acquire(): Promise<void> {
    const now = this.now();
    const readyAt = Math.max(now, this.next);
    this.next = readyAt + this.minIntervalMs;
    const wait = readyAt - now;
    if (wait > 0) await this.sleep(wait);
  }
}

/** Exponential backoff with full jitter, in milliseconds. */
export function backoffMs(
  attempt: number,
  baseMs = 500,
  maxMs = 30_000,
  random = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/** Worth retrying: rate limits, server errors and network blips. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
