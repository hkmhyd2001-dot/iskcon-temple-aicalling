import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { normalizePhone } from "../utils/phone.js";
import { dialAll, type DialTarget } from "../services/calls/dialer.js";
import { resolvePlivo } from "../services/credentials/providerCredentials.js";
import { audit } from "../utils/audit.js";

export const alertRoutes = Router();

// ─── POST /api/alert — instant multi-number announcement dial ────────────────
//
// THE integration endpoint. The Raspberry Pi (app.py) hits this on every camera
// line-crossing. In ONE request it dials every guard at once — no batch, no
// queue, no Redis.
//
// Auth: API key (acai_…) or a logged-in admin.
//
// Body (identical to the contract app.py already sends):
//   { agentId: string,
//     fromNumber?: string,                       // optional caller-ID override
//     phones: string[] | { name?, phone }[] }    // guards to ring
//
// Response 200:
//   { message, calls: [{ callId, phone }], dialed, skipped }
alertRoutes.post(
  "/",
  authenticate(true),
  asyncHandler(async (req, res) => {
    const orgId = req.auth!.organizationId;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (!agentId) {
      res.status(400).json({ message: "agentId is required." });
      return;
    }

    // Accept string[] OR [{name, phone}]. Normalize, dedupe, drop placeholders.
    const rawPhones = Array.isArray(body.phones) ? body.phones : [];
    const targets: DialTarget[] = [];
    const seen = new Set<string>();
    for (const entry of rawPhones) {
      let name = "";
      let phone = "";
      if (typeof entry === "string") {
        phone = normalizePhone(entry);
      } else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        phone = normalizePhone(typeof o.phone === "string" ? o.phone : "");
        name = typeof o.name === "string" ? o.name.trim() : "";
      }
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      targets.push({ name: name || "Guard", phone });
    }

    if (targets.length === 0) {
      res.status(400).json({
        message: "Provide at least one valid phone number in E.164 format (e.g. +919876543210)."
      });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.organizationId !== orgId) {
      res.status(404).json({ message: "Agent not found." });
      return;
    }
    if (!agent.isActive) {
      res.status(409).json({ message: "This alert agent is disabled." });
      return;
    }

    // Snooze gate: a guard may have pressed a keypad digit on a recent call to
    // pause alerts. While the window is open, accept the request but place NO
    // calls (return 200 so the Pi logs it cleanly rather than retrying).
    if (agent.suppressedUntil && agent.suppressedUntil.getTime() > Date.now()) {
      res.json({
        message: `Alerts are paused until ${agent.suppressedUntil.toISOString()}. No calls placed.`,
        calls: [],
        dialed: 0,
        skipped: targets.length,
        suppressed: true,
        suppressedUntil: agent.suppressedUntil
      });
      return;
    }

    // Resolve Plivo credentials (dashboard-stored first, env fallback).
    const plivoCreds = await resolvePlivo(orgId);

    // Resolve caller ID: explicit override → agent → org default number → Plivo default.
    let fromNumber = normalizePhone(typeof body.fromNumber === "string" ? body.fromNumber : "");
    if (!fromNumber) fromNumber = normalizePhone(agent.fromNumber ?? "");
    if (!fromNumber) {
      const dflt = await prisma.phoneNumber.findFirst({
        where: { organizationId: orgId, provider: "plivo", isActive: true },
        orderBy: { isDefaultOutbound: "desc" }
      });
      fromNumber = normalizePhone(dflt?.phoneNumber ?? "");
    }
    if (!fromNumber) fromNumber = normalizePhone(plivoCreds.defaultNumber ?? "");
    if (!fromNumber) {
      res.status(400).json({
        message: "No caller number configured. Set a Plivo number in Settings or pass fromNumber."
      });
      return;
    }

    const results = await dialAll({
      organizationId: orgId,
      agentId: agent.id,
      agentName: agent.name,
      fromNumber,
      targets,
      source: "alert",
      plivoCreds
    });

    const dialed = results.filter((r) => r.status === "queued");
    const skipped = results.length - dialed.length + (rawPhones.length - targets.length);

    void audit(orgId, "alert.fired", `Alert dialed ${dialed.length} guard(s).`, {
      agentId: agent.id,
      dialed: dialed.length,
      skipped
    });

    res.json({
      message: `Alert dialing ${dialed.length} number(s) via plivo.`,
      calls: dialed.map((r) => ({ callId: r.callId, phone: r.phone })),
      dialed: dialed.length,
      skipped: skipped > 0 ? skipped : 0
    });
  })
);
