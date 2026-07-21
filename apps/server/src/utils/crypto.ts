import crypto from "node:crypto";
import { env } from "../config/env.js";

// AES-256-GCM at-rest encryption for provider credentials stored in Mongo.
// Key = sha256(ENCRYPTION_KEY) → deterministic 32 bytes. Output layout:
//   base64( iv(12) | authTag(16) | ciphertext )
const KEY = crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptJson<T = Record<string, string>>(blob: string): T {
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}
