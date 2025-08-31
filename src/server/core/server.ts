import type { EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type { KeyExchangeRequest, KeyExchangeResponse } from '../../shared/types/processors.js';
import type { SessionManager } from './session-manager.js';

/**
 * Core server class that provides secure audio streaming functionality.
 * This class only contains the essential methods - no framework-specific handlers.
 * Developers can integrate these methods into any server framework they choose.
 * Compatible with Node.js, Cloudflare Workers, and other JavaScript environments.
 * Supports generic key exchange types for full flexibility.
 */
export class SecureAudioServer {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Create a new audio session from uploaded audio data
   * @param audioData - Raw audio data (ArrayBuffer or ReadableStream)
   * @returns Promise resolving to session information
   */
  async createSession(audioData: ArrayBuffer | ReadableStream): Promise<{ sessionId: string }> {
    const sessionId = await this.sessionManager.createSession(audioData);
    return { sessionId };
  }

  /**
   * Handle key exchange for a session
   * @param sessionId - The session identifier
   * @param request - Key exchange request from client
   * @returns Promise resolving to key exchange response
   */
  async handleKeyExchange<TRequestData = unknown, TResponseData = unknown>(
    sessionId: string, 
    request: KeyExchangeRequest<TRequestData>
  ): Promise<KeyExchangeResponse<TResponseData, SessionInfo>> {
    return await this.sessionManager.handleKeyExchange(sessionId, request);
  }

  /**
   * Get session information
   * @param sessionId - The session identifier
   * @returns Session information or null if not found
   */
  async getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
    return this.sessionManager.getSessionInfo(sessionId);
  }

  /**
   * Get an encrypted audio slice
   * @param sessionId - The session identifier
   * @param sliceId - The slice identifier (e.g., "slice_0")
   * @returns Encrypted slice data or null if not found
   */
  async getSlice(sessionId: string, sliceId: string): Promise<EncryptedSlice | null> {
    return await this.sessionManager.getSlice(sessionId, sliceId);
  }

  /**
   * Destroy a session and clean up resources
   * @param sessionId - The session identifier
   */
  destroySession(sessionId: string): void {
    this.sessionManager.destroySession(sessionId);
  }

  /**
   * Get server statistics
   * @returns Statistics about active sessions
   */
  getStats(): { activeSessions: number; totalSessions: number } {
    return this.sessionManager.getStats();
  }
}