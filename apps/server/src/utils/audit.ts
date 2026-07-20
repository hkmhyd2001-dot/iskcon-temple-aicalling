import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

// Best-effort audit log — never throws into the request path.
export async function audit(
  organizationId: string,
  type: string,
  message: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId,
        type,
        message,
        metaJson: meta === undefined ? undefined : (meta as Prisma.InputJsonValue)
      }
    });
  } catch (err) {
    console.error("[audit] failed:", (err as Error).message);
  }
}
