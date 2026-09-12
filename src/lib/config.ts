/** An OpenAI-compatible chat endpoint. Both providers speak that protocol, so one client type serves both. */
export interface LlmProvider {
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

// flash-lite answers these summarisation questions in ~1s where gemini-3.6-flash took 30s+,
// and its free-tier daily quota is far higher.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

// gpt-oss-120b is ungated and served by ~11 inference providers, so the fallback doesn't
// depend on a licence acceptance or a single provider staying up.
const HF_MODEL = process.env.HF_MODEL ?? "openai/gpt-oss-120b";
const HF_BASE_URL = "https://router.huggingface.co/v1";

/**
 * Providers in priority order. The chat route walks this list and uses the first that answers,
 * so an exhausted Gemini quota falls through to Hugging Face instead of failing the request.
 * A provider with no key configured is simply absent.
 */
export function configuredProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];

  if (process.env.GEMINI_API_KEY) {
    providers.push({
      name: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: GEMINI_BASE_URL,
      model: GEMINI_MODEL,
    });
  }

  if (process.env.HF_API_KEY) {
    providers.push({
      name: "huggingface",
      apiKey: process.env.HF_API_KEY,
      baseURL: HF_BASE_URL,
      model: HF_MODEL,
    });
  }

  return providers;
}
