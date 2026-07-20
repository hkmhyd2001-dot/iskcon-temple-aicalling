import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the repo-root .env first (shared), then any app-local .env (overrides).
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),

  // Public HTTPS URL of THIS backend — Plivo webhooks are fetched from here.
  SERVER_URL: z.string().default("http://localhost:3000"),
  // Dashboard origin, for CORS.
  APP_URL: z.string().default("http://localhost:5173"),

  DATABASE_URL: z
    .string()
    .default("mongodb+srv://username:password@cluster.mongodb.net/iskcon_alerts?appName=IskconAlerts"),

  JWT_SECRET: z.string().default("replace-me"),
  ENCRYPTION_KEY: z.string().default("dev-encryption-key-change-this"),

  // ─── Telephony: Plivo ──────────────────────────────────────────────────────
  PLIVO_AUTH_ID: z.string().optional(),
  PLIVO_AUTH_TOKEN: z.string().optional(),
  PLIVO_DEFAULT_NUMBER: z.string().optional(),
  // Verify Plivo webhook signatures. false = fail closed (production default).
  PLIVO_SIGNATURE_INSECURE: z.coerce.boolean().default(false),

  // ─── Voice: Cartesia (TTS) ─────────────────────────────────────────────────
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_DEFAULT_VOICE_ID: z.string().optional(),
  CARTESIA_TTS_MODEL: z.string().default("sonic-2"),

  // ─── LLM: Gemini (OPTIONAL — dashboard message helper only) ────────────────
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // ─── First-run seed ────────────────────────────────────────────────────────
  SEED_ORG_NAME: z.string().default("ISKCON Temple"),
  SEED_ADMIN_EMAIL: z.string().default("admin@iskcon.local"),
  SEED_ADMIN_PASSWORD: z.string().default("change-this-now"),

  // Ring timeout (seconds) for each outbound Plivo call.
  CALL_RING_TIMEOUT: z.coerce.number().int().default(45)
});

export const env = envSchema.parse(process.env);

// In production, refuse to boot on the dev-default secrets. In dev/test, warn.
const weakSecretsAllowed = env.NODE_ENV === "development" || env.NODE_ENV === "test";

function enforce(name: string, value: string, devDefault: string): void {
  if (value === devDefault) {
    const msg = `${name} is still the development default — set a strong random value before production.`;
    if (!weakSecretsAllowed) throw new Error(msg);
    console.warn(`[env] WARNING: ${msg}`);
  }
  if (value.length < 32) {
    const msg = `${name} should be at least 32 characters (got ${value.length}).`;
    if (!weakSecretsAllowed) throw new Error(msg);
    console.warn(`[env] WARNING: ${msg}`);
  }
}

enforce("JWT_SECRET", env.JWT_SECRET, "replace-me");
enforce("ENCRYPTION_KEY", env.ENCRYPTION_KEY, "dev-encryption-key-change-this");
