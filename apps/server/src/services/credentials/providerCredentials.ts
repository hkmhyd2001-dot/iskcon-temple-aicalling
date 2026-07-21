import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { encryptJson, decryptJson } from "../../utils/crypto.js";

// Resolve provider credentials: DASHBOARD-STORED (MongoDB, encrypted) first,
// then environment variables (Fly secrets) as a fallback. This lets the client
// manage Plivo/Cartesia/Gemini keys from the UI without redeploying.

export interface PlivoCreds { authId?: string; authToken?: string; defaultNumber?: string; }
export interface CartesiaCreds { apiKey?: string; voiceId?: string; model?: string; }
export interface GeminiCreds { apiKey?: string; model?: string; }

export type Provider = "plivo" | "cartesia" | "gemini";

// Tiny cache so the dial hot-path doesn't re-query/decrypt every call.
const cache = new Map<string, { at: number; data: Record<string, string> | null }>();
const TTL_MS = 30_000;

async function readDb(orgId: string, provider: Provider): Promise<Record<string, string> | null> {
  const key = `${orgId}:${provider}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let data: Record<string, string> | null = null;
  try {
    const row = await prisma.providerCredential.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider } }
    });
    if (row) data = decryptJson(row.encData);
  } catch {
    data = null;
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function invalidateCredCache(orgId: string, provider: Provider): void {
  cache.delete(`${orgId}:${provider}`);
}

export async function resolvePlivo(orgId: string): Promise<PlivoCreds> {
  const db = await readDb(orgId, "plivo");
  return {
    authId: db?.authId || env.PLIVO_AUTH_ID,
    authToken: db?.authToken || env.PLIVO_AUTH_TOKEN,
    defaultNumber: db?.defaultNumber || env.PLIVO_DEFAULT_NUMBER
  };
}

export async function resolveCartesia(orgId: string): Promise<CartesiaCreds> {
  const db = await readDb(orgId, "cartesia");
  return {
    apiKey: db?.apiKey || env.CARTESIA_API_KEY,
    voiceId: db?.voiceId || env.CARTESIA_DEFAULT_VOICE_ID,
    model: db?.model || env.CARTESIA_TTS_MODEL
  };
}

export async function resolveGemini(orgId: string): Promise<GeminiCreds> {
  const db = await readDb(orgId, "gemini");
  return {
    apiKey: db?.apiKey || env.GEMINI_API_KEY,
    model: db?.model || env.GEMINI_MODEL
  };
}

// Save (upsert) dashboard-entered credentials, encrypted. Empty-string fields
// are dropped so a partial save doesn't wipe existing values with blanks.
export async function saveCredentials(
  orgId: string,
  provider: Provider,
  fields: Record<string, string>
): Promise<void> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" && v.trim()) clean[k] = v.trim();
  }
  const encData = encryptJson(clean);
  await prisma.providerCredential.upsert({
    where: { organizationId_provider: { organizationId: orgId, provider } },
    update: { encData },
    create: { organizationId: orgId, provider, encData }
  });
  invalidateCredCache(orgId, provider);
}

export async function deleteCredentials(orgId: string, provider: Provider): Promise<void> {
  await prisma.providerCredential
    .delete({ where: { organizationId_provider: { organizationId: orgId, provider } } })
    .catch(() => undefined);
  invalidateCredCache(orgId, provider);
}

// Which providers are configured (from DB or env), and which fields exist — for
// the Settings UI. Never returns secret values, only booleans + safe hints.
export async function providerStatus(orgId: string) {
  const [plivo, cartesia, gemini] = await Promise.all([
    resolvePlivo(orgId),
    resolveCartesia(orgId),
    resolveGemini(orgId)
  ]);
  const [plivoDb, cartesiaDb, geminiDb] = await Promise.all([
    readDb(orgId, "plivo"),
    readDb(orgId, "cartesia"),
    readDb(orgId, "gemini")
  ]);
  return {
    plivo: {
      configured: Boolean(plivo.authId && plivo.authToken),
      source: plivoDb?.authId ? "dashboard" : plivo.authId ? "env" : "none",
      defaultNumber: plivo.defaultNumber ?? null,
      hasAuthId: Boolean(plivo.authId)
    },
    cartesia: {
      configured: Boolean(cartesia.apiKey),
      source: cartesiaDb?.apiKey ? "dashboard" : cartesia.apiKey ? "env" : "none",
      voiceId: cartesia.voiceId ?? null,
      model: cartesia.model ?? null
    },
    gemini: {
      configured: Boolean(gemini.apiKey),
      source: geminiDb?.apiKey ? "dashboard" : gemini.apiKey ? "env" : "none",
      model: gemini.model ?? null
    }
  };
}
