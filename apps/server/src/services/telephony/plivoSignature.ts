import crypto from "node:crypto";
import type { Request } from "express";
import { env } from "../../config/env.js";

// Plivo signature V3: base64( HMAC-SHA256( authToken, requestUrl + nonce ) ).
// Header may carry several comma-separated signatures; any match is valid.
// `authToken` should be the token resolved for the call's org (DB or env).
// Returns true when authentic OR when verification is disabled. This is used as
// a BEST-EFFORT check by the webhook routes — the unguessable per-call UUID in
// the URL is the real guard, so callers log a mismatch but never reject (a
// signature edge case must never drop a security alert).
export function verifyPlivoSignature(req: Request, authToken?: string): boolean {
  if (env.PLIVO_SIGNATURE_INSECURE) return true; // dev/tunnel escape hatch
  const token = authToken || env.PLIVO_AUTH_TOKEN;
  if (!token) return false;

  const signatureHeader = req.header("X-Plivo-Signature-V3");
  const nonce = req.header("X-Plivo-Signature-V3-Nonce");
  if (!signatureHeader || !nonce) return false;

  // Reconstruct the exact URL Plivo signed. SERVER_URL must be the public https
  // origin Plivo was told to call.
  const url = `${env.SERVER_URL}${req.originalUrl}`;
  const expected = crypto.createHmac("sha256", token).update(url + nonce).digest("base64");

  return signatureHeader
    .split(",")
    .map((s) => s.trim())
    .some((candidate) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
      } catch {
        return false;
      }
    });
}
