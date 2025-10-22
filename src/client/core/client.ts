import type { EncryptedSlice, SessionInfo, TrackInfo } from '../../shared/types/interfaces.js';
import type {
  CompressionProcessor,
  CryptoMetadata,
  EncryptionProcessor,
  KeyExchangeProcessor,
  ProcessingConfig,
} from '../../shared/types/processors.js';
import type { RetryConfig } from '../network/retry-manager.js';
import type { Transport } from '../network/transport.js';
import type { DecryptionWorkerConfig } from '../workers/decryption-worker-types.js';
import { DeflateCompressionProcessor } from '../../shared/compression/processors/deflate-processor.js';
import { EcdhP256KeyExchangeProcessor } from '../../shared/crypto/key-exchange/ecdh-p256-processor.js';
import { AesGcmEncryptionProcessor } from '../../shared/crypto/processors/aes-gcm-processor.js';
import { RetryManager } from '../network/retry-manager.js';
import {
  DecodingError,
  DecryptionError,
  NetworkError,
} from '../network/transport.js';
import { DecryptionWorkerManager } from '../workers/decryption-worker-manager.js';

// Default configuration constants
const DEFAULT_PREFETCH_CONCURRENCY = 3;
const DEFAULT_BUFFER_SIZE = 5;
const DEFAULT_POLL_INTERVAL_MS = 50;

export interface ClientConfig<
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor,
> {
  /** Maximum concurrent prefetch/loading operations */
  prefetchConcurrency?: number;
  retryConfig?: Partial<RetryConfig>;
  processingConfig?: ProcessingConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;
  /** Web Worker configuration for offloading decryption (optional) */
  workerConfig?: Partial<DecryptionWorkerConfig>;
  /** URL to the worker script (required if workerConfig.enabled is true) */
  workerUrl?: string;
}

export interface AudioSliceData {
  audioBuffer: AudioBuffer;
  sequence: number;
}

/**
 * Secure audio client for encrypted audio streaming
 * Handles key exchange, session management, and slice storage
 * Uses pluggable transport interface for flexibility
 * Supports customizable compression and encryption processors
 *
 * Note: This client acts as "dumb storage" - it loads and stores slices on demand.
 * Buffer management strategies (prefetch/cleanup) are handled by SecureAudioPlayer.
 * If using standalone, call cleanupBuffers() manually when needed.
 */
