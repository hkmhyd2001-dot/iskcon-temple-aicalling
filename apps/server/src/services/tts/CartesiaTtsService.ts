import { env } from "../../config/env.js";

export interface CartesiaOptions {
  apiKey?: string;
  modelId?: string;
  voiceId?: string;
  language?: string;
}

// Map an agent language code to what Cartesia Sonic expects.
export function cartesiaLanguageCode(lang?: string): string {
  switch ((lang ?? "").trim().toLowerCase()) {
    case "hindi":
    case "hi":
      return "hi";
    case "telugu":
    case "te":
      return "te";
    case "tamil":
    case "ta":
      return "ta";
    default:
      return "en";
  }
}

// Announcement TTS. Renders the whole message to a WAV buffer that Plivo can
// <Play>. Latency doesn't matter here — the audio is cached after the first
// render, so the fixed alert costs ₹0 on every later call.
export class CartesiaTtsService {
  async synthesizeWav(text: string, options: CartesiaOptions = {}): Promise<Buffer> {
    const apiKey = options.apiKey ?? env.CARTESIA_API_KEY;
    const voiceId = options.voiceId ?? env.CARTESIA_DEFAULT_VOICE_ID;
    const modelId = options.modelId ?? env.CARTESIA_TTS_MODEL;

    if (!apiKey) throw new Error("Cartesia API key is not configured (CARTESIA_API_KEY).");
    if (!voiceId) throw new Error("Cartesia voice is not configured (CARTESIA_DEFAULT_VOICE_ID or agent.voiceId).");

    const body: Record<string, unknown> = {
      model_id: modelId || "sonic-2",
      transcript: text,
      voice: { mode: "id", id: voiceId },
      // WAV container so Plivo's <Play> can consume it directly. 24kHz mono is a
      // good quality/size balance; Plivo transcodes to the 8kHz phone leg.
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
      language: cartesiaLanguageCode(options.language)
    };

    const doFetch = () =>
      fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Cartesia-Version": "2026-03-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

    let response = await doFetch();
    if (response.status === 429) response = await doFetch(); // free-tier concurrency retry

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Cartesia TTS failed (${response.status}): ${errBody}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // List the Cartesia voices available on the account, so the dashboard can show
  // a picker instead of asking for a raw voice UUID. Handles both the plain-array
  // and the paginated ({data:[…]}) response shapes.
  async listVoices(apiKey?: string): Promise<
    Array<{ id: string; name: string; language?: string; description?: string }>
  > {
    const key = apiKey ?? env.CARTESIA_API_KEY;
    if (!key) throw new Error("Cartesia API key is not configured (CARTESIA_API_KEY).");

    const res = await fetch("https://api.cartesia.ai/voices/?limit=100", {
      headers: { "X-API-Key": key, "Cartesia-Version": "2026-03-01" }
    });
    if (!res.ok) {
      throw new Error(`Cartesia list voices failed (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as unknown;
    const arr: Array<Record<string, unknown>> = Array.isArray(json)
      ? (json as Array<Record<string, unknown>>)
      : ((json as { data?: Array<Record<string, unknown>> }).data ?? []);

    return arr
      .filter((v) => typeof v.id === "string" && typeof v.name === "string")
      .map((v) => ({
        id: v.id as string,
        name: v.name as string,
        language: typeof v.language === "string" ? v.language : undefined,
        description: typeof v.description === "string" ? v.description : undefined
      }));
  }
}
