# SecStream Demo

A complete runnable demo showcasing SecStream's secure audio streaming capabilities built with Hono.

## 🚀 Quick Start

```bash
# From project root
npm run dev

# OR from demo directory
cd demo
pnpm install
pnpm run dev

# Open browser
open http://localhost:3000
```

**Note**: The demo includes a TypeScript build step that compiles browser-side code (`demo-transport.ts`) before starting the server.

## ✨ Features Demonstrated

- 🔐 **Secure Audio Upload**: End-to-end encrypted audio processing
- 🎵 **Multi-Format Support**: WAV, MP3, FLAC, OGG format detection
- ⚡ **Real-time Processing**: Live audio metadata extraction
- 📊 **Session Management**: Secure session creation and management
- 🌐 **REST API**: Complete HTTP API for audio streaming
- 🎨 **Modern UI**: Beautiful, responsive web interface

## 🔧 API Endpoints

### Core Endpoints
- `POST /api/sessions` - Create new audio session
- `POST /api/sessions/:id/key-exchange` - ECDH key exchange
- `GET /api/sessions/:id/info` - Get session metadata
- `GET /api/sessions/:id/slices/:sliceId` - Fetch encrypted audio slice

### Utility Endpoints
- `GET /` - Demo web interface
- `GET /api/stats` - Server statistics
- `GET /health` - Health check

## 🏗️ Architecture

```
demo/
├── server.ts               # Hono server with SecStream integration
├── demo-transport.ts       # Browser-side transport implementation (TypeScript)
├── build.js                # esbuild configuration for browser code
├── dist/
│   ├── demo-transport.js   # Compiled browser code
│   └── utils/
│       └── crc32.js        # CRC32 validation utilities
├── utils/
│   └── crc32.ts            # CRC32 implementation (TypeScript)
├── public/
│   ├── index.html          # Demo web interface
│   └── styles.css          # UI styles
├── package.json            # Dependencies and scripts
└── tsconfig.json           # TypeScript configuration
```

The demo uses a split architecture:
- **Server code** (`server.ts`): Runs in Node.js with tsx (TypeScript loader)
- **Browser code** (`demo-transport.ts`): Compiled to JavaScript via esbuild
- **Shared utilities** (`utils/crc32.ts`): Used by both server and browser

## 🎯 How It Works

1. **Upload**: User uploads audio file through web interface
2. **Detection**: Server automatically detects audio format (WAV/MP3/FLAC/OGG)
3. **Processing**: Audio is processed into encrypted slices
4. **Session**: Secure session created with unique ID
5. **Streaming**: Client can request encrypted audio slices securely

## 🔒 Security Features

- **ECDH Key Exchange**: Secure key negotiation
- **AES-GCM Encryption**: Military-grade encryption for audio data
- **Session Isolation**: Each upload gets unique session
- **Memory Protection**: Automatic cleanup of sensitive data
- **Format Validation**: Audio format verification

## 📋 Requirements

- Node.js 18+
- Built SecStream library (`../dist/`)
- Modern web browser

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build browser code (compiles TypeScript to JavaScript)
pnpm run build

# Start development server (auto-builds and auto-reloads)
pnpm run dev

# Start production server
pnpm start
```

### Build Process

The demo requires building browser-side TypeScript files:

1. **`demo-transport.ts`** → `dist/demo-transport.js` (bundled with dependencies)
2. **`utils/crc32.ts`** → `dist/utils/crc32.js` (standalone module)

The build uses **esbuild** for fast compilation and outputs ES modules that can be imported directly in the browser.

**Auto-build**: Running `pnpm run dev` automatically builds before starting and watches for changes.

## 🌐 Deployment

The demo server can be deployed to various platforms:

- **Node.js**: Direct deployment with `pnpm start`
- **Docker**: Containerized deployment
- **Cloudflare Workers**: Edge deployment (modify imports)
- **Vercel/Netlify**: Serverless deployment

## 🎵 Supported Audio Formats

| Format | Detection | Metadata | Streaming |
|--------|-----------|----------|-----------|
| WAV    | ✅        | ✅       | ✅        |
| MP3    | ✅        | ✅       | ✅        |
| FLAC   | ✅        | ✅       | ✅        |
| OGG    | ✅        | ✅       | ✅        |

## 📊 Demo Statistics

The demo tracks:
- Active sessions
- Audio format distribution
- Upload success rate
- Server performance metrics

## 🤝 Integration Examples

This demo serves as a reference for integrating SecStream into:
- Music streaming platforms
- Podcast applications
- Audio conferencing systems
- Educational platforms
- Content protection systems

## 📝 Notes

### Configuration
- File size limit: 50MB
- Session timeout: 30 minutes
- Slice duration: 5 seconds
- Compression level: 6

### Streaming Optimization
This demo uses **prewarm optimization** for instant playback:
- `prewarmSlices: 3` - First 3 slices (15 seconds) prepared during key exchange
- `prewarmConcurrency: 3` - Parallel processing for faster preparation
- **Result**: Near-zero latency when starting playback from the beginning

The first slice is ready **immediately** when the user clicks play, providing a smooth instant-start experience.

### Cache Settings
- Server cache: 10 slices in memory (50 seconds of audio)
- Cache TTL: 5 minutes
- In-flight deduplication prevents redundant processing