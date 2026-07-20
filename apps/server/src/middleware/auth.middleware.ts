import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { verifyAuthToken, hashApiKey, API_KEY_PREFIX } from "../utils/auth.js";

// Populated on every authenticated request.
export interface AuthContext {
  organizationId: string;
  userId?: string; // present for JWT (dashboard) sessions
  apiKeyId?: string; // present for API-key (Raspberry Pi) sessions
  role: string; // "admin" | "viewer" | "service"
  kind: "user" | "apikey";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Route mounts an API key MAY reach. Everything else (settings, api-keys mgmt,
// agent editing) requires a logged-in admin — an API key can only trigger calls
// and read results.
const API_KEY_ALLOWED_PREFIXES = ["/api/alert", "/api/calls"];

function readBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim();
}

// Throttle lastUsedAt writes so a busy key doesn't hammer Mongo.
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

export function authenticate(required = true) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readBearer(req);
    if (!token) {
      if (!required) return next();
      res.status(401).json({ message: "Authentication required." });
      return;
    }

    // ─── API key (Raspberry Pi / integrations) ───────────────────────────────
    if (token.startsWith(API_KEY_PREFIX)) {
      const keyHash = hashApiKey(token);
      const key = await prisma.apiKey.findFirst({
        where: { keyHash },
        select: { id: true, organizationId: true, revokedAt: true, lastUsedAt: true }
      });
      if (!key || key.revokedAt) {
        res.status(401).json({ message: "Invalid or revoked API key." });
        return;
      }

      const path = req.baseUrl + req.path;
      const allowed = API_KEY_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
      if (!allowed) {
        res.status(403).json({ message: "This API key cannot access this endpoint." });
        return;
      }

      req.auth = {
        organizationId: key.organizationId,
        apiKeyId: key.id,
        role: "service",
        kind: "apikey"
      };

      // Best-effort, throttled lastUsedAt bump.
      const now = Date.now();
      const last = lastUsedWrites.get(key.id) ?? 0;
      if (now - last > LAST_USED_THROTTLE_MS) {
        lastUsedWrites.set(key.id, now);
        prisma.apiKey
          .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);
      }
      return next();
    }

    // ─── JWT (dashboard) ─────────────────────────────────────────────────────
    const payload = verifyAuthToken(token);
    if (!payload) {
      res.status(401).json({ message: "Invalid or expired session." });
      return;
    }
    req.auth = {
      organizationId: payload.organizationId,
      userId: payload.userId,
      role: payload.role,
      kind: "user"
    };
    return next();
  };
}

// Guard: only a logged-in user (not an API key) may proceed. Optionally require
// a specific role.
export function requireUser(role?: "admin") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.kind !== "user") {
      res.status(403).json({ message: "Dashboard login required." });
      return;
    }
    if (role && req.auth.role !== role) {
      res.status(403).json({ message: "Admin access required." });
      return;
    }
    next();
  };
}
