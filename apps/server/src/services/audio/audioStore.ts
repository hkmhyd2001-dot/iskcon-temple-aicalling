import crypto from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { CartesiaTtsService } from "../tts/CartesiaTtsService.js";

const tts = new CartesiaTtsService();

// Cache key = hash of everything that changes the produced audio. If the message
// or voice changes, the key changes and we re-render; otherwise we reuse the
// stored bytes (₹0 TTS on every repeat alert).
export function audioCacheKey(input: {
  message: string;
  voiceId: string;
  model: string;
  language: string;
}): string {
  return crypto
    .createHash("sha256")
    .update([input.message, input.voiceId, input.model, input.language].join("|"))
    .digest("hex");
}

export interface RenderedAudio {
  cacheKey: string;
  data: Buffer;
  mimeType: string;
}

// Returns the cached WAV for an agent, rendering + storing it on first use.
// Called lazily by the Plivo answer webhook (so the very first alert renders
// once, then every later call replays instantly).
export async function getOrRenderAgentAudio(agent: {
  id: string;
  message: string;
  voiceId: string | null;
  ttsModel: string | null;
  language: string;
}): Promise<RenderedAudio> {
  const voiceId = agent.voiceId || env.CARTESIA_DEFAULT_VOICE_ID || "";
  const model = agent.ttsModel || env.CARTESIA_TTS_MODEL;
  const language = agent.language || "en";
  const key = audioCacheKey({ message: agent.message, voiceId, model, language });

  const existing = await prisma.audioCache.findUnique({ where: { cacheKey: key } });
  if (existing) {
    return { cacheKey: key, data: Buffer.from(existing.data), mimeType: existing.mimeType };
  }

  const wav = await tts.synthesizeWav(agent.message, { voiceId, modelId: model, language });

  // Store bytes in Mongo. upsert guards against a race where two calls render
  // the same new key simultaneously.
  const bytes = new Uint8Array(wav);
  await prisma.audioCache.upsert({
    where: { cacheKey: key },
    update: { data: bytes, byteSize: bytes.length, agentId: agent.id },
    create: { cacheKey: key, agentId: agent.id, mimeType: "audio/wav", data: bytes, byteSize: bytes.length }
  });

  // Keep the agent's pointer fresh so the UI can show "audio ready".
  await prisma.agent.update({ where: { id: agent.id }, data: { audioCacheKey: key } }).catch(() => undefined);

  return { cacheKey: key, data: wav, mimeType: "audio/wav" };
}

// Fetch by explicit cache key (used by the public audio endpoint Plivo hits).
export async function getAudioByKey(cacheKey: string): Promise<RenderedAudio | null> {
  const row = await prisma.audioCache.findUnique({ where: { cacheKey } });
  if (!row) return null;
  return { cacheKey, data: Buffer.from(row.data), mimeType: row.mimeType };
}
