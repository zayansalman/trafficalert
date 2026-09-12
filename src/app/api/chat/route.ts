import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { readdir, readFile } from "fs/promises";
import path from "path";

function getClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

const ALERTS_DIR = path.join(process.cwd(), "data", "traffic-alerts");

async function loadAlertContext(): Promise<string> {
  try {
    const files = await readdir(ALERTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort().reverse();

    if (mdFiles.length === 0) return "No traffic alert data available.";

    const contents = await Promise.all(
      mdFiles.map((f) => readFile(path.join(ALERTS_DIR, f), "utf-8"))
    );

    return contents.join("\n\n---\n\n");
  } catch {
    return "No traffic alert data available.";
  }
}

const SYSTEM_PROMPT = `You are a Dhaka traffic assistant. Your job is to help users navigate Dhaka by providing traffic updates, congestion warnings, and route suggestions based on crowd-sourced traffic alert data.

You will be given the latest traffic alert data below. Use it to answer user questions. If the data shows no alerts or is a placeholder, say that no live traffic data is available yet but you're ready to help once it is.

Be concise, helpful, and specific to Dhaka. If a user reports traffic, acknowledge it. If they ask about a route, reference any relevant alerts.

--- TRAFFIC ALERT DATA ---
{ALERT_DATA}
--- END DATA ---`;

export async function POST(req: NextRequest) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const { messages } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const alertData = await loadAlertContext();
    const systemPrompt = SYSTEM_PROMPT.replace("{ALERT_DATA}", alertData);

    const completion = await getClient().chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    const reply = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
