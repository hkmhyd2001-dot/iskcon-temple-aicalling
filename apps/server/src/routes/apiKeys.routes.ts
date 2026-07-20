import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { generateApiKey } from "../utils/auth.js";
import { audit } from "../utils/audit.js";

export const apiKeyRoutes = Router();

apiKeyRoutes.use(authenticate(true), requireUser("admin"));

// GET /api/api-keys — list (never returns the raw key).
apiKeyRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true }
    });
    res.json({ keys });
  })
);

// POST /api/api-keys — mint a key. The raw value is returned ONCE, here only.
apiKeyRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim() || "Raspberry Pi";
    const { raw, hash, prefix } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { organizationId: req.auth!.organizationId, name, keyHash: hash, prefix }
    });
    void audit(req.auth!.organizationId, "apikey.created", `API key "${name}" created.`, { keyId: key.id });
    res.status(201).json({
      id: key.id,
      name: key.name,
      key: raw, // show once — the Pi's config.json gets this value
      prefix: key.prefix,
      createdAt: key.createdAt
    });
  })
);

// POST /api/api-keys/:id/revoke — disable a key but keep the row for audit.
apiKeyRoutes.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const key = await prisma.apiKey.findUnique({ where: { id: String(req.params.id) } });
    if (!key || key.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "API key not found." });
      return;
    }
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    void audit(req.auth!.organizationId, "apikey.revoked", `API key "${key.name}" revoked.`, { keyId: key.id });
    res.json({ ok: true });
  })
);

// PATCH /api/api-keys/:id — rename a key.
apiKeyRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const key = await prisma.apiKey.findUnique({ where: { id: String(req.params.id) } });
    if (!key || key.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "API key not found." });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    if (!name) {
      res.status(400).json({ message: "Name is required." });
      return;
    }
    const updated = await prisma.apiKey.update({ where: { id: key.id }, data: { name } });
    res.json({ id: updated.id, name: updated.name });
  })
);

// DELETE /api/api-keys/:id — permanently remove a key.
apiKeyRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const key = await prisma.apiKey.findUnique({ where: { id: String(req.params.id) } });
    if (!key || key.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "API key not found." });
      return;
    }
    await prisma.apiKey.delete({ where: { id: key.id } });
    void audit(req.auth!.organizationId, "apikey.deleted", `API key "${key.name}" deleted.`, { keyId: key.id });
    res.json({ ok: true });
  })
);
