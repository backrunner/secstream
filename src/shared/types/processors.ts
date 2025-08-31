/**
 * Generic type for compression options
 */
export interface CompressionOptions {
  level?: number;
  [key: string]: unknown;
}

/**
 * Generic type for encryption/decryption metadata
 */
export interface CryptoMetadata {
  algorithm?: string;
  iv?: ArrayBuffer;
  [key: string]: unknown;
}

/**
 * Generic type for encryption options
 */
export interface EncryptionOptions {
  [key: string]: unknown;
}

/**
 * Customizable compression processor interface
 * Allows developers to implement their own compression algorithms
 */
export interface CompressionProcessor {
  /**
   * Compress data
   * @param data - Raw data to compress
   * @param options - Compression options (algorithm-specific)
   * @returns Promise<ArrayBuffer> - Compressed data
   */
  compress(data: ArrayBuffer, options?: CompressionOptions): Promise<ArrayBuffer>;

  /**
   * Decompress data
   * @param compressedData - Compressed data to decompress
   * @param options - Decompression options (algorithm-specific)
   * @returns Promise<ArrayBuffer> - Decompressed data
   */
  decompress(compressedData: ArrayBuffer, options?: CompressionOptions): Promise<ArrayBuffer>;

  /**
   * Get processor name/identifier
   */
  getName(): string;
}

/**
 * Customizable encryption processor interface with generic key type
 * Allows developers to implement their own encryption algorithms with any key format
 */
export interface EncryptionProcessor<TKey = CryptoKey | ArrayBuffer | string> {
  /**
   * Encrypt data
   * @param data - Raw data to encrypt
   * @param key - Encryption key (format depends on processor implementation)
   * @param options - Encryption options (algorithm-specific)
   * @returns Promise with encrypted data and metadata
   */
  encrypt(data: ArrayBuffer, key: TKey, options?: EncryptionOptions): Promise<{
    encrypted: ArrayBuffer;
    metadata: CryptoMetadata;
  }>;

  /**
   * Decrypt data
   * @param encryptedData - Encrypted data
   * @param key - Decryption key (format depends on processor implementation)
   * @param metadata - Decryption metadata (e.g., IV, salt, etc.)
   * @param options - Decryption options (algorithm-specific)
   * @returns Promise<ArrayBuffer> - Decrypted data
   */
  decrypt(
    encryptedData: ArrayBuffer,
    key: TKey,
    metadata: CryptoMetadata,
    options?: EncryptionOptions
  ): Promise<ArrayBuffer>;

  /**
   * Get processor name/identifier
   */
  getName(): string;
}

/**
 * Key exchange request data with generic payload type
 */
export interface KeyExchangeRequest<TData = unknown> {
  publicKey?: string;
  data?: TData;
  metadata?: Record<string, unknown>;
}

/**
 * Key exchange response data with generic payload and session info types
 */
export interface KeyExchangeResponse<TData = unknown, TSessionInfo = unknown> {
  publicKey?: string;
  sessionInfo: TSessionInfo;
  data?: TData;
  metadata?: Record<string, unknown>;
}

/**
 * Customizable key exchange processor interface with generic key and session types
 */
export interface KeyExchangeProcessor<
  TKey = CryptoKey, 
  TSessionInfo = unknown,
  TRequestData = unknown,
  TResponseData = unknown
> {
  /**
   * Initialize the key exchange processor
   */
  initialize(): Promise<void>;

  /**
   * Create a key exchange request (client side)
   * @returns Promise<KeyExchangeRequest> - Key exchange request data
   */
  createKeyExchangeRequest(): Promise<KeyExchangeRequest<TRequestData>>;

  /**
   * Process key exchange request and create response (server side)
   * @param request - Key exchange request from client
   * @param sessionId - Session identifier
   * @returns Promise with response and derived session key
   */
  processKeyExchangeRequest(
    request: KeyExchangeRequest<TRequestData>, 
    sessionId: string
  ): Promise<{
    response: KeyExchangeResponse<TResponseData, TSessionInfo>;
    sessionKey: TKey;
  }>;

  /**
   * Process key exchange response and derive session key (client side)
   * @param response - Key exchange response from server
   * @returns Promise<TKey> - Derived session key
   */
  processKeyExchangeResponse(
    response: KeyExchangeResponse<TResponseData, TSessionInfo>
  ): Promise<TKey>;

  /**
   * Get processor name/identifier
   */
  getName(): string;

  /**
   * Clean up resources
   */
  destroy(): void;
}

/**
 * Processing configuration for both client and server
 */
export interface ProcessingConfig<
  TCompressionProcessor extends CompressionProcessor = CompressionProcessor,
  TEncryptionProcessor extends EncryptionProcessor = EncryptionProcessor,
  TKeyExchangeProcessor extends KeyExchangeProcessor = KeyExchangeProcessor
> {
  compressionProcessor?: TCompressionProcessor;
  encryptionProcessor?: TEncryptionProcessor;
  keyExchangeProcessor?: TKeyExchangeProcessor;
}