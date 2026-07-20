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
}
