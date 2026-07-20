# API Reference — ISKCON AI Calls

Base URL: `https://iskcon-aicalls.fly.dev/api` (or `http://localhost:3000/api` in dev).

## Authentication

Two credential types, both sent as `Authorization: Bearer <token>`:

| Credential | Format | Who uses it | Can access |
|-----------|--------|-------------|-----------|
| **API key** | `acai_<hex>` | Raspberry Pi / integrations | `POST /alert`, `GET /calls` only |
| **JWT** | login token | Dashboard admins | everything |

API keys are minted in the dashboard (**API Keys** page) or by `npm run seed`.
Only the SHA-256 hash is stored; the raw key is shown once.

---

## `POST /alert` — fire an alert (THE integration endpoint)

Rings every guard at once and speaks the agent's fixed message. One request,
no queue. Auth: API key or admin JWT.

**Request**
```json
{
  "agentId": "d2845c62-4b06-4ee5-8240-6ebe0c591849",
  "fromNumber": "+9180XXXXXXXX",
  "phones": [
    { "name": "Guard 1", "phone": "+919876543210" },
    { "name": "Guard 2", "phone": "+919542763698" }
  ]
}
```
- `agentId` *(required)* — which alert message to speak.
- `phones` *(required)* — `string[]` **or** `[{name, phone}]`. Numbers are
  normalized to E.164; placeholders (`+91XXXX…`) and duplicates are dropped.
- `fromNumber` *(optional)* — caller ID override. Falls back to the agent's
  number → the org default number → `PLIVO_DEFAULT_NUMBER`.

**Response `200`**
```json
{
  "message": "Alert dialing 2 number(s) via plivo.",
  "calls": [
    { "callId": "…", "phone": "+919876543210" },
    { "callId": "…", "phone": "+919542763698" }
  ],
  "dialed": 2,
  "skipped": 0
}
```

**Errors:** `400` (no agentId / no valid phone / no caller number), `401`
(bad key), `403` (key not allowed / disabled), `404` (agent not found),
`409` (agent disabled).

---

## `GET /calls` — call history

Query: `?page=1&limit=50&status=completed`. Auth: API key or JWT.
```json
{ "calls": [ { "id", "targetName", "targetPhone", "status", "durationSeconds", "createdAt" } ],
  "total": 128, "page": 1, "limit": 50, "pages": 3 }
```
`GET /calls/:id` returns one call. `status` ∈
`queued | ringing | answered | completed | failed | no_answer`.

`POST /calls/test` `{ agentId, phone }` — place a single test call.

---

## Dashboard-only endpoints (JWT)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` | `{email,password}` → `{token,user}` |
| GET | `/auth/me` | current session |
| GET/POST | `/agents` | list / create alert message |
| PATCH/DELETE | `/agents/:id` | edit / delete |
| POST | `/agents/:id/preview` | render + return the WAV to play in-browser |
| POST | `/agents/compose` | `{instruction,language}` → Gemini-drafted message |
| GET/POST | `/api-keys` | list / mint (raw key returned once) |
| POST | `/api-keys/:id/revoke` | revoke |
| GET | `/settings` | provider readiness + caller numbers |
| POST/DELETE | `/settings/numbers[/:id]` | manage caller numbers |
| GET | `/health` | liveness + provider status (public) |

---

## Webhooks (called by Plivo — not for clients)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/webhooks/plivo/answer/:callId` | returns Plivo XML that `<Play>`s the cached alert audio twice |
| POST | `/webhooks/plivo/status/:callId` | records terminal status + duration |
| GET | `/webhooks/audio/:cacheKey.wav` | serves the cached WAV to Plivo (public, unguessable key, Range-supported) |

Plivo webhook signatures are verified (V3 HMAC) unless
`PLIVO_SIGNATURE_INSECURE=true` (dev tunnels only).
