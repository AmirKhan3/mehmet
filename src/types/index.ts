export type UserJob =
  | "view_schedule"
  | "edit_schedule_preview"
  | "log_workout"
  | "view_workout_logs"
  | "log_nutrition"
  | "view_nutrition"
  | "correct_workout"
  | "correct_nutrition"
  | "import_routine"
  | "list_routines"
  | "activate_routine"
  | "coaching"
  | "general";

export type Domain = "schedule" | "workout" | "nutrition" | "routine" | "meta";

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
  | "nutrition_deleted"
  | "nutrition_restored"
  | "meal_suggestion"
  | "routine_import_preview"
  | "routine_list"
  | "routine_detail"
  | "confirmation";

export interface ParsedExercise {
  name_raw: string;
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  tempo?: string | null;
  rir_min?: number | null;
  rir_max?: number | null;
  load_notes?: string | null;
  duration_sec?: number | null;
  is_amrap?: boolean;
}

export interface ParsedBlock {
  block_type: "straight" | "circuit" | "amrap" | "superset";
  rounds?: number | null;
  rest_between_exercises_sec?: number | null;
  rest_between_rounds_sec?: number | null;
  notes?: string | null;
  exercises: ParsedExercise[];
}

export interface ParsedDay {
  day_index: number;
  name: string;
  session_type: string;
  is_rest_day: boolean;
  notes?: string | null;
  blocks: ParsedBlock[];
}

export interface ParsedRoutine {
  name: string;
  schedule_mode: "weekday" | "cycle";
  phase_label?: string | null;
  days: ParsedDay[];
}

export interface ParsedRoutineResult {
  routines: ParsedRoutine[];
}

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
