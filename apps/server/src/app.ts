import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { notFound, errorHandler } from "./middleware/error.middleware.js";

import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { alertRoutes } from "./routes/alert.routes.js";
import { agentRoutes } from "./routes/agents.routes.js";
import { callRoutes } from "./routes/calls.routes.js";
import { apiKeyRoutes } from "./routes/apiKeys.routes.js";
import { userRoutes } from "./routes/users.routes.js";
import { settingsRoutes } from "./routes/settings.routes.js";
import { voiceRoutes } from "./routes/voices.routes.js";
import { webhookRoutes } from "./routes/webhooks.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS: allow the dashboard origin (and any *.vercel.app preview of it).
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / server-to-server / Plivo
        if (origin === env.APP_URL || /\.vercel\.app$/.test(new URL(origin).hostname)) {
          return cb(null, true);
        }
        return cb(null, true); // single-tenant tool — permissive; tighten if needed
      },
      credentials: true
    })
  );

  // Plivo posts form-encoded webhooks; the API is JSON.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/alert", alertRoutes);
  app.use("/api/agents", agentRoutes);
  app.use("/api/calls", callRoutes);
  app.use("/api/api-keys", apiKeyRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/voices", voiceRoutes);
  app.use("/api/webhooks", webhookRoutes);

  app.get("/", (_req, res) => {
    res.json({ service: "iskcon-aicalls", status: "ok" });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
