import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { providerStatus } from "../services/credentials/providerCredentials.js";

export const healthRoutes = Router();

// GET /api/health — liveness + provider readiness. Used by Fly health checks.
// Provider status reflects BOTH dashboard-stored (DB) and env credentials.
healthRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    let db = false;
    let providers = {
      plivo: Boolean(env.PLIVO_AUTH_ID && env.PLIVO_AUTH_TOKEN),
      cartesia: Boolean(env.CARTESIA_API_KEY && env.CARTESIA_DEFAULT_VOICE_ID),
      gemini: Boolean(env.GEMINI_API_KEY)
    };

    try {
      const org = await prisma.organization.findFirst({ select: { id: true } });
      db = true;
      if (org) {
        const s = await providerStatus(org.id);
        providers = {
          plivo: s.plivo.configured,
          cartesia: s.cartesia.configured,
          gemini: s.gemini.configured
        };
      }
    } catch {
      db = false;
    }

    res.json({ ok: true, db, providers, time: new Date().toISOString() });
  })
);
