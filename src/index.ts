// Export client functionality
export * from './client/index.js';

// Export server functionality
export * from './server/index.js';

// Export shared functionality (but avoid conflicts with client exports)
export * from './shared/compression/index.js';
export * from './shared/crypto/index.js';
export * from './shared/slice-id/index.js';
// Export shared types explicitly to avoid conflicts
export type {
  AudioConfig,
  AudioSlice,
  DEFAULT_CONFIG,
  EncryptedSlice,
  SessionInfo,
  SliceIdGenerator,
  SliceRequest,
} from './shared/types/interfaces.js';

// Export processor types explicitly to avoid naming conflicts
export type {
  CompressionOptions,
  CompressionProcessor,
  CryptoMetadata,
  EncryptionOptions,
  EncryptionProcessor,
  KeyExchangeProcessor,
  ProcessingConfig,
  // Use qualified names to avoid conflicts with client's legacy exports
  KeyExchangeRequest as ProcessorKeyExchangeRequest,
  KeyExchangeResponse as ProcessorKeyExchangeResponse,
} from './shared/types/processors.js';

export * from './shared/utils/index.js';
