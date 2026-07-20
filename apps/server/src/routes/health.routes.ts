import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export const healthRoutes = Router();

// GET /api/health — liveness + provider readiness. Used by Fly health checks.
healthRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    let db = false;
    try {
      await prisma.organization.findFirst({ select: { id: true } });
      db = true;
    } catch {
      db = false;
    }
    res.json({
      ok: true,
      db,
      providers: {
        plivo: Boolean(env.PLIVO_AUTH_ID && env.PLIVO_AUTH_TOKEN),
        cartesia: Boolean(env.CARTESIA_API_KEY && env.CARTESIA_DEFAULT_VOICE_ID),
        gemini: Boolean(env.GEMINI_API_KEY)
      },
      time: new Date().toISOString()
    });
  })
);
