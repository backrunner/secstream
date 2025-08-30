import type {
  BufferEntry,
  BufferEvent,
  BufferManagementStrategy,
  BufferStats,
} from '../types/strategies.js';

/**
 * Buffer manager that handles expiration-based cleanup without intervals
 * Cleanup happens on-demand during operations, not on a timer
 */
export class BufferManager extends EventTarget {
  private buffers = new Map<number, BufferEntry>();
  private strategy: BufferManagementStrategy;
  private maxBufferSize: number;
  private maxMemoryUsage: number;
  private enableLogging: boolean;

  // Stats tracking
  private totalRequests = 0;
  private cacheHits = 0;

  constructor(
    strategy: BufferManagementStrategy,
    maxBufferSize: number = 10,
    maxMemoryUsage: number = 0, // 0 = no limit
    enableLogging: boolean = false,
  ) {
    super();
    this.strategy = strategy;
    this.maxBufferSize = maxBufferSize;
    this.maxMemoryUsage = maxMemoryUsage;
    this.enableLogging = enableLogging;
  }

  /**
   * Store a buffer with expiration time determined by strategy
   */
  setBuffer(sliceIndex: number, buffer: AudioBuffer): void {
    const now = Date.now();
    const ttl = this.strategy.onSliceLoaded(sliceIndex, buffer);
    const expiresAt = ttl > 0 ? now + ttl : Number.MAX_SAFE_INTEGER;

    // Clean up expired buffers before adding new one
    this.cleanupExpiredBuffers();

    const entry: BufferEntry = {
      buffer,
      playCount: 0,
      lastAccessed: now,
      expiresAt,
      sliceIndex,
    };

    this.buffers.set(sliceIndex, entry);
    this.emitEvent('loaded', sliceIndex);

    // Enforce buffer size and memory limits
    this.enforceLimits();

    if (this.enableLogging) {
      // eslint-disable-next-line no-console
      console.log(`🗂️ Buffer stored: slice ${sliceIndex}, expires in ${ttl}ms`);
    }
  }

  /**
   * Get a buffer if it exists and hasn't expired
   */
  getBuffer(sliceIndex: number): AudioBuffer | null {
    this.totalRequests++;

    // Clean up expired buffers first
    this.cleanupExpiredBuffers();

    const entry = this.buffers.get(sliceIndex);
    if (!entry) {
      this.emitEvent('miss', sliceIndex);
      return null;
    }

    // Update access time and play count
    entry.lastAccessed = Date.now();
    entry.playCount++;

    this.cacheHits++;
    this.emitEvent('hit', sliceIndex);

    if (this.enableLogging) {
      // eslint-disable-next-line no-console
      console.log(`🎯 Buffer hit: slice ${sliceIndex}, play count: ${entry.playCount}`);
    }

    return entry.buffer;
  }

  /**
   * Mark a slice as playing - strategy decides what to do
   */
  markSlicePlaying(sliceIndex: number): void {
    const entry = this.buffers.get(sliceIndex);
    if (!entry)
      return;

    const shouldKeep = this.strategy.onSlicePlaying(sliceIndex, entry.buffer);
    if (!shouldKeep) {
      this.removeBuffer(sliceIndex, 'playing');
    }
  }

  /**
   * Mark a slice as finished playing - strategy decides cleanup
   */
  markSliceFinished(sliceIndex: number): void {
    const entry = this.buffers.get(sliceIndex);
    if (!entry)
      return;

    const shouldRemove = this.strategy.onSliceFinished(sliceIndex, entry.buffer);
    if (shouldRemove) {
      this.removeBuffer(sliceIndex, 'finished');
    }
  }

