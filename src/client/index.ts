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
// Re-export core types that developers need
export type {
  EncryptedSlice,
  LegacyKeyExchangeRequest as KeyExchangeRequest,
  LegacyKeyExchangeResponse as KeyExchangeResponse,
  SessionInfo,
  TrackInfo,
} from '../shared/types/interfaces.js';

export type { CompressionLevel } from '../shared/types/interfaces.js';
export type { SliceIdGenerator } from '../shared/types/interfaces.js';
// Shared configuration and types
export type {
  AudioConfig,
  AudioSlice,
  DEFAULT_CONFIG,
} from '../shared/types/interfaces.js';

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
// Re-export buffer strategies and core functionality
export { BufferManager } from './buffer/buffer-manager.js';
// Core client functionality with pluggable transport
export { SecureAudioClient } from './core/client.js';

export type { AudioSliceData, ClientConfig } from './core/client.js';
// Audio player
export { SecureAudioPlayer } from './core/player.js';

// ============================================================================
// Shared functionality - Processors, Utilities, Types
// ============================================================================

export type { PlayerConfig, PlayerEvent, PlayerState } from './core/player.js';
// Network utilities and error types
export { RetryManager } from './network/retry-manager.js';
export type { RetryConfig } from './network/retry-manager.js';

// Transport interface - developers implement this
export type { Transport } from './network/transport.js';
export {
  DecodingError,
  DecryptionError,
  NetworkError,
} from './network/transport.js';

export {
  AdaptivePrefetchStrategy,
  AggressiveBufferStrategy,
  BalancedBufferStrategy,
  ConservativeBufferStrategy,
  LinearPrefetchStrategy,
  NoPrefetchStrategy,
} from './strategies/default.js';
export type {
  AdaptivePrefetchStrategyConfig,
  AggressiveBufferStrategyConfig,
  BalancedBufferStrategyConfig,
  ConservativeBufferStrategyConfig,
  LinearPrefetchStrategyConfig,
} from './strategies/default.js';

export type {
  BufferEntry,
  BufferExpirationConfig,
  BufferManagementStrategy,
  BufferStats,
  PrefetchStrategy,
  StreamingPlayerConfig,
} from './types/strategies.js';
// Web Worker decryption support
export { DecryptionWorkerManager } from './workers/decryption-worker-manager.js';

export type { DecryptionWorkerConfig } from './workers/decryption-worker-types.js';
