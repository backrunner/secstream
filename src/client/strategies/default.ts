import type {
  BufferEntry,
  BufferManagementStrategy,
  PrefetchStrategy,
} from '../types/strategies.js';

/**
 * Conservative buffer management - removes buffers immediately after playback
 * Good for high-security scenarios where content piracy is a major concern
 */
export class ConservativeBufferStrategy implements BufferManagementStrategy {
  constructor(
    private maxBufferSize: number = 2, // Only current + next slice
    private keepPreviousSlice: boolean = false,
  ) {}

  onSliceLoaded(_sliceIndex: number, _buffer: AudioBuffer): number {
    // Conservative: expire buffers quickly (30 seconds)
    return 30_000;
  }

  onSlicePlaying(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Don't keep buffer during playback in conservative mode
    return false;
  }

  onSliceFinished(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Immediately remove finished buffers
    return true;
  }

  shouldCleanupBuffer(entry: BufferEntry, currentSlice: number): boolean {
    // Cleanup if expired or if too far from current position
    const isExpired = Date.now() > entry.expiresAt;
    const tooFarBehind = entry.sliceIndex < currentSlice - (this.keepPreviousSlice ? 1 : 0);
    const tooFarAhead = entry.sliceIndex > currentSlice + this.maxBufferSize - 1;

    return isExpired || tooFarBehind || tooFarAhead;
  }

  onSeek(targetSlice: number, currentSlice: number, bufferedSlices: number[]): number[] {
    // Conservative: cleanup all buffers except target and next
    return bufferedSlices.filter(slice =>
      slice < targetSlice || slice > targetSlice + 1,
    );
  }
}

/**
 * Aggressive buffer management - keeps more buffers for smooth playback
 * Good for scenarios where user experience is prioritized over security
 */
export class AggressiveBufferStrategy implements BufferManagementStrategy {
  constructor(
    private maxBufferSize: number = 10,
    private keepPlayedSlices: boolean = true,
  ) {}

  onSliceLoaded(_sliceIndex: number, _buffer: AudioBuffer): number {
    // Aggressive: longer expiration (5 minutes)
    return 300_000;
  }

  onSlicePlaying(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Keep buffer during playback for potential seeking
    return true;
  }

  onSliceFinished(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Don't immediately remove - keep for seeking
    return false;
  }

  shouldCleanupBuffer(entry: BufferEntry): boolean {
    // Only cleanup if expired or buffer is full
    return Date.now() > entry.expiresAt;
  }

  onSeek(targetSlice: number, currentSlice: number, bufferedSlices: number[]): number[] {
    // Aggressive: keep most buffers during seek
    if (bufferedSlices.length <= this.maxBufferSize) {
      return [];
    }

    // Only cleanup buffers that are very far from target
    return bufferedSlices.filter(slice =>
      Math.abs(slice - targetSlice) > this.maxBufferSize / 2,
    );
  }
}

/**
 * Balanced buffer management - good default for most use cases
 */
export class BalancedBufferStrategy implements BufferManagementStrategy {
  constructor(
    private maxBufferSize: number = 5,
    private slidingWindow: number = 2,
  ) {}

  onSliceLoaded(_sliceIndex: number, _buffer: AudioBuffer): number {
    // Balanced: moderate expiration (2 minutes)
    return 120_000;
  }

  onSlicePlaying(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Keep buffer for a short while during playback
    return true;
  }

  onSliceFinished(_sliceIndex: number, _buffer: AudioBuffer): boolean {
    // Remove after a delay, not immediately
    return false;
  }

  shouldCleanupBuffer(entry: BufferEntry, currentSlice: number): boolean {
    const isExpired = Date.now() > entry.expiresAt;
    const outsideWindow = Math.abs(entry.sliceIndex - currentSlice) > this.slidingWindow;

    return isExpired || outsideWindow;
  }

  onSeek(targetSlice: number, currentSlice: number, bufferedSlices: number[]): number[] {
    // Balanced: keep slices within sliding window of target
    return bufferedSlices.filter(slice =>
      Math.abs(slice - targetSlice) > this.slidingWindow,
    );
  }
}

/**
 * Simple linear prefetch strategy
 */
export class LinearPrefetchStrategy implements PrefetchStrategy {
  constructor(
    private prefetchAhead: number = 2,
    private prefetchBehind: number = 1,
  ) {}

