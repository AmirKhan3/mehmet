import { query, queryOne } from "./db";
import type { Card, ActionDescriptor } from "@/types";
import { commitLogWorkout, commitCorrectWorkout } from "./tools/workout";
import { commitSetupNutritionTargets, commitCorrectNutrition, commitDeleteNutritionEntry } from "./tools/nutrition";
import { commitActivateRoutine } from "./tools/routines";
import { commitMoveSession } from "./tools/schedule";

type PendingRow = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  expires_at: string | null;
};

// Editable top-level keys per action type (security allow-list for LLM patches)
const EDITABLE_FIELDS: Record<string, string[]> = {
  log_workout: ["exercises", "date"],
  correct_workout: ["after"],
  setup_nutrition_targets: ["weight_lbs", "goal", "training_days_per_week"],
  correct_nutrition: ["after"],
  move_session: ["target_date"],
};

const STANDARD_ACTIONS: ActionDescriptor[] = [
  { label: "Confirm", kind: "confirm" },
  { label: "Cancel", kind: "cancel" },
  { label: "Edit", kind: "edit" },
];
const CONFIRM_CANCEL: ActionDescriptor[] = [
  { label: "Confirm", kind: "confirm" },
  { label: "Cancel", kind: "cancel" },
];

export type ResolvePendingResult = { text: string; card: Card };

export async function resolvePendingAction(
  pendingId: number,
  action: "confirm" | "cancel" | "edit",
  patch?: Record<string, unknown>
): Promise<ResolvePendingResult> {
  const row = await queryOne(
    `SELECT id, type, payload, status, expires_at FROM pending_actions WHERE id = $1 AND athlete_profile_id = 1`,
    [pendingId]
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
        await query(`DELETE FROM routines WHERE id = $1 AND status = 'draft' AND athlete_profile_id = 1`, [id]);
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

  const resultCard = await commitFn(row.payload);
  await query(
    `UPDATE pending_actions SET status = 'confirmed', resolved_at = NOW(), result_card_json = $1::jsonb WHERE id = $2`,
    [JSON.stringify(resultCard), pendingId]
  );
  return { text: narrate(row.type, row.payload, resultCard), card: resultCard };
}

export async function resolveLatestPendingId(): Promise<number | null> {
  const row = await queryOne(
    `SELECT id FROM pending_actions WHERE athlete_profile_id = 1 AND status = 'pending' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`
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
        actions: [{ label: "Yes, delete", kind: "confirm" }, { label: "Cancel", kind: "cancel" }],
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
      const exs = (payload.exercises as Array<{ name: string; sets: number; reps: number }>) || [];
      if (exs.length === 1) return `Logged ${exs[0].sets}×${exs[0].reps} ${exs[0].name}.`;
      return `Logged ${exs.length} exercises for ${fmtDate(payload.date as string)}.`;
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
    default: return "Done.";
  }
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Lazy map avoids circular-import issues — functions are resolved at call time, not module init
const COMMIT_FNS: Record<string, (p: Record<string, unknown>) => Promise<Card>> = {
  log_workout: (p) => commitLogWorkout(p as Parameters<typeof commitLogWorkout>[0]),
  correct_workout: (p) => commitCorrectWorkout(p as Parameters<typeof commitCorrectWorkout>[0]),
  setup_nutrition_targets: (p) => commitSetupNutritionTargets(p as Parameters<typeof commitSetupNutritionTargets>[0]),
  correct_nutrition: (p) => commitCorrectNutrition(p as Parameters<typeof commitCorrectNutrition>[0]),
  delete_nutrition_entry: (p) => commitDeleteNutritionEntry(p as Parameters<typeof commitDeleteNutritionEntry>[0]),
  activate_routine: (p) => commitActivateRoutine(p as Parameters<typeof commitActivateRoutine>[0]),
  move_session: (p) => commitMoveSession(p as Parameters<typeof commitMoveSession>[0]),
};
