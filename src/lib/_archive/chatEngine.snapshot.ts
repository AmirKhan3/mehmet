import { chatCompletionJSON, chatCompletion } from "@/lib/llm";
import { query } from "@/lib/db";
import { getResolvedPlan, getTemplateForWeekday, getResolvedWeek, previewMoveSession } from "@/lib/tools/schedule";
import { logWorkoutEntry, getWorkoutLogs, correctWorkoutEntry } from "@/lib/tools/workout";
import { logNutritionItem, getNutritionDay, getNutritionTargetsVsActuals, correctNutritionEntry, deleteLastNutritionEntry, restoreLastNutritionEntry, suggestNextMeal, setupNutritionTargets, getNutritionWeekSummary } from "@/lib/tools/nutrition";
import { importRoutine, listRoutines, activateRoutine } from "@/lib/tools/routines";
import type { Card, ChatToolRequest } from "@/types";

const SINGLE_CALL_SYSTEM = `You are the Performance Steward — a shepherd of health who treats the user's fitness journey as a sacred trust (Amaanah). Your priority is a real conversation that values wholeness (body, mind, heart, and spirit) over mere data logging. Tools are a silent superpower used to maintain the user's "scroll" — the constant reckoner of their choices.

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
- correctNutritionEntry({"target":"last","changes":{"quantity":"3 eggs"}}) → fix the most recent log
- deleteLastNutritionEntry({}) → "scratch that", "remove that", "undo last log"
- restoreLastNutritionEntry({}) → "actually keep that", "bring it back"
- suggestNextMeal({"intent":"fill_gap"}) → "what should I eat now", "need more protein", "close my macros"
- suggestNextMeal({"intent":"post_workout"}) → "what to eat after workout", "post-workout meal"
- suggestNextMeal({"intent":"next_meal"}) → "what should I eat later", "plan dinner", "what for lunch"
- suggestNextMeal({"intent":"pair_with_last"}) → "what should I eat with this", "pair this"
- setupNutritionTargets({"weight_lbs":180,"goal":"bulk","training_days_per_week":4}) → first-time macro setup; user provides weight + goal + training days. Call when user mentions weight, goal type (cut/bulk/maintain), or if previous card was nutrition_setup_required.
- getNutritionWeekSummary({}) → "did I hit my macros this week", "weekly recap", "protein this week", "how was last week"
- listRoutines({}) → shows user's saved routines
- activateRoutine({"routine_id":123}) → switches active routine
- importRoutine({"text":"..."}) → pastes a workout routine as plain text to import it

Rules:

Tone:
- Mirror the user: One-line user → one-line reply. A paragraph from them → a paragraph back.
- Collaborative Intelligence: Work with the user, not at them. Use paraphrasing to confirm you understand their state.
- Honest Orientation: Do not overlook "unpleasant bits"; if progress is stalled, name the complication honestly.
- No shallow motivation: Avoid catchphrases. Use intellectual stimulation and provide logical and valid justification for your coaching.

Length by Intent:
- Pure Logging / Corrections: Adhere to transactional silence. Confirm the update to their "scroll" in 1 line. For corrections, be a surgical editor.
- Factual Queries: 1–2 lines acting as an accountant. Point at one thing worth noticing in the data.
- Musings / Feelings ("I feel X", "I'm sore", "I feel drained"): 3–6 sentences. Acknowledge the feeling (body, mind, or heart), offer a hypothesis, and ask: "What is your overall take on what's happening here?"
- How / Why / Physiology: Actually answer as a teacher. 4–8 sentences providing causal explanations. Do not dumb it down; focus on biological wholeness.
- Planning / Protocols ("I'm thinking about cutting"): Act as an architect seeking durable decisions. Before recommending, ask about constraints to find a plan the user "can actually live with."
- Photo messages: The user sent an image. If it shows food, log it and confirm. If it shows a body, assess composition honestly. If it shows equipment, explain how to use it. If it shows a workout in progress, comment on form or programming. Treat the photo context as the primary signal.

Tool Selection:
- Factual Queries (Data/Schedule/Routines): Pick exactly one tool.
- Coaching / Planning / Emotional Check-ins: tool=null. Talk.
- Outcome Valuation: Tool firing and narration are not mutually exclusive. If the user logs something alongside a feeling or context, call the tool AND engage with what they shared.
- For logNutritionItem: include estimated macros directly in args.macros — no lookup needed.
- For logWorkoutEntry: if user says "I did Tuesday's plan", use source_session="Tuesday" and empty exercises [].
- Destructive Acts (delete/clear): tool=null, narration confirms before acting.

Don't:
- Don't pretend to log when no tool was called.
- Don't ignore emotional content to push a tool. If they are exhausted, the servant-leader response comes first.

Return ONLY this JSON (no markdown, no prose around it):
{
  "tool": "<toolName or null>",
  "args": {},
  "narration": "<plain text — use paraphrasing and honest orientation as needed>"
}`;

