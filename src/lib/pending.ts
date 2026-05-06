import { query, queryOne } from "./db";
import type { Card, ActionDescriptor } from "@/types";
import { commitLogWorkout, commitCorrectWorkout } from "./tools/workout";
import { commitSetupNutritionTargets, commitCorrectNutrition, commitDeleteNutritionEntry, commitAddNutritionRule, commitEditNutritionRule, commitRemoveNutritionRule, commitRemoveDayTypeTarget, commitImportNutritionPlan } from "./tools/nutrition";
import { commitActivateRoutine } from "./tools/routines";
import { commitMoveSession } from "./tools/schedule";

type PendingRow = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  expires_at: string | null;
};

const EDITABLE_FIELDS: Record<string, string[]> = {
  log_workout: ["exercises", "date"],
  correct_workout: ["after"],
  setup_nutrition_targets: ["weight_lbs", "goal", "training_days_per_week", "day_type"],
  correct_nutrition: ["after"],
  move_session: ["target_date"],
  add_nutrition_rule: ["name", "definition"],
  edit_nutrition_rule: ["after"],
  remove_nutrition_rule: [],
  remove_day_type_target: [],
  import_nutrition_plan: ["targets", "rules", "diet", "goal"],
};

const STANDARD_ACTIONS: ActionDescriptor[] = [
  { label: "Accept", kind: "confirm" },
  { label: "Cancel", kind: "cancel" },
];
const CONFIRM_CANCEL: ActionDescriptor[] = [
  { label: "Accept", kind: "confirm" },
  { label: "Cancel", kind: "cancel" },
];

export type ResolvePendingResult = { text: string; card: Card };

export async function resolvePendingAction(
  athleteId: number,
  pendingId: number,
  action: "confirm" | "cancel" | "edit",
  patch?: Record<string, unknown>
): Promise<ResolvePendingResult> {
  const row = await queryOne(
    `SELECT id, type, payload, status, expires_at FROM pending_actions WHERE id = $1 AND athlete_profile_id = $2`,
    [pendingId, athleteId]
  ) as PendingRow | null;

  if (!row) throw Object.assign(new Error("Pending action not found"), { statusCode: 404 });
  if (row.status !== "pending") throw Object.assign(new Error(`Action already ${row.status}`), { statusCode: 409 });
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await query(`UPDATE pending_actions SET status = 'expired', resolved_at = NOW() WHERE id = $1`, [pendingId]);
    throw Object.assign(new Error("Preview expired — start over"), { statusCode: 410 });
  }

  if (action === "cancel") {
    await query(`UPDATE pending_actions SET status = 'cancelled', resolved_at = NOW() WHERE id = $1`, [pendingId]);
    if (row.type === "import_routine") {
      const ids = (row.payload.routine_ids as number[]) || [];
      for (const id of ids) {
        await query(`DELETE FROM routines WHERE id = $1 AND status = 'draft' AND athlete_profile_id = $2`, [id, athleteId]);
      }
    }
    const card = buildPreviewCard(row.type, row.payload, pendingId);
    return { text: "Cancelled.", card: { type: "confirmation", title: "Cancelled", data: { outcome: "cancelled", pending_id: pendingId, original: card.data } } };
  }

  if (action === "edit") {
    if (!patch || Object.keys(patch).length === 0) {
      throw Object.assign(new Error("No patch provided"), { statusCode: 400 });
    }
    const allowed = EDITABLE_FIELDS[row.type] ?? [];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (allowed.includes(key)) safePatch[key] = patch[key];
    }
    if (Object.keys(safePatch).length === 0) {
      throw Object.assign(new Error("No valid editable fields in patch"), { statusCode: 400 });
    }
    const newPayload = { ...row.payload, ...safePatch };
    await query(
      `UPDATE pending_actions SET payload = $1::jsonb WHERE id = $2`,
      [JSON.stringify(newPayload), pendingId]
    );
    const card = buildPreviewCard(row.type, newPayload, pendingId);
    return { text: "", card };
  }

  // confirm
  const commitFn = COMMIT_FNS[row.type];
  if (!commitFn) throw new Error(`No commit handler for type: ${row.type}`);

  const resultCard = await commitFn(athleteId, row.payload);
  await query(
    `UPDATE pending_actions SET status = 'confirmed', resolved_at = NOW(), result_card_json = $1::jsonb WHERE id = $2`,
    [JSON.stringify(resultCard), pendingId]
  );
  return { text: narrate(row.type, row.payload, resultCard), card: resultCard };
}

