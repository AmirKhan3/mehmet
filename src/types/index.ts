export type UserJob =
  | "view_schedule"
  | "edit_schedule_preview"
  | "log_workout"
  | "view_workout_logs"
  | "log_nutrition"
  | "view_nutrition"
  | "correct_workout"
  | "correct_nutrition"
  | "coaching"
  | "general";

export type Domain = "schedule" | "workout" | "nutrition" | "meta";

export type CardType =
  | "schedule_plan"
  | "weekday_template"
  | "schedule_week"
  | "program_edit_preview"
  | "workout_logged"
  | "workout_logs"
  | "workout_corrected"
  | "nutrition_item_logged"
  | "nutrition_day"
  | "nutrition_targets_vs_actuals"
  | "nutrition_corrected"
  | "confirmation";

export interface ChatToolRequest {
  domain: Domain;
  tool: string;
  args: Record<string, unknown>;
  confidence: number;
}

export interface Card {
  type: CardType;
  title: string;
  data: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: Card[];
  timestamp: number;
}

export interface RouterResult {
  job: UserJob;
  tool_request: ChatToolRequest | null;
  narration: string;
  cards: Card[];
}
