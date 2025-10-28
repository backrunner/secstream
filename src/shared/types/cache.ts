/**
 * Cache interfaces for audio processing
 * Allows users to implement custom caching strategies for decoded audio
 */

/**
 * Abstract base class for audio decode caching
 * Users can extend this to implement custom cache storage (Redis, filesystem, etc.)
 */
export abstract class AudioDecodeCache {
  /**
   * Get decoded audio from cache
   * @param key - Unique identifier for the cached audio (usually hash of input)
   * @returns Cached AudioSource or null if not found
   */
  abstract get(key: string): Promise<CachedAudioSource | null> | CachedAudioSource | null;

  /**
   * Store decoded audio in cache
   * @param key - Unique identifier for the cached audio
   * @param value - The decoded audio source to cache
   * @param ttl - Optional time-to-live in milliseconds
   */
  abstract set(key: string, value: CachedAudioSource, ttl?: number): Promise<void> | void;

  /**
   * Check if a key exists in cache
   * @param key - Cache key to check
   * @returns true if key exists and is not expired
   */
  abstract has(key: string): Promise<boolean> | boolean;

  /**
   * Remove a specific key from cache
   * @param key - Cache key to remove
   */
  abstract delete(key: string): Promise<void> | void;

  /**
   * Clear all cached data
   */
  abstract clear(): Promise<void> | void;

  /**
   * Get cache statistics (optional, for monitoring)
   * @returns Statistics about cache usage
   */
  getStats?(): CacheStats | Promise<CacheStats>;

  /**
   * Get the name/identifier of this cache implementation for logging/debugging
   * @returns string - Name of the cache implementation
   */
  abstract getName(): string;
}

/**
 * Cached audio source data
 * This is a serializable version of AudioSource for caching
 */
export interface CachedAudioSource {
  /** Audio data buffer */
  data: ArrayBuffer;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of audio channels */
  channels: number;
  /** Total number of samples */
  length: number;
  /** Audio format */
  format: string;
  /** Audio metadata - complete metadata from format parser */
  metadata: {
    format: 'wav' | 'mp3' | 'flac' | 'ogg' | 'aac' | 'unknown';
    sampleRate: number;
    channels: number;
    bitDepth?: number;
    duration?: number;
    bitrate?: number;
    dataOffset: number;
    dataLength: number;
    totalSamples?: number;
  };
  /** Cached MP3 frame boundaries (if MP3 format) */
  mp3FrameBoundaries?: number[];
  /** Timestamp when cached */
  cachedAt: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of items in cache */
  size: number;
  /** Number of cache hits */
  hits?: number;
  /** Number of cache misses */
  misses?: number;
  /** Hit rate (hits / (hits + misses)) */
  hitRate?: number;
  /** Total memory used (bytes) */
  memoryUsed?: number;
  /** Number of evictions */
  evictions?: number;
}
