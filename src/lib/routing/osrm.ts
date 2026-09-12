import { OSRM_BASE_URL } from "@/lib/config";
import { nearestVertex } from "@/lib/geo/distance";
import { DHAKA_GAZETTEER } from "./gazetteer";
import type { LatLng, Route, RouteStep } from "@/types/routing";

const OSRM_TIMEOUT_MS = 8_000;
const MAX_ALTERNATIVES = 3;
/** Named roads listed per route. Enough to recognise the path, short enough to stay readable. */
const MAX_MAIN_ROADS = 6;

/**
 * How close a gazetteer point must be to the line to count as "the route goes through here".
 *
 * Gazetteer entries are area centres accurate to a few hundred metres, so this has to absorb
 * that error without sweeping in every neighbouring area — at Dhaka's density, 800m does.
 */
export const CORRIDOR_RADIUS_METERS = 800;

export type RoutingErrorCode = "no_route" | "unavailable";

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;

  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }
}

interface OsrmStep {
  name?: string;
  distance?: number;
  duration?: number;
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
  legs?: { steps?: OsrmStep[] }[];
}

interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

/** GeoJSON is [lng, lat]; nothing outside this module sees that order. */
function decodeGeometry(coordinates: [number, number][]): LatLng[] {
  return coordinates.map(([lng, lat]) => ({ lat, lng }));
}

function collectSteps(route: OsrmRoute): RouteStep[] {
  return (route.legs ?? []).flatMap((leg) =>
    (leg.steps ?? []).map((step) => ({
      name: step.name?.trim() ? step.name.trim() : null,
      distanceMeters: step.distance ?? 0,
      durationSeconds: step.duration ?? 0,
    })),
  );
}

/** Named roads carrying the most distance, longest first. Unnamed links are dropped. */
function mainRoads(steps: RouteStep[]): string[] {
  const byRoad = new Map<string, number>();

  for (const step of steps) {
    if (!step.name) continue;
    byRoad.set(step.name, (byRoad.get(step.name) ?? 0) + step.distanceMeters);
  }

  return [...byRoad.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MAIN_ROADS)
    .map(([name]) => name);
}

function summarise(roads: string[]): string {
  if (roads.length === 0) return "unnamed local roads";
  if (roads.length === 1) return `via ${roads[0]}`;
  return `via ${roads[0]} and ${roads[1]}`;
}

/**
 * Gazetteer areas within the route corridor, in travel order.
 *
 * This is the bridge between the two data sources: the router speaks OSM road names, while
 * crowd-sourced reports name neighbourhoods ("Bijoy Sarani is stuck"). Without this the two
 * vocabularies never meet.
 */
function areasPassed(geometry: LatLng[]): string[] {
  if (geometry.length === 0) return [];

  const hits: { name: string; index: number }[] = [];

  for (const entry of DHAKA_GAZETTEER) {
    const { index, distanceMeters } = nearestVertex(entry.location, geometry);
    if (distanceMeters <= CORRIDOR_RADIUS_METERS) {
      hits.push({ name: entry.name, index });
    }
  }

  return hits.sort((a, b) => a.index - b.index).map((h) => h.name);
}

function toRoute(raw: OsrmRoute, index: number): Route {
  const geometry = decodeGeometry(raw.geometry?.coordinates ?? []);
  const steps = collectSteps(raw);
  const roads = mainRoads(steps);

  return {
    routeId: `r${index}`,
    summary: summarise(roads),
    distanceMeters: raw.distance ?? 0,
    durationSeconds: raw.duration ?? 0,
    geometry,
    steps,
    mainRoads: roads,
    areasPassed: areasPassed(geometry),
  };
}

/**
 * Driving routes between two points from OSRM, in the order it returned them.
 *
 * OSRM offers alternatives only where a genuinely distinct path exists, so a single-route
 * response is normal and not an error.
 *
 * @throws {RoutingError} `no_route` when the points cannot be connected, `unavailable` when
 * the service could not be reached.
 */
export async function fetchRoutes(
  origin: LatLng,
  destination: LatLng,
): Promise<Route[]> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`/route/v1/driving/${coords}`, OSRM_BASE_URL);
  url.searchParams.set("alternatives", String(MAX_ALTERNATIVES));
  url.searchParams.set("steps", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");

  let body: OsrmResponse;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OSRM responded ${res.status}`);
    body = (await res.json()) as OsrmResponse;
  } catch (err) {
    console.error("[routing/osrm] route request failed", err);
    throw new RoutingError("unavailable", "The routing service could not be reached.");
  }

  if (body.code !== "Ok" || !body.routes?.length) {
    throw new RoutingError(
      "no_route",
      body.message ?? "No drivable route connects those two places.",
    );
  }

  return body.routes.map(toRoute);
}
