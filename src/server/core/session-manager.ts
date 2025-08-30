import type { AudioConfig, EncryptedSlice, KeyExchangeRequest, KeyExchangeResponse, SessionInfo } from '../../shared/types/interfaces.js';
import type { Timer } from '../../shared/utils/timers.js';
import { KeyExchangeManager } from '../../shared/crypto/key-exchange.js';
import { createInterval } from '../../shared/utils/timers.js';
import { AudioProcessor } from '../processing/audio-processor.js';

interface AudioSession {
  id: string;
  keyManager: KeyExchangeManager;
  processor: AudioProcessor;
  sessionInfo: SessionInfo;
  getSlice: (sliceId: string) => Promise<EncryptedSlice | null>;
  createdAt: Date;
  lastAccessed: Date;
  keyExchangeComplete?: boolean;
  audioData?: ArrayBuffer;
}

/**
 * Manages audio sessions including key exchange and audio processing
 * Handles session lifecycle, cleanup, and statistics
 * Compatible with Node.js, Cloudflare Workers, and other JavaScript environments
 */
export class SessionManager {
  private sessions = new Map<string, AudioSession>();
  private config: AudioConfig;
  private cleanupTimer: Timer | null = null;

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...{ sliceDurationMs: 5000, compressionLevel: 6, encryptionAlgorithm: 'AES-GCM' }, ...config };

    // Clean up expired sessions every 5 minutes using cross-platform timer
    this.cleanupTimer = createInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  async createSession(audioData: ArrayBuffer | ReadableStream): Promise<string> {
    const sessionId = this.generateSessionId();

    // Initialize key exchange manager
    const keyManager = new KeyExchangeManager();
    await keyManager.initialize();

    // Create audio processor
    const processor = new AudioProcessor(this.config);

    // Store session info temporarily (will be completed after key exchange)
    const session: Partial<AudioSession> = {
      id: sessionId,
      keyManager,
      processor,
      createdAt: new Date(),
      lastAccessed: new Date(),
    }

    // Store the audio data temporarily for processing after key exchange
    ;(session as any).audioData = audioData;

    this.sessions.set(sessionId, session as AudioSession);

    return sessionId;
  }

  async handleKeyExchange(sessionId: string, request: KeyExchangeRequest): Promise<KeyExchangeResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Process the audio now that we have the session key
    const audioData = (session as any).audioData;
    if (!audioData) {
      throw new Error('Audio data not found for session');
    }

    // First, we need to create a temporary session info for the key exchange
    // We'll update it with the real info after processing
    const tempSessionInfo: SessionInfo = {
      sessionId,
      totalSlices: 0,
      sliceDuration: this.config.sliceDurationMs,
      sampleRate: 44100, // Will be updated
      channels: 2, // Will be updated
    };

    const response = await session.keyManager.handleKeyExchangeRequest(request, tempSessionInfo);

    // Mark key exchange as complete and process audio immediately
    session.keyExchangeComplete = true;
    session.lastAccessed = new Date();

    // Process audio immediately after key exchange
    await this.processSessionAudio(session, sessionId);

    // Update the response with the actual session info
    response.sessionInfo = session.sessionInfo;

    return response;
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

    const sessionKey = session.keyManager.getSessionKey();
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
      session.keyManager.destroy();
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
