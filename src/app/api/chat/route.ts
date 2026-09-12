import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GEMINI_BASE_URL, GEMINI_MODEL, requireGeminiKey } from "@/lib/config";
import { loadTrafficContext } from "@/lib/traffic/loadAlerts";
import { addReport, loadUserReportContext } from "@/lib/traffic/reportStore";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUBMIT_REPORT_TOOL: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_report",
    description:
      "Store a user-submitted traffic report. Call this ONLY after the user has confirmed the details you summarised back to them.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description:
            "The road, intersection, or area name in Dhaka (e.g. 'Mirpur Road near Shewrapara')",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "low = slow but moving, medium = significant delays / stop-and-go, high = gridlocked / road blocked / accident",
        },
        description: {
          type: "string",
          description:
            "Short plain-English summary of what the user reported (e.g. 'Heavy traffic due to road construction')",
        },
      },
      required: ["location", "severity", "description"],
    },
  },
};

function buildSystemPrompt(trafficContext: string): string {
  return `You are the Traffic Alert BD assistant — a traffic advisor for Dhaka, Bangladesh.

Rules you must always follow:
1. Answer ONLY using the traffic data provided below. Do not use outside knowledge, training data, or guesses about roads, routes, or conditions.
2. If the data below doesn't cover what the user is asking, say so plainly (e.g. "I don't have a report on that right now") instead of inventing or estimating an answer.
3. Only discuss Dhaka-area traffic: roads, routes, jams, accidents, closures, protests, or other incidents found in the data below. Politely decline anything unrelated to traffic (general knowledge, coding help, other topics) and redirect the user to ask about Dhaka traffic.
4. Be concise. Mention the location and how recent a report is when that's available.
5. Reports are crowd-sourced from a Facebook group and may be outdated, conflicting, or mix Bangla and English — flag it when reports disagree.
6. When an incident is mentioned by more than one post or comment, say how many separate people reported it (e.g. "reported by 5 different people") — this tells the user how corroborated it is. Only count distinct posters, never the same person's post and its own replies as separate reports, and never state a count for something only one source mentions.
7. Each post has a [Freshness] tag showing how old it is right now. Use these to judge reliability:
   - FRESH / RECENT: trust these — they reflect current conditions.
   - FEW HOURS OLD: probably still relevant for long-duration issues (construction, closures) but short incidents (jams, accidents) may have cleared.
   - HALF DAY OLD or older: treat as background context only. Do NOT present these as current conditions. Say "as of earlier today" or "reported yesterday" and warn the user it may have changed.
   - STALE (>1 day): only mention if the user specifically asks about that area and nothing fresher exists. Always caveat that the situation has very likely changed.
8. When all available reports for a location are stale, say so clearly — e.g. "The latest report I have for Mohakhali is from yesterday and is likely outdated."

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

  const body = (await req.json().catch(() => null)) as {
    messages?: ChatMessage[];
    sessionId?: string;
  } | null;
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const sessionId = body?.sessionId ?? "anonymous";

  try {
    // Load both Facebook data and user-submitted reports.
    const [trafficContext, userReportContext] = await Promise.all([
      loadTrafficContext(),
      loadUserReportContext(),
    ]);

    const fullContext = [trafficContext, userReportContext]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const client = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL });

    const completion = await client.chat.completions.create({
      model: GEMINI_MODEL,
      temperature: 0.2,
      tools: [SUBMIT_REPORT_TOOL],
      messages: [
        { role: "system", content: buildSystemPrompt(fullContext) },
        ...messages,
      ],
    });

    const choice = completion.choices[0];

    // If the model called the submit_report tool, execute it and get a final reply.
    if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      const toolCall = choice.message.tool_calls[0];
      if ("function" in toolCall && toolCall.function.name === "submit_report") {
        const args = JSON.parse(toolCall.function.arguments) as {
          location: string;
          severity: "low" | "medium" | "high";
          description: string;
        };

        const report = await addReport({
          location: args.location,
          severity: args.severity,
          description: args.description,
          sessionId,
        });

        // Send the tool result back to get a natural-language confirmation.
        const followUp = await client.chat.completions.create({
          model: GEMINI_MODEL,
          temperature: 0.2,
          messages: [
            { role: "system", content: buildSystemPrompt(fullContext) },
            ...messages,
            choice.message as OpenAI.ChatCompletionMessageParam,
            {
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: true,
                id: report.id,
                location: report.location,
                severity: report.severity,
                description: report.description,
              }),
            },
          ],
        });

        const reply = followUp.choices[0]?.message?.content ?? "Your report has been saved!";
        return NextResponse.json({ reply });
      }
    }

    const reply = choice?.message?.content ?? "";
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[api/chat] upstream call failed", err);

    const status = err instanceof OpenAI.APIError ? err.status : undefined;
    const error =
      status === 429
        ? "The traffic assistant is over its request limit right now. Please try again in a minute."
        : "Sorry, the traffic assistant is having trouble right now. Please try again.";

    return NextResponse.json({ error }, { status: status === 429 ? 429 : 500 });
  }
}
