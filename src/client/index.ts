// Key management for developers
export { KeyExchangeManager } from '../shared/crypto/key-exchange.js';
// Re-export core types that developers need
export type {
  EncryptedSlice,
  KeyExchangeRequest,
  KeyExchangeResponse,
  SessionInfo,
} from '../shared/types/interfaces.js';

// Re-export buffer strategies and core functionality
export { BufferManager } from './buffer/buffer-manager.js';
// Core client functionality with pluggable transport
export { SecureAudioClient } from './core/client.js';

export type { AudioSliceData, ClientConfig } from './core/client.js';
// Audio player
export { SecureAudioPlayer } from './core/player.js';

export type { PlayerEvent, PlayerState } from './core/player.js';
// Network utilities and error types
export { RetryManager } from './network/retry-manager.js';
export type { RetryConfig } from './network/retry-manager.js';

// Transport interface - developers implement this
export type { Transport } from './network/transport.js';

export { DefaultTransport } from './network/transport.js';

export {
  DecodingError,
  DecryptionError,
  NetworkError,
  SecStreamError,
  ServerError,
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
  BufferEntry,
  BufferExpirationConfig,
  BufferManagementStrategy,
  BufferStats,
  PrefetchStrategy,
  StreamingPlayerConfig,
} from './types/strategies.js';
