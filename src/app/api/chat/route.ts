import { NextRequest } from "next/server";
import OpenAI from "openai";
import { OPENAI_MODEL, requireOpenAiKey } from "@/lib/config";
import { loadTrafficContext } from "@/lib/traffic/loadAlerts";

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(trafficContext: string): string {
  return `You are the Traffic Alert BD assistant — a traffic advisor for Dhaka, Bangladesh.

Rules you must always follow:
1. Answer ONLY using the traffic data provided below. Do not use outside knowledge, training data, or guesses about roads, routes, or conditions.
2. If the data below doesn't cover what the user is asking, say so plainly (e.g. "I don't have a report on that right now") instead of inventing or estimating an answer.
3. Only discuss Dhaka-area traffic: roads, routes, jams, accidents, closures, protests, or other incidents found in the data below. Politely decline anything unrelated to traffic (general knowledge, coding help, other topics) and redirect the user to ask about Dhaka traffic.
4. Be concise. Mention the location and how recent a report is when that's available.
5. Reports are crowd-sourced from a Facebook group and may be outdated, conflicting, or mix Bangla and English — flag it when reports disagree.

--- TRAFFIC DATA (current known reports) ---
${trafficContext || "No traffic data is currently available."}
--- END TRAFFIC DATA ---`;
}

export async function POST(req: NextRequest) {
  let apiKey: string;
  try {
    apiKey = requireOpenAiKey();
  } catch {
    return new Response("The traffic assistant isn't configured on the server yet.", {
      status: 500,
    });
  }

  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages is required", { status: 400 });
  }

  const trafficContext = await loadTrafficContext();
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    stream: true,
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt(trafficContext) },
      ...messages,
    ],
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
