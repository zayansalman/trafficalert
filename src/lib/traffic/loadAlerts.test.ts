import { describe, expect, it } from "vitest";
import { hasReports } from "./loadAlerts";

const PLACEHOLDER = `# Traffic Alert Data — 2026-09-12T06:20:50Z

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-09-12T06:20:50Z |
| Status | No live data source configured yet |

## Notes

This file is a placeholder snapshot generated to establish the daily
traffic alert data format.

## Alerts

| Time | Location | Severity | Description |
|---|---|---|---|
| - | - | - | - |
`;

const FACEBOOK_POSTS = `# Traffic Alert BD — Facebook Group Posts

1. **NicePersimmon9429** — 21 minutes ago
   "What's the current traffic condition around Bijoy Soroni?"
   1.1. **GlowingRabbit6631** — 19m
        "it's clear now."
`;

const FILLED_TABLE = `## Alerts

| Time | Location | Severity | Description |
|---|---|---|---|
| 11:35 | Bijoy Sarani | high | Stuck since early morning |
`;

describe("hasReports", () => {
  it("rejects a placeholder snapshot, even though it has filled tables elsewhere", () => {
    expect(hasReports(PLACEHOLDER)).toBe(false);
  });

  it("accepts Facebook posts", () => {
    expect(hasReports(FACEBOOK_POSTS)).toBe(true);
  });

  it("accepts an Alerts table with a real row", () => {
    expect(hasReports(FILLED_TABLE)).toBe(true);
  });

  it("ignores rows outside the Alerts section", () => {
    expect(hasReports("## Notes\n\n| Field | Value |\n|---|---|\n| Status | none |\n")).toBe(false);
  });

  it("stops counting at the next heading", () => {
    const content = `## Alerts

| Time | Location |
|---|---|
| - | - |

## Notes

| Field | Value |
|---|---|
| Status | none |
`;
    expect(hasReports(content)).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(hasReports("")).toBe(false);
  });
});
