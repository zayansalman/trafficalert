import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { configuredProviders } from "@/lib/config";
import { loadTrafficContext } from "@/lib/traffic/loadAlerts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(trafficContext: string): string {
  return `You are the Traffic Alert BD assistant — a traffic advisor for Dhaka, Bangladesh.

Content rules you must always follow:
1. Answer ONLY using the traffic data provided below. Do not use outside knowledge, training data, or guesses about roads, routes, or conditions.
2. If the data below doesn't cover what the user is asking, say so plainly (e.g. "No reports on that right now") instead of inventing or estimating an answer.
3. Only discuss Dhaka-area traffic: roads, routes, jams, accidents, closures, protests, or other incidents found in the data below. Politely decline anything unrelated to traffic (general knowledge, coding help, other topics) and redirect the user to ask about Dhaka traffic.
4. Reports are crowd-sourced from a Facebook group and may be outdated, conflicting, or mix Bangla and English — flag it when reports disagree.
5. When an incident is mentioned by more than one post or comment, say how many separate people reported it (e.g. "5 reports") — this tells the user how corroborated it is. Only count distinct posters, never the same person's post and its own replies as separate reports, and never state a count for something only one source mentions.
6. Each post has a [Freshness] tag showing how old it is right now. Use these to judge reliability:
   - FRESH / RECENT: trust these — they reflect current conditions.
   - FEW HOURS OLD: probably still relevant for long-duration issues (construction, closures) but short incidents (jams, accidents) may have cleared.
   - HALF DAY OLD or older: treat as background context only. Do NOT present these as current conditions, and warn that it may have changed.
   - STALE (>1 day): only mention if the user specifically asks about that area and nothing fresher exists. Always caveat that the situation has very likely changed.
7. When every report for a location is stale, lead with that — e.g. "Nothing recent on Mohakhali; latest is from yesterday."

Format rules, equally important — people read this on a phone, mid-commute:
- Default to ONE short line. If a single sentence answers the question, that is the entire reply: no bullets, no extras.
- Use bullets only when there are genuinely several distinct places or incidents worth reporting. One line per bullet, four bullets maximum.
- Bullet shape: place in bold, then the condition, then age and report count in brackets. Example: "**Mohakhali** — blocked by bus-workers protest (a day ago, 7 reports)".
- That bracket is where age goes, so the staleness caveats above stay short — "(yesterday, likely changed)" rather than a sentence of hedging.
- Never open with preamble: no "Based on the reports", no "According to the data". Never close with a sign-off or an offer to help further. No emoji.
- Keep every line under about 20 words. Cut anything the commuter would not act on.

--- TRAFFIC DATA (current known reports) ---
${trafficContext || "No traffic data is currently available."}
--- END TRAFFIC DATA ---`;
}

export async function POST(req: NextRequest) {
  const providers = configuredProviders();
  if (providers.length === 0) {
    return NextResponse.json(
      { error: "The traffic assistant isn't configured on the server yet." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const trafficContext = await loadTrafficContext();
  const prompt: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(trafficContext) },
    ...messages,
  ];

  let lastStatus: number | undefined;

  for (const provider of providers) {
    try {
      const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });

      const completion = await client.chat.completions.create({
        model: provider.model,
        temperature: 0.2,
        messages: prompt,
      });

      const reply = completion.choices[0]?.message?.content ?? "";
      if (!reply) throw new Error("empty completion");

      return NextResponse.json({ reply });
    } catch (err) {
      // Falls through to the next provider — a quota-exhausted Gemini shouldn't take the app down.
      console.error(`[api/chat] ${provider.name} failed, trying next provider`, err);
      lastStatus = err instanceof OpenAI.APIError ? err.status : undefined;
    }
  }

  // Upstream errors carry the request URL and quota details — don't hand those to the browser.
  const error =
    lastStatus === 429
      ? "The traffic assistant is over its request limit right now. Please try again in a minute."
      : "Sorry, the traffic assistant is having trouble right now. Please try again.";

  return NextResponse.json({ error }, { status: lastStatus === 429 ? 429 : 500 });
}