  /**
   * Handle seeking - strategy decides what to cleanup
   */
  handleSeek(targetSlice: number, currentSlice: number): void {
    const bufferedSlices = Array.from(this.buffers.keys());
    const slicesToCleanup = this.strategy.onSeek(targetSlice, currentSlice, bufferedSlices);

    for (const sliceIndex of slicesToCleanup) {
      this.removeBuffer(sliceIndex, 'seek');
    }

    if (this.enableLogging && slicesToCleanup.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`🎯 Seek cleanup: removed ${slicesToCleanup.length} buffers`);
    }
  }

  /**
   * Force cleanup of a specific buffer
   */
  removeBuffer(sliceIndex: number, reason: string = 'manual'): boolean {
    const removed = this.buffers.delete(sliceIndex);
    if (removed) {
      this.emitEvent('cleaned', sliceIndex, reason);

      if (this.enableLogging) {
        // eslint-disable-next-line no-console
        console.log(`🗑️ Buffer removed: slice ${sliceIndex} (${reason})`);
      }
    }
    return removed;
  }

  /**
   * Get list of currently buffered slice indices
   */
  getBufferedSlices(): number[] {
    this.cleanupExpiredBuffers();
    return Array.from(this.buffers.keys()).sort((a, b) => a - b);
  }

  /**
   * Get buffer statistics
   */
  getStats(): BufferStats {
    this.cleanupExpiredBuffers();

    const bufferedSlices = this.getBufferedSlices();
    const memoryUsage = this.calculateMemoryUsage();
    const hitRate = this.totalRequests > 0 ? (this.cacheHits / this.totalRequests) * 100 : 0;

    return {
      totalSlices: bufferedSlices.length,
      bufferedSlices,
      memoryUsage,
      hitRate,
    };
  }

  /**
   * Clear all buffers
   */
  clear(): void {
    const sliceCount = this.buffers.size;
    this.buffers.clear();

    if (this.enableLogging && sliceCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`🗑️ Cleared all buffers (${sliceCount} slices)`);
    }
  }

  /**
   * Update the buffer management strategy
   */
  setStrategy(strategy: BufferManagementStrategy): void {
    this.strategy = strategy;
    // Re-evaluate all buffers with new strategy
    this.cleanupWithStrategy();
  }

  /**
   * Clean up expired buffers (called on-demand, not on timer)
   */
  private cleanupExpiredBuffers(): void {
    const now = Date.now();
    const expiredSlices: number[] = [];

    for (const [sliceIndex, entry] of this.buffers) {
      if (entry.expiresAt <= now) {
        expiredSlices.push(sliceIndex);
      }
    }

    for (const sliceIndex of expiredSlices) {
      this.buffers.delete(sliceIndex);
      this.emitEvent('expired', sliceIndex);
    }

    if (this.enableLogging && expiredSlices.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`⏰ Expired ${expiredSlices.length} buffers`);
    }
  }

  /**
   * Clean up buffers using strategy logic
   */
  private cleanupWithStrategy(currentSlice: number = 0): void {
    const toRemove: number[] = [];

    for (const [sliceIndex, entry] of this.buffers) {
      if (this.strategy.shouldCleanupBuffer(entry, currentSlice)) {
        toRemove.push(sliceIndex);
      }
    }

    for (const sliceIndex of toRemove) {
      this.removeBuffer(sliceIndex, 'strategy');
    }
  }

  /**
   * Enforce buffer size and memory limits
   */
  private enforceLimits(): void {
    // Enforce buffer count limit
    if (this.buffers.size > this.maxBufferSize) {
      const excess = this.buffers.size - this.maxBufferSize;
      const entries = Array.from(this.buffers.entries())
        .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed); // LRU order

      for (let i = 0; i < excess; i++) {
        const [sliceIndex] = entries[i];
        this.removeBuffer(sliceIndex, 'limit');
      }
    }

    // Enforce memory limit if specified
    if (this.maxMemoryUsage > 0) {
      while (this.calculateMemoryUsage() > this.maxMemoryUsage && this.buffers.size > 0) {
        // Remove least recently accessed buffer
        let oldestSlice = -1;
        let oldestTime = Date.now();

        for (const [sliceIndex, entry] of this.buffers) {
          if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestSlice = sliceIndex;
          }
        }

        if (oldestSlice >= 0) {
          this.removeBuffer(oldestSlice, 'memory');
        } else {
          break; // Safety break
        }
      }
    }
  }

  /**
   * Estimate memory usage of stored buffers
   */
  private calculateMemoryUsage(): number {
    let totalBytes = 0;

    for (const entry of this.buffers.values()) {
      const buffer = entry.buffer;
      // Estimate: channels * samples * 4 bytes per float32 sample
      totalBytes += buffer.numberOfChannels * buffer.length * 4;
    }

    return totalBytes;
  }

  /**
   * Emit buffer events
   */
  private emitEvent(type: BufferEvent['type'], sliceIndex: number, reason?: string): void {
    const event = new CustomEvent('bufferevent', {
      detail: {
        type,
        sliceIndex,
        reason,
        timestamp: Date.now(),
      } as BufferEvent,
    });

    this.dispatchEvent(event);
  }
}
