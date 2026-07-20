# ── Build + run the ISKCON AI Calls backend (apps/server) on Fly.io ──────────
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install workspace deps (root + server only; the web app is deployed on Vercel).
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
RUN npm install --omit=dev=false

# Copy source and generate the Prisma client + compile TS.
COPY apps/server ./apps/server
RUN npm run build --workspace @iskcon/server

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
