import { readdir, readFile } from "fs/promises";
import path from "path";
import {
  parseCompileTime,
  parseRelativeTimestamp,
  getFreshness,
  formatAge,
  formatDhakaTime,
} from "./timestamps";

const ALERTS_DIR = path.join(process.cwd(), "data", "traffic-alerts");
const MAX_CONTEXT_CHARS = 60_000;

const POST_HEADER_RE =
  /^(\d+)\.\s+\*\*[^*]+\*\*\s*(?:(?:\([^)]*\)\s*)?(?:—|–)\s*)(.+?)\s*$/;

function annotatePost(
  line: string,
  compileTime: Date,
  now: Date,
): string {
  const m = line.match(POST_HEADER_RE);
  if (!m) return line;

  const rawTs = m[2]
    .replace(/\s*\((?:includes|with|feeling|second|same)[^)]*\)/gi, "")
    .replace(/\s*(?:—|–).*$/, "")
    .replace(/,\s*(?:multiple |with )?(?:photos?|video).*$/i, "")
    .trim();

  const postTime = parseRelativeTimestamp(rawTs, compileTime);
  if (!postTime) return line;

  const { label } = getFreshness(postTime, now);
  const age = formatAge(
    (now.getTime() - postTime.getTime()) / 60_000,
  );
  return `${line}\n   [Freshness: ${label} — posted ${age}, approx ${formatDhakaTime(postTime)}]`;
}

const ALERTS_HEADING_RE = /^##\s+alerts\s*$/i;
const HEADING_RE = /^##\s+/;

/** Cells of a markdown table row, or null if the line isn't one. */
function parseRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** True once the Alerts table holds a row that is neither its header, its rule, nor a dash. */
function alertsTableHasRows(lines: string[]): boolean {
  let inAlerts = false;
  let pastHeader = false;

  for (const line of lines) {
    if (ALERTS_HEADING_RE.test(line)) {
      inAlerts = true;
      pastHeader = false;
      continue;
    }
    if (inAlerts && HEADING_RE.test(line)) inAlerts = false;
    if (!inAlerts) continue;

    const cells = parseRow(line);
    if (!cells) continue;

    if (!pastHeader) {
      // The row of dashes separates the header from the body; anything after it is data.
      if (isSeparatorRow(cells)) pastHeader = true;
      continue;
    }

    if (cells.some((cell) => cell !== "" && cell !== "-")) return true;
  }

  return false;
}

/**
 * True when a snapshot carries at least one actual report.
 *
 * Snapshots are sorted newest first, so a placeholder — "No live data source configured yet"
 * over an empty Alerts table — lands at the very top of the model's context and reads as
 * "there is no traffic data", even with hundreds of real reports below it.
 */
export function hasReports(content: string): boolean {
  const lines = content.split("\n");
  return lines.some((line) => POST_HEADER_RE.test(line)) || alertsTableHasRows(lines);
}

function annotateContent(
  content: string,
  compileTime: Date,
  now: Date,
): string {
  const lines = content.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    out.push(annotatePost(line, compileTime, now));
  }

  return out.join("\n");
}

export async function loadTrafficContext(): Promise<string> {
  let files: string[];
  try {
    files = (await readdir(ALERTS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return "";
  }

  files.sort().reverse();

  const now = new Date();
  const sections: string[] = [];
  let total = 0;

  for (const file of files) {
    const raw = await readFile(path.join(ALERTS_DIR, file), "utf-8");
    if (!hasReports(raw)) continue;

    const compileTime = parseCompileTime(file);

    let content: string;
    if (compileTime) {
      const snapshotAge = Math.round(
        (now.getTime() - compileTime.getTime()) / 60_000,
      );
      const header = `[Snapshot captured: ${formatDhakaTime(compileTime)} — ${formatAge(snapshotAge)} from now]`;
      content = header + "\n" + annotateContent(raw, compileTime, now);
    } else {
      content = raw;
    }

    if (total + content.length > MAX_CONTEXT_CHARS) break;
    sections.push(content);
    total += content.length;
  }

  return sections.join("\n\n---\n\n");
}
