import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import { getOrRenderAgentAudio, getAudioByKey } from "../services/audio/audioStore.js";
import { verifyPlivoSignature } from "../services/telephony/plivoSignature.js";

export const webhookRoutes = Router();

function xml(res: import("express").Response, body: string): void {
  res.setHeader("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`);
}

// ─── GET /api/webhooks/plivo/answer/:callId ──────────────────────────────────
// Plivo fetches this when the guard picks up. We render (once) + cache the alert
// audio and return Plivo XML that PLAYS it twice for a security alert.
webhookRoutes.get(
  "/plivo/answer/:callId",
  asyncHandler(async (req, res) => {
    if (!verifyPlivoSignature(req)) {
      res.status(403).send("Invalid signature.");
      return;
    }

    const call = await prisma.call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) {
      xml(res, `<Response><Speak>Alert.</Speak></Response>`);
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: call.agentId } });
    if (!agent) {
      xml(res, `<Response><Speak>Security alert. Please check the entrance immediately.</Speak></Response>`);
      return;
    }

    await prisma.call.update({ where: { id: call.id }, data: { status: "answered" } }).catch(() => undefined);

    try {
      const audio = await getOrRenderAgentAudio(agent);
      const audioUrl = `${env.SERVER_URL}/api/webhooks/audio/${audio.cacheKey}.wav`;
      // Play twice with a short gap — a guard must not miss the message.
      xml(
        res,
        `<Response><Play>${audioUrl}</Play><Wait length="1"/><Play>${audioUrl}</Play></Response>`
      );
    } catch (err) {
      // TTS failed → fall back to Plivo's built-in <Speak> so the alert still lands.
      console.error("[webhook] audio render failed, falling back to Speak:", (err as Error).message);
      const safe = agent.message.replace(/[<&>]/g, " ");
      xml(res, `<Response><Speak>${safe}</Speak><Wait length="1"/><Speak>${safe}</Speak></Response>`);
    }
  })
);

// ─── POST /api/webhooks/plivo/status/:callId ─────────────────────────────────
// Plivo posts terminal status here (hangup_url). Records outcome + duration.
webhookRoutes.post(
  "/plivo/status/:callId",
  asyncHandler(async (req, res) => {
    if (!verifyPlivoSignature(req)) {
      res.status(403).send("Invalid signature.");
      return;
    }

    const b = req.body ?? {};
    const callStatus = String(b.CallStatus ?? b.Status ?? "").toLowerCase();
    const durationRaw = b.Duration ?? b.BillDuration;
    const duration = durationRaw != null ? parseInt(String(durationRaw), 10) : undefined;

    // Map Plivo status → our vocabulary.
    const map: Record<string, string> = {
      completed: "completed",
      answered: "completed",
      "no-answer": "no_answer",
      busy: "no_answer",
      failed: "failed",
      timeout: "no_answer"
    };
    const status = map[callStatus] ?? "completed";

    const call = await prisma.call.findUnique({ where: { id: String(req.params.callId) } });
    if (call) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status,
          durationSeconds: Number.isFinite(duration) ? duration : call.durationSeconds,
          endedAt: new Date()
        }
      });
    }
    res.status(200).send("OK");
  })
);

// ─── GET /api/webhooks/audio/:cacheKey.wav ───────────────────────────────────
// Serves the cached WAV to Plivo's <Play>. PUBLIC (no auth): Plivo can't send a
// bearer token, and the key is an unguessable sha256. Supports HTTP Range so
// Plivo's ranged fetch never gets a truncated/duration-0 file.
webhookRoutes.get(
  "/audio/:cacheKey.wav",
  asyncHandler(async (req, res) => {
    const cacheKey = String(req.params.cacheKey);
    const audio = await getAudioByKey(cacheKey);
    if (!audio) {
      res.status(404).send("Not found.");
      return;
    }

    const total = audio.data.length;
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : total - 1;
        if (start >= total || end >= total || start > end) {
          res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", String(end - start + 1));
        res.end(audio.data.subarray(start, end + 1));
        return;
      }
    }

    res.setHeader("Content-Length", String(total));
    res.end(audio.data);
  })
);
