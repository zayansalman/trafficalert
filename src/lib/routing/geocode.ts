import { NOMINATIM_BASE_URL, OSM_USER_AGENT } from "@/lib/config";
import { DHAKA_GAZETTEER } from "./gazetteer";
import type { Place } from "@/types/routing";

/** Below this a caller must treat the match as a guess and ask the user to confirm. */
export const MIN_USABLE_CONFIDENCE = 0.5;

const NOMINATIM_TIMEOUT_MS = 5_000;
/** Nominatim's usage policy caps us at one request per second; leave headroom. */
const NOMINATIM_MIN_GAP_MS = 1_100;
const CACHE_LIMIT = 200;

/** Lowercase, strip punctuation, collapse whitespace — "Dhanmondi-27" and "dhanmondi 27" match. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when `needle` appears in `haystack` on word boundaries, so "mirpur 1" misses "mirpur 10". */
function containsPhrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

interface Scored {
  place: Place;
  /** Length of the matched phrase — longer wins, so "Dhanmondi 27" beats "Dhanmondi". */
  specificity: number;
}

/**
 * Resolve against the local gazetteer. Never hits the network, so this is the path
 * every common Dhaka place name takes.
 */
export function searchGazetteer(query: string): Place[] {
  const q = normalise(query);
  if (!q) return [];

  const scored: Scored[] = [];

  for (const entry of DHAKA_GAZETTEER) {
    const names = [entry.name, ...(entry.aliases ?? [])];
    let best = 0;
    let matched = "";

    for (const name of names) {
      const n = normalise(name);
      let confidence = 0;

      // An exact name, or a whole name found inside the user's sentence, is safe to route on.
      // A fragment of a name ("mirpur", "27") is not: it fits several entries equally well and
      // picking one silently sends the user somewhere they did not ask for. Scoring it below
      // MIN_USABLE_CONFIDENCE turns it into a suggestion, so the caller asks which one.
      if (n === q) confidence = 1;
      else if (containsPhrase(q, n)) confidence = 0.8;
      else if (containsPhrase(n, q)) confidence = 0.4;

      if (confidence > best || (confidence === best && n.length > matched.length)) {
        best = confidence;
        matched = n;
      }
    }

    if (best > 0) {
      scored.push({
        specificity: matched.length,
        place: {
          name: entry.name,
          displayName: `${entry.name}, Dhaka, Bangladesh`,
          location: entry.location,
          confidence: best,
          source: "gazetteer",
        },
      });
    }
  }

  return scored
    .sort(
      (a, b) =>
        b.place.confidence - a.place.confidence || b.specificity - a.specificity,
    )
    .map((s) => s.place);
}

interface NominatimResult {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
}

const nominatimCache = new Map<string, Place[]>();
let nominatimQueue: Promise<unknown> = Promise.resolve();

/** Serialises Nominatim calls with a minimum gap, as their usage policy requires. */
function rateLimited<T>(task: () => Promise<T>): Promise<T> {
  const result = nominatimQueue.then(task, task);
  nominatimQueue = result
    .catch(() => undefined)
    .then(() => new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_GAP_MS)));
  return result;
}

/**
 * Fall back to OpenStreetMap's geocoder, restricted to Bangladesh.
 *
 * Confidence is deliberately capped below the gazetteer's: Nominatim returns results ordered
 * by its own relevance score but gives no calibrated probability, and for colloquial Dhaka
 * names a curated entry is the better answer whenever one exists.
 */
export async function searchNominatim(query: string): Promise<Place[]> {
  const key = normalise(query);
  if (!key) return [];

  const cached = nominatimCache.get(key);
  if (cached) return cached;

  const url = new URL("/search", NOMINATIM_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "bd");
  url.searchParams.set("limit", "5");

  let results: NominatimResult[];
  try {
    results = await rateLimited(async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": OSM_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
      return (await res.json()) as NominatimResult[];
    });
  } catch (err) {
    console.error("[routing/geocode] Nominatim lookup failed", err);
    return [];
  }

  const places: Place[] = results.flatMap((r, index) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const displayName = r.display_name ?? r.name ?? query;
    return [
      {
        name: r.name || displayName.split(",")[0].trim(),
        displayName,
        location: { lat, lng },
        confidence: Math.max(0.5, 0.7 - index * 0.05),
        source: "nominatim" as const,
      },
    ];
  });

  if (nominatimCache.size >= CACHE_LIMIT) {
    nominatimCache.delete(nominatimCache.keys().next().value as string);
  }
  nominatimCache.set(key, places);

  return places;
}

/**
 * Resolve a place name to coordinates, best candidate first.
 *
 * The gazetteer answers first and the network is only touched when it has nothing usable.
 */
export async function resolvePlace(query: string): Promise<Place[]> {
  const local = searchGazetteer(query);
  if (local.length > 0 && local[0].confidence >= MIN_USABLE_CONFIDENCE) return local;

  const remote = await searchNominatim(query);
  return [...local, ...remote].sort((a, b) => b.confidence - a.confidence);
}
