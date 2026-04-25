import { NextRequest, NextResponse } from "next/server";
import { chatCompletionJSON, chatCompletion } from "@/lib/llm";
import { query } from "@/lib/db";
import { getResolvedPlan, getTemplateForWeekday, getResolvedWeek, previewMoveSession } from "@/lib/tools/schedule";
import { logWorkoutEntry, getWorkoutLogs, correctWorkoutEntry } from "@/lib/tools/workout";
import { logNutritionItem, getNutritionDay, getNutritionTargetsVsActuals, correctNutritionEntry } from "@/lib/tools/nutrition";
import { importRoutine, listRoutines, activateRoutine } from "@/lib/tools/routines";
import type { Card, ChatToolRequest } from "@/types";

const SINGLE_CALL_SYSTEM = `You are Strong — a concise fitness and nutrition assistant. Given the user message and context, return a single JSON response.

Available tools:
- getResolvedPlan({"date":"today"}) → today's workout card
- getTemplateForWeekday({"weekday":"Tuesday"}) → weekday plan card
- getResolvedWeek({}) → full weekly routine card
- previewMoveSession({"source":"Tuesday","targetDate":"today"}) → preview card
- logWorkoutEntry({"exercises":[{"name":"...","sets":3,"reps":10}],"date":"today","source_session":"Tuesday"}) → log card
- getWorkoutLogs({"date":"today"}) → what I finished card
- logNutritionItem({"item":"eggs","quantity":"2","date":"today","macros":{"calories":140,"protein_g":12,"carbs_g":1,"fat_g":10}}) → nutrition card
- getNutritionDay({"date":"today"}) → what I ate card
- getNutritionTargetsVsActuals({"date":"today"}) → macro targets card
- correctWorkoutEntry({"entry_id":null,"changes":{}}) → correction
- correctNutritionEntry({"entry_id":null,"changes":{}}) → correction
- listRoutines({}) → shows user's saved routines
- activateRoutine({"routine_id":123}) → switches active routine

Rules:
- Coaching/general questions: tool=null, write a helpful reply in "narration"
- Always pick exactly one tool for factual queries
- For logNutritionItem: include estimated macros directly in args.macros — no lookup needed
- For logWorkoutEntry: if user says "I did Tuesday's plan", use source_session="Tuesday" and empty exercises []
- Destructive actions (delete/clear): tool=null, narration asks to confirm
- Keep narration under 2 sentences, direct and motivating

Return ONLY this JSON (no markdown):
{
  "tool": "<toolName or null>",
  "args": {},
  "narration": "<1-2 sentences>"
}`;

