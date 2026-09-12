import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GEMINI_BASE_URL, GEMINI_MODEL, requireGeminiKey } from "@/lib/config";
import { loadTrafficContext } from "@/lib/traffic/loadAlerts";
import { TOOL_DEFINITIONS, runTool } from "@/lib/llm/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How many times the model may call tools before it has to answer in prose.
 * Two covers the normal path (look up the route, then answer) plus one retry after a
 * place-not-found, and bounds the worst case to three upstream calls.
 */
const MAX_TOOL_ROUNDS = 2;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(trafficContext: string): string {
  return `You are the Traffic Alert BD assistant — a traffic advisor for Dhaka, Bangladesh.

Rules you must always follow:
1. Report road conditions ONLY from the traffic data below. Never use outside knowledge, training data, or guesses about what conditions are like somewhere.
2. If the data below doesn't cover what the user is asking, say so plainly instead of inventing or estimating an answer — and then follow rule 15 rather than stopping there.
3. Only discuss Dhaka-area traffic: roads, routes, jams, accidents, closures, protests, or other incidents. Politely decline anything unrelated to traffic (general knowledge, coding help, other topics) and redirect the user to ask about Dhaka traffic.
4. Be concise. Mention the location and how recent a report is when that's available.
5. Reports are crowd-sourced from a Facebook group and may be outdated, conflicting, or mix Bangla and English — flag it when reports disagree.
6. When an incident is mentioned by more than one post or comment, say how many separate people reported it (e.g. "reported by 5 different people") — this tells the user how corroborated it is. Only count distinct posters, never the same person's post and its own replies as separate reports, and never state a count for something only one source mentions.
7. Each post has a [Freshness] tag showing how old it is right now. Use these to judge reliability:
   - FRESH / RECENT: trust these — they reflect current conditions.
   - FEW HOURS OLD: probably still relevant for long-duration issues (construction, closures) but short incidents (jams, accidents) may have cleared.
   - HALF DAY OLD or older: treat as background context only. Do NOT present these as current conditions. Say "as of earlier today" or "reported yesterday" and warn the user it may have changed.
   - STALE (>1 day): only mention if the user specifically asks about that area and nothing fresher exists. Always caveat that the situation has very likely changed.
8. When all available reports for a location are stale, say so clearly — e.g. "The latest report I have for Mohakhali is from yesterday and is likely outdated."

Route lookups:
9. Whenever the user asks about travelling between two places, call the get_route tool before answering. It returns the roads and areas the drive actually uses, drawn from OpenStreetMap. Without it you are guessing which roads matter.
10. Then check the traffic data below against that route's "roads" and "areas", one by one. Where there is a report, give it with its freshness. Where there is none, say there are no reports for that stretch — never call it clear or fine. No report means no data, not good conditions.
11. Never give freeFlowMinutes as a travel time, ETA, or "it takes about X minutes". It assumes completely empty roads and is wrong for Dhaka at almost any hour. Distance in km is safe to quote.
12. When the tool returns more than one route option, compare them by what the reports say about each, not by their distance or free-flow time.
13. If the tool returns an "error" field, follow its "hint". If a resolved place comes back with "uncertain": true, name the place you assumed (e.g. "assuming you mean Gulshan 1") so the user can correct you.

Broad questions, and questions you can't answer:
14. "How's traffic in Dhaka?" is a question you CAN answer. Don't say you have nothing. Lead with the FRESH and RECENT reports, grouped by area, worst or most corroborated first, in a few short lines. Then ask which area or route they need so you can be precise.
15. Never end your turn with only "I don't have a report on that". Every time you can't answer, say which areas you do have recent reports for, then ask for what would let you answer — the specific area or road, or the two ends of their journey.
16. If a place name is too vague to act on ("Mirpur", "the north side"), name the options you have reports for and ask which one they mean.

--- TRAFFIC DATA (current known reports) ---
${trafficContext || "No traffic data is currently available."}
--- END TRAFFIC DATA ---`;
}

function isFunctionCall(
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}

export async function POST(req: NextRequest) {
  let apiKey: string;
  try {
    apiKey = requireGeminiKey();
  } catch {
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

  try {
    const trafficContext = await loadTrafficContext();
    const client = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL });

    const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(trafficContext) },
      ...messages,
    ];

    // Cleared if the provider turns out to reject function calling; see the catch below.
    let toolsSupported = true;

    for (let round = 0; ; round++) {
      // On the last round the tools are withheld, which forces a prose answer instead of
      // another tool call we would have no budget to run.
      const toolsAllowed = toolsSupported && round < MAX_TOOL_ROUNDS;

      let completion;
      try {
        completion = await client.chat.completions.create({
          model: GEMINI_MODEL,
          temperature: 0.2,
          messages: conversation,
          ...(toolsAllowed ? { tools: TOOL_DEFINITIONS } : {}),
        });
      } catch (err) {
        // Not every model behind the OpenAI-compatible endpoint accepts `tools`. Rather than
        // failing the whole conversation, drop back to answering from the reports alone.
        // Only on the first round, where no tool messages exist yet to invalidate the retry.
        const rejectedTools =
          round === 0 && toolsAllowed && err instanceof OpenAI.APIError && err.status === 400;
        if (!rejectedTools) throw err;

        console.error(
          `[api/chat] ${GEMINI_MODEL} rejected tool definitions; route lookups are disabled`,
          err,
        );
        toolsSupported = false;
        continue;
      }

      const message = completion.choices[0]?.message;
      const toolCalls = (message?.tool_calls ?? []).filter(isFunctionCall);

      if (!message || toolCalls.length === 0) {
        return NextResponse.json({ reply: message?.content ?? "" });
      }

      conversation.push(message);

      const outputs = await Promise.all(
        toolCalls.map(async (call) => ({
          id: call.id,
          content: await runTool(call.function.name, call.function.arguments),
        })),
      );

      for (const output of outputs) {
        conversation.push({
          role: "tool",
          tool_call_id: output.id,
          content: output.content,
        });
      }
    }
  } catch (err) {
    console.error("[api/chat] upstream call failed", err);

    // Upstream errors carry the request URL and quota details — don't hand those to the browser.
    const status = err instanceof OpenAI.APIError ? err.status : undefined;
    const error =
      status === 429
        ? "The traffic assistant is over its request limit right now. Please try again in a minute."
        : "Sorry, the traffic assistant is having trouble right now. Please try again.";

    return NextResponse.json({ error }, { status: status === 429 ? 429 : 500 });
  }
}
