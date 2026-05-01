import { query, queryOne } from "../db";
import { buildPreviewCard } from "../pending";
import type { Card } from "@/types";

const EXPIRES_MINUTES = 30;

export async function logWorkoutEntry(args: {
  exercises?: { name: string; sets?: number; reps?: number; modifier?: string }[];
  date?: string;
  source_session?: string;
}): Promise<Card> {
  const date = resolveDate(args.date);
  let exercises = args.exercises || [];

  if (!exercises.length && args.source_session) {
    const dayIndex = weekdayIndex(args.source_session);
    if (dayIndex >= 0) {
      const rows = await query(
        `SELECT ec.name, ste.sets, ste.reps
         FROM schedule_templates st
         JOIN schedule_template_exercises ste ON ste.template_id = st.id
         JOIN exercise_catalog ec ON ec.id = ste.exercise_id
         WHERE st.weekday = $1
         ORDER BY ste.sort_order`,
        [dayIndex]
      );
      exercises = rows.map((r) => ({ name: r.name as string, sets: r.sets as number, reps: r.reps as number }));
    }
  }

  // Resolve exercise IDs upfront so the preview shows what will be written
  const resolved = await Promise.all(
    exercises.map(async (ex) => {
      const row = await queryOne(
        `SELECT id FROM exercise_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [ex.name]
      );
      return { name: ex.name, sets: ex.sets ?? 1, reps: ex.reps ?? 0, modifier: ex.modifier ?? null, exercise_id: (row?.id as number) ?? null };
    })
  );

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { date, exercises: resolved, source_session: args.source_session ?? null };

  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES (1, 'log_workout', $1::jsonb, $2) RETURNING id`,
    [JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("log_workout", payload, pendingId);
}

export async function commitLogWorkout(payload: {
  date: string;
  exercises: { name: string; sets: number; reps: number; modifier?: string | null; exercise_id?: number | null }[];
  source_session?: string | null;
}): Promise<Card> {
  const logged: { name: string; sets: number; reps: number; entry_id: number }[] = [];

  for (const ex of payload.exercises) {
    const exerciseId = ex.exercise_id ?? null;
    const dedup = `${payload.date}:${exerciseId ?? ex.name}:${ex.sets}:${ex.reps}`;
    const rows = await query(
      `INSERT INTO workout_logs (athlete_profile_id, date, exercise_id, sets, reps, status, modifier, dedup_key)
       VALUES (1, $1, $2, $3, $4, 'completed', $5, $6)
       ON CONFLICT (dedup_key) DO UPDATE SET sets = EXCLUDED.sets, reps = EXCLUDED.reps
       RETURNING id`,
      [payload.date, exerciseId, ex.sets, ex.reps, ex.modifier ?? null, dedup]
    );
    logged.push({ name: ex.name, sets: ex.sets, reps: ex.reps, entry_id: rows[0].id as number });
  }

  return {
    type: "workout_logged",
    title: `Workout Logged · ${formatDate(payload.date)}`,
    data: { date: payload.date, exercises: logged, source_session: payload.source_session ?? null },
  };
}

export async function getWorkoutLogs(args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const rows = await query(
    `SELECT wl.*, ec.name as exercise_name
     FROM workout_logs wl
     LEFT JOIN exercise_catalog ec ON ec.id = wl.exercise_id
     WHERE wl.athlete_profile_id = 1 AND wl.date = $1
     ORDER BY wl.id`,
    [date]
  );

  const scheduled = await query(
    `SELECT ec.name
     FROM schedule_templates st
     JOIN schedule_template_exercises ste ON ste.template_id = st.id
     JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     WHERE st.athlete_profile_id = 1 AND st.weekday = $1`,
    [new Date(date + "T12:00:00").getDay()]
  );

  return {
    type: "workout_logs",
    title: `${formatDate(date)} · Workout`,
    data: {
      date,
      logs: rows.map((r) => ({
        id: r.id,
        name: r.exercise_name || "Unknown",
        sets: r.sets,
        reps: r.reps,
        status: r.status,
        skipped: r.skipped,
      })),
      completed: rows.filter((r) => !r.skipped).length,
      planned: scheduled.length,
    },
  };
}

export async function correctWorkoutEntry(args: {
  entry_id?: number;
  changes: Record<string, unknown>;
}): Promise<Card> {
  if (!args.entry_id) {
    return { type: "workout_corrected", title: "Correction", data: { error: "No entry ID provided" } };
  }

  const existing = await queryOne(
    `SELECT sets, reps, status, skipped, modifier FROM workout_logs WHERE id = $1`,
    [args.entry_id]
  );
  if (!existing) {
    return { type: "workout_corrected", title: "Correction", data: { error: "Entry not found" } };
  }

  const before = { sets: existing.sets, reps: existing.reps, status: existing.status, skipped: existing.skipped, modifier: existing.modifier };
  const after = { ...before };
  for (const k of ["sets", "reps", "status", "skipped", "modifier"] as const) {
    if (args.changes[k] !== undefined) after[k] = args.changes[k] as never;
  }

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { entry_id: args.entry_id, before, after };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES (1, 'correct_workout', $1::jsonb, $2) RETURNING id`,
    [JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("correct_workout", payload, pendingId);
}

export async function commitCorrectWorkout(payload: {
  entry_id: number;
  after: Record<string, unknown>;
}): Promise<Card> {
  const fields = ["sets", "reps", "status", "skipped", "modifier"].filter((k) => payload.after[k] !== undefined);

  if (fields.length) {
    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => payload.after[k]);
    await query(`UPDATE workout_logs SET ${sets} WHERE id = $1`, [payload.entry_id, ...values]);
  }

  return {
    type: "workout_corrected",
    title: "Entry Updated",
    data: { entry_id: payload.entry_id, changes: payload.after },
  };
}

function resolveDate(date?: string): string {
  if (!date || date === "today") return todayPT();
  if (date === "yesterday") return yesterdayPT();
  return date;
}

function todayPT(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function yesterdayPT(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function weekdayIndex(name: string): number {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days.indexOf(name.toLowerCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
