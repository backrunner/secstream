import type { AudioConfig, EncryptedSlice, SessionInfo, SliceIdGenerator, TrackInfo } from '../../shared/types/interfaces.js';
import type {
  KeyExchangeProcessor,
  KeyExchangeRequest,
  KeyExchangeResponse,
  ProcessingConfig,
} from '../../shared/types/processors.js';
import type { Timer } from '../../shared/utils/timers.js';
import { EcdhP256KeyExchangeProcessor } from '../../shared/crypto/key-exchange/ecdh-p256-processor.js';
import { createInterval } from '../../shared/utils/timers.js';
import { AudioProcessor } from '../processing/audio-processor.js';

/**
 * Track-specific data within a session
 */
interface TrackData {
  trackId: string;
  trackIndex: number;
  processor: AudioProcessor;
  trackInfo?: TrackInfo;
  sessionKey?: unknown;
  keyExchangeProcessor?: KeyExchangeProcessor;
  keyExchangeComplete?: boolean;
  audioData?: ArrayBuffer;
  getSlice?: (sliceId: string) => Promise<EncryptedSlice | null>;
  metadata?: { title?: string; artist?: string; album?: string };
}

interface AudioSession {
  id: string;
  // Multi-track support
  tracks: Map<string, TrackData>; // trackId → track data
  trackOrder: string[]; // Ordered list of trackIds
  activeTrackId?: string;

  // Backward compatibility - single track session
  keyExchangeProcessor?: KeyExchangeProcessor;
  processor?: AudioProcessor;
  sessionInfo?: SessionInfo;
  sessionKey?: unknown;
  getSlice?: (sliceId: string) => Promise<EncryptedSlice | null>;

  createdAt: Date;
  lastAccessed: Date;
  keyExchangeComplete?: boolean;
  audioData?: ArrayBuffer;

  // Multi-track flags
  isMultiTrack: boolean;
}

/**
 * Configuration options for SessionManager
 * Extends AudioConfig with additional server-side processing options
 */
export interface SessionManagerConfig extends Partial<AudioConfig> {
  /** Custom processing configuration (compression, encryption, key exchange) */
  processingConfig?: ProcessingConfig;
  /** Custom slice ID generator */
  sliceIdGenerator?: SliceIdGenerator;
  /** Number of slices to prewarm after key exchange. Default: 0 */
  prewarmSlices?: number;
  /** Maximum parallel prewarm workers. Default: 3 */
  prewarmConcurrency?: number;
  /** Enable adaptive compression for already-compressed formats. Default: true */
  adaptiveCompression?: boolean;
  /** Server-side encrypted slice cache size (LRU). Default: 10 */
  serverCacheSize?: number;
  /** Server-side encrypted slice TTL in ms. Default: 300_000 (5 minutes) */
  serverCacheTtlMs?: number;
  /**
   * Multi-track optimization: Parallel track processing limit. Default: 3
   * Controls how many tracks can be processed simultaneously during batch upload
   */
  trackProcessingConcurrency?: number;
  /**
   * Multi-track optimization: Prewarm first track of playlist. Default: true
   * When enabled, first track is fully processed and cached during session creation
   */
  prewarmFirstTrack?: boolean;
}

/**
 * Manages audio sessions including key exchange and audio processing
 * Handles session lifecycle, cleanup, and statistics
 * Compatible with Node.js, Cloudflare Workers, and other JavaScript environments
 * Supports customizable compression, encryption, and key exchange processors
 */
export class SessionManager {
  private sessions = new Map<string, AudioSession>();
  private config: SessionManagerConfig & Required<Pick<AudioConfig, 'sliceDurationMs' | 'compressionLevel' | 'encryptionAlgorithm'>>;

