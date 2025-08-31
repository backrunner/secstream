import type { SecureAudioClient } from './client.js';

export type PlayerEvent = 'play' | 'pause' | 'stop' | 'timeupdate' | 'ended' | 'error' | 'seek' | 'buffering' | 'buffered';

export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  isBuffering: boolean;
  isEnded: boolean;
  currentTime: number;
  duration: number;
  currentSlice: number;
  totalSlices: number;
}

export interface PlayerConfig {
  bufferingTimeoutMs?: number; // Default: 10000ms (10 seconds)
}

/**
 * Simple secure audio player for encrypted audio streaming
 * Focuses only on audio playback - developers handle slice loading
 */
export class SecureAudioPlayer extends EventTarget {
  private client: SecureAudioClient;
  private audioContext: AudioContext;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode;
  private config: PlayerConfig;

  // Playback state
  private _isPlaying = false;
  private _isPaused = false;
  private _isBuffering = false;
  private _isEnded = false;
  private _currentSliceIndex = 0;
  private _pausedAt = 0;
  private _playbackStartTime = 0;
  private _sliceOffsetSeconds = 0; // Offset within the current slice for precise seeking
  private _progressTimer: number | null = null;
  private _seekOperationId = 0; // Incremental ID for seek operations
  private _currentSeekOperationId: number | null = null; // Track current seek operation ID
  private _isSeeking = false; // Flag to indicate if seeking is in progress
  private _bufferingTimeout: number | null = null; // Timeout for buffering state

  constructor(client: SecureAudioClient, config: PlayerConfig = {}) {
    super();
    this.client = client;
    this.config = {
      bufferingTimeoutMs: 10000, // Default 10 seconds
      ...config,
    };
    // Reuse client's AudioContext to ensure identical sampleRate and avoid resampling artifacts
    this.audioContext = this.client.getAudioContext();

    // Create audio graph
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  /**
   * Safely stop and cleanup current source without triggering onended side-effects
   */
  private stopCurrentSourceSilently(): void {
    if (!this.currentSource)
      return;

    try {
      // Prevent onended from firing due to manual stop
      this.currentSource.onended = null;
      this.currentSource.stop();
    } catch {
      // Ignore errors from stopping already-stopped sources
    }
    try {
      this.currentSource.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.currentSource = null;
  }

  /**
   * Play audio from current position
   * Developers must ensure the current slice is loaded
   */
  async play(): Promise<void> {
    if (this._isPlaying)
      return;

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo) {
      throw new Error('No session initialized');
    }

    // Clear ended state when starting to play
    const wasEnded = this._isEnded;
    this._isEnded = false;

    // If playback had ended previously, restart from the beginning
    if (wasEnded) {
      this._currentSliceIndex = 0;
      this._sliceOffsetSeconds = 0;
      this._pausedAt = 0;
      this._playbackStartTime = 0;
    }

    await this.playCurrentSlice();

    // Start realtime progress updates
    this.startProgressUpdates();
  }

  /**
   * Pause audio playback
   */
  pause(): void {
    if (!this._isPlaying)
      return;

    this._isPaused = true;
    this._isPlaying = false;

    // Clear buffering state when manually paused
    this.exitBufferingState();

    // Calculate accurate pause position
    if (this._playbackStartTime > 0) {
      this._pausedAt = this.audioContext.currentTime;
    }

    this.stopCurrentSourceSilently();

    // Stop progress updates
    this.stopProgressUpdates();

    // Only dispatch pause event if not in the middle of seeking
    if (!this._isSeeking) {
      this.dispatchEvent(new CustomEvent('pause'));
    }
  }

  /**
   * Stop audio playback
   */
  stop(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._isEnded = false;
    this._currentSliceIndex = 0;
    this._pausedAt = 0;
    this._playbackStartTime = 0;
    this._sliceOffsetSeconds = 0;

    // Clear buffering state
    this.exitBufferingState();

    this.stopCurrentSourceSilently();

    // Stop progress updates
    this.stopProgressUpdates();

    this.dispatchEvent(new CustomEvent('stop'));
  }

  /**
   * Mark audio as ended (different from stop - maintains position)
   */
  private end(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._isEnded = true;

    // Clear buffering state
    this.exitBufferingState();

    // Stop current audio source
    this.stopCurrentSourceSilently();

    this.stopProgressUpdates();
    this.dispatchEvent(new CustomEvent('ended'));
  }

  /**
   * Seek to specific time position with optimized accuracy and performance
   * @param timeSeconds - The target time position in seconds
   * @param autoResume - Optional. If true, automatically resume playback if it was playing before seeking
   */
  async seekToTime(timeSeconds: number, autoResume: boolean = false): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo) {
      throw new Error('No session initialized');
    }

