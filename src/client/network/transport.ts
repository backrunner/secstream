import type { EncryptedSlice, SessionInfo, TrackInfo } from '../../shared/types/interfaces.js';
import type { KeyExchangeRequest, KeyExchangeResponse } from '../../shared/types/processors.js';

/**
 * Transport interface that developers must implement
 * Defines HOW to communicate with the server, but not WHAT to communicate
 * Developers have full control over request method, headers, parsing, etc.
 * Uses generic key exchange types for full flexibility
 * Supports both single-track (backward compatible) and multi-track sessions
 */
export interface Transport {
  /**
   * Create a new session by uploading audio data
   * Developer decides: request format, headers, error handling
   */
  createSession: (audioData: File | ArrayBuffer) => Promise<string>;

  /**
   * Perform key exchange with server
   * Developer decides: request format, response parsing
   * @param sessionId - Session identifier
   * @param request - Key exchange request data
   * @param trackId - Optional track ID for multi-track sessions (lazy key exchange)
   */
  performKeyExchange: <TRequestData = unknown, TResponseData = unknown, TSessionInfo = SessionInfo>(
    sessionId: string,
    request: KeyExchangeRequest<TRequestData>,
    trackId?: string
  ) => Promise<KeyExchangeResponse<TResponseData, TSessionInfo>>;

  /**
   * Get session information
   * Developer decides: request method, response format
   */
  getSessionInfo: (sessionId: string) => Promise<SessionInfo>;

  /**
   * Fetch encrypted slice data
   * Developer decides: how to make request, how to parse binary response and metadata
   * @param sessionId - Session identifier
   * @param sliceId - Slice identifier
   * @param trackId - Optional track ID for multi-track sessions
   */
  fetchSlice: (sessionId: string, sliceId: string, trackId?: string) => Promise<EncryptedSlice>;

  /**
   * Add a new track to an existing session (incremental track addition)
   * Developer decides: how to upload track data, metadata format
   * @param sessionId - Session identifier
   * @param audioData - Audio file or buffer to add
   * @param metadata - Optional track metadata (title, artist, album)
   */
  addTrack: (sessionId: string, audioData: File | ArrayBuffer, metadata?: { title?: string; artist?: string; album?: string }) => Promise<TrackInfo>;

  /**
   * Remove a track from an existing session (memory cleanup)
   * Developer decides: how to send removal request, how to handle response
   * @param sessionId - Session identifier
   * @param trackIdOrIndex - Track ID (string) or index (number) to remove
   * @returns Updated session info with remaining tracks
   */
  removeTrack: (sessionId: string, trackIdOrIndex: string | number) => Promise<SessionInfo>;
}

/**
 * Base class for network errors
 */
export class NetworkError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

/**
 * Indicates a decryption failure during slice processing
 */
export class DecryptionError extends NetworkError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'DecryptionError';
  }
}

/**
 * Indicates a decode failure during audio buffer creation
 */
export class DecodingError extends NetworkError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'DecodingError';
  }
}
