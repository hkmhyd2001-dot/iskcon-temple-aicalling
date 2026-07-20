import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";

// OPTIONAL. Gemini is never used at call time (announcement-only). It exists
// purely as a dashboard helper: compose or translate the fixed alert message.
export class GeminiService {
  get configured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  private client(): GoogleGenAI {
    if (!env.GEMINI_API_KEY) throw new Error("Gemini is not configured (GEMINI_API_KEY).");
    return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  // Generate/refine an alert message from a short instruction.
  async composeAlert(instruction: string, language = "en"): Promise<string> {
    const langName =
      { en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil" }[language] ?? "English";
    const prompt =
      `You write short, calm, clear public-address security-alert messages that are ` +
      `spoken aloud over a phone call to security guards. Write ONE message in ${langName}, ` +
      `2 sentences max, no preamble, no quotes. Instruction: ${instruction}`;

    const res = await this.client().models.generateContent({
      model: env.GEMINI_MODEL,
      contents: prompt
    });
    return (res.text ?? "").trim();
  }
}
