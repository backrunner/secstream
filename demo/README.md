# SecStream Demo

A complete runnable demo showcasing SecStream's secure audio streaming capabilities built with Hono.

## 🚀 Quick Start

```bash
# Install dependencies
cd demo
npm install

# Start development server
npm run dev

# Open browser
open http://localhost:3000
```

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
├── server.ts          # Hono server with SecStream integration
├── public/
│   └── index.html     # Demo web interface
├── package.json       # Dependencies and scripts
└── tsconfig.json      # TypeScript configuration
```

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
npm install

# Start development server (auto-reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## 🌐 Deployment

The demo server can be deployed to various platforms:

- **Node.js**: Direct deployment with `npm start`
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

- File size limit: 50MB
- Session timeout: 30 minutes
- Slice duration: 5 seconds
- Compression level: 6