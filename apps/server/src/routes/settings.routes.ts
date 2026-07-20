import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import { env } from "../config/env.js";

export const settingsRoutes = Router();

settingsRoutes.use(authenticate(true), requireUser());

// GET /api/settings — provider readiness + caller numbers. Never leaks secrets;
// only booleans indicating whether each provider is configured via env.
settingsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const numbers = await prisma.phoneNumber.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { createdAt: "asc" }
    });
    res.json({
      providers: {
        plivo: Boolean(env.PLIVO_AUTH_ID && env.PLIVO_AUTH_TOKEN),
        cartesia: Boolean(env.CARTESIA_API_KEY && env.CARTESIA_DEFAULT_VOICE_ID),
        gemini: Boolean(env.GEMINI_API_KEY)
      },
      defaults: {
        plivoNumber: env.PLIVO_DEFAULT_NUMBER ?? null,
        cartesiaModel: env.CARTESIA_TTS_MODEL,
        geminiModel: env.GEMINI_MODEL
      },
      numbers
    });
  })
);

// POST /api/settings/numbers — add a caller-ID number.
settingsRoutes.post(
  "/numbers",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body?.phoneNumber);
    if (!phone) {
      res.status(400).json({ message: "A valid E.164 phone number is required." });
      return;
    }
    const makeDefault = req.body?.isDefaultOutbound === true;
    if (makeDefault) {
      await prisma.phoneNumber.updateMany({
        where: { organizationId: req.auth!.organizationId },
        data: { isDefaultOutbound: false }
      });
    }
    const number = await prisma.phoneNumber.create({
      data: {
        organizationId: req.auth!.organizationId,
        provider: "plivo",
        phoneNumber: phone,
        label: req.body?.label ? String(req.body.label) : null,
        isDefaultOutbound: makeDefault
      }
    });
    res.status(201).json({ number });
  })
);

// DELETE /api/settings/numbers/:id
settingsRoutes.delete(
  "/numbers/:id",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const number = await prisma.phoneNumber.findUnique({ where: { id: String(req.params.id) } });
    if (!number || number.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Number not found." });
      return;
    }
    await prisma.phoneNumber.delete({ where: { id: number.id } });
    res.json({ ok: true });
  })
);
