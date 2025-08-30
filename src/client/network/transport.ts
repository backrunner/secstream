import type { EncryptedSlice, KeyExchangeRequest, KeyExchangeResponse, SessionInfo } from '../../shared/types/interfaces.js';

/**
 * Transport interface that developers must implement
 * Defines HOW to communicate with the server, but not WHAT to communicate
 * Developers have full control over request method, headers, parsing, etc.
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
  performKeyExchange: (sessionId: string, request: KeyExchangeRequest) => Promise<KeyExchangeResponse>;

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
 * Retry configuration for network operations
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffFactor: number;
}

/**
 * Client configuration
 */
export interface ClientConfig {
  bufferSize: number;
  prefetchSize: number;
  retryConfig: Partial<RetryConfig>;
}

/**
 * Custom error types for better error handling
 */
export class SecStreamError extends Error {
  constructor(
    message: string,
    public readonly type: 'network' | 'decrypt' | 'decode' | 'server',
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'SecStreamError';
  }
}

export class NetworkError extends SecStreamError {
  constructor(message: string, cause?: Error) {
    super(message, 'network', cause);
    this.name = 'NetworkError';
  }
}

export class DecryptionError extends SecStreamError {
  constructor(message: string, cause?: Error) {
    super(message, 'decrypt', cause);
    this.name = 'DecryptionError';
  }
}

export class DecodingError extends SecStreamError {
  constructor(message: string, cause?: Error) {
    super(message, 'decode', cause);
    this.name = 'DecodingError';
  }
}

export class ServerError extends SecStreamError {
  constructor(message: string, cause?: Error) {
    super(message, 'server', cause);
    this.name = 'ServerError';
  }
}

/**
 * Default fetch-based transport implementation
 * Developers can use this as-is or create their own implementation
 */
export class DefaultTransport implements Transport {
  private baseUrl: string;
  private endpoints: {
    createSession: string;
    keyExchange: (sessionId: string) => string;
    sessionInfo: (sessionId: string) => string;
    slice: (sessionId: string, sliceId: string) => string;
  };

  constructor(
    baseUrl: string,
    endpoints: {
      createSession?: string;
      keyExchange?: (sessionId: string) => string;
      sessionInfo?: (sessionId: string) => string;
      slice?: (sessionId: string, sliceId: string) => string;
    } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');

    this.endpoints = {
      createSession: endpoints.createSession || '/sessions',
      keyExchange: endpoints.keyExchange || (sessionId => `/sessions/${sessionId}/key-exchange`),
      sessionInfo: endpoints.sessionInfo || (sessionId => `/sessions/${sessionId}/info`),
      slice: endpoints.slice || ((sessionId, sliceId) => `/sessions/${sessionId}/slices/${sliceId}`),
    };
  }

  async createSession(audioData: File | ArrayBuffer): Promise<string> {
    let body: FormData | ArrayBuffer;

    if (audioData instanceof File) {
      const formData = new FormData();
      formData.append('audio', audioData);
      body = formData;
    } else {
      body = audioData;
    }

    const response = await fetch(`${this.baseUrl}${this.endpoints.createSession}`, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.sessionId;
  }

  async performKeyExchange(sessionId: string, request: KeyExchangeRequest): Promise<KeyExchangeResponse> {
    const response = await fetch(`${this.baseUrl}${this.endpoints.keyExchange(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const response = await fetch(`${this.baseUrl}${this.endpoints.sessionInfo(sessionId)}`);

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  async fetchSlice(sessionId: string, sliceId: string): Promise<EncryptedSlice> {
    const response = await fetch(`${this.baseUrl}${this.endpoints.slice(sessionId, sliceId)}`);

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Default implementation: parse binary response with HTTP headers
    const binaryData = await response.arrayBuffer();

    // Extract metadata from headers - developers can customize this
    const sliceIdHeader = response.headers.get('X-Slice-ID');
    const sequenceHeader = response.headers.get('X-Slice-Sequence');
    const sessionIdHeader = response.headers.get('X-Session-ID');
    const encryptedDataLengthHeader = response.headers.get('X-Encrypted-Data-Length');
    const ivLengthHeader = response.headers.get('X-IV-Length');

    if (!sliceIdHeader || !sequenceHeader || !sessionIdHeader
      || !encryptedDataLengthHeader || !ivLengthHeader) {
      throw new ServerError('Missing required headers in slice response');
    }

    const encryptedDataLength = Number.parseInt(encryptedDataLengthHeader, 10);
    const ivLength = Number.parseInt(ivLengthHeader, 10);
    const sequence = Number.parseInt(sequenceHeader, 10);

    // Split binary payload - developers can customize this logic
    const encryptedData = binaryData.slice(0, encryptedDataLength);
    const iv = binaryData.slice(encryptedDataLength, encryptedDataLength + ivLength);

    return {
      id: sliceIdHeader,
      encryptedData,
      iv,
      sequence,
      sessionId: sessionIdHeader,
    };
  }
}
