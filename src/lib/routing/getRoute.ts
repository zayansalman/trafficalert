import { MIN_USABLE_CONFIDENCE, resolvePlace } from "./geocode";
import { fetchRoutes } from "./osrm";
import type { LatLng, Place, Route, RouteResult } from "@/types/routing";

/** Road geometry is static, so this bounds memory rather than staleness. */
const ROUTE_CACHE_TTL_MS = 10 * 60_000;
const ROUTE_CACHE_LIMIT = 100;

export type PlaceField = "origin" | "destination";

/** Thrown when a place name cannot be resolved confidently enough to route from or to. */
export class PlaceNotFoundError extends Error {
  readonly field: PlaceField;
  readonly query: string;
  /** Near misses, best first. Empty when nothing matched at all. */
  readonly candidates: Place[];

  constructor(field: PlaceField, query: string, candidates: Place[]) {
    super(`Could not resolve ${field} "${query}".`);
    this.name = "PlaceNotFoundError";
    this.field = field;
    this.query = query;
    this.candidates = candidates;
  }
}

interface CacheEntry {
  routes: Route[];
  expiresAt: number;
}

const routeCache = new Map<string, CacheEntry>();

/** ~11m precision — finer than the router's own snapping, so it never merges distinct trips. */
function cacheKey(origin: LatLng, destination: LatLng): string {
  const round = (n: number) => n.toFixed(4);
  return `${round(origin.lat)},${round(origin.lng)}|${round(destination.lat)},${round(destination.lng)}`;
}

async function cachedRoutes(origin: LatLng, destination: LatLng): Promise<Route[]> {
  const key = cacheKey(origin, destination);
  const hit = routeCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.routes;

  const routes = await fetchRoutes(origin, destination);

  if (routeCache.size >= ROUTE_CACHE_LIMIT) {
    routeCache.delete(routeCache.keys().next().value as string);
  }
  routeCache.set(key, { routes, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });

  return routes;
}

async function resolveField(field: PlaceField, query: string): Promise<Place> {
  const candidates = await resolvePlace(query);
  const best = candidates[0];

  if (!best || best.confidence < MIN_USABLE_CONFIDENCE) {
    throw new PlaceNotFoundError(field, query, candidates);
  }

  return best;
}

/**
 * Resolve two place names and fetch the driving routes between them.
 *
 * The returned routes are unscored and in the router's own order — they say nothing about
 * congestion. Anything reported as current conditions has to come from the traffic reports.
 *
 * @throws {PlaceNotFoundError} when either place cannot be resolved.
 * @throws {RoutingError} when no route exists or the router is unreachable.
 */
export async function getRoute(
  originQuery: string,
  destinationQuery: string,
): Promise<RouteResult> {
  // Sequential so an unresolvable origin is always reported before an unresolvable
  // destination; both lookups are cache- or gazetteer-served on the common path anyway.
  const origin = await resolveField("origin", originQuery);
  const destination = await resolveField("destination", destinationQuery);

  const routes = await cachedRoutes(origin.location, destination.location);

  return { origin, destination, routes };
}
