import type {
  BufferEntry,
  BufferManagementStrategy,
  PrefetchStrategy,
} from '../types/strategies.js';

export interface ConservativeBufferStrategyConfig {
  maxBufferSize?: number;
  keepPreviousSlice?: boolean;
}

/**
 * Conservative buffer management - removes buffers immediately after playback
 * Good for high-security scenarios where content piracy is a major concern
 */
export class ConservativeBufferStrategy implements BufferManagementStrategy {
  private maxBufferSize: number;
  private keepPreviousSlice: boolean;

  constructor(config: ConservativeBufferStrategyConfig = {}) {
    this.maxBufferSize = config.maxBufferSize ?? 2; // Only current + next slice
    this.keepPreviousSlice = config.keepPreviousSlice ?? false;
  }

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

export interface AggressiveBufferStrategyConfig {
  maxBufferSize?: number;
  keepPlayedSlices?: boolean;
}

/**
 * Aggressive buffer management - keeps more buffers for smooth playback
 * Good for scenarios where user experience is prioritized over security
 */
export class AggressiveBufferStrategy implements BufferManagementStrategy {
  private maxBufferSize: number;
  private keepPlayedSlices: boolean;

  constructor(config: AggressiveBufferStrategyConfig = {}) {
    this.maxBufferSize = config.maxBufferSize ?? 10;
    this.keepPlayedSlices = config.keepPlayedSlices ?? true;
  }

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

export interface BalancedBufferStrategyConfig {
  maxBufferSize?: number;
  slidingWindow?: number;
}

/**
 * Balanced buffer management - good default for most use cases
 */
export class BalancedBufferStrategy implements BufferManagementStrategy {
  private maxBufferSize: number;
  private slidingWindow: number;

  constructor(config: BalancedBufferStrategyConfig = {}) {
    this.maxBufferSize = config.maxBufferSize ?? 5;
    this.slidingWindow = config.slidingWindow ?? 2;
  }

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

export interface LinearPrefetchStrategyConfig {
  basePrefetchAhead?: number;
  basePrefetchBehind?: number;
  maxPrefetchAhead?: number;
  minPrefetchAhead?: number;
  expectedDownloadTimeMs?: number;
}

/**
 * Simple linear prefetch strategy with network-aware buffering
 */
export class LinearPrefetchStrategy implements PrefetchStrategy {
  private downloadTimes: number[] = [];
  private downloadStartTimes = new Map<number, number>();
  private failureCount: number = 0;
  private totalAttempts: number = 0;
  private basePrefetchAhead: number;
  private basePrefetchBehind: number;
  private maxPrefetchAhead: number;
  private minPrefetchAhead: number;
  private expectedDownloadTimeMs: number;

  constructor(config: LinearPrefetchStrategyConfig = {}) {
    this.basePrefetchAhead = config.basePrefetchAhead ?? 2;
    this.basePrefetchBehind = config.basePrefetchBehind ?? 1;
    this.maxPrefetchAhead = config.maxPrefetchAhead ?? 8;
    this.minPrefetchAhead = config.minPrefetchAhead ?? 1;
    this.expectedDownloadTimeMs = config.expectedDownloadTimeMs ?? 1000; // Expected time per slice (1s default)
  }

  getSlicesToPrefetch(
    currentSlice: number,
    totalSlices: number,
    bufferedSlices: number[],
  ): number[] {
    const toFetch: number[] = [];

    // Calculate dynamic prefetch count based on network performance
    const prefetchAhead = this.calculateDynamicPrefetchAhead();

    // Prefetch ahead
    for (let i = 1; i <= prefetchAhead; i++) {
      const sliceIndex = currentSlice + i;
      if (sliceIndex < totalSlices && !bufferedSlices.includes(sliceIndex)) {
        toFetch.push(sliceIndex);
        // Track when we start requesting this slice
        this.downloadStartTimes.set(sliceIndex, Date.now());
      }
    }

    // Prefetch behind (for seeking)
    if (this.basePrefetchBehind > 0) {
      for (let i = 1; i <= this.basePrefetchBehind; i++) {
        const sliceIndex = currentSlice - i;
        if (sliceIndex >= 0 && !bufferedSlices.includes(sliceIndex)) {
          toFetch.push(sliceIndex);
          this.downloadStartTimes.set(sliceIndex, Date.now());
        }
      }
    }

    return toFetch;
  }

  onPrefetchComplete(sliceIndex: number, success: boolean, error?: Error): void {
    this.totalAttempts++;

    if (!success && error) {
      this.failureCount++;
      console.warn(`Prefetch failed for slice ${sliceIndex}:`, error);
    } else if (success) {
      // Record successful download time
      const startTime = this.downloadStartTimes.get(sliceIndex);
      if (startTime) {
        const downloadTime = Date.now() - startTime;
        this.recordDownloadTime(downloadTime);
        this.downloadStartTimes.delete(sliceIndex);
      }
    }
  }

