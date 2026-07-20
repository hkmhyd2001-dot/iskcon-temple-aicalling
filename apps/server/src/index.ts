import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";

async function main() {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log("=".repeat(56));
    console.log("  ISKCON AI Calls — announcement backend STARTED");
    console.log(`  Port       : ${env.PORT}`);
    console.log(`  Public URL : ${env.SERVER_URL}`);
    console.log(`  Node env   : ${env.NODE_ENV}`);
    console.log("=".repeat(56));
  });

  const shutdown = async (sig: string) => {
    console.log(`\n[shutdown] ${sig} received — closing…`);
    server.close();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
