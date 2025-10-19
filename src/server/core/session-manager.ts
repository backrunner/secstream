import type { AudioConfig, EncryptedSlice, SessionInfo, SliceIdGenerator } from '../../shared/types/interfaces.js';
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

interface AudioSession {
  id: string;
  keyExchangeProcessor: KeyExchangeProcessor;
  processor: AudioProcessor;
  sessionInfo: SessionInfo;
  sessionKey?: any;
  getSlice: (sliceId: string) => Promise<EncryptedSlice | null>;
  createdAt: Date;
  lastAccessed: Date;
  keyExchangeComplete?: boolean;
  audioData?: ArrayBuffer;
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
  private keyExchangeProcessorFactory: () => KeyExchangeProcessor<any, any, any, any>;

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
      ...config,
    };

    // Create factory for key exchange processors
    const keyExchangeProcessor = config.processingConfig?.keyExchangeProcessor;
    this.keyExchangeProcessorFactory = keyExchangeProcessor
      ? () => {
        // Create a new instance of the same type as the provided processor
        const ProcessorClass = keyExchangeProcessor.constructor as new () => any;
        return new ProcessorClass();
      }
      : () => new EcdhP256KeyExchangeProcessor();

    // Clean up expired sessions every 5 minutes using cross-platform timer
    this.cleanupTimer = createInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  async createSession(audioData: ArrayBuffer | ReadableStream): Promise<string> {
    const sessionId = this.generateSessionId();

    // Initialize key exchange processor
    const keyExchangeProcessor = this.keyExchangeProcessorFactory();
    await keyExchangeProcessor.initialize();

    // Create audio processor with customizable processors
    const processor = new AudioProcessor(this.config);

    // Store session info temporarily (will be completed after key exchange)
    const session: Partial<AudioSession> = {
      id: sessionId,
      keyExchangeProcessor,
      processor,
      createdAt: new Date(),
      lastAccessed: new Date(),
    }

    // Store the audio data temporarily for processing after key exchange
    ;(session as any).audioData = audioData;

    this.sessions.set(sessionId, session as AudioSession);

    return sessionId;
  }

  async handleKeyExchange<TRequestData = unknown, TResponseData = unknown>(
    sessionId: string,
    request: KeyExchangeRequest<TRequestData>,
  ): Promise<KeyExchangeResponse<TResponseData, SessionInfo>> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Process the key exchange request
    const { response, sessionKey } = await session.keyExchangeProcessor.processKeyExchangeRequest(request, sessionId);

    // Store the session key
    session.sessionKey = sessionKey;

    // Mark key exchange as complete and process audio immediately
    session.keyExchangeComplete = true;
    session.lastAccessed = new Date();

    // Process audio immediately after key exchange
    await this.processSessionAudio(session, sessionId);

    // Update the response with the actual session info
    response.sessionInfo = session.sessionInfo;

    return response as KeyExchangeResponse<TResponseData, SessionInfo>;
  }

  async getSlice(sessionId: string, sliceId: string): Promise<EncryptedSlice | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Process audio lazily when first slice is requested
    if (!session.getSlice && session.keyExchangeComplete) {
      await this.processSessionAudio(session, sessionId);
    }

    if (!session.getSlice) {
      return null;
    }

    session.lastAccessed = new Date();
    return await session.getSlice(sliceId);
  }

  private async processSessionAudio(session: AudioSession, sessionId: string): Promise<void> {
    if (!session.audioData || !session.keyExchangeComplete) {
      return;
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
    delete (session as any).audioData;
  }

  getSessionInfo(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    return session?.sessionInfo || null;
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.keyExchangeProcessor.destroy();
      this.sessions.delete(sessionId);
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
