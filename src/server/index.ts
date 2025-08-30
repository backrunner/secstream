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

export { AudioProcessor } from './processing/audio-processor.js';
export type { AudioSource } from './processing/audio-processor.js';
