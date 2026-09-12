import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { jsonResponse, okResponse } from "@/lib/routing/osrm.fixture";
import { addReport } from "@/lib/traffic/reportStore";
import {
  GET_ROUTE_TOOL,
  SUBMIT_REPORT_TOOL,
  runGetRoute,
  runSubmitReport,
  runTool,
  type ToolContext,
} from "./tools";

// The real store writes into data/, which a unit test has no business touching.
vi.mock("@/lib/traffic/reportStore", () => ({
  addReport: vi.fn(async (report: Record<string, unknown>) => ({
    ...report,
    id: "report-1",
    timestamp: "2026-09-12T06:00:00Z",
  })),
}));

const CTX: ToolContext = { sessionId: "session-abc" };

interface Stub {
  /** Geocoder results, or null to make the geocoder fail. */
  geocoder?: unknown[] | null;
  /** OSRM body, or "down" to make the router unreachable. */
  router?: unknown | "down";
}

function stubNetwork({ geocoder = null, router = okResponse() }: Stub = {}) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);

    if (url.includes("/route/v1/")) {
      if (router === "down") throw new Error("offline in tests");
      return jsonResponse(router);
    }

    if (geocoder === null) throw new Error("offline in tests");
    return jsonResponse(geocoder);
  });
}

function call(args: Record<string, unknown>) {
  return runGetRoute(JSON.stringify(args)).then((raw) => JSON.parse(raw));
}

// Skips the geocoder's rate-limit cool-off; see the note in geocode.test.ts.
beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(2_000);
  vi.unstubAllGlobals();
  vi.mocked(addReport).mockClear();
});

describe("get_route success", () => {
  it("returns the roads and areas the drive uses", async () => {
    stubNetwork();
    const result = await call({ origin: "Gulshan 1", destination: "Dhanmondi 27" });

    expect(result.origin.name).toBe("Gulshan 1");
    expect(result.destination.name).toBe("Dhanmondi 27");
    expect(result.routes[0].roads).toContain("Mirpur Road");
    expect(result.routes[0].areas).toContain("Bijoy Sarani");
  });

  it("reports distance in km and free-flow time in whole minutes", async () => {
    stubNetwork();
    const [route] = (await call({ origin: "Banani", destination: "Shahbagh" })).routes;

    expect(route.option).toBe(1);
    expect(route.distanceKm).toBe(9.4);
    expect(route.freeFlowMinutes).toBe(22);
  });

  it("withholds the raw geometry, which the model has no use for", async () => {
    stubNetwork();
    const [route] = (await call({ origin: "Mohakhali", destination: "Motijheel" })).routes;

    expect(route).not.toHaveProperty("geometry");
    expect(route).not.toHaveProperty("steps");
  });

  it("warns that the free-flow time is not an arrival time", async () => {
    stubNetwork();
    const result = await call({ origin: "Uttara", destination: "Farmgate" });

    expect(result.note).toMatch(/never present it as an arrival time/i);
  });

  it("leaves a confident gazetteer match unflagged", async () => {
    stubNetwork();
    const result = await call({ origin: "Gulshan 2", destination: "Jigatola" });

    expect(result.origin.uncertain).toBeUndefined();
  });

  it("flags a place the geocoder guessed at, so the assistant can name its assumption", async () => {
    stubNetwork({
      geocoder: [{ name: "Kotalipara", display_name: "Kotalipara", lat: "23.0", lon: "89.9" }],
    });
    const result = await call({ origin: "Kotalipara", destination: "Dhanmondi 27" });

    expect(result.origin).toMatchObject({ uncertain: true, interpretedFrom: "Kotalipara" });
  });
});

