export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/** Gemini's OpenAI-compatible endpoint — lets us keep using the `openai` SDK unchanged. */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Throws if GEMINI_API_KEY isn't set, so callers fail with a clear message instead of a raw 401. */
export function requireGeminiKey(): string {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local for local dev, or to your hosting provider's environment variables in production.",
    );
  }
  return GEMINI_API_KEY;
}
