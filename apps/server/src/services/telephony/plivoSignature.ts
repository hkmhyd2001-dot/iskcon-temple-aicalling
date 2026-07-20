import crypto from "node:crypto";
import type { Request } from "express";
import { env } from "../../config/env.js";

// Plivo signature V3: base64( HMAC-SHA256( authToken, requestUrl + nonce ) ).
// Header may carry several comma-separated signatures; any match is valid.
// Returns true when the request is authentic OR when verification is explicitly
// disabled (dev tunnels). Fails CLOSED by default in production.
export function verifyPlivoSignature(req: Request): boolean {
  if (env.PLIVO_SIGNATURE_INSECURE) return true; // dev/tunnel escape hatch
  const token = env.PLIVO_AUTH_TOKEN;
  if (!token) {
    console.warn("[plivo] PLIVO_AUTH_TOKEN unset — cannot verify webhook signature.");
    return false;
  }

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