export class SecureAudioClient<
  TKey = unknown,
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor,
> {
  private keyExchangeProcessor: TKeyExchangeProcessor;
  private audioContext: AudioContext;
  private transport: Transport;
  private retryManager: RetryManager;
  private compressionProcessor: TCompressionProcessor;
  private encryptionProcessor: TEncryptionProcessor;
  private workerManager: DecryptionWorkerManager | null = null;

  public config: ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>;

  // Session and track management
  private sessionInfo: SessionInfo | null = null;
  private activeTrackId: string | null = null;
  private trackKeys = new Map<string, TKey>(); // trackId → encryption key (lazy loaded on track initialization)

  // Multi-track buffer management (trackId → sliceIndex → data)
  private audioBuffers = new Map<string, Map<number, AudioSliceData>>();
  private playedSlices = new Map<string, Set<number>>(); // trackId → played slice indices
  private loadingSlices = new Map<string, AbortController>(); // Track slices currently being loaded with abort controllers

  constructor(
    transport: Transport,
    config: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> = {},
  ) {
    this.transport = transport;
    this.config = {
      prefetchConcurrency: DEFAULT_PREFETCH_CONCURRENCY,
      retryConfig: {},
      ...config,
    };
    this.retryManager = new RetryManager(this.config.retryConfig);
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Initialize processors with defaults or user-provided ones
    const processingConfig = this.config.processingConfig || {};
    this.compressionProcessor = (processingConfig.compressionProcessor || new DeflateCompressionProcessor()) as TCompressionProcessor;
    this.encryptionProcessor = (processingConfig.encryptionProcessor || new AesGcmEncryptionProcessor()) as TEncryptionProcessor;
    this.keyExchangeProcessor = (processingConfig.keyExchangeProcessor || new EcdhP256KeyExchangeProcessor()) as TKeyExchangeProcessor;

    // Initialize Web Worker manager if enabled
    if (this.config.workerConfig?.enabled && this.config.workerUrl) {
      const workerConfig: DecryptionWorkerConfig = {
        enabled: true,
        workerCount: this.config.workerConfig.workerCount,
        maxQueueSize: this.config.workerConfig.maxQueueSize,
      };

      this.workerManager = new DecryptionWorkerManager(
        this.config.workerUrl,
        this.compressionProcessor.getName(),
        this.encryptionProcessor.getName(),
        workerConfig,
      );
    }
  }

  /**
   * Expose the decoding AudioContext so that player can share it to avoid resampling
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Get current client configuration
   */
  getConfig(): Readonly<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>> {
    return { ...this.config };
  }

  /**
   * Update client configuration at runtime
   * @param updates - Partial config object with properties to update
   */
  updateConfig(updates: Partial<ClientConfig<TCompressionProcessor, TEncryptionProcessor, TKeyExchangeProcessor>>): void {
    this.config = {
      ...this.config,
      ...updates,
    };

    // Update retry manager if retry config changed
    if (updates.retryConfig) {
      this.retryManager = new RetryManager({
        ...this.config.retryConfig,
        ...updates.retryConfig,
      });
    }
  }

  /**
   * Create session with audio data
   * Framework handles the process, developer implements transport
   */
  async createSession(audioData: File | ArrayBuffer): Promise<string> {
    return await this.retryManager.retry(async() => {
      try {
        return await this.transport.createSession(audioData);
      } catch(error) {
        throw new NetworkError('Failed to create session', error as Error);
      }
    });
  }

  /**
   * Initialize session with key exchange
   * Supports both single-track (backward compatible) and multi-track sessions
   */
  async initializeSession(sessionId: string): Promise<SessionInfo> {
    // Initialize key exchange
    await this.keyExchangeProcessor.initialize();

    // Create key exchange request
    const keyExchangeRequest = await this.keyExchangeProcessor.createKeyExchangeRequest();

    console.log(`🔑 Client: Performing initial key exchange for session ${sessionId}`);

    // Perform key exchange with retry
    const keyExchangeResponse = await this.retryManager.retry(async() => {
      try {
        return await this.transport.performKeyExchange(sessionId, keyExchangeRequest);
      } catch(error) {
        throw new NetworkError('Key exchange failed', error as Error);
      }
    });

    console.log(`📦 Client: Received key exchange response`, {
      hasSessionInfo: !!keyExchangeResponse.sessionInfo,
      trackCount: keyExchangeResponse.sessionInfo?.tracks?.length || 0
    });

    // Store session info
    this.sessionInfo = keyExchangeResponse.sessionInfo;

    // Detect session type (multi-track vs single-track)
    if (this.sessionInfo.tracks && this.sessionInfo.tracks.length > 0) {
      // Multi-track session: Backend automatically initializes first track during initial key exchange
      // We need to store the key for the first track
      const sessionKey = await this.keyExchangeProcessor.processKeyExchangeResponse(keyExchangeResponse) as TKey;

      // Set first track as active and store its key
      this.activeTrackId = this.sessionInfo.tracks[0].trackId;
      this.trackKeys.set(this.activeTrackId, sessionKey);
      this.sessionInfo.activeTrackId = this.activeTrackId;

      console.log(`✅ Client: First track key stored for ${this.activeTrackId}`, {
        trackInfo: this.sessionInfo.tracks[0],
        sliceCount: this.sessionInfo.tracks[0].sliceIds?.length || 0
      });
    } else {
      // Single-track session (backward compatibility)
      // Exchange key immediately for the single track
      const sessionKey = await this.keyExchangeProcessor.processKeyExchangeResponse(keyExchangeResponse) as TKey;

      // Store key with a default trackId for backward compatibility
      const defaultTrackId = 'default';
      this.trackKeys.set(defaultTrackId, sessionKey);
      this.activeTrackId = defaultTrackId;
    }

    // Initialize worker manager if configured
    if (this.workerManager) {
      try {
        await this.workerManager.initialize();
      } catch(error) {
        console.warn('Failed to initialize Web Worker, falling back to main thread:', error);
        this.workerManager = null;
      }
    }

    // Align decode context sample rate with source to preserve quality
    try {
      if (this.audioContext.sampleRate !== this.sessionInfo.sampleRate) {
        if (this.audioContext.state !== 'closed') {
          await this.audioContext.close();
        }
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: this.sessionInfo.sampleRate,
        });
      }
    } catch {
      // Fallback: if sampleRate hint not supported, continue with existing context
    }

    return this.sessionInfo;
  }

  /**
   * Get current track information (helper for both single and multi-track)
   */
  private getCurrentTrackInfo(): TrackInfo | null {
    if (!this.sessionInfo) {
      console.warn('⚠️ Client: getCurrentTrackInfo called but sessionInfo is null');
      return null;
    }

    // Multi-track session
    if (this.sessionInfo.tracks && this.sessionInfo.tracks.length > 0) {
      const track = this.sessionInfo.tracks.find(t => t.trackId === this.activeTrackId);
      if (track) {
        console.log(`📍 Client: getCurrentTrackInfo returning track ${track.trackId} with ${track.sliceIds?.length || 0} slices`);
      } else {
        console.warn(`⚠️ Client: getCurrentTrackInfo could not find activeTrackId=${this.activeTrackId}`);
      }
      return track || null;
    }

    // Single-track session (backward compatibility) - construct TrackInfo from SessionInfo
    return {
      trackId: 'default',
      trackIndex: 0,
      totalSlices: this.sessionInfo.totalSlices,
      sliceDuration: this.sessionInfo.sliceDuration,
      sampleRate: this.sessionInfo.sampleRate,
      channels: this.sessionInfo.channels,
      bitDepth: this.sessionInfo.bitDepth,
      isFloat32: this.sessionInfo.isFloat32,
      sliceIds: this.sessionInfo.sliceIds,
      format: this.sessionInfo.format,
      duration: (this.sessionInfo.totalSlices * this.sessionInfo.sliceDuration) / 1000,
    };
  }

  /**
   * Get track information by trackId or index
   */
  getTrackInfo(trackIdOrIndex: string | number): TrackInfo | null {
    console.log(`🔍 Client: getTrackInfo called with ${trackIdOrIndex}`);

    if (!this.sessionInfo) {
      console.warn('⚠️ Client: getTrackInfo called but sessionInfo is null');
      return null;
    }

    // Single-track session (backward compatibility)
    if (!this.sessionInfo.tracks || this.sessionInfo.tracks.length === 0) {
      if (trackIdOrIndex === 'default' || trackIdOrIndex === 0) {
        return this.getCurrentTrackInfo();
      }
      return null;
    }

    // Multi-track session
    let track: TrackInfo | undefined;
    if (typeof trackIdOrIndex === 'string') {
      track = this.sessionInfo.tracks.find(t => t.trackId === trackIdOrIndex);
    } else {
      track = this.sessionInfo.tracks[trackIdOrIndex];
    }

    if (track) {
      console.log(`✅ Client: getTrackInfo found track ${track.trackId} with ${track.sliceIds?.length || 0} slices`);
    } else {
      console.warn(`⚠️ Client: getTrackInfo could not find track for ${trackIdOrIndex}`);
    }

    return track || null;
  }

  /**
   * Initialize a track (perform lazy key exchange)
   * This is called automatically when switching to a new track
   */
  async initializeTrack(trackIdOrIndex: string | number): Promise<void> {
    if (!this.sessionInfo) {
      throw new Error('Session not initialized');
    }

    const trackInfo = this.getTrackInfo(trackIdOrIndex);
    if (!trackInfo) {
      throw new Error(`Track not found: ${trackIdOrIndex}`);
    }

    // Check if key already exists
    if (this.trackKeys.has(trackInfo.trackId)) {
      console.log(`✅ Client: Track key already exists for ${trackInfo.trackId}`);
      return; // Already initialized
    }

    console.log(`🔑 Client: Initializing track key for ${trackInfo.trackId}...`);

    // Perform key exchange for this track
    await this.keyExchangeProcessor.initialize();
    const keyExchangeRequest = await this.keyExchangeProcessor.createKeyExchangeRequest();

    const keyExchangeResponse = await this.retryManager.retry(async() => {
      try {
        return await this.transport.performKeyExchange(
          this.sessionInfo!.sessionId,
          keyExchangeRequest,
          trackInfo.trackId // Pass trackId for track-specific key exchange
        );
      } catch(error) {
        throw new NetworkError(`Track key exchange failed for ${trackInfo.trackId}`, error as Error);
      }
    });

    console.log(`📦 Client: Received track key exchange response for ${trackInfo.trackId}`, {
      hasSessionInfo: !!keyExchangeResponse.sessionInfo,
      hasUpdatedTrack: !!keyExchangeResponse.sessionInfo?.tracks?.find(t => t.trackId === trackInfo.trackId)
    });

    // Store the track-specific key
    const trackKey = await this.keyExchangeProcessor.processKeyExchangeResponse(keyExchangeResponse) as TKey;
    this.trackKeys.set(trackInfo.trackId, trackKey);

    // Update the specific track's info in sessionInfo with processed data (includes sliceIds)
    // The backend processes the track audio during key exchange and returns updated sessionInfo
    if (keyExchangeResponse.sessionInfo && keyExchangeResponse.sessionInfo.tracks) {
      const updatedTrack = keyExchangeResponse.sessionInfo.tracks.find(t => t.trackId === trackInfo.trackId);
      if (updatedTrack && this.sessionInfo.tracks) {
        const trackIndex = this.sessionInfo.tracks.findIndex(t => t.trackId === trackInfo.trackId);
        if (trackIndex !== -1) {
          this.sessionInfo.tracks[trackIndex] = updatedTrack;
          console.log(`✅ Client: Track info updated with ${updatedTrack.sliceIds.length} slices for ${trackInfo.trackId}`);
        } else {
          console.warn(`⚠️ Client: Could not find track index for ${trackInfo.trackId} in sessionInfo.tracks`);
        }
      } else {
        console.warn(`⚠️ Client: No updated track found in response for ${trackInfo.trackId}`);
      }
    } else {
      console.warn(`⚠️ Client: No sessionInfo.tracks in key exchange response`);
    }

    console.log(`✅ Client: Track key initialized for ${trackInfo.trackId}, key type:`, trackKey instanceof CryptoKey ? 'CryptoKey' : typeof trackKey);
  }

  /**
   * Switch to a different track within the session
   * Performs lazy key exchange if needed
   */
  async switchToTrack(trackIdOrIndex: string | number): Promise<TrackInfo> {
    console.log(`🔄 Client: switchToTrack called with ${trackIdOrIndex}`);

    if (!this.sessionInfo) {
      throw new Error('Session not initialized');
    }

    const trackInfo = this.getTrackInfo(trackIdOrIndex);
    if (!trackInfo) {
      throw new Error(`Track not found: ${trackIdOrIndex}`);
    }

    console.log(`📌 Client: Track info BEFORE initialization:`, {
      trackId: trackInfo.trackId,
      sliceCount: trackInfo.sliceIds?.length || 0
    });

    // Initialize track key if not already done (lazy loading)
    await this.initializeTrack(trackInfo.trackId);

    // IMPORTANT: Re-fetch track info after initialization because initializeTrack may have updated sessionInfo
    const updatedTrackInfo = this.getTrackInfo(trackInfo.trackId);
    if (!updatedTrackInfo) {
      throw new Error(`Track not found after initialization: ${trackInfo.trackId}`);
    }

    console.log(`📌 Client: Track info AFTER initialization:`, {
      trackId: updatedTrackInfo.trackId,
      sliceCount: updatedTrackInfo.sliceIds?.length || 0
    });

    // Update active track
    this.activeTrackId = updatedTrackInfo.trackId;
    if (this.sessionInfo.activeTrackId !== undefined) {
      this.sessionInfo.activeTrackId = this.activeTrackId;
    }

    // Update backward compatibility fields in sessionInfo
    this.sessionInfo.totalSlices = updatedTrackInfo.totalSlices;
    this.sessionInfo.sliceDuration = updatedTrackInfo.sliceDuration;
    this.sessionInfo.sampleRate = updatedTrackInfo.sampleRate;
    this.sessionInfo.channels = updatedTrackInfo.channels;
    this.sessionInfo.bitDepth = updatedTrackInfo.bitDepth;
    this.sessionInfo.isFloat32 = updatedTrackInfo.isFloat32;
    this.sessionInfo.sliceIds = updatedTrackInfo.sliceIds;
    this.sessionInfo.format = updatedTrackInfo.format;

    console.log(`✅ Client: switchToTrack complete, backward compat sliceIds count: ${this.sessionInfo.sliceIds?.length || 0}`);

    return updatedTrackInfo;
  }

  /**
   * Add a new track to the session (incremental track addition)
   * Server-side must support this operation
   */
  async addTrack(audioData: File | ArrayBuffer, metadata?: { title?: string; artist?: string; album?: string }): Promise<TrackInfo> {
    if (!this.sessionInfo) {
      throw new Error('Session not initialized');
    }

    // Call transport to add track
    const trackInfo = await this.retryManager.retry(async() => {
      try {
        return await this.transport.addTrack(this.sessionInfo!.sessionId, audioData, metadata);
      } catch(error) {
        throw new NetworkError('Failed to add track', error as Error);
      }
    });

    // Add to session tracks array
    if (!this.sessionInfo.tracks) {
      this.sessionInfo.tracks = [];
    }
    this.sessionInfo.tracks.push(trackInfo);

    return trackInfo;
  }

  /**
   * Remove a track from the session (memory cleanup)
   * @param trackIdOrIndex - Track ID (string) or index (number) to remove
   * @returns Updated session info with remaining tracks
   */
  async removeTrack(trackIdOrIndex: string | number): Promise<SessionInfo> {
    if (!this.sessionInfo) {
      throw new Error('Session not initialized');
    }

    // Get track info before removal
    const trackInfo = this.getTrackInfo(trackIdOrIndex);
    if (!trackInfo) {
      throw new Error(`Track not found: ${trackIdOrIndex}`);
    }

    const trackId = trackInfo.trackId;

    // Cancel any pending loads for this track
    const loadingKeys = Array.from(this.loadingSlices.keys());
    for (const key of loadingKeys) {
      if (key.startsWith(`${trackId}:`)) {
        const controller = this.loadingSlices.get(key);
        if (controller) {
          controller.abort();
        }
        this.loadingSlices.delete(key);
      }
    }

    // Clean up track-specific buffers (BIGGEST memory saver)
    this.audioBuffers.delete(trackId);
    this.playedSlices.delete(trackId);

    // Remove track encryption key
    this.trackKeys.delete(trackId);

    // Handle active track removal - switch to another track
    let newActiveTrackId = this.activeTrackId;
    if (this.activeTrackId === trackId) {
      // Find another track to switch to
      if (this.sessionInfo.tracks && this.sessionInfo.tracks.length > 1) {
        const trackIndex = this.sessionInfo.tracks.findIndex(t => t.trackId === trackId);
        const nextTrack = this.sessionInfo.tracks[trackIndex + 1] || this.sessionInfo.tracks[trackIndex - 1];
        if (nextTrack && nextTrack.trackId !== trackId) {
          newActiveTrackId = nextTrack.trackId;
        }
      }
    }

    // Call transport to remove track from server
    const updatedSessionInfo = await this.retryManager.retry(async() => {
      try {
        return await this.transport.removeTrack(this.sessionInfo!.sessionId, trackIdOrIndex);
      } catch(error) {
        throw new NetworkError('Failed to remove track', error as Error);
      }
    });

    // Update local session info
    this.sessionInfo = updatedSessionInfo;

    // Update active track if needed
    if (this.activeTrackId === trackId) {
      this.activeTrackId = newActiveTrackId;
      if (this.sessionInfo.activeTrackId !== undefined && newActiveTrackId !== null) {
        this.sessionInfo.activeTrackId = newActiveTrackId;
      }
    }

    return updatedSessionInfo;
  }

  /**
   * Check if there are any pending slice loading operations
   */
  hasPendingLoads(): boolean {
    return this.loadingSlices.size > 0;
  }

  /**
   * Cancel all pending slice loading operations
   */
  cancelPendingLoads(): void {
    // Cancel all ongoing slice loading operations
    for (const [_sliceId, controller] of this.loadingSlices) {
      controller.abort();
    }
    this.loadingSlices.clear();
  }

  /**
   * Load slice with buffering strategy (track-aware)
   * Framework manages caching and decryption
   */
  async loadSlice(sliceId: string, abortSignal?: AbortSignal, trackId?: string): Promise<AudioSliceData> {
    if (!this.sessionInfo) {
      throw new Error('Session not initialized');
    }

    // Determine which track to load from
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) {
      throw new Error('No active track');
    }

    // Get track info
    const trackInfo = this.getTrackInfo(targetTrackId);
    if (!trackInfo) {
      throw new Error(`Track not found: ${targetTrackId}`);
    }

    // Ensure track is initialized (key exchange done)
    if (!this.trackKeys.has(targetTrackId)) {
      console.log(`⚠️ Track key not found for ${targetTrackId}, initializing...`);
      await this.initializeTrack(targetTrackId);
    }

    const trackKey = this.trackKeys.get(targetTrackId);
    if (!trackKey) {
      throw new Error(`Track key not available for ${targetTrackId}`);
    }

    console.log(`🔐 Loading slice ${sliceId} for track ${targetTrackId}`);

    // Get sequence from slice ID using track's slice IDs
    const sequence = trackInfo.sliceIds.indexOf(sliceId);
    if (sequence === -1) {
      throw new Error(`Invalid slice ID: ${sliceId}`);
    }

    // Initialize track buffer if needed
    if (!this.audioBuffers.has(targetTrackId)) {
      this.audioBuffers.set(targetTrackId, new Map());
    }
    const trackBuffer = this.audioBuffers.get(targetTrackId)!;

    // Check if slice is already loaded
    const cached = trackBuffer.get(sequence);
    if (cached) {
      return cached;
    }

    // Check if slice is currently being loaded
    const loadingKey = `${targetTrackId}:${sliceId}`;
    const existingController = this.loadingSlices.get(loadingKey);
    if (existingController) {
      // If we have a new abort signal, cancel the existing load and start fresh
      if (abortSignal) {
        existingController.abort();
        this.loadingSlices.delete(loadingKey);
      } else {
        // Wait for the ongoing loading to complete
        return new Promise<AudioSliceData>((resolve, reject) => {
          const checkLoading = (): void => {
            const cached = trackBuffer.get(sequence);
            if (cached) {
              resolve(cached);
            } else if (!this.loadingSlices.has(loadingKey)) {
              // Loading failed, reject
              reject(new Error(`Slice loading failed: ${sliceId}`));
            } else {
              // Still loading, check again after a short delay
              setTimeout(checkLoading, DEFAULT_POLL_INTERVAL_MS);
            }
          };
          checkLoading();
        });
      }
    }

    // Create abort controller for this loading operation
    const loadController = new AbortController();

    // Chain with provided abort signal if any
    if (abortSignal) {
      if (abortSignal.aborted) {
        throw new Error('Operation cancelled');
      }
      abortSignal.addEventListener('abort', () => {
        loadController.abort();
      });
    }

    // Mark slice as being loaded
    this.loadingSlices.set(loadingKey, loadController);

    try {
      // Check if cancelled before starting
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Fetch encrypted slice with retry and cancellation support
      const encryptedSlice = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          return await this.transport.fetchSlice(this.sessionInfo!.sessionId, sliceId, targetTrackId);
        } catch(error) {
          throw new NetworkError(`Failed to fetch slice ${sliceId}`, error as Error);
        }
      });

      // Check if cancelled after fetch
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Decrypt and decompress the slice with retry (using track-specific key)
      const audioData = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          return await this.decryptSlice(encryptedSlice, trackKey);
        } catch(error) {
          throw new DecryptionError(`Failed to decrypt slice ${sliceId}`, error as Error);
        }
      });

      // Check if cancelled after decrypt
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      // Convert audio data to AudioBuffer with retry
      // For WAV (PCM), parse manually; for MP3/FLAC/OGG, use Web Audio API decoder
      const audioBuffer = await this.retryManager.retry(async() => {
        if (loadController.signal.aborted) {
          throw new Error('Operation cancelled');
        }
        try {
          const format = trackInfo.format || 'wav';
          if (format === 'wav') {
            // Raw PCM data - parse manually for precise control
            return this.createAudioBufferFromPCM(audioData, trackInfo);
          } else {
            // Compressed format (MP3, FLAC, OGG) - use Web Audio API decoder
            // This is more efficient than server-side decoding
            return await this.createAudioBufferFromCompressed(audioData);
          }
        } catch(error) {
          throw new DecodingError(`Failed to decode slice ${sliceId}`, error as Error);
        }
      });

      // Final check if cancelled before storing
      if (loadController.signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const sliceData: AudioSliceData = {
        audioBuffer,
        sequence: encryptedSlice.sequence,
      };

      // Store in track-specific buffer only if not cancelled
      trackBuffer.set(sequence, sliceData);

      return sliceData;
    } catch(error) {
      // If operation was cancelled, don't treat as error
      if (error instanceof Error && error.message === 'Operation cancelled') {
        throw error;
      }
      // For other errors, rethrow
      throw error;
    } finally {
      // Always remove from loading set when done (success, failure, or cancellation)
      this.loadingSlices.delete(loadingKey);
    }
  }

  /**
   * Prefetch multiple slices for smooth playback (track-aware)
   * Framework buffer strategy - developers can customize this
   */
  async prefetchSlices(startSlice: number, count: number, trackId?: string): Promise<void> {
    if (!this.sessionInfo)
      return;

    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return;

    const trackInfo = this.getTrackInfo(targetTrackId);
    if (!trackInfo) return;

    // Limit concurrency for prefetch to reduce contention and maintain responsiveness
    const tasks: Array<() => Promise<void>> = [];

    for (let i = 0; i < count; i++) {
      const sliceIndex = startSlice + i;
      if (sliceIndex >= trackInfo.totalSlices)
        break;

      const sliceId = trackInfo.sliceIds[sliceIndex];
      if (!sliceId)
        continue;

      if (this.isSliceAvailable(sliceIndex, targetTrackId))
        continue;

      tasks.push(async() => {
        try {
          await this.loadSlice(sliceId, undefined, targetTrackId);
        } catch(error) {
          if (!(error instanceof Error && error.message === 'Operation cancelled')) {
            console.warn(`Failed to prefetch slice ${sliceId}:`, error);
          }
        }
      });
    }

    const concurrency = Math.max(1, this.config.prefetchConcurrency ?? DEFAULT_PREFETCH_CONCURRENCY);
    let index = 0;
    const runners: Promise<void>[] = [];

    const runNext = async(): Promise<void> => {
      if (index >= tasks.length)
        return;
      const task = tasks[index++];
      await task();
      return runNext();
    };

    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
      runners.push(runNext());
    }

    await Promise.all(runners);
  }

  /**
   * Get slice data if available (track-aware)
   */
  getSliceData(sequence: number, trackId?: string): AudioSliceData | null {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return null;

    const trackBuffer = this.audioBuffers.get(targetTrackId);
    return trackBuffer?.get(sequence) || null;
  }

  /**
   * Get session information
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Decrypt slice data using configurable processor (track-aware)
   * Uses Web Worker if configured, otherwise falls back to main thread
   */
  private async decryptSlice(encryptedSlice: EncryptedSlice, trackKey: TKey): Promise<ArrayBuffer> {
    if (!trackKey) {
      throw new Error('Track key not available');
    }

    // Try using Web Worker if available
    if (this.workerManager) {
      try {
        // Convert track key to transferable type
        let transferableKey: ArrayBuffer | string;
        if (trackKey instanceof ArrayBuffer) {
          transferableKey = trackKey;
        } else if (typeof trackKey === 'string') {
          transferableKey = trackKey;
        } else if (trackKey instanceof CryptoKey) {
          // Export CryptoKey to raw format for transfer to worker
          transferableKey = await crypto.subtle.exportKey('raw', trackKey);
        } else {
          // Unknown key type, fall back to main thread
          throw new TypeError('Unknown key type, using main thread');
        }

        return await this.workerManager.decryptSlice(encryptedSlice, transferableKey);
      } catch(error) {
        // Log warning and fall through to main thread decryption
        console.warn('Worker decryption failed, falling back to main thread:', error);
      }
    }

    // Main thread decryption (fallback or default)
    // Data is binary - no encoding conversion needed
    const encryptedData = encryptedSlice.encryptedData;
    const metadata: CryptoMetadata = { iv: encryptedSlice.iv };

    // Decrypt using configurable processor
    // Type assertion is safe here because we know the encryption processor accepts TKey type
    const compressedData = await this.encryptionProcessor.decrypt(
      encryptedData,
      trackKey as Parameters<TEncryptionProcessor['decrypt']>[1],
      metadata,
    );

    // Decompress using configurable processor
    const audioData = await this.compressionProcessor.decompress(compressedData);

    return audioData;
  }

  /**
   * Manually clean up old buffers based on current playback position (track-aware)
   * Note: When using SecureAudioPlayer, buffer cleanup is managed by player strategies.
   * Only call this manually if using the client standalone without a player.
   * @param currentSlice - The current slice being played
   * @param bufferSize - Number of slices to keep in buffer behind current position
   * @param trackId - Optional track ID (defaults to active track)
   */
  cleanupBuffers(currentSlice: number, bufferSize: number = DEFAULT_BUFFER_SIZE, trackId?: string): void {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return;

    const bufferStart = Math.max(0, currentSlice - bufferSize);
    const trackBuffer = this.audioBuffers.get(targetTrackId);
    const playedSet = this.playedSlices.get(targetTrackId);

    if (!trackBuffer || !playedSet) return;

    for (const [sequence] of trackBuffer) {
      if (sequence < bufferStart && playedSet.has(sequence)) {
        trackBuffer.delete(sequence);
        playedSet.delete(sequence);
      }
    }
  }

  /**
   * Create AudioBuffer from raw PCM data
   */
  private createAudioBufferFromPCM(pcmData: ArrayBuffer, audioInfo: SessionInfo | TrackInfo): AudioBuffer {
    const sampleRate = audioInfo.sampleRate;
    const channels = audioInfo.channels;
    const bitDepth = audioInfo.bitDepth || 16;

    // Calculate number of samples per channel
    const bytesPerSample = bitDepth / 8;
    const frameSize = channels * bytesPerSample;
    const totalFrames = pcmData.byteLength / frameSize;

    // Create AudioBuffer with exact sampleRate to avoid resampling drift
    const audioBuffer = this.audioContext.createBuffer(channels, totalFrames, sampleRate);

    // Convert PCM data to float32 arrays for each channel
    const dataView = new DataView(pcmData);

    for (let channel = 0; channel < channels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);

      for (let frame = 0; frame < totalFrames; frame++) {
        const byteOffset = frame * frameSize + channel * bytesPerSample;

        let sample: number;
        if (bitDepth === 16) {
          // 16-bit signed PCM
          sample = dataView.getInt16(byteOffset, true) / 32768.0;
        } else if (bitDepth === 24) {
          // 24-bit signed PCM (stored as 3 bytes)
          const byte1 = dataView.getUint8(byteOffset);
          const byte2 = dataView.getUint8(byteOffset + 1);
          const byte3 = dataView.getUint8(byteOffset + 2);
          const intVal = (byte3 << 16) | (byte2 << 8) | byte1;
          // Convert from unsigned to signed
          sample = (intVal > 0x7FFFFF ? intVal - 0x1000000 : intVal) / 8388608.0;
        } else if (bitDepth === 32 && audioInfo.isFloat32) {
          // 32-bit float PCM
          sample = dataView.getFloat32(byteOffset, true);
        } else if (bitDepth === 32) {
          // 32-bit signed PCM (int)
          sample = dataView.getInt32(byteOffset, true) / 2147483648.0;
        } else {
          // Default to 16-bit if unsupported bit depth
          sample = dataView.getInt16(byteOffset, true) / 32768.0;
        }

        channelData[frame] = sample;
      }
    }

    return audioBuffer;
  }

  /**
   * Create AudioBuffer from compressed audio data (MP3, FLAC, OGG) using Web Audio API
   */
  private async createAudioBufferFromCompressed(compressedData: ArrayBuffer): Promise<AudioBuffer> {
    // Use browser's built-in decoder - supports MP3, AAC, WAV, FLAC, OGG, etc.
    // This is much more efficient than server-side decoding
    return await this.audioContext.decodeAudioData(compressedData);
  }

  // Mark a slice as played for cleanup purposes (track-aware)
  markSlicePlayed(sequence: number, trackId?: string): void {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return;

    if (!this.playedSlices.has(targetTrackId)) {
      this.playedSlices.set(targetTrackId, new Set());
    }
    this.playedSlices.get(targetTrackId)!.add(sequence);
  }

  // Check if a slice is available in buffer (track-aware)
  isSliceAvailable(sequence: number, trackId?: string): boolean {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return false;

    const trackBuffer = this.audioBuffers.get(targetTrackId);
    return trackBuffer?.has(sequence) || false;
  }

  // Remove a specific slice from buffer (track-aware)
  removeSlice(sequence: number, trackId?: string): void {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return;

    const trackBuffer = this.audioBuffers.get(targetTrackId);
    if (trackBuffer) {
      trackBuffer.delete(sequence);
    }

    const playedSet = this.playedSlices.get(targetTrackId);
    if (playedSet) {
      playedSet.delete(sequence);
    }
  }

  // Get all buffered slice indices (track-aware)
  getBufferedSlices(trackId?: string): number[] {
    const targetTrackId = trackId || this.activeTrackId;
    if (!targetTrackId) return [];

    const trackBuffer = this.audioBuffers.get(targetTrackId);
    return trackBuffer ? Array.from(trackBuffer.keys()) : [];
  }

  // Get all tracks in the session
  getTracks(): TrackInfo[] {
    if (!this.sessionInfo) return [];
    return this.sessionInfo.tracks || [];
  }

  // Get active track ID
  getActiveTrackId(): string | null {
    return this.activeTrackId;
  }

  // Get total duration in seconds
  getTotalDuration(): number {
    if (!this.sessionInfo)
      return 0;
    return (this.sessionInfo.totalSlices * this.sessionInfo.sliceDuration) / 1000;
  }

  // Clean up resources
  destroy(): void {
    this.keyExchangeProcessor.destroy();
    this.cancelPendingLoads();
    this.audioBuffers.clear();
    this.playedSlices.clear();

    // Clean up worker manager
    if (this.workerManager) {
      this.workerManager.destroy();
      this.workerManager = null;
    }

    if (this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}
