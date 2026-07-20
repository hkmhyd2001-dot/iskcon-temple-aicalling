import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import { getOrRenderAgentAudio } from "../services/audio/audioStore.js";
import { GeminiService } from "../services/llm/GeminiService.js";
import { audit } from "../utils/audit.js";

export const agentRoutes = Router();

agentRoutes.use(authenticate(true), requireUser());

// GET /api/agents — list this org's alert agents.
agentRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const agents = await prisma.agent.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { createdAt: "asc" }
    });
    res.json({ agents });
  })
);

// POST /api/agents — create an alert agent.
agentRoutes.post(
  "/",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? "").trim();
    const message = String(b.message ?? "").trim();
    if (!name || !message) {
      res.status(400).json({ message: "name and message are required." });
      return;
    }
    const agent = await prisma.agent.create({
      data: {
        organizationId: req.auth!.organizationId,
        name,
        message,
        language: String(b.language ?? "en"),
        fromNumber: normalizePhone(b.fromNumber) || null,
        voiceId: b.voiceId ? String(b.voiceId) : null,
        ttsModel: b.ttsModel ? String(b.ttsModel) : null,
        isActive: b.isActive !== false
      }
    });
    void audit(req.auth!.organizationId, "agent.created", `Created alert agent "${name}".`, { agentId: agent.id });
    res.status(201).json({ agent });
  })
);

// PATCH /api/agents/:id — update. Editing the message clears the cached audio
// pointer so the next call re-renders the new words.
agentRoutes.patch(
  "/:id",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.agent.findUnique({ where: { id: String(req.params.id) } });
    if (!existing || existing.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Agent not found." });
      return;
    }
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (typeof b.name === "string") data.name = b.name.trim();
    if (typeof b.message === "string") data.message = b.message.trim();
    if (typeof b.language === "string") data.language = b.language;
    if (b.fromNumber !== undefined) data.fromNumber = normalizePhone(b.fromNumber) || null;
    if (b.voiceId !== undefined) data.voiceId = b.voiceId ? String(b.voiceId) : null;
    if (b.ttsModel !== undefined) data.ttsModel = b.ttsModel ? String(b.ttsModel) : null;
    if (typeof b.isActive === "boolean") data.isActive = b.isActive;

    // Any change that affects the spoken audio invalidates the cache pointer.
    if ("message" in data || "voiceId" in data || "ttsModel" in data || "language" in data) {
      data.audioCacheKey = null;
    }

    const agent = await prisma.agent.update({ where: { id: existing.id }, data });
    res.json({ agent });
  })
);

// POST /api/agents/:id/preview — render (and cache) the audio now, return it as
// a WAV so the dashboard can play a preview.
agentRoutes.post(
  "/:id/preview",
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({ where: { id: String(req.params.id) } });
    if (!agent || agent.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Agent not found." });
      return;
    }
    const audio = await getOrRenderAgentAudio(agent);
    res.setHeader("Content-Type", audio.mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(audio.data);
  })
);

// POST /api/agents/compose — OPTIONAL Gemini helper: draft an alert message.
agentRoutes.post(
  "/compose",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const gemini = new GeminiService();
    if (!gemini.configured) {
      res.status(400).json({ message: "Gemini is not configured (GEMINI_API_KEY)." });
      return;
    }
    const instruction = String(req.body?.instruction ?? "").trim();
    const language = String(req.body?.language ?? "en");
    if (!instruction) {
      res.status(400).json({ message: "instruction is required." });
      return;
    }
    const message = await gemini.composeAlert(instruction, language);
    res.json({ message });
  })
);

// DELETE /api/agents/:id
agentRoutes.delete(
  "/:id",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({ where: { id: String(req.params.id) } });
    if (!agent || agent.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Agent not found." });
      return;
    }
    await prisma.agent.delete({ where: { id: agent.id } });
    res.json({ ok: true });
  })
);
