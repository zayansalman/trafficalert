export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Throws if OPENAI_API_KEY isn't set, so callers fail with a clear message instead of a raw 401. */
export function requireOpenAiKey(): string {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local for local dev, or to your hosting provider's environment variables in production.",
    );
  }
  return OPENAI_API_KEY;
}
