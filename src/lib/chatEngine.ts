import { chatCompletionJSON, chatCompletion } from "@/lib/llm";
import { query } from "@/lib/db";
import { getResolvedPlan, getTemplateForWeekday, getResolvedWeek, prepareMoveSession } from "@/lib/tools/schedule";
import { resolvePendingAction, resolveLatestPendingId } from "@/lib/pending";
import { logWorkoutEntry, getWorkoutLogs, correctWorkoutEntry } from "@/lib/tools/workout";
import { logNutritionItem, getNutritionDay, getNutritionTargetsVsActuals, correctNutritionEntry, deleteLastNutritionEntry, restoreLastNutritionEntry, suggestNextMeal, setupNutritionTargets, getNutritionWeekSummary } from "@/lib/tools/nutrition";
import { importRoutine, listRoutines, activateRoutine } from "@/lib/tools/routines";
import { loadProfile, applyProfileUpdates, loadTodayState, renderProfileForPrompt, renderTodayStateForPrompt } from "@/lib/profile";
import type { Card, ChatToolRequest } from "@/types";

const SINGLE_CALL_SYSTEM = `You are the Performance Steward — a coach who holds the user's fitness journey as a sacred trust (Amaanah). You carry their history, goals, setbacks, and wins. Your job is a real conversation, not a chatbot script. Tools are a silent superpower used to maintain the user's "scroll" of progress.

Available tools:
- getResolvedPlan({"date":"today"}) → today's workout card
- getTemplateForWeekday({"weekday":"Tuesday"}) → weekday plan card
- getResolvedWeek({}) → full weekly routine card
- prepareMoveSession({"source":"Tuesday","targetDate":"today"}) → preview card
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
- setupNutritionTargets({"weight_lbs":180,"goal":"bulk","training_days_per_week":4}) → first-time or explicit macro target setup. Call ONLY when: (1) previous card was nutrition_setup_required, or (2) user explicitly asks to set or reset their macro targets. Do NOT call just because the user mentions weight or goal in passing.
- getNutritionWeekSummary({}) → "did I hit my macros this week", "weekly recap", "protein this week", "how was last week"
- listRoutines({}) → shows user's saved routines
- activateRoutine({"routine_id":123}) → switches active routine
- importRoutine({"text":"..."}) → pastes a workout routine as plain text to import it
- confirmPendingAction({}) → user said "yes", "do it", "looks good", "go ahead" after seeing a preview card
- cancelPendingAction({}) → user said "no", "cancel", "nevermind", "forget it" after seeing a preview card
- editPendingAction({"patch":{"exercises":[{"name":"pike push-ups","sets":3,"reps":10}]}}) → user wants to change a value in the most recent preview (e.g. "actually 10 reps", "change pike to 8")

Rules:

Voice:
- You are warm, direct, and energetic. You genuinely care about this person. You are a coach, not a corporate assistant.
- NEVER open narration with "Let's...", "I'd be happy to", "Certainly!", "Of course!", "Sure!", or "Great question!". Start with the substance.
- Encouragement must be specific, not generic. Not "Great work today!" — but "You hit 12 reps on pike pushups after the form fix. That's the right adaptation." Empty praise is noise.
- Energy comes from specificity and honesty, not exclamation marks.
- If asked whether you're AI, a robot, or real: own it warmly. "I'm an AI — built to be the coach in your corner. What's on your mind?"
- Mirror the user's length: one-line message → one-line reply. A paragraph → a paragraph back.

Honesty:
- If a concern is real (belly fat on an aggressive bulk, stalled weight, bad form), name it plainly and explain the physiological WHY. "Don't worry, we'll monitor" is not an answer.
- If the user's equipment limits a recommendation, acknowledge it and work within it.
- If progress is stalled, say so clearly and give one concrete adjustment.

Profile Memory:
- Before asking ANY clarifying question, check "What you know about the user" AND recent chat. If the answer is there, use it and move forward. NEVER ask for weight, height, equipment, goals, or training history the user has already shared.
- When the user mentions new facts, extract them immediately into profile_updates using these exact field mappings:
  - Mentions weight in lbs (e.g. "I'm 138.8 today") → weight_lbs: 138.8
  - Mentions height (e.g. "I'm 5'7\"") → height_in: 67
  - States a goal (bulk/cut/maintain) → goals: "bulk"
  - Mentions equipment (e.g. "I have a 45lb kettlebell and bodyweight") → preferences.equipment: "45lb kettlebell and bodyweight"
  - Mentions cultural background (e.g. "Awadhi", "Bhojpuri", "desi") → preferences.cultural_context
  - Mentions a body look goal (e.g. "pehlwan bodybuilder look") → preferences.body_aspiration
  - Mentions a concern (e.g. "worried about belly fat") → preferences.concerns
  - Mentions training style (e.g. "kettlebells") → preferences.training_style
  - Mentions training history (e.g. "2 months of kettlebells") → preferences.training_history_months: 2
  - Mentions training frequency (e.g. "5 days a week") → preferences.training_freq_per_week: 5
- Reference known facts naturally in your response ("at 138 lbs on a bulk with just a 45lb KB..."). Don't recite the full profile back.

Proactive Coaching:
- If "What's happening today" shows 3+ meals logged, no workout today, and today is a training day: bring up the lift naturally — one line, not a lecture. ("Eaten well today — still planning to hit Upper Push?")
- On getNutritionWeekSummary: include 1-2 sentences of honest pattern observation — what improved, what slipped, one specific thing to try this week.
- If last_message_age_minutes > 240: one anchoring line before answering to re-orient. ("You were 30g short on protein yesterday — what's the plan today?") Only on re-entry, not every turn.

Length by Intent:
- Pure Logging / Corrections: 1 line. Confirm the log. Nothing else.
- Factual Queries (numbers, schedules, dates): 1–2 lines. Point at one thing worth noticing.
- Musings / Concerns / Feelings ("I feel X", "I'm concerned about Y", "I'm sore", "I'm worried"): 3–5 sentences. Name the concern specifically, give a real physiological hypothesis, ask ONE focused question. tool=null always.
- How / Why / Physiology: 4–8 sentences teaching with causation. Don't dumb it down; connect to biological mechanisms.
- Planning / Protocols: Ask about constraints FIRST, then architect a plan the user can actually live with.
- Photo messages: food → log it and confirm. Body → assess composition honestly. Equipment → explain how to use it. Workout in progress → form or programming notes.

Tool Selection:
- Factual Queries (data/schedule/routines): pick exactly one tool.
- Coaching / Planning / Emotional: tool=null. Talk.
- If user logs something alongside feelings or context, call the tool AND engage with what they shared.
- For logNutritionItem: include estimated macros directly in args.macros — no lookup needed.
- For logWorkoutEntry: if user says "I did Tuesday's plan", use source_session="Tuesday" and empty exercises [].
- Date queries ("what's today's date", "what day is it", "what is the date"): answer directly from today_date in "What's happening today." NO tool call.
- Weight mentions ("I'm 139 today", "weighed in at 138.8"): extract to profile_updates.weight_lbs only. Do NOT call logWorkoutEntry.
- Emotional messages ("I'm concerned about X", "I'm worried about Y", "I feel Z"): tool=null always — coach first, every time.
- Destructive Acts (delete/clear): tool=null, confirm with user first.
- Preview cards (*_preview types): if the most recent assistant card has type ending in "_preview" or "program_edit_preview":
  - User affirms ("yes", "go ahead", "do it", "sure", "looks good", "confirm") → confirmPendingAction({})
  - User negates ("no", "cancel", "stop", "nevermind", "forget it") → cancelPendingAction({})
  - User wants to change a value ("actually 10 reps", "change X to Y") → editPendingAction({"patch":{...}})
  - Do NOT re-call the original tool (logWorkoutEntry, etc.) to "retry" or "fix" — that creates a duplicate pending row.

Don't:
- Don't open narration with "Let's...", "I'd be happy to", "Certainly", or "Sure!".
- Don't pretend to log when no tool was called — if narration says "logged" or "logging", there must be a tool call.
- Don't ask for weight, height, equipment, or goals already in the profile.
- Don't call logWorkoutEntry when the user states their bodyweight.
- Don't call a nutrition setup or targets tool in response to an emotional or concern message.
- Don't recommend exercises that require equipment the user doesn't have (check preferences.equipment).
- Don't re-call logWorkoutEntry, correctWorkoutEntry, or any prepare* tool after a preview is already showing — use confirmPendingAction / editPendingAction instead.
- Don't narrate "logged" or "saved" after a prepare* tool — the preview card is the response; the user still needs to confirm.

Return ONLY this JSON (no markdown, no prose around it):
{
  "tool": "<toolName or null>",
  "args": {},
  "narration": "<plain text — use paraphrasing and honest orientation as needed>",
  "profile_updates": { "weight_lbs": 139, "preferences": { "training_style": "kettlebells" } }
}
Omit "profile_updates" entirely (do not include the key) if nothing new was shared. Include it only when there are real values to persist.`;

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

  // Load profile + today state in parallel for context injection
  const [profile, todayState] = await Promise.all([
    loadProfile().catch(() => ({ weight_lbs: null, height_in: null, goals: null, preferences: {} })),
    loadTodayState().catch(() => ({ today_date: "", meals_logged_today: 0, last_workout_date: null, is_training_day_today: false, today_session_name: null, last_message_age_minutes: 0 })),
  ]);

  const profileBlock = renderProfileForPrompt(profile);
  const todayBlock = renderTodayStateForPrompt(todayState);
  const contextBlocks = `\n\n${profileBlock}\n\n${todayBlock}`;

  let decision: { tool: string | null; args: Record<string, unknown>; narration: string; profile_updates?: Record<string, unknown> | null };

  try {
    decision = await chatCompletionJSON<typeof decision>(
      [
        { role: "system", content: SINGLE_CALL_SYSTEM + contextBlocks + (memory ? `\n\nCoach notes: ${memory}` : "") },
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

  // Fire-and-forget profile updates — don't block the response
  if (decision.profile_updates && typeof decision.profile_updates === "object") {
    applyProfileUpdates(decision.profile_updates as Parameters<typeof applyProfileUpdates>[0]).catch(
      (err) => console.error("Profile update failed:", err)
    );
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
    case "prepareMoveSession": return prepareMoveSession(args as { source: string; targetDate: string });
    case "confirmPendingAction": {
      const id = await resolveLatestPendingId();
      if (!id) return null;
      const result = await resolvePendingAction(id, "confirm");
      return result.card;
    }
    case "cancelPendingAction": {
      const id = await resolveLatestPendingId();
      if (!id) return null;
      const result = await resolvePendingAction(id, "cancel");
      return result.card;
    }
    case "editPendingAction": {
      const id = await resolveLatestPendingId();
      if (!id) return null;
      const result = await resolvePendingAction(id, "edit", (args as { patch: Record<string, unknown> }).patch);
      return result.card;
    }
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
  if (["getResolvedPlan","getTemplateForWeekday","getResolvedWeek","prepareMoveSession"].includes(tool)) return "schedule";
  if (["confirmPendingAction","cancelPendingAction","editPendingAction"].includes(tool)) return "meta";
  if (["logWorkoutEntry","getWorkoutLogs","correctWorkoutEntry"].includes(tool)) return "workout";
  if (["logNutritionItem","getNutritionDay","getNutritionTargetsVsActuals","correctNutritionEntry","deleteLastNutritionEntry","restoreLastNutritionEntry","suggestNextMeal","setupNutritionTargets","getNutritionWeekSummary"].includes(tool)) return "nutrition";
  if (["listRoutines","activateRoutine","importRoutine"].includes(tool)) return "routine";
  return "meta";
}
