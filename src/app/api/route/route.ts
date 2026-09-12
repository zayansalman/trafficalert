import { NextRequest, NextResponse } from "next/server";
import { getRoute, PlaceNotFoundError } from "@/lib/routing/getRoute";
import { RoutingError } from "@/lib/routing/osrm";

export const runtime = "nodejs";

/**
 * `GET /api/route?from=Gulshan%201&to=Dhanmondi%2027`
 *
 * The routing layer on its own, with no model in the loop — the way to tell a geocoding or
 * OSRM problem apart from a prompting one. Pass `geometry=1` for the full polyline
 * (thousands of points; intended for drawing a map, not for reading).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  const withGeometry = params.get("geometry") === "1";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Both 'from' and 'to' query parameters are required." },
      { status: 400 },
    );
  }

  try {
    const result = await getRoute(from, to);

    return NextResponse.json({
      origin: result.origin,
      destination: result.destination,
      routes: result.routes.map((route) => ({
        routeId: route.routeId,
        summary: route.summary,
        distanceMeters: Math.round(route.distanceMeters),
        freeFlowSeconds: Math.round(route.durationSeconds),
        mainRoads: route.mainRoads,
        areasPassed: route.areasPassed,
        ...(withGeometry ? { geometry: route.geometry } : {}),
      })),
      attribution: "Routing and place data © OpenStreetMap contributors (ODbL).",
    });
  } catch (err) {
    if (err instanceof PlaceNotFoundError) {
      return NextResponse.json(
        {
          error: `Could not find "${err.query}".`,
          field: err.field,
          suggestions: err.candidates.slice(0, 3).map((c) => c.name),
        },
        { status: 404 },
      );
    }

    if (err instanceof RoutingError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.code === "no_route" ? 404 : 502 },
      );
    }

    console.error("[api/route] unexpected failure", err);
    return NextResponse.json({ error: "Route lookup failed." }, { status: 500 });
  }
}
