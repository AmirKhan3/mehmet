# StrongAI — Agent Architecture Spec

## Overview

StrongAI is a chat-first fitness, nutrition, and training system.

The user interacts through natural language. The system interprets intent, executes actions via tools, and returns structured UI cards grounded in database truth.

---

# 1. Core Principles

### Separation of responsibilities

- **LLM**: interprets intent, selects tools, produces short narration
- **Deterministic gate**: safety only (delete, confirm)
- **Database**: source of truth
- **UI**: renders structured cards

### No hallucinated state

The system must never invent workouts, nutrition logs, progress, or schedule data. All factual responses must come from tools backed by DB queries.

### Card-first UX

- Cards are the primary output
- Text is secondary narration
- Multiple cards can appear per message

---

# 2. Jobs To Be Done

### Planning
- "What's my workout today?"
- "What's my routine?"
- "What about Tuesday?"

### Editing schedule
- "Move Tuesday to today"
- "Make Friday a rest day"

### Executing workouts
- "I did everything"
- "Finished everything except last sets"
- "3 circuits, 10 reps for goblet squats"

### Tracking progress
- "What did I finish today?"
- "How am I doing?"

### Nutrition
- "Log 2 eggs"
- "What did I eat today?"
- "How much protein left?"

### Corrections
- "Remove the pasta"
- "Fix the last set"

### Safety
- "Delete today's logs"
- "Yes" (confirmation)

### Coaching
- "How does progressive overload work?"
- "Can I have Costco tilapia?"
- "When can I move to a 24kg kettlebell?"

### General
- "Which LLM is this?"

---

# 3. Database Model

## athlete_profile
- id, name, height, weight, goals, preferences (JSONB)
- Single row. No multi-user auth.

## schedule_templates
- athlete_profile_id, weekday (0-6), session_type, notes

## schedule_template_exercises
- template_id, exercise_id, sort_order, sets, reps, tempo, notes

## schedule_overrides
- athlete_profile_id, date, override_type, workout_type, is_rest_day, metadata (JSONB), exercises (JSONB)

## workout_logs
- athlete_profile_id, date, exercise_id, sets, reps, round_number, status, modifier, exception_type, skipped, partial, dedup_key, source_message_id

## exercise_catalog
- id, name, slug, category, equipment, muscles (JSONB), is_custom

## nutrition_entries
- athlete_profile_id, date, item_name, quantity, calories, protein_g, carbs_g, fat_g, source, source_message_id

## nutrition_targets
- athlete_profile_id, day_type, calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g

## pending_actions
- type, payload (JSONB), expires_at

## chat_messages
- role, text, cards_json, tool_requests, tool_results

## assistant_memory
- athlete_profile_id, summary
- Preferences and durable facts only. NOT transient state.

---

# 4. Routing Model

## Deterministic gate (before LLM)

Safety only:
- "delete" / "clear" / "undo" -> create pending_action, return confirmation card
- "yes" / "confirm" -> execute pending_action

Everything else goes to the LLM router.

## LLM router

Classifies user intent into one of these jobs:

```
type UserJob =
  | "view_schedule"         // today's plan, a weekday, or the full week
  | "edit_schedule_preview" // move, swap, override — always preview first
  | "log_workout"           // log performed exercises
  | "view_workout_logs"     // what did I finish
  | "log_nutrition"         // log food item
  | "view_nutrition"        // what did I eat, remaining macros
  | "correct_workout"       // fix a logged exercise
  | "correct_nutrition"     // remove/fix a logged food item
  | "coaching"              // training advice, food questions, progression
  | "general"               // meta, system questions
```

## Tool selection

The LLM router returns:

```
type ChatToolRequest = {
  domain: "schedule" | "workout" | "nutrition" | "meta"
  tool: string
  args: object
  confidence: number
}
```

---

# 5. Domain Tools

## Schedule

| Intent | Tool | Card |
|--------|------|------|
| today's plan | getResolvedPlan | schedule_plan |
| specific weekday | getTemplateForWeekday | weekday_template |
| full week | getResolvedWeek | schedule_week |
| move/swap session | previewMoveSession | program_edit_preview |
| override a day | previewDailyOverride | program_edit_preview |

## Workout

| Intent | Tool | Card |
|--------|------|------|
| log exercises | logWorkoutEntry | workout_logged |
| view today's logs | getWorkoutLogs | workout_logs |
| correct a log | correctWorkoutEntry | workout_corrected |

## Nutrition

| Intent | Tool | Card |
|--------|------|------|
| log food | logNutritionItem | nutrition_item_logged |
| view day's food | getNutritionDay | nutrition_day |
| remaining macros | getNutritionTargetsVsActuals | nutrition_targets_vs_actuals |
| correct an entry | correctNutritionEntry | nutrition_corrected |

## Coaching / General

No tools. LLM answers from its training data + assistant_memory. No DB grounding required.

---

# 6. UX Rules

- Cards over text. Never dump exercise lists in plain text when a card exists.
- Previews must clearly state what changes, what stays, and that confirmation is required.
- Destructive actions must confirm before executing.
- No silent writes. No silent failures.
- schedule != workout != nutrition. Never cross domains.
- Logs come only from workout_logs. Nutrition comes only from nutrition_entries. Schedule comes only from templates/overrides.
- Derived values (totals, remaining macros, progress counts) are computed at query time from source tables. No derived-state tables.

---

# 7. System Guarantees

- All factual card data comes from DB via tools
- The LLM never fabricates workout, nutrition, or schedule data
- Write operations always go through tool dispatch, never inline in narration
- Corrections target existing rows, never create new entries
- Pending actions expire (prevent stale confirmations)
