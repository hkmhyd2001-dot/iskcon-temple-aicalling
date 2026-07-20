import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { CartesiaTtsService } from "../services/tts/CartesiaTtsService.js";
import { env } from "../config/env.js";

export const voiceRoutes = Router();

voiceRoutes.use(authenticate(true), requireUser());

// Small in-memory cache — the voice list rarely changes and the Cartesia call
// costs a round trip. 5-minute TTL is plenty for a dashboard picker.
let cache: { at: number; data: unknown[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

// GET /api/voices — Cartesia voices for the dashboard's voice picker.
voiceRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    if (!env.CARTESIA_API_KEY) {
      res.json({ voices: [], configured: false });
      return;
    }
    if (cache && Date.now() - cache.at < TTL_MS) {
      res.json({ voices: cache.data, configured: true });
      return;
    }
    const voices = await new CartesiaTtsService().listVoices();
    cache = { at: Date.now(), data: voices };
    res.json({ voices, configured: true });
  })
);
