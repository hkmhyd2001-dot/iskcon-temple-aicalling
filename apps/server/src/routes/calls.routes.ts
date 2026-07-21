import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import { dialAll, type DialTarget } from "../services/calls/dialer.js";
import { resolvePlivo } from "../services/credentials/providerCredentials.js";

export const callRoutes = Router();

// Both dashboard sessions AND API keys may read call history.
callRoutes.use(authenticate(true));

// GET /api/calls — paginated call history (newest first).
callRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const where = { organizationId: orgId, ...(status ? { status } : {}) };
    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.call.count({ where })
    ]);

    res.json({ calls, total, page, limit, pages: Math.ceil(total / limit) });
  })
);

// GET /api/calls/:id — single call.
callRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const call = await prisma.call.findUnique({ where: { id: String(req.params.id) } });
    if (!call || call.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Call not found." });
      return;
    }
    res.json({ call });
  })
);

// POST /api/calls/test — dashboard "send a test call" button.
callRoutes.post(
  "/test",
  requireUser(),
  asyncHandler(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const b = req.body ?? {};
    const agentId = String(b.agentId ?? "").trim();
    const phone = normalizePhone(b.phone);
    if (!agentId || !phone) {
      res.status(400).json({ message: "agentId and a valid phone are required." });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.organizationId !== orgId) {
      res.status(404).json({ message: "Agent not found." });
      return;
    }

    const plivoCreds = await resolvePlivo(orgId);
    let fromNumber = normalizePhone(agent.fromNumber ?? "");
    if (!fromNumber) {
      const dflt = await prisma.phoneNumber.findFirst({
        where: { organizationId: orgId, provider: "plivo", isActive: true },
        orderBy: { isDefaultOutbound: "desc" }
      });
      fromNumber = normalizePhone(dflt?.phoneNumber ?? "");
    }
    if (!fromNumber) fromNumber = normalizePhone(plivoCreds.defaultNumber ?? "");
    if (!fromNumber) {
      res.status(400).json({ message: "No caller number configured. Add one in Settings." });
      return;
    }

    const targets: DialTarget[] = [{ name: "Test", phone }];
    const results = await dialAll({
      organizationId: orgId,
      agentId,
      agentName: agent.name,
      fromNumber,
      targets,
      source: "test",
      plivoCreds
    });
    res.json({ results });
  })
);

// DELETE /api/calls/:id — remove a call record from history (dashboard only).
callRoutes.delete(
  "/:id",
  requireUser(),
  asyncHandler(async (req, res) => {
    const call = await prisma.call.findUnique({ where: { id: String(req.params.id) } });
    if (!call || call.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "Call not found." });
      return;
    }
    await prisma.call.delete({ where: { id: call.id } });
    res.json({ ok: true });
  })
);

// POST /api/calls/clear — clear the whole call history (dashboard only).
callRoutes.post(
  "/clear",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const result = await prisma.call.deleteMany({ where: { organizationId: req.auth!.organizationId } });
    res.json({ ok: true, deleted: result.count });
  })
);