export async function POST(req: NextRequest) {
  const { message, history = [] } = await req.json();

  if (!message?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  if (isDestructive(message)) {
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO pending_actions (type, payload, expires_at) VALUES ($1, $2, $3)`,
      ["clear_day", JSON.stringify({ message }), expires]
    );
    return NextResponse.json({
      text: "Are you sure? This will delete all of today's logs. Reply 'yes' to confirm.",
      cards: [{
        type: "confirmation",
        title: "Confirm Delete",
        data: { action: "clear_day", message: "Delete today's workout and nutrition logs?", expires_at: expires },
      }],
    });
  }

  const recentContext = history
    .slice(-6)
    .map((m: { role: string; text: string }) => `${m.role}: ${m.text}`)
    .join("\n");

  const memory = await getMemory();

  let decision: { tool: string | null; args: Record<string, unknown>; narration: string };

  try {
    decision = await chatCompletionJSON<typeof decision>(
      [
        { role: "system", content: SINGLE_CALL_SYSTEM + (memory ? `\n\nUser context: ${memory}` : "") },
        ...(recentContext ? [{ role: "user" as const, content: `Recent chat:\n${recentContext}` }] : []),
        { role: "user", content: message },
      ],
      { temperature: 0.2, max_tokens: 512 }
    );
  } catch {
    const fallback = await chatCompletion(
      [
        { role: "system", content: "You are Strong, a concise fitness coach. Reply in 1-2 sentences." },
        { role: "user", content: message },
      ],
      { temperature: 0.7, max_tokens: 256 }
    );
    return NextResponse.json({ text: fallback, cards: [] });
  }

  const cards: Card[] = [];

  if (decision.tool) {
    try {
      const toolReq: ChatToolRequest = {
        domain: toolDomain(decision.tool),
        tool: decision.tool,
        args: decision.args || {},
        confidence: 0.9,
      };
      const card = await dispatchTool(toolReq);
      if (card) cards.push(card);
    } catch (err) {
      console.error("Tool dispatch failed:", err);
    }
  }

  // Guard: prevent narration claiming a log succeeded when no card was produced.
  // Covers: no tool ran (hallucination) and tool ran but threw (silent failure).
  // "saved" excluded — too broad, matches non-log contexts like "session preferences saved".
  let narration = decision.narration;
  if (cards.length === 0) {
    const logClaim = /\b(logged|recorded)\b/i.test(narration) &&
      /\b(workout|sets?|reps?|exercise)\b/i.test(narration);
    if (logClaim) {
      narration = "I didn't log anything yet — could you tell me which exercises you completed and how many sets/reps?";
    }
  }

  return NextResponse.json({ text: narration, cards });
}

async function dispatchTool(req: ChatToolRequest): Promise<Card | null> {
  const { tool, args } = req;

  switch (tool) {
    case "getResolvedPlan": return getResolvedPlan(args as { date?: string });
    case "getTemplateForWeekday": return getTemplateForWeekday(args as { weekday: string });
    case "getResolvedWeek": return getResolvedWeek(args as { range?: string });
    case "previewMoveSession": return previewMoveSession(args as { source: string; targetDate: string });
    case "logWorkoutEntry": return logWorkoutEntry(args as Parameters<typeof logWorkoutEntry>[0]);
    case "getWorkoutLogs": return getWorkoutLogs(args as { date?: string });
    case "correctWorkoutEntry": return correctWorkoutEntry(args as Parameters<typeof correctWorkoutEntry>[0]);
    case "logNutritionItem": return logNutritionItemWithInlineMacros(args);
    case "getNutritionDay": return getNutritionDay(args as { date?: string });
    case "getNutritionTargetsVsActuals": return getNutritionTargetsVsActuals(args as { date?: string });
    case "correctNutritionEntry": return correctNutritionEntry(args as Parameters<typeof correctNutritionEntry>[0]);
    case "listRoutines": return listRoutines();
    case "activateRoutine": return activateRoutine(args as { routine_id: number });
    case "importRoutine": return importRoutine(args as { text: string });
    default: return null;
  }
}

async function logNutritionItemWithInlineMacros(args: Record<string, unknown>): Promise<Card> {
  const macros = args.macros as { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number } | undefined;
  return logNutritionItem({
    item: args.item as string,
    quantity: args.quantity as string | undefined,
    date: args.date as string | undefined,
    inlineMacros: macros,
  });
}

function toolDomain(tool: string): "schedule" | "workout" | "nutrition" | "routine" | "meta" {
  if (["getResolvedPlan","getTemplateForWeekday","getResolvedWeek","previewMoveSession","previewDailyOverride"].includes(tool)) return "schedule";
  if (["logWorkoutEntry","getWorkoutLogs","correctWorkoutEntry"].includes(tool)) return "workout";
  if (["logNutritionItem","getNutritionDay","getNutritionTargetsVsActuals","correctNutritionEntry"].includes(tool)) return "nutrition";
  if (["listRoutines","activateRoutine","importRoutine"].includes(tool)) return "routine";
  return "meta";
}

function isDestructive(message: string): boolean {
  return /\b(delete|clear|undo|reset)\b.*\b(log|workout|nutrition|today|entry|all)\b/i.test(message);
}

async function getMemory(): Promise<string> {
  try {
    const rows = await query(`SELECT summary FROM assistant_memory WHERE athlete_profile_id = 1 LIMIT 1`);
    return (rows[0]?.summary as string) || "";
  } catch {
    return "";
  }
}
