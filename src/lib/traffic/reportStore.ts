import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { getFreshness, formatAge, formatDhakaTime } from "./timestamps";

// JSON-file store — works locally, read-only on Vercel.
// TODO (#12): swap for Turso (libsql) so reports persist in production.
const REPORTS_PATH = path.join(process.cwd(), "data", "user-reports.json");

export interface UserReport {
  id: string;
  location: string;
  severity: "low" | "medium" | "high";
  description: string;
  timestamp: string; // ISO 8601
  sessionId: string;
}

async function readReports(): Promise<UserReport[]> {
  try {
    const raw = await readFile(REPORTS_PATH, "utf-8");
    return JSON.parse(raw) as UserReport[];
  } catch {
    return [];
  }
}

async function writeReports(reports: UserReport[]): Promise<void> {
  await mkdir(path.dirname(REPORTS_PATH), { recursive: true });
  await writeFile(REPORTS_PATH, JSON.stringify(reports, null, 2) + "\n", "utf-8");
}

export async function addReport(
  report: Omit<UserReport, "id" | "timestamp">,
): Promise<UserReport> {
  const reports = await readReports();
  const entry: UserReport = {
    ...report,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  reports.push(entry);

  try {
    await writeReports(reports);
  } catch (err) {
    // On Vercel the filesystem is read-only — log but don't crash.
    // The report object is still returned so the LLM can confirm to the user.
    console.warn("[reportStore] write failed (read-only fs?)", err);
  }

  return entry;
}

/** Load user reports and format them as context for the system prompt. */
export async function loadUserReportContext(): Promise<string> {
  const reports = await readReports();
  if (reports.length === 0) return "";

  const now = new Date();
  const lines: string[] = ["## User-Submitted Reports"];

  for (const r of reports) {
    const postTime = new Date(r.timestamp);
    const { label } = getFreshness(postTime, now);
    const age = formatAge((now.getTime() - postTime.getTime()) / 60_000);
    const time = formatDhakaTime(postTime);

    lines.push(
      `- **${r.location}** — ${r.severity} severity — "${r.description}"`,
      `  [Freshness: ${label} — reported ${age}, at ${time}] (user report)`,
    );
  }

  return lines.join("\n");
}
