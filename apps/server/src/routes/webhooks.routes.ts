import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import { getOrRenderAgentAudio, getAudioByKey } from "../services/audio/audioStore.js";
import { verifyPlivoSignature } from "../services/telephony/plivoSignature.js";
import { resolveCartesia, resolvePlivo } from "../services/credentials/providerCredentials.js";
import { audit } from "../utils/audit.js";

// Best-effort signature check: log a mismatch but NEVER reject — the unguessable
// per-call UUID in the webhook URL is the security boundary, and a signature
// edge case must never break a live security alert.
async function softVerify(req: import("express").Request, organizationId: string, callId: string): Promise<void> {
  const creds = await resolvePlivo(organizationId);
  if (!verifyPlivoSignature(req, creds.authToken)) {
    console.warn(`[plivo] webhook signature not verified for call ${callId} — processing anyway.`);
  }
}

export const webhookRoutes = Router();

// DTMF snooze map: 0 = 30 minutes, every other digit = that many hours.
const SNOOZE_HOURS: Record<string, number> = {
  "0": 0.5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9
};
function snoozeLabel(hours: number): string {
  return hours < 1 ? "thirty minutes" : `${hours} hour${hours > 1 ? "s" : ""}`;
}
const SNOOZE_PROMPT =
  "To pause further alerts, press 0 for thirty minutes, or press a number from 1 to 9 for that many hours. Otherwise you may hang up.";
const ACK_PROMPT = "Please press any key to confirm you have received this alert.";

function xml(res: Response, body: string): void {
  res.setHeader("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`);
}

// ─── GET /api/webhooks/plivo/answer/:callId ──────────────────────────────────
// Plivo fetches this when the guard picks up. Plays the alert, then — depending
// on the agent's call type — either hangs up (one-way), asks for an
// acknowledgement, or offers the keypad snooze.
webhookRoutes.get(
  "/plivo/answer/:callId",
  asyncHandler(async (req, res) => {
    const call = await prisma.call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) {
      xml(res, `<Response><Speak>Alert.</Speak></Response>`);
      return;
    }
    await softVerify(req, call.organizationId, call.id);

    const agent = await prisma.agent.findUnique({ where: { id: call.agentId } });
    if (!agent) {
      xml(res, `<Response><Speak>Security alert. Please check the entrance immediately.</Speak></Response>`);
      return;
    }

    await prisma.call.update({ where: { id: call.id }, data: { status: "answered" } }).catch(() => undefined);

    // Render (once) + cache the alert audio, or fall back to Plivo <Speak>.
    let messageXml: string;
    try {
      const cartesia = await resolveCartesia(call.organizationId);
      const audio = await getOrRenderAgentAudio(agent, cartesia);
      const audioUrl = `${env.SERVER_URL}/api/webhooks/audio/${audio.cacheKey}.wav`;
      messageXml = `<Play>${audioUrl}</Play><Wait length="1"/><Play>${audioUrl}</Play>`;
    } catch (err) {
      console.error("[webhook] audio render failed, falling back to Speak:", (err as Error).message);
      const safe = agent.message.replace(/[<&>]/g, " ");
      messageXml = `<Speak>${safe}</Speak><Wait length="1"/><Speak>${safe}</Speak>`;
    }

    const mode = agent.callMode || "snooze";

    // One-way announcement — no keypad input.
    if (mode === "one_way") {
      xml(res, `<Response>${messageXml}</Response>`);
      return;
    }

    // Acknowledge / snooze — gather a single digit.
    const gatherUrl = `${env.SERVER_URL}/api/webhooks/plivo/gather/${call.id}`;
    const prompt = mode === "ack" ? ACK_PROMPT : SNOOZE_PROMPT;
    const validDigits = mode === "ack" ? "0123456789*#" : "0123456789";
    const noInput = mode === "ack" ? "No confirmation received. Goodbye." : "No option selected. Goodbye.";
    xml(
      res,
      `<Response>` +
        `<GetDigits action="${gatherUrl}" method="POST" numDigits="1" timeout="10" retries="1" validDigits="${validDigits}">` +
          messageXml +
          `<Speak>${prompt}</Speak>` +
        `</GetDigits>` +
        `<Speak>${noInput}</Speak>` +
      `</Response>`
    );
  })
);

// ─── POST /api/webhooks/plivo/gather/:callId ─────────────────────────────────
// The guard pressed a key. For an "ack" agent, record the acknowledgement; for
// a "snooze" agent, pause further alerts for that agent.
webhookRoutes.post(
  "/plivo/gather/:callId",
  asyncHandler(async (req, res) => {
    const digit = String((req.body?.Digits ?? "") as string).trim();
    const call = await prisma.call.findUnique({ where: { id: String(req.params.callId) } });
    if (!call) {
      xml(res, `<Response><Speak>Goodbye.</Speak><Hangup/></Response>`);
      return;
    }
    await softVerify(req, call.organizationId, call.id);
    const agent = await prisma.agent.findUnique({ where: { id: call.agentId } });
    const mode = agent?.callMode || "snooze";

    if (mode === "ack") {
      await prisma.call.update({ where: { id: call.id }, data: { acknowledgedAt: new Date() } }).catch(() => undefined);
      void audit(call.organizationId, "alert.acknowledged", `Guard acknowledged the alert (key ${digit}).`, {
        agentId: call.agentId,
        callId: call.id
      });
      xml(res, `<Response><Speak>Thank you. Your acknowledgement has been recorded. Goodbye.</Speak><Hangup/></Response>`);
      return;
    }

    const hours = SNOOZE_HOURS[digit];
    if (hours === undefined) {
      xml(res, `<Response><Speak>No valid option selected. Goodbye.</Speak><Hangup/></Response>`);
      return;
    }
    const until = new Date(Date.now() + hours * 3600 * 1000);
    await prisma.agent.update({ where: { id: call.agentId }, data: { suppressedUntil: until } }).catch(() => undefined);
    const label = snoozeLabel(hours);
    void audit(call.organizationId, "alert.snoozed", `Alerts paused for ${label} via keypad (digit ${digit}).`, {
      agentId: call.agentId,
      digit,
      until: until.toISOString()
    });
    xml(res, `<Response><Speak>Alerts have been paused for ${label}. Goodbye.</Speak><Hangup/></Response>`);
  })
);

// ─── POST /api/webhooks/plivo/status/:callId ─────────────────────────────────
webhookRoutes.post(
  "/plivo/status/:callId",
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const callStatus = String(b.CallStatus ?? b.Status ?? "").toLowerCase();
    const durationRaw = b.Duration ?? b.BillDuration;
    const duration = durationRaw != null ? parseInt(String(durationRaw), 10) : undefined;

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
      await softVerify(req, call.organizationId, call.id);
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
// Serves the cached WAV to Plivo's <Play>. PUBLIC (unguessable sha256 key),
// with HTTP Range support so Plivo's ranged fetch is never truncated.
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
