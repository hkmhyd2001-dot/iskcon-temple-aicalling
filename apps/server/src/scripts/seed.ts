// One-time bootstrap: creates the org, an admin user, a default alert agent, and
// the first API key (for the Raspberry Pi). Safe to re-run — it is idempotent on
// the admin email and org slug; it always prints a FRESH API key.
//
//   npm run seed   (from repo root: npm run seed)
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { generateApiKey } from "../utils/auth.js";

const DEFAULT_MESSAGE =
  "Attention security team. Someone has crossed the restricted area near the " +
  "entrance gate. Please check immediately.";

async function main() {
  const slug = "iskcon";

  const org =
    (await prisma.organization.findUnique({ where: { slug } })) ??
    (await prisma.organization.create({ data: { name: env.SEED_ORG_NAME, slug } }));
  console.log(`✓ Organization: ${org.name} (${org.id})`);

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (!existingUser) {
    const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10);
    const user = await prisma.user.create({
      data: { organizationId: org.id, email, name: "Admin", passwordHash, role: "admin" }
    });
    console.log(`✓ Admin user: ${user.email}  (password: ${env.SEED_ADMIN_PASSWORD})`);
  } else {
    console.log(`• Admin user already exists: ${email}`);
  }

  let agent = await prisma.agent.findFirst({ where: { organizationId: org.id } });
  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        organizationId: org.id,
        name: "Line-Crossing Security Alert",
        message: DEFAULT_MESSAGE,
        language: "en",
        fromNumber: env.PLIVO_DEFAULT_NUMBER ?? null
      }
    });
    console.log(`✓ Alert agent created — AGENT ID: ${agent.id}`);
  } else {
    console.log(`• Alert agent already exists — AGENT ID: ${agent.id}`);
  }

  // Always mint a fresh key so the operator has one to paste into config.json.
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { organizationId: org.id, name: "Raspberry Pi (seed)", keyHash: hash, prefix }
  });

  console.log("\n" + "=".repeat(60));
  console.log("  COPY THESE INTO pi/config.json");
  console.log("=".repeat(60));
  console.log(`  veytrix_agent_id : ${agent.id}`);
  console.log(`  veytrix_api_key  : ${raw}`);
  console.log(`  veytrix_base_url : ${env.SERVER_URL}`);
  console.log(`  from_number      : ${env.PLIVO_DEFAULT_NUMBER ?? "(set your Plivo number)"}`);
  console.log("=".repeat(60));
  console.log("  (The API key is shown ONCE. Store it now.)\n");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[seed] failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
