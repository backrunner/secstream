# SecStream Cloudflare Workers + R2 Example

This example demonstrates how to use SecStream with Cloudflare Workers and R2 storage to create a secure audio streaming service.

## Features

- 🎵 **R2 Audio Storage**: Store audio files in Cloudflare R2 bucket
- 🔐 **Secure Streaming**: Process audio files on-demand with SecStream encryption
- 🌐 **Edge Computing**: Global distribution with Cloudflare's edge network
- 🚀 **Serverless**: No server maintenance, automatic scaling
- 🛡️ **CORS Support**: Configurable cross-origin access control

## Architecture

```
Client → Cloudflare Worker → R2 Bucket
                ↓
         SecStream Processing
                ↓
      Encrypted Audio Slices
```

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Wrangler

Update `wrangler.toml` with your bucket and domain settings:

```toml
[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "your-audio-bucket"

[vars]
ALLOWED_ORIGINS = "https://your-app.com"
```

### 3. Create R2 Bucket

```bash
# Create bucket for production
wrangler r2 bucket create your-audio-bucket

# Create preview bucket for development
wrangler r2 bucket create your-audio-bucket-preview
```

### 4. Upload Audio Files

```bash
# Upload sample audio file
wrangler r2 object put your-audio-bucket/music/song1.mp3 --file ./audio/song1.mp3
```

## API Endpoints

### Create Session from R2
Create a secure streaming session from an R2-stored audio file:

```javascript
POST /api/sessions/from-r2

{
  "key": "music/song1.mp3"
}

// Response
{
  "sessionId": "abc123",
  "metadata": {
    "format": "MP3",
    "duration": 245.6,
    "channels": 2
  },
  "sessionInfo": {
    "totalSlices": 49,
    "sliceDuration": 5000
  },
  "r2Key": "music/song1.mp3"
}
```

### Standard SecStream Endpoints
All standard SecStream API endpoints are supported:

- `POST /api/sessions/:id/key-exchange` - ECDH key exchange
- `GET /api/sessions/:id/info` - Session information
- `GET /api/sessions/:id/slices/:sliceId` - Get encrypted audio slice

## Client Usage

```javascript
import { SecStreamClient } from 'secstream/client'

const client = new SecStreamClient({
  serverUrl: 'https://your-worker.your-domain.workers.dev'
})

// Create session from R2 file
const response = await fetch('https://your-worker.your-domain.workers.dev/api/sessions/from-r2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'music/song1.mp3' })
})

const { sessionId } = await response.json()

// Load and play
const player = await client.loadSession(sessionId)
await player.play()
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins | None (allow all in dev) |

## Security Considerations

⚠️ **Important Security Notes:**

1. **R2 Access Control**: Ensure your R2 bucket is not publicly accessible
2. **Origin Control**: Set `ALLOWED_ORIGINS` to restrict client access
3. **Authentication**: Consider adding authentication middleware for production
4. **Rate Limiting**: Implement rate limiting to prevent abuse
5. **Content Validation**: Validate audio files before processing

## Performance Optimization

### R2 Caching
Enable R2 conditional requests for better performance:

```javascript
// Check if file was modified
const headers = { 'If-None-Match': lastETag }
const object = await env.AUDIO_BUCKET.get(key, { headers })
```

### Worker Caching
Cache session data in Durable Objects for high-traffic scenarios:

```javascript
// wrangler.toml
[[durable_objects.bindings]]
name = "SESSIONS"
class_name = "SessionStorage"
```

## Deployment

### Development
```bash
pnpm run dev
```

### Production
```bash
pnpm run deploy
```

### Monitor Logs
```bash
pnpm run tail
```

## Cost Considerations

### R2 Storage Costs
- Storage: $0.015/GB/month
- Class A Operations (writes): $4.50/million
- Class B Operations (reads): $0.36/million

### Workers Costs
- Requests: $0.50/million after 100k free
- CPU Time: $12.50/million GB-s after 400k GB-s free

## Troubleshooting

### Common Issues

**R2 Object Not Found**
```javascript
// Check bucket binding in wrangler.toml
[[r2_buckets]]
binding = "AUDIO_BUCKET"  # Must match code
bucket_name = "your-bucket"
```

**CORS Errors**
```javascript
// Set ALLOWED_ORIGINS in wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://your-frontend.com"
```

**Audio Format Errors**
```javascript
// Supported formats: WAV, MP3, FLAC, OGG
// Ensure file is valid audio format
```

## Security Disclaimer

⚠️ **This is NOT Digital Rights Management (DRM)**

SecStream provides **content protection**, not DRM. The goal is to **raise the barrier** for audio piracy by:

- Making it harder to extract complete audio files
- Requiring technical knowledge to reconstruct content
- Adding friction to the piracy process

**What SecStream does:**
- Encrypts audio slices with unique session keys
- Prevents direct file downloads
- Makes memory extraction more difficult
- Requires understanding of the protocol to extract content

**What SecStream does NOT do:**
- Provide legal protection or enforcement
- Stop determined attackers with technical skills
- Prevent screen recording or analog extraction
- Replace proper content licensing agreements

**For stronger protection, consider:**
- Professional DRM solutions (Widevine, FairPlay, PlayReady)
- Content delivery networks with token authentication
- Legal agreements and terms of service
- Watermarking and content fingerprinting

SecStream is best suited for scenarios where you need reasonable protection against casual piracy while maintaining performance and compatibility across platforms.

## License

This example is provided under the same license as SecStream.