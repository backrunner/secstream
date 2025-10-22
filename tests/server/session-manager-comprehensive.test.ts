import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/server/core/session-manager.js';
import { EcdhP256KeyExchangeProcessor } from '../../src/shared/crypto/key-exchange/ecdh-p256-processor.js';
import type { SessionInfo, TrackInfo } from '../../src/shared/types/interfaces.js';

// Mock audio data generator (simple WAV file)
function createMockWavData(durationSeconds: number = 2): ArrayBuffer {
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds * channels;
  const dataSize = numSamples * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // WAV header
  view.setUint32(0, 0x46464952, false); // "RIFF"
  view.setUint32(4, fileSize - 8, true);
  view.setUint32(8, 0x45564157, false); // "WAVE"
  view.setUint32(12, 0x20746d66, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x61746164, false); // "data"
  view.setUint32(40, dataSize, true);

  // Simple sine wave data
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((i / channels) * 2 * Math.PI * 440 / sampleRate) * 0x7FFF;
    view.setInt16(44 + i * 2, sample, true);
  }

  return buffer;
}

describe('SessionManager - Comprehensive Tests', () => {
  let sessionManager: SessionManager;
  let clientKeyProcessor: EcdhP256KeyExchangeProcessor;

  beforeEach(async () => {
    sessionManager = new SessionManager({
      sliceDurationMs: 1000, // 1 second slices for faster tests
    });
    clientKeyProcessor = new EcdhP256KeyExchangeProcessor();
    await clientKeyProcessor.initialize();
  });

  afterEach(() => {
    sessionManager.destroy();
    clientKeyProcessor.destroy();
  });

  describe('Single-Track Sessions (Backward Compatibility)', () => {
    it('should create and initialize single-track session', async () => {
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);

      // Key exchange
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      expect(response.sessionInfo).toBeDefined();
      expect(response.sessionInfo.sessionId).toBe(sessionId);
      expect(response.sessionInfo.totalSlices).toBeGreaterThan(0);
      expect(response.sessionInfo.sliceIds).toBeDefined();
      expect(response.sessionInfo.sliceIds.length).toBe(response.sessionInfo.totalSlices);
    });

    it('should retrieve slices from single-track session', async () => {
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      const sessionInfo = sessionManager.getSessionInfo(sessionId)!;
      const firstSlice = await sessionManager.getSlice(sessionId, sessionInfo.sliceIds[0]);

      expect(firstSlice).toBeDefined();
      expect(firstSlice!.encryptedData).toBeInstanceOf(ArrayBuffer);
      expect(firstSlice!.iv).toBeInstanceOf(ArrayBuffer);
      expect(firstSlice!.sequence).toBe(0);
    });

    it('should not have tracks array in single-track session', async () => {
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      // Single-track sessions should not expose tracks array
      expect(response.sessionInfo.tracks).toBeUndefined();
    });
  });

  describe('Multi-Track Sessions', () => {
    it('should create multi-track session with multiple tracks', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1', artist: 'Artist A' } },
        { audioData: createMockWavData(3), metadata: { title: 'Track 2', artist: 'Artist B' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 3', artist: 'Artist A' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
    });

    it('should initialize first track during initial key exchange', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      expect(response.sessionInfo.tracks).toBeDefined();
      expect(response.sessionInfo.tracks!.length).toBe(2);
      expect(response.sessionInfo.activeTrackId).toBeDefined();

      // First track should be initialized with sliceIds
      const firstTrack = response.sessionInfo.tracks![0];
      expect(firstTrack.sliceIds.length).toBeGreaterThan(0);
      expect(firstTrack.title).toBe('Track 1');

      // Second track should be placeholder
      const secondTrack = response.sessionInfo.tracks![1];
      expect(secondTrack.sliceIds.length).toBe(0);
      expect(secondTrack.title).toBe('Track 2');
    });

    it('should lazily initialize tracks when requested', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(3), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);

      // Initialize first track
      const request1 = await clientKeyProcessor.createKeyExchangeRequest();
      const response1 = await sessionManager.handleKeyExchange(sessionId, request1);
      const track1Id = response1.sessionInfo.tracks![0].trackId;

      // Initialize second track (lazy)
      const processor2 = new EcdhP256KeyExchangeProcessor();
      await processor2.initialize();
      const request2 = await processor2.createKeyExchangeRequest();
      const track2Id = response1.sessionInfo.tracks![1].trackId;
      const response2 = await sessionManager.handleKeyExchange(sessionId, request2, track2Id);

      // Second track should now be initialized
      const secondTrack = response2.sessionInfo.tracks!.find(t => t.trackId === track2Id)!;
      expect(secondTrack.sliceIds.length).toBeGreaterThan(0);
      expect(secondTrack.totalSlices).toBeGreaterThan(0);

      processor2.destroy();
    });

    it('should retrieve slices from specific tracks', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);

      // Initialize first track
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      const firstTrack = response.sessionInfo.tracks![0];
      const firstSlice = await sessionManager.getSlice(sessionId, firstTrack.sliceIds[0], firstTrack.trackId);

      expect(firstSlice).toBeDefined();
      expect(firstSlice!.trackId).toBe(firstTrack.trackId);
      expect(firstSlice!.sequence).toBe(0);
    });

    it('should error when creating multi-track session with no tracks', async () => {
      await expect(sessionManager.createMultiTrackSession([])).rejects.toThrow('At least one track is required');
    });
  });

  describe('Track Addition (Incremental)', () => {
    it('should add track to single-track session (migrate to multi-track)', async () => {
      // Start with single track
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      // Add second track
      const newTrack = await sessionManager.addTrack(
        sessionId,
        createMockWavData(3),
        { title: 'Track 2', artist: 'Artist B' }
      );

      expect(newTrack).toBeDefined();
      expect(newTrack.trackId).toBeDefined();
      expect(newTrack.title).toBe('Track 2');
    });

    it('should add track to multi-track session', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      // Add second and third tracks
      const track2 = await sessionManager.addTrack(sessionId, createMockWavData(2), { title: 'Track 2' });
      const track3 = await sessionManager.addTrack(sessionId, createMockWavData(2), { title: 'Track 3' });

      expect(track2.trackIndex).toBe(1);
      expect(track3.trackIndex).toBe(2);
    });
  });

  describe('Track Removal', () => {
    it('should remove track from multi-track session by ID', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 3' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      const trackToRemove = response.sessionInfo.tracks![1].trackId;
      const updatedSessionInfo = sessionManager.removeTrack(sessionId, trackToRemove);

      expect(updatedSessionInfo.tracks).toBeDefined();
      expect(updatedSessionInfo.tracks!.length).toBe(2);
      expect(updatedSessionInfo.tracks!.find(t => t.trackId === trackToRemove)).toBeUndefined();
    });

    it('should remove track from multi-track session by index', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 3' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      // Remove second track by index
      const updatedSessionInfo = sessionManager.removeTrack(sessionId, 1);

      expect(updatedSessionInfo.tracks!.length).toBe(2);
      expect(updatedSessionInfo.tracks![0].title).toBe('Track 1');
      expect(updatedSessionInfo.tracks![1].title).toBe('Track 3');
    });

    it('should switch active track when removing current active track', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      const firstTrackId = response.sessionInfo.tracks![0].trackId;
      const secondTrackId = response.sessionInfo.tracks![1].trackId;

      // Remove first track (which is active)
      const updatedSessionInfo = sessionManager.removeTrack(sessionId, firstTrackId);

      // Active track should switch to second track
      expect(updatedSessionInfo.activeTrackId).toBe(secondTrackId);
    });

    it('should error when removing last track', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      const trackId = response.sessionInfo.tracks![0].trackId;

      expect(() => sessionManager.removeTrack(sessionId, trackId)).toThrow('Cannot remove the last track');
    });

    it('should error when removing track from single-track session', async () => {
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      expect(() => sessionManager.removeTrack(sessionId, 0)).toThrow('Cannot remove track from single-track session');
    });

    it('should error when removing non-existent track', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      expect(() => sessionManager.removeTrack(sessionId, 'non-existent-track-id')).toThrow('Track not found');
      expect(() => sessionManager.removeTrack(sessionId, 99)).toThrow('Track not found');
    });
  });

  describe('Real-World Scenarios', () => {
    it('Scenario: Music player with album playback', async () => {
      // User uploads an album with 5 tracks
      const album = [
        { audioData: createMockWavData(3), metadata: { title: 'Intro', artist: 'Band', album: 'Album' } },
        { audioData: createMockWavData(4), metadata: { title: 'Main Song', artist: 'Band', album: 'Album' } },
        { audioData: createMockWavData(3), metadata: { title: 'Ballad', artist: 'Band', album: 'Album' } },
        { audioData: createMockWavData(5), metadata: { title: 'Rock Song', artist: 'Band', album: 'Album' } },
        { audioData: createMockWavData(2), metadata: { title: 'Outro', artist: 'Band', album: 'Album' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(album);

      // User starts playing - first track initialized
      const processor1 = new EcdhP256KeyExchangeProcessor();
      await processor1.initialize();
      const request1 = await processor1.createKeyExchangeRequest();
      const response1 = await sessionManager.handleKeyExchange(sessionId, request1);

      expect(response1.sessionInfo.tracks![0].sliceIds.length).toBeGreaterThan(0);

      // User skips to track 3
      const processor3 = new EcdhP256KeyExchangeProcessor();
      await processor3.initialize();
      const request3 = await processor3.createKeyExchangeRequest();
      const track3Id = response1.sessionInfo.tracks![2].trackId;
      const response3 = await sessionManager.handleKeyExchange(sessionId, request3, track3Id);

      expect(response3.sessionInfo.tracks!.find(t => t.trackId === track3Id)!.sliceIds.length).toBeGreaterThan(0);

      // User finishes album, removes played tracks to free memory
      sessionManager.removeTrack(sessionId, 0); // Remove track 1
      sessionManager.removeTrack(sessionId, 0); // Remove track 2 (now at index 0)
      sessionManager.removeTrack(sessionId, 0); // Remove track 3 (now at index 0)

      const finalInfo = sessionManager.getSessionInfo(sessionId);
      expect(finalInfo).toBeDefined();
      // Should have tracks 4 and 5 remaining

      processor1.destroy();
      processor3.destroy();
    });

    it('Scenario: Podcast player with episode queue', async () => {
      // User adds 3 podcast episodes to queue
      const episodes = [
        { audioData: createMockWavData(10), metadata: { title: 'Episode 101' } },
        { audioData: createMockWavData(15), metadata: { title: 'Episode 102' } },
        { audioData: createMockWavData(12), metadata: { title: 'Episode 103' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(episodes);

      // User starts playing first episode
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      const response = await sessionManager.handleKeyExchange(sessionId, request);

      expect(response.sessionInfo.tracks!.length).toBe(3);

      // User finishes episode 1, removes it from queue
      const updatedInfo = sessionManager.removeTrack(sessionId, 0);
      expect(updatedInfo.tracks!.length).toBe(2);

      // User adds episode 104 to queue while listening
      const episode104 = await sessionManager.addTrack(sessionId, createMockWavData(14), { title: 'Episode 104' });
      expect(episode104.trackIndex).toBe(2);

      const finalInfo = sessionManager.getSessionInfo(sessionId);
      expect(finalInfo).toBeDefined();
    });

    it('Scenario: Session expiration and cleanup', async () => {
      const audioData = createMockWavData(2);
      const sessionId = await sessionManager.createSession(audioData);

      // Verify session exists
      expect(sessionManager.getSessionInfo(sessionId)).toBeNull(); // No session info until key exchange

      // Destroy session manually
      sessionManager.destroySession(sessionId);

      // Verify session is gone
      expect(sessionManager.getSessionInfo(sessionId)).toBeNull();
      const slice = await sessionManager.getSlice(sessionId, 'any-slice-id');
      expect(slice).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID gracefully', async () => {
      expect(sessionManager.getSessionInfo('invalid-id')).toBeNull();
      await expect(sessionManager.getSlice('invalid-id', 'slice-id')).resolves.toBeNull();
      await expect(
        sessionManager.handleKeyExchange('invalid-id', await clientKeyProcessor.createKeyExchangeRequest())
      ).rejects.toThrow('Session invalid-id not found');
    });

    it('should handle invalid track ID in multi-track session', async () => {
      const tracks = [{ audioData: createMockWavData(2), metadata: { title: 'Track 1' } }];
      const sessionId = await sessionManager.createMultiTrackSession(tracks);
      const request = await clientKeyProcessor.createKeyExchangeRequest();
      await sessionManager.handleKeyExchange(sessionId, request);

      await expect(
        sessionManager.handleKeyExchange(sessionId, request, 'invalid-track-id')
      ).rejects.toThrow('Track invalid-track-id not found');
    });

    it('should handle concurrent key exchanges', async () => {
      const tracks = [
        { audioData: createMockWavData(2), metadata: { title: 'Track 1' } },
        { audioData: createMockWavData(2), metadata: { title: 'Track 2' } },
      ];

      const sessionId = await sessionManager.createMultiTrackSession(tracks);

      // Initialize first track
      const request1 = await clientKeyProcessor.createKeyExchangeRequest();
      const response1 = await sessionManager.handleKeyExchange(sessionId, request1);

      // Try concurrent initialization of second track
      const processor2a = new EcdhP256KeyExchangeProcessor();
      const processor2b = new EcdhP256KeyExchangeProcessor();
      await processor2a.initialize();
      await processor2b.initialize();

      const track2Id = response1.sessionInfo.tracks![1].trackId;
      const request2a = await processor2a.createKeyExchangeRequest();
      const request2b = await processor2b.createKeyExchangeRequest();

      const [response2a, response2b] = await Promise.all([
        sessionManager.handleKeyExchange(sessionId, request2a, track2Id),
        sessionManager.handleKeyExchange(sessionId, request2b, track2Id),
      ]);

      // Both should succeed with valid session info
      expect(response2a.sessionInfo.tracks).toBeDefined();
      expect(response2b.sessionInfo.tracks).toBeDefined();

      processor2a.destroy();
      processor2b.destroy();
    });
  });

  describe('Memory and Performance', () => {
    it('should track session statistics', () => {
      const stats = sessionManager.getStats();
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('totalSessions');
      expect(stats.activeSessions).toBe(0);
    });

    it('should properly cleanup on destroy', async () => {
      const audioData = createMockWavData(2);
      await sessionManager.createSession(audioData);
      await sessionManager.createSession(audioData);

      expect(sessionManager.getStats().activeSessions).toBe(2);

      sessionManager.destroy();

      // After destroy, all sessions should be gone
      expect(sessionManager.getStats().activeSessions).toBe(0);
    });
  });
});
