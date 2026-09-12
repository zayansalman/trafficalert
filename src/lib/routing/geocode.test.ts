import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MIN_USABLE_CONFIDENCE, resolvePlace, searchGazetteer, searchNominatim } from "./geocode";
import { jsonResponse } from "./osrm.fixture";

// The geocoder leaves a one-second cool-off pending after every Nominatim call, as their usage
// policy requires. Fake timers let each test skip that wait without weakening the real gap;
// it has to be flushed while the fake clock is still installed, or the next call blocks on a
// timer that will never fire.
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

describe("searchGazetteer", () => {
  it.each([
    ["Dhanmondi 27", "Dhanmondi 27"],
    ["dhanmondi", "Dhanmondi"],
    ["gulshan 1", "Gulshan 1"],
    ["Gulshan-2", "Gulshan 2"],
    ["mirpur 10", "Mirpur 10"],
    ["manik mia avenue", "Manik Mia Avenue"],
  ])("resolves %j to %j", (query, expected) => {
    expect(searchGazetteer(query)[0]?.name).toBe(expected);
  });

  it.each([
    ["bijoy soroni", "Bijoy Sarani"],
    ["kawran bazar", "Karwan Bazar"],
    ["zigatola", "Jigatola"],
  ])("resolves the Banglish spelling %j to %j", (query, expected) => {
    expect(searchGazetteer(query)[0]?.name).toBe(expected);
  });

  it("finds a place named inside a longer sentence", () => {
    expect(searchGazetteer("i am heading to bijoy soroni now")[0]?.name).toBe("Bijoy Sarani");
  });

  it("matches on word boundaries, so 'mirpur 1' is not 'Mirpur 10'", () => {
    expect(searchGazetteer("mirpur 1")[0]?.name).toBe("Mirpur 1");
  });

  it("prefers the more specific entry", () => {
    const names = searchGazetteer("dhanmondi 27").map((p) => p.name);
    expect(names.indexOf("Dhanmondi 27")).toBeLessThan(names.indexOf("Dhanmondi"));
  });

  it("resolves an alias that is a fragment of the full name", () => {
    const top = searchGazetteer("hazrat shahjalal")[0];
    expect(top?.name).toBe("Airport");
    expect(top?.confidence).toBeGreaterThanOrEqual(MIN_USABLE_CONFIDENCE);
  });

  it("scores a bare fragment too low to route on", () => {
    expect(searchGazetteer("mirpur")[0].confidence).toBeLessThan(MIN_USABLE_CONFIDENCE);
    expect(searchGazetteer("27")[0].confidence).toBeLessThan(MIN_USABLE_CONFIDENCE);
  });

  it("still offers every place an ambiguous fragment could mean", () => {
    const names = searchGazetteer("mirpur").map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Mirpur 1", "Mirpur 10", "Mirpur 12"]));
  });

  it("returns nothing for an unknown name", () => {
    expect(searchGazetteer("qqqzzz")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchGazetteer("   ")).toEqual([]);
  });

  it("never touches the network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    searchGazetteer("gulshan 1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("searchNominatim", () => {
  it("restricts the search to Bangladesh and identifies itself", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    await searchNominatim("some unlisted place");

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("countrycodes")).toBe("bd");
    expect(url.searchParams.get("format")).toBe("jsonv2");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/trafficalert/);
  });

  it("keeps its confidence below a gazetteer match", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse([{ name: "Somewhere", display_name: "Somewhere, Dhaka", lat: "23.7", lon: "90.4" }]),
    );

    const [place] = await searchNominatim("somewhere unlisted");
    expect(place.source).toBe("nominatim");
    expect(place.confidence).toBeLessThan(1);
    expect(place.confidence).toBeGreaterThanOrEqual(MIN_USABLE_CONFIDENCE);
  });

  it("drops results with unusable coordinates", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse([{ name: "Broken", lat: "not-a-number", lon: "90.4" }]),
    );

    expect(await searchNominatim("broken coordinates place")).toEqual([]);
  });

  it("returns nothing rather than throwing when the geocoder is down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    await expect(searchNominatim("an unreachable lookup")).resolves.toEqual([]);
  });
});

describe("resolvePlace", () => {
  it("answers from the gazetteer without a network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const [place] = await resolvePlace("Dhanmondi 27");

    expect(place.name).toBe("Dhanmondi 27");
    expect(place.source).toBe("gazetteer");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the geocoder when the gazetteer has nothing", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse([{ name: "Kotalipara", display_name: "Kotalipara, Bangladesh", lat: "23.0", lon: "89.9" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const [place] = await resolvePlace("Kotalipara");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(place.name).toBe("Kotalipara");
  });
});
