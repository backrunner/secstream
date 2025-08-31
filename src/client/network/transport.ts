import type { EncryptedSlice, SessionInfo } from '../../shared/types/interfaces.js';
import type { KeyExchangeRequest, KeyExchangeResponse } from '../../shared/types/processors.js';

/**
 * Transport interface that developers must implement
 * Defines HOW to communicate with the server, but not WHAT to communicate
 * Developers have full control over request method, headers, parsing, etc.
 * Uses generic key exchange types for full flexibility
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
   */
  performKeyExchange: <TRequestData = unknown, TResponseData = unknown, TSessionInfo = SessionInfo>(
    sessionId: string, 
    request: KeyExchangeRequest<TRequestData>
  ) => Promise<KeyExchangeResponse<TResponseData, TSessionInfo>>;

  /**
   * Get session information
   * Developer decides: request method, response format
   */
  getSessionInfo: (sessionId: string) => Promise<SessionInfo>;

  /**
   * Fetch encrypted slice data
   * Developer decides: how to make request, how to parse binary response and metadata
   */
  fetchSlice: (sessionId: string, sliceId: string) => Promise<EncryptedSlice>;
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