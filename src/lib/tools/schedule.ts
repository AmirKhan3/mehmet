import { query, queryOne } from "../db";
import type { Card } from "@/types";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ActiveRoutine {
  id: number;
  name: string;
  schedule_mode: "weekday" | "cycle";
  phase_label: string | null;
  cycle_start_date: string | null;
}

interface RoutineDay {
  id: number;
  day_index: number;
  name: string;
  session_type: string;
  is_rest_day: boolean;
  notes: string | null;
}

interface BlockRow {
  id: number;
  block_type: string;
  rounds: number | null;
  rest_between_exercises_sec: number | null;
  rest_between_rounds_sec: number | null;
  notes: string | null;
  exercises: {
    name: string;
    name_raw: string;
    sets: number | null;
    reps_min: number | null;
    reps_max: number | null;
    tempo: string | null;
    rir_min: number | null;
    rir_max: number | null;
    load_notes: string | null;
    is_amrap: boolean;
    duration_sec: number | null;
  }[];
}

async function getActiveRoutine(): Promise<ActiveRoutine | null> {
  return queryOne(
    `SELECT id, name, schedule_mode, phase_label, cycle_start_date
     FROM routines
     WHERE athlete_profile_id = 1 AND status = 'active'
     LIMIT 1`
  ) as Promise<ActiveRoutine | null>;
}

function utcDateMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

async function getDayIndex(routine: ActiveRoutine, date: string): Promise<number> {
  if (routine.schedule_mode === "weekday") {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  // Cycle mode: compute position from cycle_start_date using UTC to avoid DST drift
  const startStr = routine.cycle_start_date;
  if (!startStr) return 0;

  const daysSinceStart = Math.max(0, Math.floor((utcDateMs(date) - utcDateMs(startStr)) / 86400000));

  const countRow = await queryOne(
    `SELECT COUNT(*)::int as total FROM routine_days WHERE routine_id = $1`,
    [routine.id]
  );
  const totalDays = (countRow?.total as number) || 1;

  return daysSinceStart % totalDays;
}

async function getBlocksForDay(dayId: number): Promise<BlockRow[]> {
  return query(
    `SELECT rb.id, rb.block_type, rb.rounds,
            rb.rest_between_exercises_sec, rb.rest_between_rounds_sec, rb.notes,
            COALESCE(
              json_agg(
                json_build_object(
                  'name', COALESCE(ec.name, re.name_raw),
                  'name_raw', re.name_raw,
                  'sets', re.sets,
                  'reps_min', re.reps_min,
                  'reps_max', re.reps_max,
                  'tempo', re.tempo,
                  'rir_min', re.rir_min,
                  'rir_max', re.rir_max,
                  'load_notes', re.load_notes,
                  'is_amrap', re.is_amrap,
                  'duration_sec', re.duration_sec
                ) ORDER BY re.sort_order
              ) FILTER (WHERE re.id IS NOT NULL),
              '[]'
            ) as exercises
     FROM routine_blocks rb
     LEFT JOIN routine_exercises re ON re.routine_block_id = rb.id
     LEFT JOIN exercise_catalog ec ON ec.id = re.exercise_id
     WHERE rb.routine_day_id = $1
     GROUP BY rb.id
     ORDER BY rb.sort_order`,
    [dayId]
  ) as Promise<BlockRow[]>;
}

function flattenExercises(blocks: BlockRow[]) {
  return blocks.flatMap((b) =>
    b.exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets ?? null,
      reps: ex.reps_min === ex.reps_max ? ex.reps_min : null,
      reps_range: ex.reps_min !== ex.reps_max ? `${ex.reps_min}–${ex.reps_max}` : null,
      tempo: ex.tempo,
      load_notes: ex.load_notes,
      is_amrap: ex.is_amrap,
    }))
  );
}

export async function getResolvedPlan(args: { date?: string }): Promise<Card> {
  const date =
    !args.date || args.date === "today"
      ? new Date().toISOString().split("T")[0]
      : args.date;

  // Check for override first
  const override = await queryOne(
    `SELECT * FROM schedule_overrides WHERE date = $1 LIMIT 1`,
    [date]
  );
  if (override) {
    return {
      type: "schedule_plan",
      title: `Today · ${formatDate(date)}`,
      data: {
        date,
        source: "override",
        session_type: override.workout_type,
        exercises: (override.exercises as unknown[]) || [],
        blocks: [],
        is_rest_day: override.is_rest_day,
      },
    };
  }

  const routine = await getActiveRoutine();
  if (!routine) {
    return {
      type: "schedule_plan",
      title: `Today · ${formatDate(date)}`,
      data: { date, source: "none", session_type: "Rest", exercises: [], blocks: [], is_rest_day: true },
    };
  }

  const dayIndex = await getDayIndex(routine, date);
  const routineDay = await queryOne(
    `SELECT * FROM routine_days WHERE routine_id = $1 AND day_index = $2 LIMIT 1`,
    [routine.id, dayIndex]
  ) as RoutineDay | null;

  if (!routineDay || routineDay.is_rest_day) {
    return {
      type: "schedule_plan",
      title: `Today · ${formatDate(date)}`,
      data: {
        date,
        source: "routine",
        session_type: "Rest",
        exercises: [],
        blocks: [],
        is_rest_day: true,
        routine_name: routine.name,
        phase_label: routine.phase_label,
      },
    };
  }

  const blocks = await getBlocksForDay(routineDay.id);
  const exercises = flattenExercises(blocks);

  return {
    type: "schedule_plan",
    title: `Today · ${formatDate(date)}`,
    data: {
      date,
      source: "routine",
      session_type: routineDay.session_type || routineDay.name,
      exercises,
      blocks,
      is_rest_day: false,
      routine_name: routine.name,
      phase_label: routine.phase_label,
      day_name: routineDay.name,
    },
  };
}

