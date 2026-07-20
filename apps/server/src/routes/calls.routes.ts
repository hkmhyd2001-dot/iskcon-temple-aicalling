import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import { dialAll, type DialTarget } from "../services/calls/dialer.js";
import { env } from "../config/env.js";

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

// POST /api/calls/test — dashboard "send a test call" button. Same dial path as
// a real alert, tagged source=test.
callRoutes.post(
  "/test",
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

    let fromNumber = normalizePhone(agent.fromNumber ?? "") || normalizePhone(env.PLIVO_DEFAULT_NUMBER ?? "");
    if (!fromNumber) {
      const dflt = await prisma.phoneNumber.findFirst({
        where: { organizationId: orgId, provider: "plivo", isActive: true },
        orderBy: { isDefaultOutbound: "desc" }
      });
      fromNumber = normalizePhone(dflt?.phoneNumber ?? "");
    }
    if (!fromNumber) {
      res.status(400).json({ message: "No caller number configured." });
      return;
    }

    const targets: DialTarget[] = [{ name: "Test", phone }];
    const results = await dialAll({ organizationId: orgId, agentId, fromNumber, targets, source: "test" });
    res.json({ results });
  })
);
