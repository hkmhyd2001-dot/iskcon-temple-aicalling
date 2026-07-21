# Deployment Guide

Three pieces: **MongoDB Atlas** (data), **Fly.io** (backend), **Vercel**
(dashboard). All credentials are yours — nothing is baked into the code.

## 0. Prerequisites
- Node 20+ and npm
- `fly` CLI (`https://fly.io/docs/flyctl/install/`)
- A Plivo account with a rented India number + auth id/token
- A Cartesia account with an API key and a chosen voice ID
- (optional) A Gemini API key

## 1. MongoDB Atlas
1. Create a free **M0** cluster (region **ap-south-1 / Mumbai** for lowest latency).
2. Add a database user; set **Network Access** to `0.0.0.0/0` (or Fly's egress IPs).
3. Copy the connection string → this is your `DATABASE_URL`
   (append a db name, e.g. `…/iskcon_alerts`).

## 2. Configure environment
```bash
cp .env.example .env
# Fill in: DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY (openssl rand -hex 32 each),
#          PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_DEFAULT_NUMBER,
#          CARTESIA_API_KEY, CARTESIA_DEFAULT_VOICE_ID,
#          GEMINI_API_KEY (optional), SERVER_URL (your Fly URL)
```

## 3. Push schema + seed (run once, locally, against your Atlas)
```bash
npm install
cd apps/server
npx prisma generate
npx prisma db push          # creates collections/indexes in Mongo
cd ../..
npm run seed                # prints AGENT ID + first API KEY — save them
```

## 4. Deploy the backend to Fly.io
```bash
fly launch --no-deploy      # accept app name "iskcon-aicalls" or pick your own
# Set every secret (never commit them):
fly secrets set \
  DATABASE_URL="mongodb+srv://…" \
  JWT_SECRET="…" ENCRYPTION_KEY="…" \
  PLIVO_AUTH_ID="…" PLIVO_AUTH_TOKEN="…" PLIVO_DEFAULT_NUMBER="+9180XXXXXXXX" \
  CARTESIA_API_KEY="…" CARTESIA_DEFAULT_VOICE_ID="…" CARTESIA_TTS_MODEL="sonic-2" \
  GEMINI_API_KEY="…" \
  SERVER_URL="https://iskcon-temple-aicalling.fly.dev" \
  APP_URL="https://your-dashboard.vercel.app"
fly deploy
```
Health check: `curl https://iskcon-temple-aicalling.fly.dev/api/health`.

> `SERVER_URL` **must** be the public https URL — Plivo fetches the answer/audio
> webhooks from it, and it's used to verify Plivo signatures.

## 5. Deploy the dashboard to Vercel
1. Import the repo; set **Root Directory** = `apps/web`.
2. Build command `npm run build`, output `dist` (already in `vercel.json`).
3. Env var: `VITE_API_URL = https://iskcon-temple-aicalling.fly.dev/api`.
4. Deploy → note the URL → set it as `APP_URL` on Fly (`fly secrets set APP_URL=…`).

## 6. Configure Plivo
- Rent an India number; set it as `PLIVO_DEFAULT_NUMBER`.
- No webhook config needed in the Plivo console — the backend passes the
  answer/hangup URLs per call.

## 7. Wire up the Raspberry Pi
Put the seeded **API key**, **agent id**, **base url**, and **Plivo number**
into `pi/config.json`, then follow [`PI_SETUP.md`](PI_SETUP.md).

## Updating later
- Backend: `fly deploy`. Schema change: `npx prisma db push` against Atlas first.
- Dashboard: push to the branch Vercel tracks.
- Rotate a secret: `fly secrets set NAME=…` (triggers a rolling restart).
