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

    this.dispatchEvent(new CustomEvent('stop'));
  }

  /**
   * Seek to specific slice
   * Developers must handle loading the target slice
   */
  seekToSlice(sliceIndex: number): void {
    const sessionInfo = this.client.getSessionInfo();
    if (!sessionInfo || sliceIndex < 0 || sliceIndex >= sessionInfo.totalSlices) {
      throw new Error('Invalid slice index');
    }

    const wasPlaying = this._isPlaying;

    if (this._isPlaying) {
      this.pause();
    }

    this._currentSliceIndex = sliceIndex;
    this._pausedAt = 0;
    this._sliceStartTime = 0;

    if (wasPlaying) {
      this.play();
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

    return sliceStartSeconds;
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

    // Start playback
    const startOffset = this._isPaused ? Math.max(0, this._pausedAt - this._playbackStartTime) : 0;
    this.currentSource.start(0, startOffset);

    this._isPlaying = true;
    this._isPaused = false;
    this._playbackStartTime = this.audioContext.currentTime - startOffset;

    // Mark slice as played for cleanup
    this.client.markSlicePlayed(this._currentSliceIndex);

    this.dispatchEvent(new CustomEvent('play'));
  }

  /**
   * Handle slice ending
   */
  private onSliceEnded(): void {
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
      const nextSliceData = this.client.getSliceData(this._currentSliceIndex);
      if (nextSliceData) {
        this._playbackStartTime = this.audioContext.currentTime;
        this.playCurrentSlice();
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

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
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
