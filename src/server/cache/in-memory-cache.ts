import type { CachedAudioSource, CacheStats } from '../../shared/types/cache.js';
import { AudioDecodeCache } from '../../shared/types/cache.js';

interface CacheEntry {
  value: CachedAudioSource;
  expiresAt?: number;
  lastAccessedAt: number;
}

/**
 * Default in-memory LRU cache for decoded audio
 * Automatically evicts least recently used items when size limit is reached
 * Supports TTL expiration for cache entries
 */
export class InMemoryAudioCache extends AudioDecodeCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly defaultTtl?: number;
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;

  /**
   * Create a new in-memory audio cache
   * @param maxSize - Maximum number of entries to cache (default: 10)
   * @param defaultTtl - Default TTL in milliseconds (default: 1 hour)
   */
  constructor(maxSize: number = 10, defaultTtl?: number) {
    super();
    this.cache = new Map();
    this.maxSize = Math.max(1, maxSize);
    this.defaultTtl = defaultTtl ?? 3600_000; // 1 hour default
  }

  get(key: string): CachedAudioSource | null {
    this.cleanupExpired();

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update last accessed time for LRU
    entry.lastAccessedAt = Date.now();
    this.hits++;

    return entry.value;
  }

  set(key: string, value: CachedAudioSource, ttl?: number): void {
    const now = Date.now();
    const effectiveTtl = ttl ?? this.defaultTtl;

    const entry: CacheEntry = {
      value,
      expiresAt: effectiveTtl ? now + effectiveTtl : undefined,
      lastAccessedAt: now,
    };

    this.cache.set(key, entry);

    // Cleanup expired entries first
    this.cleanupExpired();

    // Evict LRU entries if over size limit
    if (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }

  has(key: string): boolean {
    this.cleanupExpired();

    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  getStats(): CacheStats {
    this.cleanupExpired();

    const totalRequests = this.hits + this.misses;
    let memoryUsed = 0;

    // Estimate memory usage
    for (const entry of this.cache.values()) {
      memoryUsed += entry.value.data.byteLength;
      // Add overhead for metadata (rough estimate)
      memoryUsed += 1024;
    }

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      memoryUsed,
      evictions: this.evictions,
    };
  }

  getName(): string {
    return `InMemoryAudioCache(maxSize=${this.maxSize}, ttl=${this.defaultTtl}ms)`;
  }

  /**
   * Remove expired entries from cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.cache.delete(key);
        this.evictions++;
      }
    }
  }

  /**
   * Evict least recently used entries until under size limit
   */
  private evictLRU(): void {
    // Sort by last accessed time (oldest first)
    const entries = Array.from(this.cache.entries())
      .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

    // Evict oldest entries until we're at maxSize
    const excessCount = entries.length - this.maxSize;
    for (let i = 0; i < excessCount; i++) {
      this.cache.delete(entries[i][0]);
      this.evictions++;
    }
  }
}
