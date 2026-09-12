/**
 * Routing contracts. Trimmed from the frozen contract in `docs/parallel-plan.md`
 * to the subset that is actually implemented today.
 *
 * `LatLng` belongs in `types/congestion.ts` per that document; it lives here until
 * that file exists, and should move (not be duplicated) when it does.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A place name resolved to coordinates. */
export interface Place {
  /** Canonical display name, e.g. "Gulshan 1". */
  name: string;
  /** Full name from the source, e.g. the Nominatim display string. */
  displayName: string;
  location: LatLng;
  /** 0..1. Below 0.5 the caller must ask the user to disambiguate. */
  confidence: number;
  source: "gazetteer" | "nominatim";
}

/** One leg instruction from the router, kept only for road-name extraction. */
export interface RouteStep {
  /** OSM road name. Null for unnamed service roads and link segments. */
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
}

export interface Route {
  routeId: string;
  /** Derived from the roads carrying the most distance, e.g. "via Mirpur Road". */
  summary: string;
  distanceMeters: number;
  /**
   * The router's free-flow estimate. It knows NOTHING about Dhaka congestion.
   * Never surface this number to the user on its own.
   */
  durationSeconds: number;
  /** Decoded to {lat,lng}. Raw GeoJSON [lng,lat] pairs never cross this boundary. */
  geometry: LatLng[];
  steps: RouteStep[];
  /** Named roads carrying the most distance, longest first. */
  mainRoads: string[];
  /** Gazetteer areas the route passes within `CORRIDOR_RADIUS_METERS` of, in travel order. */
  areasPassed: string[];
}

/** Unscored routes, in the order the router returned them. */
export interface RouteResult {
  origin: Place;
  destination: Place;
  routes: Route[];
}
