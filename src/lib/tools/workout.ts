import { query, queryOne } from "../db";
import { buildPreviewCard } from "../pending";
import type { Card } from "@/types";

const EXPIRES_MINUTES = 120;

type RoutineExercise = {
  name: string;
  sets: number;
  reps: number;
  reps_min: number | null;
  reps_max: number | null;
  is_amrap: boolean | null;
  duration_sec: number | null;
  load_notes: string | null;
  modifier: string | null;
  skipped: boolean;
};

type LLMExercise = {
  name: string;
  sets?: number;
  reps?: number;
  duration_sec?: number;
  is_amrap?: boolean;
  modifier?: string;
  skipped?: boolean;
  replaces?: string;
};

function matchesBase(baseName: string, testName: string): boolean {
  const baseFirst = baseName.split(" ")[0].toLowerCase();
  const testFirst = testName.split(" ")[0].toLowerCase();
  return (
    baseName.toLowerCase().includes(testName.toLowerCase()) ||
    testName.toLowerCase().includes(baseFirst) ||
    baseFirst === testFirst
  );
}

export async function logWorkoutEntry(athleteId: number, args: {
  exercises?: LLMExercise[];
  date?: string;
  source_session?: string;
}): Promise<Card> {
  const date = resolveDate(args.date);
  let exercises: RoutineExercise[] = [];
  const rawExercises = args.exercises || [];

  if (args.source_session) {
    const dayIndex = weekdayIndex(args.source_session);
    if (dayIndex >= 0) {
      const rows = await query(
        `SELECT COALESCE(ec.name, re.name_raw) AS name,
                re.sets, re.reps_min, re.reps_max, re.is_amrap, re.duration_sec, re.load_notes
         FROM routines r
         JOIN routine_days rd ON rd.routine_id = r.id AND rd.day_index = $2
         JOIN routine_blocks rb ON rb.routine_day_id = rd.id
         JOIN routine_exercises re ON re.routine_block_id = rb.id
         LEFT JOIN exercise_catalog ec ON ec.id = re.exercise_id
         WHERE r.athlete_profile_id = $1 AND r.status = 'active'
         ORDER BY rb.sort_order, re.sort_order`,
        [athleteId, dayIndex]
      );

      const routineBase: RoutineExercise[] = rows.map((r) => ({
        name: r.name as string,
        sets: (r.sets as number) ?? 1,
        reps: (r.reps_min as number) ?? 0,
        reps_min: r.reps_min as number | null,
        reps_max: r.reps_max as number | null,
        is_amrap: r.is_amrap as boolean | null,
        duration_sec: r.duration_sec as number | null,
        load_notes: r.load_notes as string | null,
        modifier: null,
        skipped: false,
      }));

      // Pre-pass: mark routine exercises as skipped when a swap uses replaces
      const swappedOutNames = new Set<string>();
      for (const o of rawExercises) {
        if (o.replaces) {
          const target = routineBase.find((b) => matchesBase(b.name, o.replaces!));
          if (target) {
            target.skipped = true;
            swappedOutNames.add(target.name);
          }
        }
      }

      // Merge: apply LLM overrides onto matched routine exercises
      const merged: RoutineExercise[] = routineBase.map((base) => {
        if (swappedOutNames.has(base.name)) return base; // already handled by swap
        const override = rawExercises.find(
          (o) => !o.replaces && matchesBase(base.name, o.name)
        );
        if (override) {
          return {
            ...base,
            sets: override.sets ?? base.sets,
            reps: override.reps ?? base.reps,
            duration_sec: override.duration_sec ?? base.duration_sec,
            is_amrap: override.is_amrap ?? base.is_amrap,
            modifier: override.modifier ?? null,
            skipped: override.skipped ?? false,
          };
        }
        return base;
      });

      // Append LLM exercises not matched to any routine exercise (swaps/additions)
      for (const o of rawExercises) {
        const alreadyRepresented =
          swappedOutNames.has(o.name) || // name matches an exercise that was swapped out (same-name swap)
          (!o.replaces && routineBase.some((b) => matchesBase(b.name, o.name)));
        if (!alreadyRepresented) {
          // For swaps, inherit format hints from the replaced routine exercise
          const replacedBase = o.replaces ? routineBase.find((b) => matchesBase(b.name, o.replaces!)) : null;
          merged.push({
            name: o.name,
            sets: o.sets ?? replacedBase?.sets ?? 1,
            reps: o.reps ?? (o.duration_sec ? 0 : (replacedBase?.reps ?? 0)),
            reps_min: replacedBase?.reps_min ?? null,
            reps_max: replacedBase?.reps_max ?? null,
            is_amrap: o.is_amrap ?? (o.replaces ? (replacedBase?.is_amrap ?? null) : null),
            duration_sec: o.duration_sec ?? (o.replaces ? (replacedBase?.duration_sec ?? null) : null),
            load_notes: o.replaces ? (replacedBase?.load_notes ?? null) : null,
            modifier: o.modifier ?? null,
            skipped: o.skipped ?? false,
          });
        }
      }

      exercises = merged;
    } else {
      // source_session provided but weekday unrecognized — fall back to LLM exercises
      exercises = rawExercises.map((o) => ({
        name: o.name, sets: o.sets ?? 1, reps: o.reps ?? 0,
        reps_min: null, reps_max: null,
        is_amrap: o.is_amrap ?? null, duration_sec: o.duration_sec ?? null, load_notes: null,
        modifier: o.modifier ?? null, skipped: o.skipped ?? false,
      }));
    }
  } else {
    exercises = rawExercises.map((o) => ({
      name: o.name, sets: o.sets ?? 1, reps: o.reps ?? 0,
      reps_min: null, reps_max: null,
      is_amrap: o.is_amrap ?? null, duration_sec: o.duration_sec ?? null, load_notes: null,
      modifier: o.modifier ?? null, skipped: o.skipped ?? false,
    }));
  }

  const resolved = await Promise.all(
    exercises.map(async (ex) => {
      const row = await queryOne(
        `SELECT id FROM exercise_catalog WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [ex.name]
      );
      return {
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        reps_min: ex.reps_min,
        reps_max: ex.reps_max,
        is_amrap: ex.is_amrap,
        duration_sec: ex.duration_sec,
        load_notes: ex.load_notes,
        modifier: ex.modifier,
        skipped: ex.skipped,
        exercise_id: (row?.id as number) ?? null,
      };
    })
  );

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { date, exercises: resolved, source_session: args.source_session ?? null };

  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'log_workout', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("log_workout", payload, pendingId);
}

export async function commitLogWorkout(athleteId: number, payload: {
  date: string;
  exercises: {
    name: string; sets: number; reps: number; modifier?: string | null; exercise_id?: number | null;
    skipped?: boolean; duration_sec?: number | null; is_amrap?: boolean | null;
  }[];
  source_session?: string | null;
}): Promise<Card> {
  const logged: { name: string; sets: number; reps: number; entry_id: number; skipped: boolean }[] = [];

  for (const ex of payload.exercises) {
    const exerciseId = ex.exercise_id ?? null;
    const isSkipped = ex.skipped ?? false;
    const durationSec = ex.duration_sec ?? null;
    const isAmrap = ex.is_amrap ?? null;
    const status = isSkipped ? "skipped" : "completed";
    // Dedup includes duration so 30s and 60s planks don't collide; reps-based uses reps value
    const dedupVolume = durationSec != null ? `d${durationSec}` : String(ex.reps ?? 0);
    const dedup = `${payload.date}:${exerciseId ?? ex.name}:${ex.sets}:${dedupVolume}`;
    const rows = await query(
      `INSERT INTO workout_logs (athlete_profile_id, date, exercise_id, name_raw, sets, reps, duration_sec, is_amrap, status, skipped, modifier, dedup_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (dedup_key) DO UPDATE SET sets = EXCLUDED.sets, reps = EXCLUDED.reps, duration_sec = EXCLUDED.duration_sec, is_amrap = EXCLUDED.is_amrap, name_raw = EXCLUDED.name_raw, status = EXCLUDED.status, skipped = EXCLUDED.skipped
       RETURNING id`,
      [athleteId, payload.date, exerciseId, ex.name, ex.sets, durationSec != null ? null : ex.reps, durationSec, isAmrap, status, isSkipped, ex.modifier ?? null, dedup]
    );
    logged.push({ name: ex.name, sets: ex.sets, reps: ex.reps, entry_id: rows[0].id as number, skipped: isSkipped });
  }

  return {
    type: "workout_logged",
    title: `Workout Logged · ${formatDate(payload.date)}`,
    data: { date: payload.date, exercises: logged, source_session: payload.source_session ?? null },
  };
}

export async function getWorkoutLogs(athleteId: number, args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const rows = await query(
    `SELECT wl.*, ec.name as exercise_name
     FROM workout_logs wl
     LEFT JOIN exercise_catalog ec ON ec.id = wl.exercise_id
     WHERE wl.athlete_profile_id = $1 AND wl.date = $2
     ORDER BY wl.id`,
    [athleteId, date]
  );

  const scheduled = await query(
    `SELECT ec.name
     FROM schedule_templates st
     JOIN schedule_template_exercises ste ON ste.template_id = st.id
     JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     WHERE st.athlete_profile_id = $1 AND st.weekday = $2`,
    [athleteId, new Date(date + "T12:00:00").getDay()]
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
        duration_sec: r.duration_sec ?? null,
        is_amrap: r.is_amrap ?? null,
        status: r.status,
        skipped: r.skipped,
      })),
      completed: rows.filter((r) => !r.skipped).length,
      planned: scheduled.length,
    },
  };
}

export async function correctWorkoutEntry(athleteId: number, args: {
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
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'correct_workout', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("correct_workout", payload, pendingId);
}

export async function commitCorrectWorkout(_athleteId: number, payload: {
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
