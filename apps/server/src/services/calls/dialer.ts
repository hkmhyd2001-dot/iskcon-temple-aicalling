import { prisma } from "../../db/prisma.js";
import { PlivoService } from "../telephony/PlivoService.js";
import { isE164 } from "../../utils/phone.js";
import type { PlivoCreds } from "../credentials/providerCredentials.js";

export interface DialTarget {
  name: string;
  phone: string;
}

export interface DialResult {
  callId: string;
  phone: string;
  status: "queued" | "failed";
  error?: string;
}

// The no-Redis, no-queue core: create a Call row per guard and fire every Plivo
// dial AT ONCE (Promise.all). All guards ring near-simultaneously. Announcement
// calls are short and independent, so there is no concurrency ceiling to manage.
export async function dialAll(params: {
  organizationId: string;
  agentId: string;
  agentName?: string;
  fromNumber: string;
  targets: DialTarget[];
  source: "alert" | "test" | "dashboard";
  plivoCreds: PlivoCreds;
}): Promise<DialResult[]> {
  const { organizationId, agentId, agentName, fromNumber, targets, source, plivoCreds } = params;
  const plivo = new PlivoService(plivoCreds.authId, plivoCreds.authToken);

  const results = await Promise.all(
    targets.map(async (t): Promise<DialResult> => {
      if (!isE164(t.phone)) {
        return { callId: "", phone: t.phone, status: "failed", error: "Not E.164." };
      }

      // 1) Persist the call row first so the webhook can find it by id.
      const call = await prisma.call.create({
        data: {
          organizationId,
          agentId,
          agentName: agentName ?? null,
          targetName: t.name || "Alert Recipient",
          targetPhone: t.phone,
          fromNumber,
          telephonyProvider: "plivo",
          status: "queued",
          source
        }
      });

      // 2) Dial. On failure, mark the row failed but DON'T reject the batch —
      //    one bad number must never stop the other guards from ringing.
      try {
        const { providerCallId } = await plivo.makeCall({
          callId: call.id,
          from: fromNumber,
          to: t.phone
        });
        await prisma.call.update({
          where: { id: call.id },
          data: { providerCallId, status: "ringing", startedAt: new Date() }
        });
        return { callId: call.id, phone: t.phone, status: "queued" };
      } catch (err) {
        const message = (err as Error).message;
        await prisma.call.update({
          where: { id: call.id },
          data: { status: "failed", errorMessage: message, endedAt: new Date() }
        });
        return { callId: call.id, phone: t.phone, status: "failed", error: message };
      }
    })
  );

  return results;
}
