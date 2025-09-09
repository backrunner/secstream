# SecStream Worker (Cloudflare R2)

A production-ready Cloudflare Worker that serves SecStream over audio files stored in an R2 bucket. Users only need to provide a bucket name and an optional key prefix via environment variables.

## Quickstart

- Required: `BUCKET_NAME` (your R2 bucket name)
- Optional: `KEY_PREFIX` (used as root path when resolving object keys)
- Optional: `ALLOWED_ORIGINS` (comma-separated allow list; can be set later in `wrangler.toml`)

```bash
# Install deps at repo root (pnpm workspace)
pnpm install

# Run dev worker (generates wrangler.toml from env)
BUCKET_NAME=my-audio-bucket KEY_PREFIX=music pnpm -w --filter secstream-worker dev

# Deploy
BUCKET_NAME=my-audio-bucket KEY_PREFIX=music pnpm -w --filter secstream-worker deploy
```

This generates `worker/wrangler.toml` with an `AUDIO_BUCKET` R2 binding and injects the optional `KEY_PREFIX` var.

## API

- POST `/api/sessions/from-r2/<object-path>`
  - Creates a secure session from the R2 object at `<KEY_PREFIX>/<object-path>` when `KEY_PREFIX` is set, otherwise from `<object-path>`.
  - Response includes `{ sessionId, metadata, sessionInfo, r2Key }`.

- POST `/api/sessions/from-r2` with JSON body `{ "key": "relative/or/absolute/path.mp3" }`
  - Backward compatible; `key` is resolved against `KEY_PREFIX` if present.

- POST `/api/sessions/:id/key-exchange`
- GET `/api/sessions/:id/info`
- GET `/api/sessions/:id/slices/:sliceId`

CORS preflight (`OPTIONS`) is supported. At development time, if `ALLOWED_ORIGINS` is not set, the worker echoes the request origin.

## R2 Setup

```bash
# Create your bucket (adjust name)
wrangler r2 bucket create my-audio-bucket

# Upload an audio file
wrangler r2 object put my-audio-bucket/music/song1.mp3 --file ./audio/song1.mp3
```

## Example

```bash
# Create session from R2 using path-based endpoint
curl -X POST \
  "http://127.0.0.1:8787/api/sessions/from-r2/album/song1.mp3"
```

If `KEY_PREFIX=music`, this resolves to the R2 key `music/album/song1.mp3`.

## Notes

- The R2 binding name is fixed as `AUDIO_BUCKET` and is generated from env with the configure script.
- Only bucket name and key prefix are required from the user; other configuration remains sensible defaults.
- For production, set `ALLOWED_ORIGINS` inside the generated `wrangler.toml` to restrict origins.
