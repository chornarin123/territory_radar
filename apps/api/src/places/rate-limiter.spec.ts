import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryableStatus, RateLimiter } from './rate-limiter.js';

/** A fake clock: sleeping advances time instead of waiting. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe('RateLimiter', () => {
  it('lets the first call through immediately', async () => {
    const clock = fakeClock();
    await new RateLimiter(100, clock.now, clock.sleep).acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('spaces back-to-back calls by the interval', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(100, clock.now, clock.sleep);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([100, 100]);
  });

  it('keeps the spacing when callers arrive at the same instant', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(
      125,
      () => now,
      async (ms) => {
        waits.push(ms);
      },
    );
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(waits).toEqual([125, 250]);
    now = 1_000; // long idle: no debt carried forward
    waits.length = 0;
    await limiter.acquire();
    expect(waits).toEqual([]);
  });

  it('converts QPS to an interval', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(1000 / 8, clock.now, clock.sleep);
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([125]);
    expect(() => RateLimiter.forQps(0)).toThrow(RangeError);
  });
});

describe('backoffMs', () => {
  it('doubles the ceiling each attempt', () => {
    const top = () => 1; // always the ceiling
    expect([0, 1, 2, 3].map((a) => backoffMs(a, 500, 30_000, top))).toEqual([
      500, 1000, 2000, 4000,
    ]);
  });

  it('never exceeds the maximum', () => {
    expect(backoffMs(20, 500, 30_000, () => 1)).toBe(30_000);
  });

  it('uses full jitter between 0 and the ceiling', () => {
    expect(backoffMs(3, 500, 30_000, () => 0)).toBe(0);
    expect(backoffMs(3, 500, 30_000, () => 0.5)).toBe(2000);
  });
});

describe('isRetryableStatus', () => {
  it.each([429, 500, 502, 503])('retries %s', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404])(
    'does not retry %s — it would fail again and bill again',
    (status) => {
      expect(isRetryableStatus(status)).toBe(false);
    },
  );
});
