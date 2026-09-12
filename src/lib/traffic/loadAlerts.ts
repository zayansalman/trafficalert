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
