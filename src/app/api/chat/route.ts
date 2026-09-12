import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { configuredProviders, type LlmProvider } from "@/lib/config";
import { loadTrafficContext } from "@/lib/traffic/loadAlerts";
import { loadUserReportContext } from "@/lib/traffic/reportStore";
import { TOOL_DEFINITIONS, runTool, type ToolContext } from "@/lib/llm/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * How many times the model may call tools before it has to answer in prose.
 * Two covers the normal paths — look up a route then answer, or store a report then confirm —
 * plus one retry after a place-not-found, and bounds a provider to three upstream calls.
 */
const MAX_TOOL_ROUNDS = 2;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(trafficContext: string): string {
  return `You are the Traffic Alert BD assistant — a traffic advisor for Dhaka, Bangladesh.

Content rules you must always follow:
1. Report road conditions ONLY from the traffic data provided below. Do not use outside knowledge, training data, or guesses about what conditions are like somewhere.
2. If the data below doesn't cover what the user is asking, say so plainly instead of inventing or estimating an answer — then follow the "Broad or vague questions" rules rather than stopping there.
3. Only discuss Dhaka-area traffic: roads, routes, jams, accidents, closures, protests, or other incidents. Politely decline anything unrelated to traffic (general knowledge, coding help, other topics) and redirect the user to ask about Dhaka traffic.
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

## Route questions
When the user asks about getting from one place to another:
1. Call the get_route tool BEFORE answering. It returns the roads and areas the drive actually uses, from OpenStreetMap. Without it you are guessing which roads matter.
2. Check the traffic data below against that route's "roads" and "areas". Where there is a report, give it. Where there is none, say there are no reports for that stretch — never call it clear or fine. No report means no data, not good conditions.
3. Never give freeFlowMinutes as a travel time, ETA, or "about X minutes". It assumes empty roads and is wrong for Dhaka at almost any hour. Distance in km is safe to quote.
4. With more than one route option, compare them by what the reports say, not by distance or free-flow time.
5. If the tool returns an "error" field, follow its "hint". If a place comes back with "uncertain": true, name the place you assumed (e.g. "assuming Gulshan 1") so the user can correct you.

## Broad or vague questions
- "How's traffic in Dhaka?" is a question you CAN answer. Don't say you have nothing: give the worst FRESH or RECENT reports as bullets, worst or most corroborated first, then ask which area or route they need.
- If a place name is too vague to act on ("Mirpur", "the north side"), name the options you have reports for and ask which one they mean.
- Never end your turn on "no reports on that" alone. Say what you do have, then ask for the specific area or road, or the two ends of their journey.

## Accepting user traffic reports
Users can report traffic conditions they're seeing. When a user describes current traffic (e.g. "heavy jam on Airport Road" or "Mirpur Road is clear right now"):
1. Extract the location, severity, and a short description.
2. Summarise what you understood back to the user and ask them to confirm — e.g. "Got it — heavy traffic on Mirpur Road near Shewrapara. Should I save this report?"
3. Only call the submit_report tool AFTER the user explicitly confirms (says yes, yeah, sure, go ahead, save it, etc.).
4. If the location is ambiguous (e.g. just "Mirpur" with no road/intersection), ask the user to be more specific before confirming.
5. Never call submit_report without user confirmation.
6. After storing, tell the user their report was saved and will help other users.

--- TRAFFIC DATA (current known reports) ---
${trafficContext || "No traffic data is currently available."}
--- END TRAFFIC DATA ---`;
}

function isFunctionCall(
  call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}

/**
 * Drive one provider to a prose answer, running any tools it asks for along the way.
 *
 * @throws whatever the provider throws, so the caller can fall through to the next one.
 */
async function completeWithTools(
  provider: LlmProvider,
  prompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ctx: ToolContext,
): Promise<string> {
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
  const conversation = [...prompt];

  for (let round = 0; ; round++) {
    // On the last round the tools are withheld, which forces a prose answer instead of
    // another tool call we would have no budget to run.
    const toolsAllowed = round < MAX_TOOL_ROUNDS;

    const completion = await client.chat.completions.create({
      model: provider.model,
      temperature: 0.2,
      messages: conversation,
      ...(toolsAllowed ? { tools: TOOL_DEFINITIONS } : {}),
    });

    const message = completion.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).filter(isFunctionCall);

    if (!message || toolCalls.length === 0) {
      const reply = message?.content ?? "";
      if (!reply) throw new Error("empty completion");
      return reply;
    }

    conversation.push(message);

    const outputs = await Promise.all(
      toolCalls.map(async (call) => ({
        id: call.id,
        content: await runTool(call.function.name, call.function.arguments, ctx),
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
}

export async function POST(req: NextRequest) {
  const providers = configuredProviders();
  if (providers.length === 0) {
    return NextResponse.json(
      { error: "The traffic assistant isn't configured on the server yet." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    messages?: ChatMessage[];
    sessionId?: string;
  } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const ctx: ToolContext = { sessionId: body?.sessionId ?? "anonymous" };

  const [trafficContext, userReportContext] = await Promise.all([
    loadTrafficContext(),
    loadUserReportContext(),
  ]);

  const fullContext = [trafficContext, userReportContext].filter(Boolean).join("\n\n---\n\n");

  const prompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(fullContext) },
    ...messages,
  ];

  let lastStatus: number | undefined;

  for (const provider of providers) {
    try {
      return NextResponse.json({ reply: await completeWithTools(provider, prompt, ctx) });
    } catch (err) {
      // Upstream errors carry the request URL and quota details — don't hand those to the browser.
      console.error(`[api/chat] ${provider.name} failed, trying next provider`, err);
      lastStatus = err instanceof OpenAI.APIError ? err.status : undefined;
    }
  }

  const error =
    lastStatus === 429
      ? "The traffic assistant is over its request limit right now. Please try again in a minute."
      : "Sorry, the traffic assistant is having trouble right now. Please try again.";

  return NextResponse.json({ error }, { status: lastStatus === 429 ? 429 : 500 });
}