export async function resolveLatestPendingId(athleteId: number): Promise<number | null> {
  const row = await queryOne(
    `SELECT id FROM pending_actions WHERE athlete_profile_id = $1 AND status = 'pending' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
    [athleteId]
  );
  return (row?.id as number) ?? null;
}

export function buildPreviewCard(type: string, payload: Record<string, unknown>, pendingId: number): Card {
  const editableFields = EDITABLE_FIELDS[type] ?? [];
  const actions = editableFields.length > 0 ? STANDARD_ACTIONS : CONFIRM_CANCEL;

  switch (type) {
    case "log_workout":
      return {
        type: "workout_log_preview",
        title: `Log Workout · ${fmtDate(payload.date as string)}`,
        data: { date: payload.date, exercises: payload.exercises, source_session: payload.source_session ?? null },
        pending_id: pendingId, actions, editable_fields: editableFields,
      };
    case "correct_workout":
      return {
        type: "workout_correction_preview",
        title: "Edit Workout Entry",
        data: { entry_id: payload.entry_id, before: payload.before, after: payload.after },
        pending_id: pendingId, actions, editable_fields: editableFields,
      };
    case "setup_nutrition_targets":
      return {
        type: "nutrition_setup_preview",
        title: "Set Macro Targets",
        data: {
          weight_lbs: payload.weight_lbs, goal: payload.goal,
          training_days_per_week: payload.training_days_per_week, computed: payload.computed,
        },
        pending_id: pendingId, actions, editable_fields: editableFields,
      };
    case "correct_nutrition":
      return {
        type: "nutrition_correction_preview",
        title: "Edit Nutrition Entry",
        data: { entry_id: payload.entry_id, before: payload.before, after: payload.after },
        pending_id: pendingId, actions, editable_fields: editableFields,
      };
    case "delete_nutrition_entry":
      return {
        type: "confirmation",
        title: "Delete Entry",
        data: { action: "delete_nutrition_entry", message: `Delete "${payload.item_name}"?` },
        pending_id: pendingId,
        actions: [{ label: "Delete", kind: "confirm" }, { label: "Cancel", kind: "cancel" }],
      };
    case "activate_routine":
      return {
        type: "routine_activation_preview",
        title: "Activate Routine",
        data: { routine_id: payload.routine_id, routine_name: payload.routine_name },
        pending_id: pendingId, actions: CONFIRM_CANCEL,
      };
    case "move_session":
      return {
        type: "program_edit_preview",
        title: `Move ${payload.source} → ${fmtDate(payload.target_date as string)}`,
        data: {
          action: "move_session", source: payload.source,
          target_date: payload.target_date, session_type: payload.session_type,
          pending_confirmation: true,
        },
        pending_id: pendingId, actions, editable_fields: editableFields,
      };
    case "import_routine":
      return {
        type: "routine_import_preview",
        title: (payload.routines as Array<{ name: string }>)?.[0]?.name ?? "Imported Routine",
        data: {
          routine_ids: payload.routine_ids, routines: payload.routines,
          phases: payload.phases, total_exercises: payload.total_exercises, status: "draft",
        },
        pending_id: pendingId,
        actions: [{ label: "Activate", kind: "confirm" }, { label: "Discard", kind: "cancel" }],
      };
    case "add_nutrition_rule":
      return {
        type: "nutrition_rule_add_preview",
        title: `Add Rule · ${payload.name as string}`,
        data: { name: payload.name, definition: payload.definition },
        pending_id: pendingId, actions: STANDARD_ACTIONS, editable_fields: editableFields,
      };
    case "edit_nutrition_rule":
      return {
        type: "nutrition_rule_edit_preview",
        title: `Edit Rule · ${payload.original_name as string}`,
        data: { before: payload.before, after: payload.after },
        pending_id: pendingId, actions: STANDARD_ACTIONS, editable_fields: editableFields,
      };
    case "remove_nutrition_rule":
      return {
        type: "confirmation",
        title: "Remove Rule",
        data: { action: "remove_nutrition_rule", message: `Remove "${payload.name as string}"?` },
        pending_id: pendingId,
        actions: [{ label: "Yes, remove", kind: "confirm" }, { label: "Cancel", kind: "cancel" }],
      };
    case "remove_day_type_target":
      return {
        type: "confirmation",
        title: "Drop Day-Type Split",
        data: { action: "remove_day_type_target", message: `Drop the ${payload.day_type as string}-day macro split? (Default targets stay.)` },
        pending_id: pendingId,
        actions: [{ label: "Yes, drop", kind: "confirm" }, { label: "Cancel", kind: "cancel" }],
      };
    case "import_nutrition_plan":
      return {
        type: "nutrition_plan_import_preview",
        title: "Import Nutrition Plan",
        data: { targets: payload.targets, rules: payload.rules, diet: payload.diet, goal: payload.goal },
        pending_id: pendingId,
        actions: [{ label: "Activate Plan", kind: "confirm" }, { label: "Discard", kind: "cancel" }, { label: "Edit", kind: "edit" }],
        editable_fields: editableFields,
      };
    default:
      return {
        type: "confirmation",
        title: "Confirm Action",
        data: { pending_id: pendingId },
        pending_id: pendingId, actions: CONFIRM_CANCEL,
      };
  }
}

function narrate(type: string, payload: Record<string, unknown>, _card: Card): string {
  switch (type) {
    case "log_workout": {
      const exs = (payload.exercises as Array<{ name: string; sets: number; reps: number; duration_sec?: number | null; is_amrap?: boolean | null; skipped?: boolean }>) || [];
      const done = exs.filter((e) => !e.skipped);
      if (done.length === 1) {
        const e = done[0];
        const vol = e.is_amrap ? `${e.sets}×AMRAP` : e.duration_sec ? `${e.sets}×${e.duration_sec}s` : `${e.sets}×${e.reps}`;
        return `Logged ${vol} ${e.name}.`;
      }
      return `Logged ${done.length} exercises for ${fmtDate(payload.date as string)}.`;
    }
    case "correct_workout": return "Workout entry updated.";
    case "setup_nutrition_targets": {
      const c = payload.computed as Record<string, number> | undefined;
      return `Targets set — ${payload.goal} at ${c?.calories_max ?? "?"} kcal, ${c?.protein_max_g ?? "?"}g protein.`;
    }
    case "correct_nutrition": return "Nutrition entry updated.";
    case "delete_nutrition_entry": return `Removed ${payload.item_name as string}.`;
    case "activate_routine": return `${payload.routine_name as string} is now active.`;
    case "move_session": return `Moved ${payload.source as string} to ${fmtDate(payload.target_date as string)}.`;
    case "import_routine": {
      const name = (payload.routines as Array<{ name: string }>)?.[0]?.name ?? "routine";
      return `${name} activated.`;
    }
    case "add_nutrition_rule": return `Saved "${payload.name as string}".`;
    case "edit_nutrition_rule": return "Rule updated.";
    case "remove_nutrition_rule": return `Removed "${payload.name as string}".`;
    case "remove_day_type_target": return `Dropped ${payload.day_type as string}-day split.`;
    case "import_nutrition_plan": {
      const t = (payload.targets as Array<unknown>)?.length ?? 0;
      const r = (payload.rules as Array<unknown>)?.length ?? 0;
      return `Plan activated — ${t} target row${t === 1 ? "" : "s"}, ${r} rule${r === 1 ? "" : "s"}.`;
    }
    default: return "Done.";
  }
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const COMMIT_FNS: Record<string, (athleteId: number, p: Record<string, unknown>) => Promise<Card>> = {
  log_workout: (id, p) => commitLogWorkout(id, p as Parameters<typeof commitLogWorkout>[1]),
  correct_workout: (id, p) => commitCorrectWorkout(id, p as Parameters<typeof commitCorrectWorkout>[1]),
  setup_nutrition_targets: (id, p) => commitSetupNutritionTargets(id, p as Parameters<typeof commitSetupNutritionTargets>[1]),
  correct_nutrition: (id, p) => commitCorrectNutrition(id, p as Parameters<typeof commitCorrectNutrition>[1]),
  delete_nutrition_entry: (id, p) => commitDeleteNutritionEntry(id, p as Parameters<typeof commitDeleteNutritionEntry>[1]),
  activate_routine: (id, p) => commitActivateRoutine(id, p as Parameters<typeof commitActivateRoutine>[1]),
  move_session: (id, p) => commitMoveSession(id, p as Parameters<typeof commitMoveSession>[1]),
  add_nutrition_rule: (id, p) => commitAddNutritionRule(id, p as Parameters<typeof commitAddNutritionRule>[1]),
  edit_nutrition_rule: (id, p) => commitEditNutritionRule(id, p as Parameters<typeof commitEditNutritionRule>[1]),
  remove_nutrition_rule: (id, p) => commitRemoveNutritionRule(id, p as Parameters<typeof commitRemoveNutritionRule>[1]),
  remove_day_type_target: (id, p) => commitRemoveDayTypeTarget(id, p as Parameters<typeof commitRemoveDayTypeTarget>[1]),
  import_nutrition_plan: (id, p) => commitImportNutritionPlan(id, p as Parameters<typeof commitImportNutritionPlan>[1]),
};