export async function getTemplateForWeekday(args: { weekday: string }): Promise<Card> {
  const routine = await getActiveRoutine();
  if (!routine) {
    return {
      type: "weekday_template",
      title: args.weekday,
      data: { error: "No active routine. Import one first." },
    };
  }

  let dayIndex: number;
  if (routine.schedule_mode === "weekday") {
    dayIndex = WEEKDAY_NAMES.findIndex(
      (d) => d.toLowerCase() === args.weekday.toLowerCase()
    );
    if (dayIndex === -1) {
      return { type: "weekday_template", title: args.weekday, data: { error: "Unknown weekday" } };
    }
  } else {
    // Cycle mode: treat weekday arg as a cycle day number or name
    const parsed = parseInt(args.weekday);
    dayIndex = isNaN(parsed) ? 0 : parsed;
  }

  const routineDay = await queryOne(
    `SELECT * FROM routine_days WHERE routine_id = $1 AND day_index = $2 LIMIT 1`,
    [routine.id, dayIndex]
  ) as RoutineDay | null;

  if (!routineDay) {
    return {
      type: "weekday_template",
      title: args.weekday,
      data: { weekday: args.weekday, session_type: "Rest", exercises: [], blocks: [], is_rest_day: true },
    };
  }

  const blocks = await getBlocksForDay(routineDay.id);
  const exercises = flattenExercises(blocks);

  return {
    type: "weekday_template",
    title: routineDay.name || args.weekday,
    data: {
      weekday: args.weekday,
      session_type: routineDay.session_type,
      exercises,
      blocks,
      is_rest_day: false,
    },
  };
}

export async function getResolvedWeek(args: { range?: string }): Promise<Card> {
  void args;
  const routine = await getActiveRoutine();

  if (!routine) {
    return {
      type: "schedule_week",
      title: "Your Weekly Routine",
      data: { week: [], error: "No active routine. Import one first." },
    };
  }

  const days = await query(
    `SELECT rd.*,
       COALESCE(
         json_agg(
           json_build_object(
             'name', COALESCE(ec.name, re.name_raw),
             'sets', re.sets, 'reps_min', re.reps_min, 'reps_max', re.reps_max
           ) ORDER BY re.sort_order
         ) FILTER (WHERE re.id IS NOT NULL),
         '[]'
       ) as exercises
     FROM routine_days rd
     LEFT JOIN routine_blocks rb ON rb.routine_day_id = rd.id
     LEFT JOIN routine_exercises re ON re.routine_block_id = rb.id
     LEFT JOIN exercise_catalog ec ON ec.id = re.exercise_id
     WHERE rd.routine_id = $1
     GROUP BY rd.id
     ORDER BY rd.day_index`,
    [routine.id]
  );

  let week;
  if (routine.schedule_mode === "weekday") {
    week = WEEKDAY_NAMES.map((name, i) => {
      const d = days.find((r) => (r.day_index as number) === i);
      return {
        weekday: name,
        weekday_index: i,
        session_type: d ? (d.session_type as string) || (d.name as string) : "Rest",
        exercises: d ? (d.exercises as unknown[]) : [],
        is_rest_day: !d || (d.is_rest_day as boolean),
      };
    });
  } else {
    // Cycle mode: show days in order
    week = days.map((d, i) => ({
      weekday: (d.name as string) || `Day ${i + 1}`,
      weekday_index: d.day_index as number,
      session_type: (d.session_type as string) || (d.name as string),
      exercises: d.exercises as unknown[],
      is_rest_day: d.is_rest_day as boolean,
    }));
  }

  return {
    type: "schedule_week",
    title: `${routine.name}${routine.phase_label ? ` — ${routine.phase_label}` : ""}`,
    data: { week, schedule_mode: routine.schedule_mode },
  };
}

export async function previewMoveSession(args: { source: string; targetDate: string }): Promise<Card> {
  const routine = await getActiveRoutine();
  const date =
    args.targetDate === "today" ? new Date().toISOString().split("T")[0] : args.targetDate;

  let sessionType = "Unknown";
  if (routine) {
    const dayIndex = WEEKDAY_NAMES.findIndex(
      (d) => d.toLowerCase() === args.source.toLowerCase()
    );
    if (dayIndex >= 0) {
      const d = await queryOne(
        `SELECT session_type, name FROM routine_days WHERE routine_id = $1 AND day_index = $2`,
        [routine.id, dayIndex]
      );
      sessionType = (d?.session_type as string) || (d?.name as string) || "Unknown";
    }
  }

  return {
    type: "program_edit_preview",
    title: `Move ${args.source} → ${formatDate(date)}`,
    data: {
      action: "move_session",
      source: args.source,
      target_date: date,
      session_type: sessionType,
      pending_confirmation: true,
      message: `This will move your ${args.source} session to ${formatDate(date)}. Confirm to apply.`,
    },
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
