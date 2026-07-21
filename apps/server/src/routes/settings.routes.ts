import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import {
  providerStatus,
  saveCredentials,
  deleteCredentials,
  type Provider
} from "../services/credentials/providerCredentials.js";
import { audit } from "../utils/audit.js";

export const settingsRoutes = Router();

settingsRoutes.use(authenticate(true), requireUser());

const PROVIDERS: Provider[] = ["plivo", "cartesia", "gemini"];

// GET /api/settings — provider status (from DB or env) + caller numbers.
// Never returns secret values, only booleans + safe hints.
settingsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const [status, numbers] = await Promise.all([
      providerStatus(orgId),
      prisma.phoneNumber.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } })
    ]);
    res.json({ providers: status, numbers });
  })
);

// POST /api/settings/credentials/:provider — save (encrypted) provider keys.
settingsRoutes.post(
  "/credentials/:provider",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider) as Provider;
    if (!PROVIDERS.includes(provider)) {
      res.status(400).json({ message: "Unknown provider." });
      return;
    }
    const b = req.body ?? {};
    const allowed: Record<Provider, string[]> = {
      plivo: ["authId", "authToken", "defaultNumber"],
      cartesia: ["apiKey", "voiceId", "model"],
      gemini: ["apiKey", "model"]
    };
    const fields: Record<string, string> = {};
    for (const k of allowed[provider]) {
      if (typeof b[k] === "string") {
        fields[k] = k === "defaultNumber" ? normalizePhone(b[k]) : String(b[k]).trim();
      }
    }
    await saveCredentials(req.auth!.organizationId, provider, fields);
    void audit(req.auth!.organizationId, "credentials.saved", `${provider} credentials updated.`, { provider });
    res.json({ ok: true, providers: await providerStatus(req.auth!.organizationId) });
  })
);

// DELETE /api/settings/credentials/:provider — remove DB creds (fall back to env).
settingsRoutes.delete(
  "/credentials/:provider",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider) as Provider;
    if (!PROVIDERS.includes(provider)) {
      res.status(400).json({ message: "Unknown provider." });
      return;
    }
    await deleteCredentials(req.auth!.organizationId, provider);
    void audit(req.auth!.organizationId, "credentials.deleted", `${provider} credentials removed.`, { provider });
    res.json({ ok: true, providers: await providerStatus(req.auth!.organizationId) });
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

// PATCH /api/settings/numbers/:id — edit number / label, or set as default.
settingsRoutes.patch(
  "/numbers/:id",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const number = await prisma.phoneNumber.findUnique({ where: { id: String(req.params.id) } });
    if (!number || number.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Number not found." });
      return;
    }
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (typeof b.label === "string") data.label = b.label.trim() || null;
    if (b.phoneNumber !== undefined) {
      const p = normalizePhone(b.phoneNumber);
      if (!p) {
        res.status(400).json({ message: "A valid E.164 phone number is required." });
        return;
      }
      data.phoneNumber = p;
    }
    if (b.isDefaultOutbound === true) {
      await prisma.phoneNumber.updateMany({
        where: { organizationId: number.organizationId },
        data: { isDefaultOutbound: false }
      });
      data.isDefaultOutbound = true;
    }
    const updated = await prisma.phoneNumber.update({ where: { id: number.id }, data });
    res.json({ number: updated });
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
