import type { LatLng } from "@/types/routing";

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres. Accurate to well under a metre at city scale. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export interface NearestVertex {
  /** Position in the path, which doubles as travel order along a route. */
  index: number;
  distanceMeters: number;
}

/**
 * Closest vertex of `path` to `point`.
 *
 * Vertex distance rather than true perpendicular distance to each segment: route geometry
 * requested at full overview carries every shape point, so the two agree to within a few
 * metres on city roads — far inside the tolerance of any caller here.
 */
export function nearestVertex(point: LatLng, path: LatLng[]): NearestVertex {
  let index = -1;
  let distanceMeters = Infinity;

  for (let i = 0; i < path.length; i++) {
    const d = haversineMeters(point, path[i]);
    if (d < distanceMeters) {
      distanceMeters = d;
      index = i;
    }
  }

  return { index, distanceMeters };
}
