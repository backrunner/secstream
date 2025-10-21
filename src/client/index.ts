// Re-export core types that developers need
export type {
  EncryptedSlice,
  LegacyKeyExchangeRequest as KeyExchangeRequest,
  LegacyKeyExchangeResponse as KeyExchangeResponse,
  SessionInfo,
} from '../shared/types/interfaces.js';

// Re-export buffer strategies and core functionality
export { BufferManager } from './buffer/buffer-manager.js';
// Core client functionality with pluggable transport
export { SecureAudioClient } from './core/client.js';

export type { AudioSliceData, ClientConfig } from './core/client.js';
// Audio player
export { SecureAudioPlayer } from './core/player.js';

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