  getSlicesToPrefetch(
    currentSlice: number,
    totalSlices: number,
    bufferedSlices: number[],
  ): number[] {
    const toFetch: number[] = [];

    // Prefetch ahead
    for (let i = 1; i <= this.prefetchAhead; i++) {
      const sliceIndex = currentSlice + i;
      if (sliceIndex < totalSlices && !bufferedSlices.includes(sliceIndex)) {
        toFetch.push(sliceIndex);
      }
    }

    // Prefetch behind (for seeking)
    if (this.prefetchBehind > 0) {
      for (let i = 1; i <= this.prefetchBehind; i++) {
        const sliceIndex = currentSlice - i;
        if (sliceIndex >= 0 && !bufferedSlices.includes(sliceIndex)) {
          toFetch.push(sliceIndex);
        }
      }
    }

    return toFetch;
  }

  onPrefetchComplete(sliceIndex: number, success: boolean, error?: Error): void {
    if (!success && error) {
      console.warn(`Prefetch failed for slice ${sliceIndex}:`, error);
    }
  }

  getSlicePriority(sliceIndex: number, currentSlice: number): number {
    const distance = Math.abs(sliceIndex - currentSlice);
    // Higher priority for slices closer to current position
    return Math.max(0, 100 - distance * 10);
  }
}

/**
 * Adaptive prefetch strategy that adjusts based on playback patterns
 */
export class AdaptivePrefetchStrategy implements PrefetchStrategy {
  private seekHistory: number[] = [];
  private averageSeekDistance: number = 0;

  constructor(
    private basePrefetchCount: number = 3,
    private maxPrefetchCount: number = 8,
  ) {}

  getSlicesToPrefetch(
    currentSlice: number,
    totalSlices: number,
    bufferedSlices: number[],
    isPlaying: boolean,
  ): number[] {
    const prefetchCount = this.calculatePrefetchCount(isPlaying);
    const toFetch: number[] = [];

    // Always prefetch linearly ahead
    for (let i = 1; i <= prefetchCount; i++) {
      const sliceIndex = currentSlice + i;
      if (sliceIndex < totalSlices && !bufferedSlices.includes(sliceIndex)) {
        toFetch.push(sliceIndex);
      }
    }

    // If we have seek history, prefetch common seek targets
    if (this.averageSeekDistance > 0) {
      const predictedSeek = Math.round(currentSlice + this.averageSeekDistance);
      if (predictedSeek >= 0 && predictedSeek < totalSlices
        && !bufferedSlices.includes(predictedSeek)) {
        toFetch.push(predictedSeek);
      }
    }

    return toFetch;
  }

  onPrefetchComplete(sliceIndex: number, success: boolean, error?: Error): void {
    if (!success && error) {
      console.warn(`Adaptive prefetch failed for slice ${sliceIndex}:`, error);
    }
  }

  getSlicePriority(sliceIndex: number, currentSlice: number): number {
    const distance = Math.abs(sliceIndex - currentSlice);

    // Higher priority for linear playback
    if (sliceIndex > currentSlice && sliceIndex <= currentSlice + 3) {
      return 100 - distance;
    }

    // Medium priority for predicted seeks
    const predictedSeek = Math.round(currentSlice + this.averageSeekDistance);
    if (sliceIndex === predictedSeek) {
      return 80;
    }

    // Lower priority for others
    return Math.max(0, 50 - distance * 5);
  }

  // Called when user seeks to update seek patterns
  recordSeek(fromSlice: number, toSlice: number): void {
    const seekDistance = toSlice - fromSlice;
    this.seekHistory.push(seekDistance);

    // Keep only recent seek history
    if (this.seekHistory.length > 10) {
      this.seekHistory.shift();
    }

    // Update average seek distance
    this.averageSeekDistance = this.seekHistory.reduce((a, b) => a + b, 0) / this.seekHistory.length;
  }

  private calculatePrefetchCount(isPlaying: boolean): number {
    // Prefetch more when playing, less when paused
    const multiplier = isPlaying ? 1.5 : 0.8;
    return Math.min(
      this.maxPrefetchCount,
      Math.round(this.basePrefetchCount * multiplier),
    );
  }
}

/**
 * No prefetch strategy - only loads slices on demand
 */
export class NoPrefetchStrategy implements PrefetchStrategy {
  getSlicesToPrefetch(): number[] {
    return []; // Never prefetch
  }

  onPrefetchComplete(): void {
    // No-op
  }

  getSlicePriority(sliceIndex: number, currentSlice: number): number {
    // Only prioritize current slice
    return sliceIndex === currentSlice ? 100 : 0;
  }
}
