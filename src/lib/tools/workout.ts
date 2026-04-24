import { query, queryOne } from "../db";
import type { Card } from "@/types";

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

  const logged: { name: string; sets: number; reps: number }[] = [];

  for (const ex of exercises) {
    const catalogRow = await queryOne(
      `SELECT id FROM exercise_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [ex.name]
    );

    const exerciseId = catalogRow?.id || null;

    await query(
      `INSERT INTO workout_logs (athlete_profile_id, date, exercise_id, sets, reps, status, modifier, source_message_id)
       VALUES (1, $1, $2, $3, $4, 'completed', $5, $6)
       ON CONFLICT (dedup_key) DO NOTHING`,
      [date, exerciseId, ex.sets || 1, ex.reps || 0, ex.modifier || null, `msg-${Date.now()}`]
    );

    logged.push({ name: ex.name, sets: ex.sets || 1, reps: ex.reps || 0 });
  }

  return {
    type: "workout_logged",
    title: `Workout Logged · ${formatDate(date)}`,
    data: { date, exercises: logged, source_session: args.source_session || null },
  };
}

export async function getWorkoutLogs(args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const rows = await query(
    `SELECT wl.*, ec.name as exercise_name
     FROM workout_logs wl
     LEFT JOIN exercise_catalog ec ON ec.id = wl.exercise_id
     WHERE wl.date = $1
     ORDER BY wl.id`,
    [date]
  );

  const scheduled = await query(
    `SELECT ec.name
     FROM schedule_templates st
     JOIN schedule_template_exercises ste ON ste.template_id = st.id
     JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     WHERE st.weekday = $1`,
    [new Date(date + "T12:00:00").getDay()]
  );

  return {
    type: "workout_logs",
    title: `${formatDate(date)} · Workout`,
    data: {
      date,
      logs: rows.map((r) => ({
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

  const sets = ["sets", "reps", "status", "skipped", "modifier"]
    .filter((k) => args.changes[k] !== undefined)
    .map((k, i) => `${k} = $${i + 2}`)
    .join(", ");

  const values = ["sets", "reps", "status", "skipped", "modifier"]
    .filter((k) => args.changes[k] !== undefined)
    .map((k) => args.changes[k]);

  if (sets) {
    await query(`UPDATE workout_logs SET ${sets} WHERE id = $1`, [args.entry_id, ...values]);
  }

  return {
    type: "workout_corrected",
    title: "Entry Updated",
    data: { entry_id: args.entry_id, changes: args.changes },
  };
}

function resolveDate(date?: string): string {
  if (!date || date === "today") return new Date().toISOString().split("T")[0];
  if (date === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }
  return date;
}

function weekdayIndex(name: string): number {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days.indexOf(name.toLowerCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
