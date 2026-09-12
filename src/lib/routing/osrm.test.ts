import { afterEach, describe, expect, it, vi } from "vitest";
import { CORRIDOR_RADIUS_METERS, fetchRoutes, RoutingError } from "./osrm";
import { jsonResponse, okResponse } from "./osrm.fixture";

const GULSHAN_1 = { lat: 23.7806, lng: 90.4142 };
const DHANMONDI_27 = { lat: 23.7539, lng: 90.3746 };

function stubOsrm(body: unknown, status = 200) {
  const fetchSpy = vi.fn(async () => jsonResponse(body, status));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRoutes request", () => {
  it("asks for alternatives, steps and full geometry", async () => {
    const fetchSpy = stubOsrm(okResponse());
    await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    const [url] = fetchSpy.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("alternatives")).toBe("3");
    expect(url.searchParams.get("steps")).toBe("true");
    expect(url.searchParams.get("overview")).toBe("full");
    expect(url.searchParams.get("geometries")).toBe("geojson");
  });

  it("sends coordinates as lng,lat, the order OSRM expects", async () => {
    const fetchSpy = stubOsrm(okResponse());
    await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    const [url] = fetchSpy.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toContain("90.4142,23.7806;90.3746,23.7539");
  });
});

describe("fetchRoutes parsing", () => {
  it("keeps the distance and free-flow duration", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    expect(route.distanceMeters).toBe(9400);
    expect(route.durationSeconds).toBe(1320);
  });

  it("lists roads by the distance they carry, longest first", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    expect(route.mainRoads).toEqual([
      "Mirpur Road",
      "Bir Uttam Ziaur Rahman Road",
      "Manik Mia Avenue",
      "Gulshan Avenue",
      "Mohakhali Flyover",
    ]);
  });

  it("drops unnamed link segments", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    expect(route.mainRoads).not.toContain("");
    expect(route.steps.some((s) => s.name === null)).toBe(true);
  });

  it("caps the road list so it stays readable", async () => {
    const body = okResponse();
    body.routes[0].legs[0].steps = Array.from({ length: 12 }, (_, i) => ({
      name: `Road ${i}`,
      distance: 100 * (12 - i),
      duration: 60,
    }));
    stubOsrm(body);

    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);
    expect(route.mainRoads).toHaveLength(6);
    expect(route.mainRoads[0]).toBe("Road 0");
  });

  it("adds up distance per road rather than per step", async () => {
    const body = okResponse();
    body.routes[0].legs[0].steps = [
      { name: "Short Street", distance: 900, duration: 60 },
      { name: "Mirpur Road", distance: 500, duration: 60 },
      { name: "Mirpur Road", distance: 500, duration: 60 },
    ];
    stubOsrm(body);

    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);
    expect(route.mainRoads[0]).toBe("Mirpur Road");
  });

  it("summarises with the two biggest roads", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    expect(route.summary).toBe("via Mirpur Road and Bir Uttam Ziaur Rahman Road");
  });

  it("says so when the route has no named roads at all", async () => {
    const body = okResponse();
    body.routes[0].legs[0].steps = [{ name: "", distance: 400, duration: 60 }];
    stubOsrm(body);

    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);
    expect(route.summary).toBe("unnamed local roads");
    expect(route.mainRoads).toEqual([]);
  });

  it("decodes GeoJSON into {lat, lng} so no caller sees lng-first pairs", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    expect(route.geometry[0]).toEqual({ lat: 23.7806, lng: 90.4142 });
    expect(route.geometry.at(-1)).toEqual({ lat: 23.7539, lng: 90.3746 });
  });
});

describe("corridor detection", () => {
  it("lists the areas the route runs through, in travel order", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    for (const area of ["Gulshan 1", "Mohakhali", "Bijoy Sarani", "Manik Mia Avenue", "Dhanmondi 27"]) {
      expect(route.areasPassed).toContain(area);
    }
    expect(route.areasPassed.indexOf("Gulshan 1")).toBeLessThan(
      route.areasPassed.indexOf("Dhanmondi 27"),
    );
  });

  it("leaves out areas nowhere near the route", async () => {
    stubOsrm(okResponse());
    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);

    for (const area of ["Uttara", "Mirpur 10", "Jatrabari", "Savar", "Narayanganj"]) {
      expect(route.areasPassed).not.toContain(area);
    }
  });

  it("reports nothing for an empty geometry instead of failing", async () => {
    const body = okResponse();
    body.routes[0].geometry = { coordinates: [] };
    stubOsrm(body);

    const [route] = await fetchRoutes(GULSHAN_1, DHANMONDI_27);
    expect(route.areasPassed).toEqual([]);
  });

  it("uses a radius wide enough to absorb the gazetteer's own imprecision", () => {
    expect(CORRIDOR_RADIUS_METERS).toBeGreaterThanOrEqual(500);
    expect(CORRIDOR_RADIUS_METERS).toBeLessThanOrEqual(1_000);
  });
});

describe("fetchRoutes failures", () => {
  it("raises no_route when the router cannot connect the points", async () => {
    stubOsrm({ code: "NoRoute", message: "no route" });

    await expect(fetchRoutes(GULSHAN_1, DHANMONDI_27)).rejects.toMatchObject({
      name: "RoutingError",
      code: "no_route",
    });
  });

  it("raises no_route when the response carries no routes", async () => {
    stubOsrm({ code: "Ok", routes: [] });

    await expect(fetchRoutes(GULSHAN_1, DHANMONDI_27)).rejects.toMatchObject({ code: "no_route" });
  });

  it("raises unavailable on an HTTP error", async () => {
    stubOsrm({}, 503);

    await expect(fetchRoutes(GULSHAN_1, DHANMONDI_27)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("raises unavailable when the service cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });

    const error = await fetchRoutes(GULSHAN_1, DHANMONDI_27).catch((e) => e);
    expect(error).toBeInstanceOf(RoutingError);
    expect(error.code).toBe("unavailable");
  });
});
