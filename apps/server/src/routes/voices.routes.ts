import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { CartesiaTtsService } from "../services/tts/CartesiaTtsService.js";
import { resolveCartesia } from "../services/credentials/providerCredentials.js";

export const voiceRoutes = Router();

voiceRoutes.use(authenticate(true), requireUser());

// Per-org cache — the voice list rarely changes.
const cache = new Map<string, { at: number; data: unknown[] }>();
const TTL_MS = 5 * 60 * 1000;

// GET /api/voices — Cartesia voices for the dashboard's voice picker.
voiceRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const cartesia = await resolveCartesia(orgId);
    if (!cartesia.apiKey) {
      res.json({ voices: [], configured: false });
      return;
    }
    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < TTL_MS) {
      res.json({ voices: hit.data, configured: true });
      return;
    }
    const voices = await new CartesiaTtsService().listVoices(cartesia.apiKey);
    cache.set(orgId, { at: Date.now(), data: voices });
    res.json({ voices, configured: true });
  })
);