    // Pre-calculate total duration for efficiency
    const sliceDurationSeconds = sessionInfo.sliceDuration / 1000;
    const totalDuration = sessionInfo.totalSlices * sliceDurationSeconds;

    // Clamp timeSeconds to valid range for accuracy
    const clampedTime = Math.max(0, Math.min(timeSeconds, totalDuration - 0.01));

    // Early return if already at target time (within 50ms tolerance)
    const currentTime = this.getCurrentTime();
    if (Math.abs(currentTime - clampedTime) < 0.05) {
      return;
    }

    // Cancel pending operations immediately for performance
    this.client.cancelPendingLoads();
    this._isSeeking = true;

    // Generate unique operation ID
    const operationId = ++this._seekOperationId;
    this._currentSeekOperationId = operationId;

    // Calculate target slice with high precision
    const targetSliceIndex = Math.floor(clampedTime / sliceDurationSeconds);
    let offsetWithinSlice = clampedTime - (targetSliceIndex * sliceDurationSeconds);

    // Optimize last slice handling
    if (targetSliceIndex === sessionInfo.totalSlices - 1) {
      const lastSliceStartTime = targetSliceIndex * sliceDurationSeconds;
      const actualLastSliceDuration = totalDuration - lastSliceStartTime;
      offsetWithinSlice = Math.min(offsetWithinSlice, actualLastSliceDuration - 0.01);
    }

    const wasPlaying = this._isPlaying;
    const wasEnded = this._isEnded;

    // Immediately stop current audio buffer but keep play state
    this.stopCurrentSourceSilently();

