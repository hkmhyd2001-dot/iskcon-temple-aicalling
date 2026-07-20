# Architecture

## The flow

```
 Hikvision camera detects a line-crossing
        │
        ▼
 NVR (192.168.3.100, LAN-only) ──► Hik-Connect app notification   (existing, untouched)
        │
        └──► Raspberry Pi · app.py (Flask :5050, temple LAN + internet)
                 │   POST /api/alert  { agentId, fromNumber, phones }
                 │   Bearer acai_… · retries 3× on a network blip
                 ▼
        Backend on Fly.io (apps/server)
                 │  1. auth (API key)              [auth.middleware]
                 │  2. resolve agent + caller ID   [alert.routes]
                 │  3. create a Call row / guard   [dialer]  ── MongoDB
                 │  4. dial ALL guards in parallel [dialer → PlivoService]
                 ▼
        Plivo places each call ──► guard answers
                 │  answer_url ──► GET /webhooks/plivo/answer/:callId
                 │        → render+cache Cartesia WAV, return <Play> (×2)
                 │  <Play> fetches GET /webhooks/audio/:cacheKey.wav
                 │  hangup_url ──► POST /webhooks/plivo/status/:callId  (records outcome)
                 ▼
        Guard hears the fixed alert message.
```

## Why no Redis / no queue

The whole point is *fire all guard calls at once*. A burst of a handful of
short announcement calls doesn't need a job broker — the `dialer` issues every
Plivo REST call with `Promise.all`. One bad number is marked `failed` and never
blocks the others. This removes Redis, Bull, workers, and schedulers entirely.

## Why no STT / no live LLM

The alert is **one fixed message**. There is no conversation, so there is no
speech-to-text and no per-turn LLM. Cartesia renders the message **once** and
the WAV is cached in MongoDB — every later call replays it at ₹0 TTS cost. The
answer webhook returns a simple `<Play>` (falling back to Plivo `<Speak>` only
if TTS is unavailable). No media WebSocket, no real-time bridge.

Gemini is present **only** as a dashboard convenience to draft/translate the
alert text — it never runs during a call.

## Components

| Component | Path | Role |
|-----------|------|------|
| API app | `apps/server/src/app.ts` | Express wiring, CORS, routes |
| Alert endpoint | `routes/alert.routes.ts` | the integration surface |
| Dialer | `services/calls/dialer.ts` | parallel Plivo dial, per-guard Call rows |
| Plivo client | `services/telephony/PlivoService.ts` | REST call placement |
| TTS | `services/tts/CartesiaTtsService.ts` | render message → WAV |
| Audio cache | `services/audio/audioStore.ts` | render-once, store bytes in Mongo |
| Webhooks | `routes/webhooks.routes.ts` | answer `<Play>`, status, audio serving |
| Auth | `middleware/auth.middleware.ts` | API key + JWT |
| Dashboard | `apps/web` | React admin console (Vercel) |
| Pi relay | `pi/app.py` | local NVR→backend bridge |

## Data model (MongoDB via Prisma)

`Organization` · `User` · `ApiKey` · `Agent` (the alert message + voice) ·
`PhoneNumber` · `Call` · `AudioCache` (cached WAV bytes) · `AuditEvent`.

## Security notes

- API keys stored as SHA-256 hashes; scoped to `/alert` + `/calls` only.
- Plivo webhooks verified with V3 HMAC signatures (`SERVER_URL` must match).
- The public audio URL is keyed by an unguessable content hash.
- All provider secrets come from env / Fly secrets — never hardcoded.
