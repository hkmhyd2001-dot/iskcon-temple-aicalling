import { env } from "../../config/env.js";

export interface OutboundCall {
  callId: string; // our Call.id — embedded in the webhook URLs
  from: string;
  to: string;
}

// Thin Plivo REST client. Announcement-only: the answer webhook returns a
// <Play> of the cached alert audio, so there is NO media WebSocket here.
export class PlivoService {
  private authId: string;
  private authToken: string;
  private baseUrl: string;

  constructor(authId?: string, authToken?: string) {
    this.authId = authId ?? env.PLIVO_AUTH_ID ?? "";
    this.authToken = authToken ?? env.PLIVO_AUTH_TOKEN ?? "";
    this.baseUrl = `https://api.plivo.com/v1/Account/${this.authId}`;
  }

  get configured(): boolean {
    return Boolean(this.authId && this.authToken);
  }

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.authId}:${this.authToken}`).toString("base64")}`;
  }

  // Places one outbound call. Plivo fetches the answer XML from our webhook
  // (which plays the alert) and posts terminal status to the hangup webhook.
  async makeCall(call: OutboundCall): Promise<{ providerCallId: string }> {
    if (!this.configured) {
      throw new Error("Plivo is not configured (set PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN).");
    }

    const answerUrl = `${env.SERVER_URL}/api/webhooks/plivo/answer/${call.callId}`;
    const hangupUrl = `${env.SERVER_URL}/api/webhooks/plivo/status/${call.callId}`;

    const response = await fetch(`${this.baseUrl}/Call/`, {
      method: "POST",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: call.from,
        to: call.to,
        answer_url: answerUrl,
        answer_method: "GET",
        hangup_url: hangupUrl,
        hangup_method: "POST",
        ring_timeout: env.CALL_RING_TIMEOUT,
        time_limit: 120
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Plivo makeCall failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { request_uuid: string };
    return { providerCallId: data.request_uuid };
  }
}
