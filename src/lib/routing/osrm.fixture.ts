/**
 * Canned OSRM payloads for tests. Imported only from `*.test.ts`.
 *
 * The public OSRM instance is a shared best-effort service; tests that depended on it would be
 * slow and would fail for reasons that have nothing to do with this code.
 */
import { haversineMeters } from "@/lib/geo/distance";

/** Gulshan 1 → Mohakhali → Tejgaon → Bijoy Sarani → Manik Mia → Dhanmondi 27, as [lng, lat]. */
export const GULSHAN_TO_DHANMONDI: [number, number][] = [
  [90.4142, 23.7806],
  [90.4058, 23.7776],
  [90.395, 23.765],
  [90.3853, 23.7639],
  [90.379, 23.7625],
  [90.3746, 23.7539],
];

/**
 * Fill in intermediate points at roughly `spacingMeters`, the way `overview=full` returns
 * every shape point rather than just the turns.
 */
export function densify(
  waypoints: [number, number][],
  spacingMeters = 50,
): [number, number][] {
  const out: [number, number][] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lng1, lat1] = waypoints[i];
    const [lng2, lat2] = waypoints[i + 1];
    const span = haversineMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    const steps = Math.max(1, Math.round(span / spacingMeters));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t]);
    }
  }

  out.push(waypoints[waypoints.length - 1]);
  return out;
}

/** A one-route OSRM response following the corridor above. */
export function okResponse() {
  return {
    code: "Ok",
    routes: [
      {
        distance: 9400,
        duration: 1320,
        geometry: { coordinates: densify(GULSHAN_TO_DHANMONDI) },
        legs: [
          {
            steps: [
              { name: "Gulshan Avenue", distance: 1200, duration: 180 },
              { name: "", distance: 90, duration: 15 },
              { name: "Mohakhali Flyover", distance: 800, duration: 90 },
              { name: "Bir Uttam Ziaur Rahman Road", distance: 2600, duration: 380 },
              { name: "Manik Mia Avenue", distance: 1800, duration: 240 },
              { name: "Mirpur Road", distance: 2910, duration: 415 },
            ],
          },
        ],
      },
    ],
  };
}

/** Stands in for `fetch`, asserting nothing but the routing host is contacted. */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