    try {
      // Abort if superseded
      if (this._currentSeekOperationId !== operationId)
        return;

      // Update slice index and offset immediately
      this._currentSliceIndex = targetSliceIndex;
      this._sliceOffsetSeconds = offsetWithinSlice;

      // Check if target slice is available
      let sliceData = this.client.getSliceData(targetSliceIndex);

      if (!sliceData) {
        // Enter buffering state for missing slice
        this.enterBufferingState();

        // Set buffering timeout
        this._bufferingTimeout = window.setTimeout(() => {
          if (this._currentSeekOperationId === operationId) {
            this.handleBufferingTimeout(targetSliceIndex);
          }
        }, this.config.bufferingTimeoutMs!);

        try {
          const sliceId = sessionInfo.sliceIds[targetSliceIndex];
          if (!sliceId) {
            throw new Error(`No slice ID found for index ${targetSliceIndex}`);
          }

          // Load the slice
          const loadController = new AbortController();
          // If this seek gets superseded, abort the in-flight load immediately to reduce contention
          const onSuperseded = (): void => {
            if (this._currentSeekOperationId !== operationId) {
              loadController.abort();
            }
          };
          // Micro-poll since we cannot hook into ID change event
          const supersedeCheck = window.setInterval(onSuperseded, 16);
          try {
            sliceData = await this.client.loadSlice(sliceId, loadController.signal);
          } finally {
            clearInterval(supersedeCheck);
          }

          // Exit buffering state
          this.exitBufferingState();
        } catch {
          // Loading failed - handle buffering timeout if still current operation
          if (this._currentSeekOperationId === operationId) {
            this.handleBufferingTimeout(targetSliceIndex);
          }
          return;
        }
      }

      // Abort if superseded after loading
      if (this._currentSeekOperationId !== operationId)
        return;

      // Reset timing state for accurate playback
      this._pausedAt = 0;
      this._playbackStartTime = 0;

      // Clear ended state when seeking
      this._isEnded = false;

      // Resume playback if was playing, ended (Spotify-like behavior), or auto-resume requested
      const shouldResume = wasPlaying || wasEnded || autoResume;
      if (shouldResume && this._currentSeekOperationId === operationId) {
        // Ensure we're in playing state and AudioContext is active
        this._isPlaying = true;
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        await this.playCurrentSlice();
        // Restart progress updates after resuming from seek
        this.startProgressUpdates();
      }

      // Event dispatch only if still current
      if (this._currentSeekOperationId === operationId) {
        this.dispatchEvent(new CustomEvent('seek', {
          detail: { time: clampedTime, slice: targetSliceIndex, offset: offsetWithinSlice },
        }));
      }
    } catch(error) {
      if (this._currentSeekOperationId === operationId) {
        this.dispatchEvent(new CustomEvent('error', {
          detail: {
            message: `Seek failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            time: clampedTime,
            retryable: true,
          },
        }));
      }
    } finally {
      this._isSeeking = false;
      if (this._currentSeekOperationId === operationId) {
        this._currentSeekOperationId = null;
      }
    }
  }

  /**
   * Ensure a slice is loaded, loading it if necessary
   */
  private async ensureSliceLoaded(sliceIndex: number): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo || sliceIndex < 0 || sliceIndex >= sessionInfo.totalSlices) {
      throw new Error(`Invalid slice index: ${sliceIndex}`);
    }

    // Check if slice is already loaded
    if (this.client.isSliceAvailable(sliceIndex)) {
      return; // Already loaded
    }

    // Load the slice using slice ID from session info
    const sliceId = sessionInfo.sliceIds[sliceIndex];
    if (!sliceId) {
      throw new Error(`No slice ID found for index ${sliceIndex}`);
    }
    try {
      await this.client.loadSlice(sliceId);
    } catch(error) {
      throw new Error(`Failed to load slice ${sliceIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Seek to specific slice
   * Developers must handle loading the target slice
   * @param sliceIndex - The target slice index to seek to
   * @param autoResume - Optional. If true, automatically resume playback if it was playing before seeking
   */
  async seekToSlice(sliceIndex: number, autoResume: boolean = false): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo || sliceIndex < 0 || sliceIndex >= sessionInfo.totalSlices) {
      throw new Error('Invalid slice index');
    }

    // Cancel all pending slice loading operations to prevent chaos
    this.client.cancelPendingLoads();

    // Set seeking flag to prevent interruptions
    this._isSeeking = true;

    // Generate unique operation ID for this seek
    const operationId = ++this._seekOperationId;
    this._currentSeekOperationId = operationId;

    const wasPlaying = this._isPlaying;

    // Always pause when seeking to avoid state confusion
    if (this._isPlaying) {
      this.pause();
    }

    try {
      // Check if this seek operation is still current
      if (this._currentSeekOperationId !== operationId) {
        return;
      }

      // Update slice position only if this is still the current operation
      this._currentSliceIndex = sliceIndex;
      this._pausedAt = 0;
      this._playbackStartTime = 0;
      this._sliceOffsetSeconds = 0;

      // Auto-resume only if explicitly requested AND was playing before AND still current operation
      if (autoResume && wasPlaying && this._currentSeekOperationId === operationId) {
        try {
          await this.play();
        } catch(error) {
          console.error('Failed to resume playback after seek:', error);
        }
      }
    } finally {
      // Clear the seeking flag
      this._isSeeking = false;

      // Clear the current operation ID if this was the current operation
      if (this._currentSeekOperationId === operationId) {
        this._currentSeekOperationId = null;
      }
    }
  }

  /**
   * Get current player state
   */
  getState(): PlayerState {
    const sessionInfo = this.client.getSessionInfo();
    return {
      isPlaying: this._isPlaying,
      isPaused: this._isPaused,
      isBuffering: this._isBuffering,
      isEnded: this._isEnded,
      currentTime: this.getCurrentTime(),
      duration: sessionInfo ? (sessionInfo.totalSlices * sessionInfo.sliceDuration) / 1000 : 0,
      currentSlice: this._currentSliceIndex,
      totalSlices: sessionInfo ? sessionInfo.totalSlices : 0,
    };
  }

  /**
   * Get buffer statistics for monitoring
   */
  getBufferStats(): { bufferSize: number; newRequests?: number } {
    // Count how many slices are currently loaded in buffer
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo) {
      return { bufferSize: 0 };
    }

    let bufferSize = 0;
    for (let i = 0; i < sessionInfo.totalSlices; i++) {
      if (this.client.isSliceAvailable(i)) {
        bufferSize++;
      }
    }

    return { bufferSize };
  }

  /**
   * Get current playback time in seconds
   */
  private getCurrentTime(): number {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo)
      return 0;

    const sliceStartSeconds = (this._currentSliceIndex * sessionInfo.sliceDuration) / 1000;

    // When buffering, freeze time at current position
    if (this._isBuffering) {
      if (this._pausedAt > 0 && this._playbackStartTime > 0) {
        const elapsed = this._pausedAt - this._playbackStartTime;
        return sliceStartSeconds + elapsed + this._sliceOffsetSeconds;
      }
      return sliceStartSeconds + this._sliceOffsetSeconds;
    }

    if (this._isPlaying && this._playbackStartTime > 0) {
      const elapsed = this.audioContext.currentTime - this._playbackStartTime;
      return sliceStartSeconds + elapsed + this._sliceOffsetSeconds;
    } else if (this._isPaused && this._pausedAt > 0 && this._playbackStartTime > 0) {
      const elapsed = this._pausedAt - this._playbackStartTime;
      return sliceStartSeconds + elapsed + this._sliceOffsetSeconds;
    }

    // If seeking was used but not playing, return seek position
    return sliceStartSeconds + this._sliceOffsetSeconds;
  }

  /**
   * Play the current slice
   */
  private async playCurrentSlice(): Promise<void> {
    let sliceData = this.client.getSliceData(this._currentSliceIndex);

    // If slice not loaded, try to load it with buffering state
    if (!sliceData) {
      const sessionInfo = this.client.getSessionInfo();
      if (!sessionInfo) {
        throw new Error('No session initialized');
      }

      // Enter buffering state
      this.enterBufferingState();

      // Set buffering timeout
      this._bufferingTimeout = window.setTimeout(() => {
        this.handleBufferingTimeout(this._currentSliceIndex);
      }, this.config.bufferingTimeoutMs!);

      try {
        const sliceId = sessionInfo.sliceIds[this._currentSliceIndex];
        if (!sliceId) {
          throw new Error(`No slice ID found for index ${this._currentSliceIndex}`);
        }

        // Load the slice
        sliceData = await this.client.loadSlice(sliceId);

        // Exit buffering state
        this.exitBufferingState();
      } catch(error) {
        // Loading failed - handle buffering timeout
        this.handleBufferingTimeout(this._currentSliceIndex);
        throw error;
      }
    }

    // Stop any existing audio source to prevent overlapping playback
    this.stopCurrentSourceSilently();

    // Create new audio source
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = sliceData.audioBuffer;
    this.currentSource.connect(this.gainNode);

    // Set up events
    this.currentSource.onended = () => {
      this.onSliceEnded();
    };

    // Calculate start offset for resume or seeking
    let startOffset = this._sliceOffsetSeconds;
    if (this._isPaused && this._pausedAt > 0 && this._playbackStartTime > 0) {
      // If resuming from pause, add the paused duration
      const pausedDuration = this._pausedAt - this._playbackStartTime;
      startOffset += pausedDuration;
    }

    // Ensure offset doesn't exceed buffer duration and leave some padding for last slice
    const maxOffset = Math.max(0, sliceData.audioBuffer.duration - 0.1); // Leave 0.1s padding
    startOffset = Math.max(0, Math.min(startOffset, maxOffset));

    this.currentSource.start(0, startOffset);

    this._isPlaying = true;
    this._isPaused = false;
    this._playbackStartTime = this.audioContext.currentTime - startOffset;

    // Reset slice offset after using it
    this._sliceOffsetSeconds = 0;

    // Mark slice as played for cleanup
    this.client.markSlicePlayed(this._currentSliceIndex);

    this.dispatchEvent(new CustomEvent('play'));
  }

  /**
   * Handle slice ending
   */
  private async onSliceEnded(): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo)
      return;

    // Ignore slice end during seeking or when a seek operation is active
    if (this._isSeeking || this._currentSeekOperationId !== null) {
      return;
    }

    // Only continue to next slice if we're still supposed to be playing
    if (!this._isPlaying) {
      return; // User paused, don't auto-advance
    }

    // If current slice is the last slice, end playback
    if (this._currentSliceIndex >= sessionInfo.totalSlices - 1) {
      this.end();
      return;
    }

    this._currentSliceIndex++;

    if (this._currentSliceIndex < sessionInfo.totalSlices) {
      // Try to play next slice only if still playing
      let nextSliceData = this.client.getSliceData(this._currentSliceIndex);

      // If slice not available, enter buffering state and try to load it
      if (!nextSliceData) {
        // Enter buffering state - stops time progress
        this.enterBufferingState();

        // Set buffering timeout (e.g., 10 seconds)
        this._bufferingTimeout = window.setTimeout(() => {
          this.handleBufferingTimeout(this._currentSliceIndex);
        }, this.config.bufferingTimeoutMs!);

        try {
          const sessionInfo = this.client.getSessionInfo();
          if (!sessionInfo) {
            throw new Error('Session not initialized, cannot load slice');
          } else {
            const sliceId = sessionInfo.sliceIds[this._currentSliceIndex];
            if (sliceId) {
              nextSliceData = await this.client.loadSlice(sliceId);

              // Successfully loaded - exit buffering state
              this.exitBufferingState();
            } else {
              throw new Error(`No slice ID found for index ${this._currentSliceIndex}`);
            }
          }
        } catch {
          // Failed to load slice - handle buffering timeout immediately
          this.handleBufferingTimeout(this._currentSliceIndex);
          return;
        }
      }

      if (nextSliceData && this._isPlaying) { // Double-check we're still playing
        this._playbackStartTime = this.audioContext.currentTime;
        await this.playCurrentSlice();
      }
    }
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.gainNode.gain.value;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.stopProgressUpdates();

    // Clear any ongoing seek operation
    this._currentSeekOperationId = null;

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }

  /**
   * Start realtime progress updates
   */
  private startProgressUpdates(): void {
    // Clear any existing timer
    this.stopProgressUpdates();

    // Emit timeupdate events at 60fps for smooth progress
    this._progressTimer = window.setInterval(() => {
      if (this._isPlaying) {
        this.dispatchEvent(new CustomEvent('timeupdate', {
          detail: {
            currentTime: this.getCurrentTime(),
            duration: this.duration,
            progress: this.getCurrentTime() / this.duration,
          },
        }));
      }
    }, 16); // ~60fps
  }

  /**
   * Stop realtime progress updates
   */
  private stopProgressUpdates(): void {
    if (this._progressTimer !== null) {
      window.clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }

  /**
   * Enter buffering state
   */
  private enterBufferingState(): void {
    if (this._isBuffering)
      return; // Already buffering

    this._isBuffering = true;

    // Clear any existing buffering timeout
    if (this._bufferingTimeout !== null) {
      clearTimeout(this._bufferingTimeout);
    }

    this.dispatchEvent(new CustomEvent('buffering', {
      detail: { slice: this._currentSliceIndex },
    }));
  }

  /**
   * Exit buffering state
   */
  private exitBufferingState(): void {
    if (!this._isBuffering)
      return; // Not buffering

    this._isBuffering = false;

    // Clear buffering timeout
    if (this._bufferingTimeout !== null) {
      clearTimeout(this._bufferingTimeout);
      this._bufferingTimeout = null;
    }

    this.dispatchEvent(new CustomEvent('buffered', {
      detail: { slice: this._currentSliceIndex },
    }));
  }

  /**
   * Handle buffering timeout - pause with error after timeout
   */
  private handleBufferingTimeout(sliceIndex: number): void {
    if (!this._isBuffering)
      return; // No longer buffering

    this._isBuffering = false;
    this._isPlaying = false;
    this._isPaused = true;

    this.dispatchEvent(new CustomEvent('pause'));
    this.dispatchEvent(new CustomEvent('error', {
      detail: {
        message: `Slice ${sliceIndex} failed to load after timeout`,
        slice: sliceIndex,
        retryable: true,
      },
    }));
  }

  /**
   * Retry loading the current slice (useful when buffering fails)
   */
  async retryCurrentSlice(): Promise<boolean> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo) {
      return false;
    }

    try {
      // Enter buffering state
      this.enterBufferingState();

      // Set a shorter retry timeout (half the normal timeout)
      this._bufferingTimeout = window.setTimeout(() => {
        this.handleBufferingTimeout(this._currentSliceIndex);
      }, Math.floor(this.config.bufferingTimeoutMs! / 2)); // Shorter timeout for manual retry

      const sliceId = sessionInfo.sliceIds[this._currentSliceIndex];
      if (!sliceId) {
        throw new Error(`No slice ID found for index ${this._currentSliceIndex}`);
      }

      // Force reload the slice
      await this.client.loadSlice(sliceId);

      // Successfully loaded - exit buffering and resume if was playing
      this.exitBufferingState();

      if (this._isPlaying) {
        await this.playCurrentSlice();
      }

      return true;
    } catch {
      // Retry failed - handle timeout
      this.handleBufferingTimeout(this._currentSliceIndex);
      return false;
    }
  }

  // Getters for backward compatibility
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get isEnded(): boolean {
    return this._isEnded;
  }

  get currentSlice(): number {
    return this._currentSliceIndex;
  }

  get currentTime(): number {
    return this.getCurrentTime();
  }

  get duration(): number {
    return this.getState().duration;
  }

  get isSeeking(): boolean {
    return this._isSeeking;
  }

  get isBuffering(): boolean {
    return this._isBuffering;
  }
}
