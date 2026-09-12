import { readdir, readFile } from "fs/promises";
import path from "path";

const ALERTS_DIR = path.join(process.cwd(), "data", "traffic-alerts");

/** Keeps the prompt within a sane token budget as more daily snapshots accumulate. */
const MAX_CONTEXT_CHARS = 60_000;

/**
 * Loads the traffic-alert markdown snapshots, newest first, up to MAX_CONTEXT_CHARS.
 * Filenames are ISO-8601 timestamps (see data/traffic-alerts/**), so a plain string
 * sort already puts them in chronological order.
 */
export async function loadTrafficContext(): Promise<string> {
  let files: string[];
  try {
    files = (await readdir(ALERTS_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return "";
  }

  files.sort().reverse();

  const sections: string[] = [];
  let total = 0;

  for (const file of files) {
    const content = await readFile(path.join(ALERTS_DIR, file), "utf-8");
    if (total + content.length > MAX_CONTEXT_CHARS) break;
    sections.push(content);
    total += content.length;
  }

  return sections.join("\n\n---\n\n");
}
