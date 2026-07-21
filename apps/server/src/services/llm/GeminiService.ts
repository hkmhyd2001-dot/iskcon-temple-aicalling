import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";

// OPTIONAL. Gemini is never used at call time (announcement-only). It exists
// purely as a dashboard helper: compose or translate the fixed alert message.
// Credentials come from the dashboard (DB) or env — passed in by the caller.
export class GeminiService {
  constructor(private readonly apiKey?: string, private readonly model?: string) {}

  private key(): string | undefined {
    return this.apiKey || env.GEMINI_API_KEY;
  }

  get configured(): boolean {
    return Boolean(this.key());
  }

  private client(): GoogleGenAI {
    const key = this.key();
    if (!key) throw new Error("Gemini is not configured.");
    return new GoogleGenAI({ apiKey: key });
  }

  async composeAlert(instruction: string, language = "en"): Promise<string> {
    const langName =
      { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil" }[language] ?? "English";
    const prompt =
      `You write short, calm, clear public-address security-alert messages that are ` +
      `spoken aloud over a phone call to security guards. Write ONE message in ${langName}, ` +
      `2 sentences max, no preamble, no quotes. Instruction: ${instruction}`;

    const res = await this.client().models.generateContent({
      model: this.model || env.GEMINI_MODEL,
      contents: prompt
    });
    return (res.text ?? "").trim();
  }
}
