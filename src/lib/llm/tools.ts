import type OpenAI from "openai";
import { getRoute, PlaceNotFoundError } from "@/lib/routing/getRoute";
import { RoutingError } from "@/lib/routing/osrm";
import { addReport } from "@/lib/traffic/reportStore";
import type { Place, Route } from "@/types/routing";

export const GET_ROUTE_TOOL = "get_route";
export const SUBMIT_REPORT_TOOL = "submit_report";

const SEVERITIES = ["low", "medium", "high"] as const;
type Severity = (typeof SEVERITIES)[number];

/** Per-request state a tool may need. */
export interface ToolContext {
  sessionId: string;
}

/** Below this the assistant should name the place it assumed so the user can correct it. */
const UNCERTAIN_MATCH_CONFIDENCE = 0.8;

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: GET_ROUTE_TOOL,
      description:
        "Look up the driving route between two places in or around Dhaka using OpenStreetMap. " +
        "Returns the named roads and the areas each route passes through, its distance, and a " +
        "free-flow travel time that ignores congestion entirely. Call this whenever the user " +
        "asks about getting from one place to another, so you know which roads to check the " +
        "traffic reports against.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: 'Where the journey starts, as the user named it, e.g. "Gulshan 1".',
          },
          destination: {
            type: "string",
            description: 'Where the journey ends, e.g. "Dhanmondi 27".',
          },
        },
        required: ["origin", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: SUBMIT_REPORT_TOOL,
      description:
        "Store a user-submitted traffic report. Call this ONLY after the user has confirmed " +
        "the details you summarised back to them.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description:
              "The road, intersection, or area name in Dhaka (e.g. 'Mirpur Road near Shewrapara')",
          },
          severity: {
            type: "string",
            enum: [...SEVERITIES],
            description:
              "low = slow but moving, medium = significant delays / stop-and-go, " +
              "high = gridlocked / road blocked / accident",
          },
          description: {
            type: "string",
            description:
              "Short plain-English summary of what the user reported (e.g. 'Heavy traffic due to road construction')",
          },
        },
        required: ["location", "severity", "description"],
      },
    },
  },
];

function describePlace(place: Place, query: string) {
  const resolved: Record<string, unknown> = { name: place.name };
  if (place.confidence < UNCERTAIN_MATCH_CONFIDENCE) {
    resolved.uncertain = true;
    resolved.interpretedFrom = query;
  }
  return resolved;
}

function describeRoute(route: Route, index: number) {
  return {
    option: index + 1,
    summary: route.summary,
    distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
    freeFlowMinutes: Math.round(route.durationSeconds / 60),
    roads: route.mainRoads,
    areas: route.areasPassed,
  };
}

interface RouteArgs {
  origin?: unknown;
  destination?: unknown;
}

/**
 * Run `get_route` and render the outcome for the model.
 *
 * Every failure comes back as a normal result describing what went wrong, never as a thrown
 * error: the model can still answer usefully from the traffic reports alone, and a thrown
 * error would cost the user their whole reply.
 */
export async function runGetRoute(rawArgs: string): Promise<string> {
  let args: RouteArgs;
  try {
    args = JSON.parse(rawArgs) as RouteArgs;
  } catch {
    return JSON.stringify({ error: "bad_arguments" });
  }

  const origin = typeof args.origin === "string" ? args.origin.trim() : "";
  const destination =
    typeof args.destination === "string" ? args.destination.trim() : "";

  if (!origin || !destination) {
    return JSON.stringify({
      error: "missing_place",
      hint: "Ask the user for whichever of the start or destination is missing.",
    });
  }

  try {
    const result = await getRoute(origin, destination);

    return JSON.stringify({
      origin: describePlace(result.origin, origin),
      destination: describePlace(result.destination, destination),
      routes: result.routes.map(describeRoute),
      note:
        "freeFlowMinutes is an empty-road estimate from OpenStreetMap and takes no account " +
        "of Dhaka traffic. Never present it as an arrival time. Judge conditions only from " +
        "the traffic reports, matching them against the roads and areas listed here.",
    });
  } catch (err) {
    if (err instanceof PlaceNotFoundError) {
      return JSON.stringify({
        error: "place_not_found",
        field: err.field,
        query: err.query,
        suggestions: err.candidates.slice(0, 3).map((c) => c.name),
        hint: "Ask the user to confirm which place they mean.",
      });
    }

    if (err instanceof RoutingError && err.code === "no_route") {
      return JSON.stringify({
        error: "no_route",
        hint: "Tell the user no drivable route was found between those two places.",
      });
    }

    console.error("[llm/tools] get_route failed", err);
    return JSON.stringify({
      error: "routing_unavailable",
      origin,
      destination,
      hint:
        "The route lookup is down. Say so, then answer from the traffic reports for the " +
        "start and destination areas without claiming to know the roads in between.",
    });
  }
}

interface ReportArgs {
  location?: unknown;
  severity?: unknown;
  description?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Store a traffic report the user has confirmed.
 *
 * Like `get_route`, failures come back as results rather than exceptions so the assistant can
 * tell the user their report did not save instead of the request dying.
 */
export async function runSubmitReport(
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  let args: ReportArgs;
  try {
    args = JSON.parse(rawArgs) as ReportArgs;
  } catch {
    return JSON.stringify({ error: "bad_arguments" });
  }

  const location = text(args.location);
  const description = text(args.description);
  const severity = text(args.severity).toLowerCase() as Severity;

  if (!location || !description || !SEVERITIES.includes(severity)) {
    return JSON.stringify({
      error: "incomplete_report",
      hint: "Ask the user for whichever of the location, severity or description is missing.",
    });
  }

  try {
    const report = await addReport({
      location,
      severity,
      description,
      sessionId: ctx.sessionId,
    });

    return JSON.stringify({
      success: true,
      id: report.id,
      location: report.location,
      severity: report.severity,
      description: report.description,
    });
  } catch (err) {
    console.error("[llm/tools] submit_report failed", err);
    return JSON.stringify({
      error: "report_not_saved",
      hint: "Tell the user the report could not be saved and they can try again.",
    });
  }
}

/** Dispatch a tool call by name. Unknown names are reported back, not thrown. */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  if (name === GET_ROUTE_TOOL) return runGetRoute(rawArgs);
  if (name === SUBMIT_REPORT_TOOL) return runSubmitReport(rawArgs, ctx);
  return JSON.stringify({ error: "unknown_tool", name });
}
