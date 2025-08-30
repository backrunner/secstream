/**
 * Buffer management and streaming strategies for SecStream
 * Allows developers to customize buffer behavior, prefetching, and cleanup policies
 */

export interface BufferEntry {
  buffer: AudioBuffer;
  playCount: number;
  lastAccessed: number;
  expiresAt: number;
  sliceIndex: number;
}

export interface BufferStats {
  totalSlices: number;
  bufferedSlices: number[];
  memoryUsage: number; // Estimated memory usage in bytes
  hitRate: number; // Cache hit rate percentage
}

/**
 * Strategy for managing audio buffer lifecycle
 * Developers can implement custom buffer retention and cleanup policies
 */
export interface BufferManagementStrategy {
  /**
   * Called when a slice is loaded into buffer
   * @param sliceIndex - Index of the loaded slice
   * @param buffer - The audio buffer
   * @returns Expiration time in milliseconds from now (0 = never expires)
   */
  onSliceLoaded: (sliceIndex: number, buffer: AudioBuffer) => number;

  /**
   * Called when a slice starts playing
   * @param sliceIndex - Index of the playing slice
   * @param buffer - The audio buffer
   * @returns Whether to keep the buffer after playback ends
   */
  onSlicePlaying: (sliceIndex: number, buffer: AudioBuffer) => boolean;

  /**
   * Called when a slice finishes playing
   * @param sliceIndex - Index of the finished slice
   * @param buffer - The audio buffer
   * @returns Whether to immediately remove the buffer
   */
  onSliceFinished: (sliceIndex: number, buffer: AudioBuffer) => boolean;

  /**
   * Called to check if buffer should be cleaned up
   * @param entry - Buffer entry with metadata
   * @param currentSlice - Currently playing slice index
   * @returns Whether to remove this buffer
   */
  shouldCleanupBuffer: (entry: BufferEntry, currentSlice: number) => boolean;

  /**
   * Called when seeking to a new position
   * @param targetSlice - Target slice index
   * @param currentSlice - Current slice index
   * @param bufferedSlices - Currently buffered slice indices
   * @returns Slices to cleanup during seek
   */
  onSeek: (targetSlice: number, currentSlice: number, bufferedSlices: number[]) => number[];
}

/**
 * Strategy for prefetching audio slices
 * Developers can implement custom prefetching logic
 */
export interface PrefetchStrategy {
  /**
   * Determines which slices to prefetch
   * @param currentSlice - Currently playing/loading slice
   * @param totalSlices - Total number of slices
   * @param bufferedSlices - Already buffered slice indices
   * @param isPlaying - Whether audio is currently playing
   * @returns Array of slice indices to prefetch
   */
  getSlicesToPrefetch: (
    currentSlice: number,
    totalSlices: number,
    bufferedSlices: number[],
    isPlaying: boolean
  ) => number[];

  /**
   * Called when prefetch completes (success or failure)
   * @param sliceIndex - Prefetched slice index
   * @param success - Whether prefetch was successful
   * @param error - Error if prefetch failed
   */
  onPrefetchComplete: (sliceIndex: number, success: boolean, error?: Error) => void;

  /**
   * Determines priority of slice loading
   * @param sliceIndex - Slice to prioritize
   * @param currentSlice - Currently playing slice
   * @returns Priority level (higher = more priority)
   */
  getSlicePriority: (sliceIndex: number, currentSlice: number) => number;
}

/**
 * Configuration for buffer expiration
 */
export interface BufferExpirationConfig {
  /** Default TTL for buffers in milliseconds (0 = never expire) */
  defaultTtl: number;
  /** Check for expired buffers every N milliseconds */
  checkInterval: number;
  /** Whether to use absolute expiration times or sliding expiration */
  useAbsoluteExpiration: boolean;
}

/**
 * Event emitted by buffer management system
 */
export interface BufferEvent {
  type: 'loaded' | 'expired' | 'cleaned' | 'hit' | 'miss';
  sliceIndex: number;
  reason?: string;
  timestamp: number;
}

/**
 * Player configuration with strategy options
 */
export interface StreamingPlayerConfig {
  /** Buffer management strategy */
  bufferStrategy?: BufferManagementStrategy;
  /** Prefetch strategy */
  prefetchStrategy?: PrefetchStrategy;
  /** Buffer expiration configuration */
  expiration?: BufferExpirationConfig;
  /** Maximum number of slices to buffer */
  maxBufferSize?: number;
  /** Maximum memory usage in bytes (0 = no limit) */
  maxMemoryUsage?: number;
  /** Enable detailed logging */
  enableLogging?: boolean;
}
