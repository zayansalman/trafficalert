import { describe, expect, it } from "vitest";
import { haversineMeters, nearestVertex } from "./distance";

describe("haversineMeters", () => {
  it("measures one degree of latitude as ~111.2 km", () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });

  it("is zero for a point against itself", () => {
    expect(haversineMeters({ lat: 23.78, lng: 90.41 }, { lat: 23.78, lng: 90.41 })).toBe(0);
  });

  it("is symmetric", () => {
    const a = { lat: 23.7806, lng: 90.4142 };
    const b = { lat: 23.7539, lng: 90.3746 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("puts Gulshan 1 and Dhanmondi 27 about 5 km apart in a straight line", () => {
    const metres = haversineMeters(
      { lat: 23.7806, lng: 90.4142 },
      { lat: 23.7539, lng: 90.3746 },
    );
    expect(metres).toBeGreaterThan(4_500);
    expect(metres).toBeLessThan(5_500);
  });
});

describe("nearestVertex", () => {
  const path = [
    { lat: 23.78, lng: 90.41 },
    { lat: 23.77, lng: 90.4 },
    { lat: 23.76, lng: 90.39 },
  ];

  it("returns the index of the closest vertex", () => {
    expect(nearestVertex({ lat: 23.7701, lng: 90.4001 }, path).index).toBe(1);
  });

  it("reports the distance to that vertex", () => {
    const { distanceMeters } = nearestVertex({ lat: 23.76, lng: 90.39 }, path);
    expect(distanceMeters).toBeCloseTo(0, 6);
  });

  it("reports no match for an empty path", () => {
    expect(nearestVertex({ lat: 23.78, lng: 90.41 }, [])).toEqual({
      index: -1,
      distanceMeters: Infinity,
    });
  });
});
