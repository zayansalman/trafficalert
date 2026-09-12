import { getDb, ensureSchema } from "@/lib/db";
import { getFreshness, formatAge, formatDhakaTime } from "./timestamps";

export interface UserReport {
  id: string;
  location: string;
  severity: "low" | "medium" | "high";
  description: string;
  timestamp: string; // ISO 8601
  sessionId: string;
}

export async function addReport(
  report: Omit<UserReport, "id" | "timestamp">,
): Promise<UserReport> {
  await ensureSchema();

  const entry: UserReport = {
    ...report,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  await getDb().execute({
    sql: `INSERT INTO user_reports (id, location, severity, description, timestamp, session_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [entry.id, entry.location, entry.severity, entry.description, entry.timestamp, entry.sessionId],
  });

  return entry;
}

/** Load user reports and format them as context for the system prompt. */
export async function loadUserReportContext(): Promise<string> {
  await ensureSchema();

  const result = await getDb().execute(
    "SELECT id, location, severity, description, timestamp, session_id FROM user_reports ORDER BY timestamp DESC",
  );

  if (result.rows.length === 0) return "";

  const now = new Date();
  const lines: string[] = ["## User-Submitted Reports"];

  for (const row of result.rows) {
    const postTime = new Date(row.timestamp as string);
    const { label } = getFreshness(postTime, now);
    const age = formatAge((now.getTime() - postTime.getTime()) / 60_000);
    const time = formatDhakaTime(postTime);

    lines.push(
      `- **${row.location}** — ${row.severity} severity — "${row.description}"`,
      `  [Freshness: ${label} — reported ${age}, at ${time}] (user report)`,
    );
  }

  return lines.join("\n");
}
