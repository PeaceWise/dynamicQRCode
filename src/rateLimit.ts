export interface LoginLimiterOptions {
  maxAttempts: number; // failures allowed before lockout
  windowMs: number; // failures older than this are forgotten
  lockoutMs: number; // how long a lockout lasts
}

interface Entry {
  failures: number[]; // timestamps of recent failures
  lockedUntil: number;
}

/** In-memory login rate limiter, keyed by client IP. Nothing is written to disk. */
export class LoginLimiter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly opts: LoginLimiterOptions = { maxAttempts: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 },
  ) {}

  /** Milliseconds remaining in the lockout for this key, or 0 if not locked out. */
  lockedFor(key: string, now: number): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(key: string, now: number): void {
    const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < this.opts.windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= this.opts.maxAttempts) {
      entry.lockedUntil = now + this.opts.lockoutMs;
      entry.failures = [];
    }
    this.entries.set(key, entry);
    this.prune(now);
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size < 1000) return;
    for (const [key, entry] of this.entries) {
      const recent = entry.failures.some((t) => now - t < this.opts.windowMs);
      if (!recent && entry.lockedUntil <= now) this.entries.delete(key);
    }
  }
}
