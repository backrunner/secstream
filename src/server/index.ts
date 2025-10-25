// Compression processors
export {
  DeflateCompressionProcessor,
} from '../shared/compression/processors/deflate-processor.js';
// Key exchange processors
export {
  EcdhP256KeyExchangeProcessor,
} from '../shared/crypto/key-exchange/ecdh-p256-processor.js';

// Encryption processors
export {
  AesGcmEncryptionProcessor,
  XorStreamCipherProcessor,
} from '../shared/crypto/processors/index.js';
// Slice ID generators
export {
  HashSliceIdGenerator,
  NanoidSliceIdGenerator,
  SequentialSliceIdGenerator,
  TimestampSliceIdGenerator,
  UuidSliceIdGenerator,
} from '../shared/slice-id/generators.js';
// Re-export shared types that server developers need
export type { SessionInfo, TrackInfo } from '../shared/types/interfaces.js';

export type { CompressionLevel } from '../shared/types/interfaces.js';
export type { SliceIdGenerator } from '../shared/types/interfaces.js';

// Shared configuration and types
export type {
  AudioConfig,
  AudioSlice,
  DEFAULT_CONFIG,
  EncryptedSlice,
} from '../shared/types/interfaces.js';

// ============================================================================
// Shared functionality - Processors, Utilities, Types
// ============================================================================

export type {
  CompressionOptions,
  CompressionProcessor,
} from '../shared/types/processors.js';
export type {
  CryptoMetadata,
  EncryptionOptions,
  EncryptionProcessor,
} from '../shared/types/processors.js';
export type {
  KeyExchangeProcessor,
  ProcessingConfig,
  // Use qualified names to avoid conflicts
  KeyExchangeRequest as ProcessorKeyExchangeRequest,
  KeyExchangeResponse as ProcessorKeyExchangeResponse,
} from '../shared/types/processors.js';

// Audio format parsing utilities
export {
  detectAudioFormat,
  estimateSampleCount,
  extractAudioData,
  parseAudioMetadata,
} from './audio/format-parser.js';

export type { AudioMetadata } from './audio/format-parser.js';
// Server-side exports
export { SecureAudioServer } from './core/server.js';

export { SessionManager } from './core/session-manager.js';
export type { SessionManagerConfig } from './core/session-manager.js';

export { AudioProcessor } from './processing/audio-processor.js';

export type { AudioProcessorConfig, AudioSource } from './processing/audio-processor.js';