  private cleanupTimer: Timer | null = null;
  private keyExchangeProcessorFactory: () => KeyExchangeProcessor;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      sliceDurationMs: 5000,
      compressionLevel: 6,
      encryptionAlgorithm: 'AES-GCM',
      randomizeSliceLength: false,
      sliceLengthVariance: 0.4,
      prewarmSlices: 0,
      prewarmConcurrency: 3,
      adaptiveCompression: true,
      serverCacheSize: 10,
      serverCacheTtlMs: 300_000,
      trackProcessingConcurrency: 3,
      prewarmFirstTrack: true,
      ...config,
    };

    // Create factory for key exchange processors
    const keyExchangeProcessor = config.processingConfig?.keyExchangeProcessor;
    this.keyExchangeProcessorFactory = keyExchangeProcessor
      ? () => {
        // Create a new instance of the same type as the provided processor
        const ProcessorClass = keyExchangeProcessor.constructor as new () => KeyExchangeProcessor;
        return new ProcessorClass();
      }
      : () => new EcdhP256KeyExchangeProcessor() as unknown as KeyExchangeProcessor;

    // Clean up expired sessions every 5 minutes using cross-platform timer
    this.cleanupTimer = createInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Create session with single track (backward compatible)
   */
  async createSession(audioData: ArrayBuffer | ReadableStream): Promise<string> {
    const sessionId = this.generateSessionId();

    // Initialize key exchange processor
    const keyExchangeProcessor = this.keyExchangeProcessorFactory();
    await keyExchangeProcessor.initialize();

    // Create audio processor with customizable processors
    const processor = new AudioProcessor(this.config);

    // Store session info temporarily (will be completed after key exchange)
    const session: AudioSession = {
      id: sessionId,
      keyExchangeProcessor,
      processor,
      createdAt: new Date(),
      lastAccessed: new Date(),
      isMultiTrack: false,
      tracks: new Map(),
      trackOrder: [],
      audioData: audioData as ArrayBuffer,
    };

    this.sessions.set(sessionId, session);

    return sessionId;
  }

  /**
   * Create session with multiple tracks (batch upload - optimized)
   * Processes tracks in parallel for better performance
   */
  async createMultiTrackSession(tracks: Array<{
    audioData: ArrayBuffer | ReadableStream;
    metadata?: { title?: string; artist?: string; album?: string };
  }>): Promise<string> {
    if (tracks.length === 0) {
      throw new Error('At least one track is required');
    }

    const sessionId = this.generateSessionId();

    // Create session with multi-track structure
    const session: AudioSession = {
      id: sessionId,
      createdAt: new Date(),
      lastAccessed: new Date(),
      isMultiTrack: true,
      tracks: new Map(),
      trackOrder: [],
    };

    const trackDataArray: TrackData[] = [];

    for (let i = 0; i < tracks.length; i++) {
      const trackId = this.generateTrackId(sessionId, i);
      const processor = new AudioProcessor(this.config);

      const trackData: TrackData = {
        trackId,
        trackIndex: i,
        processor,
        audioData: tracks[i].audioData as ArrayBuffer,
        metadata: tracks[i].metadata,
      };

      trackDataArray.push(trackData);
      session.tracks.set(trackId, trackData);
      session.trackOrder.push(trackId);
    }

    // Set first track as active
    session.activeTrackId = session.trackOrder[0];

    this.sessions.set(sessionId, session);

    return sessionId;
  }

  /**
   * Handle key exchange for session or specific track
   * @param sessionId - Session identifier
   * @param request - Key exchange request
   * @param trackId - Optional track ID for multi-track sessions (lazy key exchange)
   */
  async handleKeyExchange<TRequestData = unknown, TResponseData = unknown>(
    sessionId: string,
    request: KeyExchangeRequest<TRequestData>,
    trackId?: string,
  ): Promise<KeyExchangeResponse<TResponseData, SessionInfo>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.lastAccessed = new Date();

    // Multi-track session with trackId - initialize specific track
    if (session.isMultiTrack && trackId) {
      const track = session.tracks.get(trackId);
      if (!track) {
        throw new Error(`Track ${trackId} not found in session ${sessionId}`);
      }

      // Initialize key exchange processor for this track
      if (!track.keyExchangeProcessor) {
        track.keyExchangeProcessor = this.keyExchangeProcessorFactory();
        await track.keyExchangeProcessor.initialize();
      }

      // Process the key exchange request (processor is guaranteed to exist after above check)
      const processor = track.keyExchangeProcessor;
      const { response, sessionKey } = await processor.processKeyExchangeRequest(request, sessionId);

      // Store the track-specific session key
      track.sessionKey = sessionKey;
      track.keyExchangeComplete = true;

      // Process track audio if prewarm is enabled for this track
      if (this.config.prewarmFirstTrack && track.trackIndex === 0) {
        await this.processTrackAudio(track, sessionId);
      }

      // Build session info with all tracks
      const sessionInfo = this.buildMultiTrackSessionInfo(session);
      response.sessionInfo = sessionInfo;

      return response as KeyExchangeResponse<TResponseData, SessionInfo>;
    }

    // Single-track session (backward compatible)
    if (!session.isMultiTrack) {
      // Process the key exchange request
      const { response, sessionKey } = await session.keyExchangeProcessor!.processKeyExchangeRequest(request, sessionId);

      // Store the session key
      session.sessionKey = sessionKey;

      // Mark key exchange as complete and process audio immediately
      session.keyExchangeComplete = true;

      // Process audio immediately after key exchange
      await this.processSessionAudio(session, sessionId);

      // Update the response with the actual session info
      response.sessionInfo = session.sessionInfo!;

      return response as KeyExchangeResponse<TResponseData, SessionInfo>;
    }

    // Multi-track session without trackId - initialize first track by default
    const firstTrackId = session.trackOrder[0];
    if (!firstTrackId) {
      throw new Error('No tracks in session');
    }

    return this.handleKeyExchange(sessionId, request, firstTrackId);
  }

  /**
   * Get encrypted slice for session or specific track
   * @param sessionId - Session identifier
   * @param sliceId - Slice identifier
   * @param trackId - Optional track ID for multi-track sessions
   */
  async getSlice(sessionId: string, sliceId: string, trackId?: string): Promise<EncryptedSlice | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    session.lastAccessed = new Date();

    // Multi-track session
    if (session.isMultiTrack) {
      const targetTrackId = trackId || session.activeTrackId;
      if (!targetTrackId) {
        return null;
      }

      const track = session.tracks.get(targetTrackId);
      if (!track) {
        return null;
      }

      // Process audio lazily when first slice is requested
      if (!track.getSlice && track.keyExchangeComplete) {
        await this.processTrackAudio(track, sessionId);
      }

      if (!track.getSlice) {
        return null;
      }

      const slice = await track.getSlice(sliceId);

      // Add trackId to the slice for client identification
      if (slice) {
        slice.trackId = targetTrackId;
      }

      return slice;
    }

    // Single-track session (backward compatible)
    // Process audio lazily when first slice is requested
    if (!session.getSlice && session.keyExchangeComplete) {
      await this.processSessionAudio(session, sessionId);
    }

    if (!session.getSlice) {
      return null;
    }

    return await session.getSlice(sliceId);
  }

  /**
   * Add a new track to an existing session (incremental track addition)
   * @param sessionId - Session identifier
   * @param audioData - Audio data for the new track
   * @param metadata - Optional track metadata
   */
  async addTrack(
    sessionId: string,
    audioData: ArrayBuffer | ReadableStream,
    metadata?: { title?: string; artist?: string; album?: string },
  ): Promise<TrackInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Convert session to multi-track if it's currently single-track
    if (!session.isMultiTrack) {
      // Migrate single-track session to multi-track
      session.isMultiTrack = true;

      // Move existing single-track data to tracks map
      if (session.processor && session.sessionInfo) {
        const trackId = this.generateTrackId(sessionId, 0);
        const trackData: TrackData = {
          trackId,
          trackIndex: 0,
          processor: session.processor,
          trackInfo: this.buildTrackInfoFromSessionInfo(session.sessionInfo, trackId, 0),
          sessionKey: session.sessionKey,
          keyExchangeProcessor: session.keyExchangeProcessor,
          keyExchangeComplete: session.keyExchangeComplete,
          getSlice: session.getSlice,
        };

        session.tracks.set(trackId, trackData);
        session.trackOrder.push(trackId);
        session.activeTrackId = trackId;
      }
    }

    // Create new track
    const trackIndex = session.tracks.size;
    const trackId = this.generateTrackId(sessionId, trackIndex);
    const processor = new AudioProcessor(this.config);

    const trackData: TrackData = {
      trackId,
      trackIndex,
      processor,
      audioData: audioData as ArrayBuffer,
      metadata,
    };

    session.tracks.set(trackId, trackData);
    session.trackOrder.push(trackId);

    session.lastAccessed = new Date();

    // Return track info (will be populated after key exchange and processing)
    return {
      trackId,
      trackIndex,
      totalSlices: 0, // Unknown until processed
      sliceDuration: this.config.sliceDurationMs,
      sampleRate: 0, // Unknown until processed
      channels: 0, // Unknown until processed
      sliceIds: [],
      duration: 0,
      ...metadata,
    };
  }

  private async processSessionAudio(session: AudioSession, sessionId: string): Promise<void> {
    if (!session.audioData || !session.keyExchangeComplete) {
      return;
    }

    if (!session.processor) {
      throw new Error('Audio processor not available');
    }

    const sessionKey = session.sessionKey;
    if (!sessionKey) {
      throw new Error('Session key not available');
    }

    const { sessionInfo, getSlice } = await session.processor.processAudio(
      session.audioData,
      sessionKey,
      sessionId,
    );

    // Update the session with complete information
    session.sessionInfo = sessionInfo;
    session.getSlice = getSlice;

    // Clean up the temporary audio data
    session.audioData = undefined;
  }

  private async processTrackAudio(track: TrackData, sessionId: string): Promise<void> {
    if (!track.audioData || !track.keyExchangeComplete) {
      return;
    }

    const sessionKey = track.sessionKey;
    if (!sessionKey) {
      throw new Error('Track session key not available');
    }

    const { sessionInfo, getSlice } = await track.processor.processAudio(
      track.audioData,
      sessionKey,
      `${sessionId}_${track.trackId}`,
    );

    // Update the track with complete information
    track.trackInfo = this.buildTrackInfoFromSessionInfo(sessionInfo, track.trackId, track.trackIndex);
    track.getSlice = getSlice;

    // Clean up the temporary audio data
    track.audioData = undefined;
  }

  private buildMultiTrackSessionInfo(session: AudioSession): SessionInfo {
    if (!session.isMultiTrack) {
      throw new Error('Session is not multi-track');
    }

    // Build tracks array from session tracks
    const tracks: TrackInfo[] = [];
    for (const trackId of session.trackOrder) {
      const track = session.tracks.get(trackId);
      if (track && track.trackInfo) {
        tracks.push(track.trackInfo);
      }
    }

    // Get first track or active track as reference for backward compatible fields
    const firstTrack = tracks[0];
    if (!firstTrack) {
      throw new Error('No tracks available in session');
    }

    return {
      sessionId: session.id,
      tracks,
      activeTrackId: session.activeTrackId,
      // Backward compatible fields - use first/active track
      totalSlices: firstTrack.totalSlices,
      sliceDuration: firstTrack.sliceDuration,
      sampleRate: firstTrack.sampleRate,
      channels: firstTrack.channels,
      bitDepth: firstTrack.bitDepth,
      isFloat32: firstTrack.isFloat32,
      sliceIds: firstTrack.sliceIds,
      format: firstTrack.format,
    };
  }

  private buildTrackInfoFromSessionInfo(sessionInfo: SessionInfo, trackId: string, trackIndex: number): TrackInfo {
    return {
      trackId,
      trackIndex,
      totalSlices: sessionInfo.totalSlices,
      sliceDuration: sessionInfo.sliceDuration,
      sampleRate: sessionInfo.sampleRate,
      channels: sessionInfo.channels,
      bitDepth: sessionInfo.bitDepth,
      isFloat32: sessionInfo.isFloat32,
      sliceIds: sessionInfo.sliceIds,
      format: sessionInfo.format,
      duration: (sessionInfo.totalSlices * sessionInfo.sliceDuration) / 1000,
    };
  }

  getSessionInfo(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    return session?.sessionInfo || null;
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Destroy session-level key exchange processor (single-track sessions)
      if (session.keyExchangeProcessor) {
        session.keyExchangeProcessor.destroy();
      }

      // Destroy all track-level key exchange processors (multi-track sessions)
      if (session.isMultiTrack) {
        for (const [_trackId, track] of session.tracks) {
          if (track.keyExchangeProcessor) {
            track.keyExchangeProcessor.destroy();
          }
        }
      }

      this.sessions.delete(sessionId);
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTrackId(sessionId: string, index: number): string {
    return `${sessionId}_track_${index}`;
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.sessions) {
      if (now.getTime() - session.lastAccessed.getTime() > maxAge) {
        this.destroySession(sessionId);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      this.cleanupTimer.clear();
      this.cleanupTimer = null;
    }

    // Clean up all sessions
    for (const sessionId of this.sessions.keys()) {
      this.destroySession(sessionId);
    }
  }

  // Get statistics about active sessions
  getStats(): { activeSessions: number; totalSessions: number } {
    return {
      activeSessions: this.sessions.size,
      totalSessions: this.sessions.size, // Could track total if needed
    };
  }
}
