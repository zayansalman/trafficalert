const DHAKA_TZ = "Asia/Dhaka";

export function parseCompileTime(filename: string): Date | null {
  const match = filename.match(
    /(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z/,
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

export function parseRelativeTimestamp(
  raw: string,
  compileTime: Date,
): Date | null {
  const t = raw.trim().toLowerCase();

  // "19m" or "21 minutes ago"
  let m = t.match(/^~?(\d+)\s*m(?:inutes?\s*ago)?$/);
  if (m) return new Date(compileTime.getTime() - +m[1] * 60_000);

  // "about an hour ago"
  if (/^about an hour ago$/.test(t))
    return new Date(compileTime.getTime() - 3600_000);

  // "~1h ago", "4h", "13 hours ago", "~13h ago (same time as post)"
  m = t.match(/^~?(\d+)\s*h(?:ours?\s*ago)?/);
  if (m) return new Date(compileTime.getTime() - +m[1] * 3600_000);

  // "~1-2h ago", "~10-11h ago" — use midpoint
  m = t.match(/^~?(\d+)-(\d+)\s*h\s*ago/);
  if (m) {
    const mid = (+m[1] + +m[2]) / 2;
    return new Date(compileTime.getTime() - mid * 3600_000);
  }

  // "a day ago"
  if (/^a day ago/.test(t))
    return new Date(compileTime.getTime() - 24 * 3600_000);

  // "1d", "2d"
  m = t.match(/^(\d+)d$/);
  if (m) return new Date(compileTime.getTime() - +m[1] * 24 * 3600_000);

  // "2 days ago"
  m = t.match(/^(\d+)\s*days?\s*ago/);
  if (m) return new Date(compileTime.getTime() - +m[1] * 24 * 3600_000);

  // "Sep 10", "Sep 11" — same year as compile time
  m = t.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})/);
  if (m) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const d = new Date(compileTime);
    d.setUTCMonth(months[m[1]], +m[2]);
    d.setUTCHours(12, 0, 0, 0);
    return d;
  }

  return null;
}

export interface FreshnessInfo {
  ageMinutes: number;
  label: string;
}

export function getFreshness(postTime: Date, now: Date): FreshnessInfo {
  const ageMinutes = Math.max(0, (now.getTime() - postTime.getTime()) / 60_000);

  let label: string;
  if (ageMinutes < 30) label = "FRESH (under 30 min)";
  else if (ageMinutes < 120) label = "RECENT (1-2 hours)";
  else if (ageMinutes < 360) label = "FEW HOURS OLD";
  else if (ageMinutes < 720) label = "HALF DAY OLD — may be outdated";
  else if (ageMinutes < 1440) label = "~1 DAY OLD — likely outdated for incidents";
  else label = "STALE (>1 day) — probably resolved";

  return { ageMinutes, label };
}

export function formatAge(ageMinutes: number): string {
  if (ageMinutes < 60) return `~${Math.round(ageMinutes)} min ago`;
  if (ageMinutes < 1440) return `~${Math.round(ageMinutes / 60)} hours ago`;
  const days = Math.round(ageMinutes / 1440);
  return `~${days} day${days > 1 ? "s" : ""} ago`;
}

export function formatDhakaTime(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: DHAKA_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
