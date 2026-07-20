import { PrismaClient } from "@prisma/client";

// Single shared client. `globalThis` guard prevents multiple instances during
// tsx watch hot-reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV === "development") {
  globalForPrisma.prisma = prisma;
}