  getSlicePriority(sliceIndex: number, currentSlice: number): number {
    const distance = Math.abs(sliceIndex - currentSlice);
    // Higher priority for slices closer to current position
    return Math.max(0, 100 - distance * 10);
  }

  /**
   * Record a download time and update network performance metrics
   */
  private recordDownloadTime(timeMs: number): void {
    this.downloadTimes.push(timeMs);

    // Keep only recent download history (last 10 downloads)
    if (this.downloadTimes.length > 10) {
      this.downloadTimes.shift();
    }
  }

  /**
   * Calculate dynamic prefetch count based on network performance
   * Slow network → prefetch more slices to compensate
   * Fast network → maintain prefetch for smooth experience
   */
  private calculateDynamicPrefetchAhead(): number {
    if (this.downloadTimes.length < 2) {
      // Not enough data, use base value
      return this.basePrefetchAhead;
    }

    // Calculate average download time
    const avgDownloadTime = this.downloadTimes.reduce((a, b) => a + b, 0) / this.downloadTimes.length;

    // Calculate performance ratio (higher = slower network)
    const performanceRatio = avgDownloadTime / this.expectedDownloadTimeMs;

    // Calculate failure rate
    const failureRate = this.totalAttempts > 0 ? this.failureCount / this.totalAttempts : 0;

    // Adjust prefetch count based on performance
    let adjustedPrefetch = this.basePrefetchAhead;

    if (performanceRatio > 2.0) {
      // Very slow network: download takes 2x longer than expected
      adjustedPrefetch = Math.min(this.maxPrefetchAhead, this.basePrefetchAhead * 2);
    } else if (performanceRatio > 1.5) {
      // Slow network: download takes 1.5x longer
      adjustedPrefetch = Math.min(this.maxPrefetchAhead, Math.ceil(this.basePrefetchAhead * 1.5));
    }

    // Additional adjustment for high failure rate
    if (failureRate > 0.2) {
      // More than 20% failure rate, increase prefetching
      adjustedPrefetch = Math.min(this.maxPrefetchAhead, adjustedPrefetch + 2);
    }

    return adjustedPrefetch;
  }

  /**
   * Get current network performance metrics (for debugging/monitoring)
   */
  getNetworkMetrics(): {
    averageDownloadTimeMs: number;
    performanceRatio: number;
    failureRate: number;
    currentPrefetchAhead: number;
  } {
    const avgDownloadTime = this.downloadTimes.length > 0
      ? this.downloadTimes.reduce((a, b) => a + b, 0) / this.downloadTimes.length
      : 0;
    const performanceRatio = avgDownloadTime / this.expectedDownloadTimeMs;
    const failureRate = this.totalAttempts > 0 ? this.failureCount / this.totalAttempts : 0;

    return {
      averageDownloadTimeMs: avgDownloadTime,
      performanceRatio,
      failureRate,
      currentPrefetchAhead: this.calculateDynamicPrefetchAhead(),
    };
  }
}

export interface AdaptivePrefetchStrategyConfig {
  basePrefetchCount?: number;
  maxPrefetchCount?: number;
  minPrefetchCount?: number;
  expectedDownloadTimeMs?: number;
}

/**
 * Adaptive prefetch strategy that adjusts based on playback patterns and network performance
 */
export class AdaptivePrefetchStrategy implements PrefetchStrategy {
  private seekHistory: number[] = [];
  private averageSeekDistance: number = 0;
  private downloadTimes: number[] = [];
  private downloadStartTimes = new Map<number, number>();
  private failureCount: number = 0;
  private totalAttempts: number = 0;
  private bufferStarvationEvents: number = 0;
  private basePrefetchCount: number;
  private maxPrefetchCount: number;
  private minPrefetchCount: number;
  private expectedDownloadTimeMs: number;

  constructor(config: AdaptivePrefetchStrategyConfig = {}) {
    this.basePrefetchCount = config.basePrefetchCount ?? 3;
    this.maxPrefetchCount = config.maxPrefetchCount ?? 12;
    this.minPrefetchCount = config.minPrefetchCount ?? 2;
    this.expectedDownloadTimeMs = config.expectedDownloadTimeMs ?? 1000; // Expected time per slice (1s default)
  }

  getSlicesToPrefetch(
    currentSlice: number,
    totalSlices: number,
    bufferedSlices: number[],
    isPlaying: boolean,
  ): number[] {
    const prefetchCount = this.calculateAdaptivePrefetchCount(isPlaying);
    const toFetch: number[] = [];

    // Always prefetch linearly ahead
    for (let i = 1; i <= prefetchCount; i++) {
      const sliceIndex = currentSlice + i;
      if (sliceIndex < totalSlices && !bufferedSlices.includes(sliceIndex)) {
        toFetch.push(sliceIndex);
        // Track when we start requesting this slice
        this.downloadStartTimes.set(sliceIndex, Date.now());
      }
    }

    // If we have seek history, prefetch common seek targets
    if (this.averageSeekDistance > 0) {
      const predictedSeek = Math.round(currentSlice + this.averageSeekDistance);
      if (predictedSeek >= 0 && predictedSeek < totalSlices
        && !bufferedSlices.includes(predictedSeek)) {
        toFetch.push(predictedSeek);
        this.downloadStartTimes.set(predictedSeek, Date.now());
      }
    }

    return toFetch;
  }

