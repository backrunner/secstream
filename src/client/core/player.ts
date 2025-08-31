import type { SecureAudioClient } from './client.js';

export type PlayerEvent = 'play' | 'pause' | 'stop' | 'timeupdate' | 'ended' | 'error';

export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  currentSlice: number;
  totalSlices: number;
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

  // Playback state
  private _isPlaying = false;
  private _isPaused = false;
  private _currentSliceIndex = 0;
  private _sliceStartTime = 0;
  private _pausedAt = 0;
  private _playbackStartTime = 0;
  private _sliceOffsetSeconds = 0; // Offset within the current slice for precise seeking
  private _progressTimer: number | null = null;

  constructor(client: SecureAudioClient) {
    super();
    this.client = client;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Create audio graph
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
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
    this._pausedAt = this.audioContext.currentTime;

    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }

    // Stop progress updates
    this.stopProgressUpdates();

    this.dispatchEvent(new CustomEvent('pause'));
  }

  /**
   * Stop audio playback
   */
  stop(): void {
    this._isPlaying = false;
    this._isPaused = false;
    this._currentSliceIndex = 0;
    this._pausedAt = 0;
    this._sliceStartTime = 0;
    this._playbackStartTime = 0;

    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
    }

    // Stop progress updates
    this.stopProgressUpdates();

    this.dispatchEvent(new CustomEvent('stop'));
  }

  /**
   * Seek to specific time position with on-demand slice loading
   * @param timeSeconds - The target time position in seconds
   * @param autoResume - Optional. If true, automatically resume playback if it was playing before seeking
   */
  async seekToTime(timeSeconds: number, autoResume: boolean = true): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo) {
      throw new Error('No session initialized');
    }

    const totalDuration = (sessionInfo.totalSlices * sessionInfo.sliceDuration) / 1000;
    if (timeSeconds < 0 || timeSeconds > totalDuration) {
      throw new Error(`Invalid seek time: ${timeSeconds}. Must be between 0 and ${totalDuration}`);
    }

    // Calculate which slice contains this time and the offset within that slice
    const sliceDurationSeconds = sessionInfo.sliceDuration / 1000;
    const targetSliceIndex = Math.floor(timeSeconds / sliceDurationSeconds);
    const offsetWithinSlice = timeSeconds - (targetSliceIndex * sliceDurationSeconds);

    const wasPlaying = this._isPlaying;

    // Always pause when seeking
    if (this._isPlaying) {
      this.pause();
    }

    try {
      // Ensure target slice is loaded with retry mechanism
      await this.ensureSliceLoadedWithRetry(targetSliceIndex);

      // Update player state
      this._currentSliceIndex = targetSliceIndex;
      this._pausedAt = 0;
      this._sliceStartTime = 0;
      this._playbackStartTime = 0;

      // Set the offset within the slice for precise positioning
      this._sliceOffsetSeconds = offsetWithinSlice;

      // Auto-resume if requested and was playing before
      if (autoResume && wasPlaying) {
        await this.play();
      }

      // Dispatch seek event for demo app to update UI
      this.dispatchEvent(new CustomEvent('seek', {
        detail: { time: timeSeconds, slice: targetSliceIndex, offset: offsetWithinSlice },
      }));
    } catch(error) {
      // If seeking fails, dispatch error event but don't throw - allow retry
      this.dispatchEvent(new CustomEvent('error', {
        detail: { message: `Seek failed: ${error instanceof Error ? error.message : 'Unknown error'}`, time: timeSeconds, retryable: true },
      }));
    }
  }

  /**
   * Ensure a slice is loaded with retry mechanism
   */
  private async ensureSliceLoadedWithRetry(sliceIndex: number, maxRetries: number = 3): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo || sliceIndex < 0 || sliceIndex >= sessionInfo.totalSlices) {
      throw new Error(`Invalid slice index: ${sliceIndex}`);
    }

    // Check if slice is already loaded
    if (this.client.isSliceAvailable(sliceIndex)) {
      return; // Already loaded
    }

    let lastError: Error | null = null;

    // Retry mechanism for loading slices
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Load the slice using slice ID from session info
        const sessionInfo = this.client.getSessionInfo();
        if (!sessionInfo) {
          throw new Error('Session not initialized');
        }
        const sliceId = sessionInfo.sliceIds[sliceIndex];
        if (!sliceId) {
          throw new Error(`No slice ID found for index ${sliceIndex}`);
        }
        await this.client.loadSlice(sliceId);
        return; // Success
      } catch(error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Dispatch progress event for retry attempts
        this.dispatchEvent(new CustomEvent('loadretry', {
          detail: { slice: sliceIndex, attempt, maxRetries, error: lastError.message },
        }));

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to load slice ${sliceIndex} after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
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
  async seekToSlice(sliceIndex: number, autoResume: boolean = true): Promise<void> {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo || sliceIndex < 0 || sliceIndex >= sessionInfo.totalSlices) {
      throw new Error('Invalid slice index');
    }

    const wasPlaying = this._isPlaying;

    // Always pause when seeking to avoid state confusion
    if (this._isPlaying) {
      this.pause();
    }

    // Update slice position
    this._currentSliceIndex = sliceIndex;
    // Reset timing state for new slice position
    this._pausedAt = 0;
    this._sliceStartTime = 0;
    this._playbackStartTime = 0;

    // Auto-resume if requested and was playing before
    if (autoResume && wasPlaying) {
      try {
        await this.play();
      } catch(error) {
        console.error('Failed to resume playback after seek:', error);
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

    if (this._isPlaying && this._playbackStartTime > 0) {
      const elapsed = this.audioContext.currentTime - this._playbackStartTime;
      return sliceStartSeconds + elapsed;
    } else if (this._pausedAt > 0) {
      const elapsed = this._pausedAt - this._playbackStartTime;
      return sliceStartSeconds + elapsed;
    }

    // If seeking was used, include the slice offset
    return sliceStartSeconds + this._sliceOffsetSeconds;
  }

  /**
   * Play the current slice
   */
  private async playCurrentSlice(): Promise<void> {
    const sliceData = this.client.getSliceData(this._currentSliceIndex);
    if (!sliceData) {
      throw new Error(`Slice ${this._currentSliceIndex} not loaded`);
    }

    // Stop any existing audio source to prevent overlapping playback
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Ignore errors from stopping already-stopped sources
      }
      this.currentSource = null;
    }

    // Create new audio source
    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = sliceData.audioBuffer;
    this.currentSource.connect(this.gainNode);

    // Set up events
    this.currentSource.onended = () => {
      this.onSliceEnded();
    };

    // Start playback with slice offset for precise seeking
    const pauseOffset = this._isPaused ? Math.max(0, this._pausedAt - this._playbackStartTime) : 0;
    const startOffset = Math.max(0, this._sliceOffsetSeconds + pauseOffset);
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

    this._currentSliceIndex++;

    if (this._currentSliceIndex >= sessionInfo.totalSlices) {
      // End of audio
      this.stop();
      this.dispatchEvent(new CustomEvent('ended'));
    } else {
      // Try to play next slice
      let nextSliceData = this.client.getSliceData(this._currentSliceIndex);

      // If slice not available, try to load it
      if (!nextSliceData) {
        try {
          const sessionInfo = this.client.getSessionInfo();
          if (!sessionInfo) {
            console.warn('Session not initialized, cannot load slice');
          } else {
            const sliceId = sessionInfo.sliceIds[this._currentSliceIndex];
            if (sliceId) {
              nextSliceData = await this.client.loadSlice(sliceId);
            } else {
              console.warn(`No slice ID found for index ${this._currentSliceIndex}`);
            }
          }
        } catch(loadError) {
          console.warn(`Failed to load slice ${this._currentSliceIndex}:`, loadError);
        }
      }

      if (nextSliceData) {
        this._playbackStartTime = this.audioContext.currentTime;
        await this.playCurrentSlice();
      } else {
        // Next slice not available - pause and let developer handle
        this.pause();
        this.dispatchEvent(new CustomEvent('error', {
          detail: { message: `Next slice ${this._currentSliceIndex} not available` },
        }));
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

  // Getters for backward compatibility
  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isPaused(): boolean {
    return this._isPaused;
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
}
