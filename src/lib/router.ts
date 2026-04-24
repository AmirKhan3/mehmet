import { chatCompletionJSON } from "./llm";
import type { UserJob, ChatToolRequest } from "@/types";

const SYSTEM_PROMPT = `You are a routing agent for a fitness assistant app. Given a user message and conversation context, classify the intent and select the appropriate tool.

Available jobs and tools:
- view_schedule: getResolvedPlan(date), getTemplateForWeekday(weekday), getResolvedWeek(range)
- edit_schedule_preview: previewMoveSession(source, targetDate), previewDailyOverride(date, override)
- log_workout: logWorkoutEntry(exercises, date, source_session?)
- view_workout_logs: getWorkoutLogs(date)
- log_nutrition: logNutritionItem(item, quantity, date)
- view_nutrition: getNutritionDay(date), getNutritionTargetsVsActuals(date)
- correct_workout: correctWorkoutEntry(entry_id, changes)
- correct_nutrition: correctNutritionEntry(entry_id, changes)
- coaching: null (no tool — answer from training data)
- general: null (no tool — answer directly)

Destructive actions (delete/clear/undo) return job="general" with tool=null; the deterministic gate handles them separately.

Return ONLY valid JSON matching this schema:
{
  "job": "<UserJob>",
  "tool_request": {
    "domain": "schedule|workout|nutrition|meta",
    "tool": "<toolName>",
    "args": {},
    "confidence": 0.0-1.0
  } | null,
  "reasoning": "<one line>"
}`;

interface RouteResponse {
  job: UserJob;
  tool_request: ChatToolRequest | null;
  reasoning: string;
}

export async function routeMessage(
  userMessage: string,
  recentContext: string
): Promise<RouteResponse> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Recent context:\n${recentContext || "none"}\n\nUser message: "${userMessage}"`,
    },
  ];

  try {
    return await chatCompletionJSON<RouteResponse>(messages, {
      temperature: 0.1,
      max_tokens: 512,
    });
  } catch {
    return {
      job: "coaching",
      tool_request: null,
      reasoning: "Router failed, fell back to coaching",
    };
  }
}

export function isDestructive(message: string): boolean {
  return /\b(delete|clear|remove|undo|reset)\b.*\b(log|workout|nutrition|today|entry|all)\b/i.test(message);
}
