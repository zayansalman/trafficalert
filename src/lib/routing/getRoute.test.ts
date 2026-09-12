import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getRoute, PlaceNotFoundError } from "./getRoute";
import { jsonResponse, okResponse } from "./osrm.fixture";

/**
 * Serves routes and fails every geocoder call, so an unresolvable name falls through to the
 * gazetteer's own suggestions. `routerCalls` counts requests to the router alone.
 */
function stubNetwork() {
  const fetchSpy = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (!url.includes("/route/v1/")) throw new Error(`offline in tests: ${url}`);
    return jsonResponse(okResponse());
  });
  vi.stubGlobal("fetch", fetchSpy);

  return {
    routerCalls: () =>
      fetchSpy.mock.calls.filter(([input]) => String(input).includes("/route/v1/")).length,
  };
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
});

describe("getRoute", () => {
  it("resolves both place names and returns routes between them", async () => {
    stubNetwork();
    const result = await getRoute("gulshan 1", "dhanmondi 27");

    expect(result.origin.name).toBe("Gulshan 1");
    expect(result.destination.name).toBe("Dhanmondi 27");
    expect(result.routes).toHaveLength(1);
  });

  it("serves a repeated lookup from cache instead of calling the router again", async () => {
    const { routerCalls } = stubNetwork();

    await getRoute("Mirpur 10", "Motijheel");
    expect(routerCalls()).toBe(1);

    await getRoute("mirpur-10", "motijheel");
    expect(routerCalls()).toBe(1);
  });

  it("treats a different journey as a different lookup", async () => {
    const { routerCalls } = stubNetwork();

    await getRoute("Uttara", "Banani");
    await getRoute("Uttara", "Farmgate");

    expect(routerCalls()).toBe(2);
  });

  it("names the origin when only the origin is unknown", async () => {
    stubNetwork();
    const error = await getRoute("qqqzzz", "Dhanmondi 27").catch((e) => e);

    expect(error).toBeInstanceOf(PlaceNotFoundError);
    expect(error.field).toBe("origin");
    expect(error.query).toBe("qqqzzz");
  });

  it("names the destination when only the destination is unknown", async () => {
    stubNetwork();
    const error = await getRoute("Gulshan 1", "qqqzzz").catch((e) => e);

    expect(error.field).toBe("destination");
  });

  it("reports the origin first when neither place is known", async () => {
    stubNetwork();
    const error = await getRoute("qqqzzz", "wwwyyy").catch((e) => e);

    expect(error.field).toBe("origin");
  });

  it("asks rather than guessing when the name is only a fragment", async () => {
    stubNetwork();
    // "27" fits Dhanmondi 27, but not well enough to send someone there unprompted.
    const error = await getRoute("Gulshan 1", "27").catch((e) => e);

    expect(error).toBeInstanceOf(PlaceNotFoundError);
    expect(error.candidates.map((c: { name: string }) => c.name)).toContain("Dhanmondi 27");
  });

  it("offers every candidate when an ambiguous name fits several places", async () => {
    stubNetwork();
    const error = await getRoute("Gulshan 1", "mirpur").catch((e) => e);

    const names = error.candidates.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Mirpur 1", "Mirpur 10", "Mirpur 12"]));
  });

  it("never calls the router when a place cannot be resolved", async () => {
    const { routerCalls } = stubNetwork();
    await getRoute("qqqzzz", "wwwyyy").catch(() => undefined);

    expect(routerCalls()).toBe(0);
  });
});
