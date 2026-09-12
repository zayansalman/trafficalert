export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// flash-lite answers these summarisation questions in ~1s where gemini-3.6-flash took 30s+,
// and its free-tier daily quota is far higher.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

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

/**
 * Public OSRM demo server — free, keyless, OpenStreetMap-derived road network.
 *
 * It is a *demo* instance: the OSRM project asks that anything beyond light use run its own
 * copy, and it offers no uptime guarantee. Override this to point at a self-hosted instance
 * (`docker run osrm/osrm-backend`) without touching any calling code.
 */
export const OSRM_BASE_URL =
  process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";

/** OpenStreetMap's free geocoder. Used only for places missing from our own gazetteer. */
export const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";

/**
 * Nominatim's usage policy requires a User-Agent identifying the application.
 * Requests without one are refused.
 */
export const OSM_USER_AGENT =
  "trafficalert/0.1 (+https://github.com/zayansalman/trafficalert)";