export async function getMemory(): Promise<string> {
  try {
    const rows = await query(`SELECT summary FROM assistant_memory WHERE athlete_profile_id = 1 LIMIT 1`);
    return (rows[0]?.summary as string) || "";
  } catch {
    return "";
  }
}

/** Core LLM routing + tool dispatch. No DB writes — callers handle persistence. */
export async function runEngine(
  message: string,
  history: { role: string; text: string }[],
  memory: string
): Promise<{ text: string; cards: Card[] }> {
  const recentContext = history
    .slice(-6)
    .map((m) => `${m.role}: ${m.text}`)
    .join("\n");

  let decision: { tool: string | null; args: Record<string, unknown>; narration: string };

  try {
    decision = await chatCompletionJSON<typeof decision>(
      [
        { role: "system", content: SINGLE_CALL_SYSTEM + (memory ? `\n\nUser context: ${memory}` : "") },
        ...(recentContext ? [{ role: "user" as const, content: `Recent chat:\n${recentContext}` }] : []),
        { role: "user", content: message },
      ],
      { temperature: 0.6, max_tokens: 1024 }
    );
  } catch {
    const fallback = await chatCompletion(
      [
        { role: "system", content: "You are Strong, a concise fitness coach. Reply in 1-2 sentences." },
        { role: "user", content: message },
      ],
      { temperature: 0.7, max_tokens: 256 }
    );
    return { text: fallback, cards: [] };
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

  let narration = decision.narration;
  if (cards.length === 0) {
    const logClaim = /\b(logged|recorded)\b/i.test(narration) &&
      /\b(workout|sets?|reps?|exercise)\b/i.test(narration);
    if (logClaim) {
      narration = "I didn't log anything yet — could you tell me which exercises you completed and how many sets/reps?";
    }
  }

  return { text: narration, cards };
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
    case "deleteLastNutritionEntry": return deleteLastNutritionEntry({} as never);
    case "restoreLastNutritionEntry": return restoreLastNutritionEntry({} as never);
    case "suggestNextMeal": return suggestNextMeal(args as { intent: "fill_gap" | "post_workout" | "next_meal" | "pair_with_last" });
    case "setupNutritionTargets": return setupNutritionTargets(args as Parameters<typeof setupNutritionTargets>[0]);
    case "getNutritionWeekSummary": return getNutritionWeekSummary(args as { weeks_back?: number });
    case "listRoutines": return listRoutines();
    case "activateRoutine": return activateRoutine(args as { routine_id: number });
    case "importRoutine": return importRoutine(args as { text: string });
    default: return null;
  }
}

function logNutritionItemWithInlineMacros(args: Record<string, unknown>): Promise<Card> {
  const macros = args.macros as { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number } | undefined;
  return logNutritionItem({
    item: args.item as string,
    quantity: args.quantity as string | undefined,
    date: args.date as string | undefined,
    inlineMacros: macros,
  });
}

function toolDomain(tool: string): "schedule" | "workout" | "nutrition" | "routine" | "meta" {
  if (["getResolvedPlan","getTemplateForWeekday","getResolvedWeek","previewMoveSession"].includes(tool)) return "schedule";
  if (["logWorkoutEntry","getWorkoutLogs","correctWorkoutEntry"].includes(tool)) return "workout";
  if (["logNutritionItem","getNutritionDay","getNutritionTargetsVsActuals","correctNutritionEntry","deleteLastNutritionEntry","restoreLastNutritionEntry","suggestNextMeal","setupNutritionTargets","getNutritionWeekSummary"].includes(tool)) return "nutrition";
  if (["listRoutines","activateRoutine","importRoutine"].includes(tool)) return "routine";
  return "meta";
}