  onPrefetchComplete(sliceIndex: number, success: boolean, error?: Error): void {
    this.totalAttempts++;

    if (!success && error) {
      this.failureCount++;
      console.warn(`Adaptive prefetch failed for slice ${sliceIndex}:`, error);
    } else if (success) {
      // Record successful download time
      const startTime = this.downloadStartTimes.get(sliceIndex);
      if (startTime) {
        const downloadTime = Date.now() - startTime;
        this.recordDownloadTime(downloadTime);
        this.downloadStartTimes.delete(sliceIndex);
      }
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

  /**
   * Called when user seeks to update seek patterns
   */
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

  /**
   * Called when playback stalls due to missing buffer (buffer starvation)
   * This indicates we need to be more aggressive with prefetching
   */
  recordBufferStarvation(): void {
    this.bufferStarvationEvents++;
  }

  /**
   * Record a download time and update network performance metrics
   */
  private recordDownloadTime(timeMs: number): void {
    this.downloadTimes.push(timeMs);

    // Keep only recent download history (last 15 downloads for better adaptation)
    if (this.downloadTimes.length > 15) {
      this.downloadTimes.shift();
    }
  }

  /**
   * Calculate adaptive prefetch count based on:
   * 1. Playback state (playing vs paused)
   * 2. Network performance (slow vs fast)
   * 3. Buffer starvation events
   * 4. Download failure rate
   */
  private calculateAdaptivePrefetchCount(isPlaying: boolean): number {
    let prefetchCount = this.basePrefetchCount;

    // Factor 1: Playback state
    const playbackMultiplier = isPlaying ? 1.3 : 0.7;
    prefetchCount = Math.round(prefetchCount * playbackMultiplier);

    // Factor 2: Network performance
    if (this.downloadTimes.length >= 3) {
      const avgDownloadTime = this.downloadTimes.reduce((a, b) => a + b, 0) / this.downloadTimes.length;
      const performanceRatio = avgDownloadTime / this.expectedDownloadTimeMs;

      if (performanceRatio > 2.5) {
        // Very slow network: downloads take 2.5x longer
        prefetchCount = Math.round(prefetchCount * 2.0);
      } else if (performanceRatio > 1.8) {
        // Slow network: downloads take 1.8x longer
        prefetchCount = Math.round(prefetchCount * 1.6);
      } else if (performanceRatio > 1.3) {
        // Moderately slow network
        prefetchCount = Math.round(prefetchCount * 1.3);
      }
      // Note: On fast networks (performanceRatio < 1.0), we maintain the current prefetch count
      // for optimal user experience and resilience to sudden network degradation
    }

    // Factor 3: Buffer starvation events
    if (this.bufferStarvationEvents > 0) {
      // Each starvation event increases prefetch by 1 (up to +3)
      const starvationBonus = Math.min(3, this.bufferStarvationEvents);
      prefetchCount += starvationBonus;
    }

    // Factor 4: Download failure rate
    const failureRate = this.totalAttempts > 0 ? this.failureCount / this.totalAttempts : 0;
    if (failureRate > 0.25) {
      // More than 25% failure rate, increase significantly
      prefetchCount += 3;
    } else if (failureRate > 0.15) {
      // More than 15% failure rate, increase moderately
      prefetchCount += 2;
    }

    // Clamp to min/max bounds
    return Math.max(this.minPrefetchCount, Math.min(this.maxPrefetchCount, prefetchCount));
  }

  /**
   * Get current network and playback metrics (for debugging/monitoring)
   */
  getAdaptiveMetrics(): {
    averageDownloadTimeMs: number;
    performanceRatio: number;
    failureRate: number;
    bufferStarvationEvents: number;
    averageSeekDistance: number;
    currentPrefetchCount: number;
  } {
    const avgDownloadTime = this.downloadTimes.length > 0
      ? this.downloadTimes.reduce((a, b) => a + b, 0) / this.downloadTimes.length
      : 0;
    const performanceRatio = avgDownloadTime / this.expectedDownloadTimeMs;
    const failureRate = this.totalAttempts > 0 ? this.failureCount / this.totalAttempts : 0;

    return {
      averageDownloadTimeMs: avgDownloadTime,
      performanceRatio,
      failureRate,
      bufferStarvationEvents: this.bufferStarvationEvents,
      averageSeekDistance: this.averageSeekDistance,
      currentPrefetchCount: this.calculateAdaptivePrefetchCount(true),
    };
  }

  /**
   * Reset starvation events counter (call this after successful recovery)
   */
  resetStarvationCounter(): void {
    // Gradually reduce starvation count instead of resetting completely
    // This provides more stable behavior
    this.bufferStarvationEvents = Math.max(0, this.bufferStarvationEvents - 1);
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