describe("get_route failures", () => {
  it("asks which place was meant when the name cannot be resolved", async () => {
    stubNetwork();
    const result = await call({ origin: "Gulshan 1", destination: "mirpur" });

    expect(result.error).toBe("place_not_found");
    expect(result.field).toBe("destination");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.hint).toMatch(/confirm/i);
  });

  it("reports a missing argument rather than routing from nowhere", async () => {
    stubNetwork();
    expect((await call({ origin: "Gulshan 1" })).error).toBe("missing_place");
    expect((await call({ origin: " ", destination: "Banani" })).error).toBe("missing_place");
  });

  it("reports malformed arguments", async () => {
    expect(JSON.parse(await runGetRoute("{oops")).error).toBe("bad_arguments");
  });

  it("reports when no route connects the two places", async () => {
    stubNetwork({ router: { code: "NoRoute", message: "no route" } });
    expect((await call({ origin: "Savar", destination: "Narayanganj" })).error).toBe("no_route");
  });

  it("keeps both place names when the router is down, so reports can still be used", async () => {
    stubNetwork({ router: "down" });
    const result = await call({ origin: "Mirpur 10", destination: "Motijheel" });

    expect(result.error).toBe("routing_unavailable");
    expect(result.origin).toBe("Mirpur 10");
    expect(result.destination).toBe("Motijheel");
    expect(result.hint).toMatch(/traffic reports/i);
  });

  it("never throws, so a routing problem cannot cost the user their reply", async () => {
    stubNetwork({ router: "down" });
    await expect(runGetRoute(JSON.stringify({ origin: "Banani", destination: "Uttara" })))
      .resolves.toBeTypeOf("string");
  });
});

describe("runTool", () => {
  it("dispatches get_route", async () => {
    stubNetwork();
    const result = JSON.parse(
      await runTool(GET_ROUTE_TOOL, JSON.stringify({ origin: "Gulshan 1", destination: "Banani" }), CTX),
    );

    expect(result.routes).toHaveLength(1);
  });

  it("dispatches submit_report", async () => {
    const result = JSON.parse(
      await runTool(
        SUBMIT_REPORT_TOOL,
        JSON.stringify({ location: "Mirpur Road", severity: "high", description: "Gridlocked" }),
        CTX,
      ),
    );

    expect(result.success).toBe(true);
  });

  it("reports an unknown tool instead of throwing", async () => {
    expect(JSON.parse(await runTool("no_such_tool", "{}", CTX))).toEqual({
      error: "unknown_tool",
      name: "no_such_tool",
    });
  });
});

describe("submit_report", () => {
  function submit(args: Record<string, unknown>) {
    return runSubmitReport(JSON.stringify(args), CTX).then((raw) => JSON.parse(raw));
  }

  const VALID = {
    location: "Mirpur Road near Shewrapara",
    severity: "high",
    description: "Gridlocked since morning",
  };

  it("stores a confirmed report and hands back its id", async () => {
    const result = await submit(VALID);

    expect(result).toMatchObject({ success: true, id: "report-1", location: VALID.location });
    expect(addReport).toHaveBeenCalledOnce();
  });

  it("attributes the report to the caller's session", async () => {
    await submit(VALID);

    expect(addReport).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-abc" }));
  });

  it("accepts a severity the model capitalised", async () => {
    expect((await submit({ ...VALID, severity: "High" })).success).toBe(true);
  });

  it.each([
    ["location", { ...VALID, location: "" }],
    ["description", { ...VALID, description: "   " }],
    ["severity", { ...VALID, severity: "catastrophic" }],
  ])("refuses to store a report missing a valid %s", async (_field, args) => {
    expect((await submit(args)).error).toBe("incomplete_report");
    expect(addReport).not.toHaveBeenCalled();
  });

  it("reports malformed arguments", async () => {
    expect(JSON.parse(await runSubmitReport("{oops", CTX)).error).toBe("bad_arguments");
  });

  it("tells the user when the store rejects the write", async () => {
    vi.mocked(addReport).mockRejectedValueOnce(new Error("store down"));

    const result = await submit(VALID);
    expect(result.error).toBe("report_not_saved");
    expect(result.hint).toMatch(/try again/i);
  });
});
