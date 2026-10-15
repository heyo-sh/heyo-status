import { getStatusSnapshot } from "./snapshot";
import type { StatusPageConfig, StatusSnapshot } from "./types";

export interface StatusSnapshotCache {
  /**
   * Returns the public snapshot. Passing an explicit clock bypasses the cache
   * entirely so programmatic and test callers stay deterministic.
   */
  get(now?: Date): Promise<StatusSnapshot>;
  /** Drops the cached snapshot, for example after a write. */
  invalidate(): void;
}

export interface StatusSnapshotCacheOptions {
  /** Injectable loader, used by tests to count database reads. */
  load?: (config: StatusPageConfig, now?: Date) => Promise<StatusSnapshot>;
  /** Injectable clock for deterministic expiry tests. */
  clock?: () => number;
}

/**
 * A single-entry, in-process snapshot cache. Status pages are read-heavy and a
 * snapshot is derived from a whole retention window, so serving the same value
 * for a short TTL removes most of the database work on a busy page.
 */
export function createStatusSnapshotCache(
  config: StatusPageConfig,
  options: StatusSnapshotCacheOptions = {},
): StatusSnapshotCache {
  const load = options.load ?? getStatusSnapshot;
  const clock = options.clock ?? Date.now;
  const ttlMs = Math.max(0, config.cache.snapshotTtlMs);

  let cached: { snapshot: StatusSnapshot; expiresAt: number } | null = null;
  let pending: Promise<StatusSnapshot> | null = null;

  return {
    async get(now?: Date) {
      if (now !== undefined || ttlMs === 0) return load(config, now);
      if (cached && cached.expiresAt > clock()) return cached.snapshot;
      // Collapse concurrent misses into one database read.
      pending ??= load(config)
        .then((snapshot) => {
          cached = { snapshot, expiresAt: clock() + ttlMs };
          return snapshot;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    invalidate() {
      cached = null;
    },
  };
}
