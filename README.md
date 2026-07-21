# ISKCON AI Calls 🛡️

An **announcement-only AI voice security-alert system** for an ISKCON temple.

When the Hikvision CCTV camera detects a line-crossing, a Raspberry Pi on the
temple network calls this backend's **`POST /api/alert`**, which instantly rings
**every security guard at once** and speaks a fixed spoken alert. This is
**in addition to** the existing Hik-Connect app notification (untouched).

> API-first. No Redis, no queue — an alert dials all guards in parallel in one
> request. Voice via **Cartesia** (TTS), telephony via **Plivo**, data in
> **MongoDB**. Gemini is optional (draft/translate the alert text). No STT, no
> live LLM — the message is fixed and cached (₹0 TTS after the first render).

```
Camera line-crossing → NVR (LAN) → Raspberry Pi (app.py)
      → POST /api/alert  → backend (Fly.io) → Plivo dials all guards
                                            → Cartesia-rendered voice message
```

## Stack

| Layer | Tech | Where |
|-------|------|-------|
| Backend API | Node + Express + Prisma | Fly.io (`apps/server`) |
| Dashboard | React + Vite | Vercel (`apps/web`) |
| Database | MongoDB Atlas | — |
| Voice (TTS) | Cartesia (`sonic-2`) | — |
| Telephony | Plivo | — |
| LLM (optional) | Gemini | dashboard helper only |
| Local relay | Python Flask (`app.py`) | Raspberry Pi at the temple (`pi/`) |

## Repository layout

```
iskcon-aicalls/
├── apps/server/   Express API + Prisma/MongoDB  → Fly.io
├── apps/web/      React dashboard               → Vercel
├── pi/            Raspberry Pi listener (app.py) + NVR setup
├── docs/          API reference, deployment, Pi setup, architecture
├── Dockerfile, fly.toml, .env.example
```

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure — copy the template and fill in YOUR credentials
cp .env.example .env      # DATABASE_URL, PLIVO_*, CARTESIA_*, secrets…

# 3. Generate the Prisma client + push the schema to Mongo
cd apps/server && npx prisma generate && npx prisma db push && cd ../..

# 4. Seed the org, admin user, default alert agent, and first API key
npm run seed              # prints the AGENT ID + API KEY for the Pi

# 5. Run both apps
npm run dev               # server :3000, dashboard :5173
```

Then log in to the dashboard with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## The one endpoint that matters

```bash
curl -X POST https://iskcon-temple-aicalling.fly.dev/api/alert \
  -H "Authorization: Bearer acai_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "agentId": "AGENT_ID",
        "fromNumber": "+9180XXXXXXXX",
        "phones": [{ "name": "Guard 1", "phone": "+919876543210" }]
      }'
```

The existing Pi `app.py` already sends exactly this — just point its
`config.json` at this backend. See [`docs/API.md`](docs/API.md).

## Docs

- [`docs/API.md`](docs/API.md) — full API reference
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploy backend (Fly) + dashboard (Vercel) + Mongo Atlas
- [`docs/PI_SETUP.md`](docs/PI_SETUP.md) — Raspberry Pi + NVR wiring
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it all fits together

> **Credentials:** every secret (Mongo URL, Plivo, Cartesia, Gemini, JWT) is
> read from environment variables — nothing is hardcoded. Provide your own.
