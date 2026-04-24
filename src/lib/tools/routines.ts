import { query, queryOne } from "../db";
import { parseRoutine } from "../llm";
import type { Card, ParsedBlock, ParsedDay, ParsedExercise, ParsedRoutine } from "@/types";

function slugify(name: string): string {
  return name
    .replace(/\s*\(.*?\)\s*/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

async function upsertExercise(nameRaw: string): Promise<number> {
  const primaryName = nameRaw.replace(/\s*\(.*?\)\s*/g, "").trim() || nameRaw.trim();
  const slug = slugify(primaryName) || "exercise-" + Date.now();

  await query(
    `INSERT INTO exercise_catalog (name, slug, is_custom)
     VALUES ($1, $2, true) ON CONFLICT (slug) DO NOTHING`,
    [primaryName, slug]
  );
  const row = await queryOne(
    `SELECT id FROM exercise_catalog WHERE slug = $1`,
    [slug]
  );
  return row!.id as number;
}

async function insertRoutine(r: ParsedRoutine, sourceText: string): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const row = await queryOne(
    `INSERT INTO routines (athlete_profile_id, name, source_text, schedule_mode, status, phase_label, cycle_start_date)
     VALUES (1, $1, $2, $3, 'draft', $4, $5) RETURNING id`,
    [
      r.name,
      sourceText,
      r.schedule_mode,
      r.phase_label ?? null,
      r.schedule_mode === "cycle" ? today : null,
    ]
  );
  return row!.id as number;
}

async function insertDaysBlocksExercises(
  routineId: number,
  days: ParsedDay[]
): Promise<void> {
  for (const day of days) {
    const dayRow = await queryOne(
      `INSERT INTO routine_days (routine_id, day_index, name, session_type, is_rest_day, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        routineId,
        day.day_index,
        day.name,
        day.session_type,
        day.is_rest_day,
        day.notes ?? null,
      ]
    );
    const dayId = dayRow!.id as number;

    for (let bi = 0; bi < day.blocks.length; bi++) {
      const block: ParsedBlock = day.blocks[bi];
      const blockRow = await queryOne(
        `INSERT INTO routine_blocks (routine_day_id, sort_order, block_type, rounds, rest_between_exercises_sec, rest_between_rounds_sec, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          dayId,
          bi,
          block.block_type,
          block.rounds ?? null,
          block.rest_between_exercises_sec ?? null,
          block.rest_between_rounds_sec ?? null,
          block.notes ?? null,
        ]
      );
      const blockId = blockRow!.id as number;

      for (let ei = 0; ei < block.exercises.length; ei++) {
        const ex: ParsedExercise = block.exercises[ei];
        const exerciseId = await upsertExercise(ex.name_raw);

        await query(
          `INSERT INTO routine_exercises (routine_block_id, sort_order, exercise_id, name_raw, sets, reps_min, reps_max, tempo, rir_min, rir_max, load_notes, duration_sec, is_amrap)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            blockId,
            ei,
            exerciseId,
            ex.name_raw,
            ex.sets ?? null,
            ex.reps_min ?? null,
            ex.reps_max ?? null,
            ex.tempo ?? null,
            ex.rir_min ?? null,
            ex.rir_max ?? null,
            ex.load_notes ?? null,
            ex.duration_sec ?? null,
            ex.is_amrap ?? false,
          ]
        );
      }
    }
  }
}

export async function importRoutine(args: { text: string }): Promise<Card> {
  const { text } = args;

  let parsed: Awaited<ReturnType<typeof parseRoutine>>;
  try {
    parsed = await parseRoutine(text);
  } catch (err) {
    return {
      type: "routine_import_preview",
      title: "Parse Error",
      data: { error: "Could not parse routine. Try pasting cleaner text.", detail: String(err) },
    };
  }

  if (!parsed.routines?.length) {
    return {
      type: "routine_import_preview",
      title: "Import Failed",
      data: { error: "No routine structure found in the text." },
    };
  }

  // Insert all routines, collecting IDs
  const routineIds: number[] = [];
  for (const r of parsed.routines) {
    const id = await insertRoutine(r, text);
    routineIds.push(id);
  }

  // Link phases 2+ to the first routine via parent_routine_id
  if (routineIds.length > 1) {
    for (let i = 1; i < routineIds.length; i++) {
      await query(
        `UPDATE routines SET parent_routine_id = $1 WHERE id = $2`,
        [routineIds[0], routineIds[i]]
      );
    }
  }

  // Insert days/blocks/exercises for each routine
  for (let i = 0; i < parsed.routines.length; i++) {
    await insertDaysBlocksExercises(routineIds[i], parsed.routines[i].days);
  }

  const totalExercises = parsed.routines.reduce(
    (sum, r) =>
      sum +
      r.days.reduce(
        (dsum, d) =>
          dsum + d.blocks.reduce((bsum, b) => bsum + b.exercises.length, 0),
        0
      ),
    0
  );

  return {
    type: "routine_import_preview",
    title: parsed.routines[0].name,
    data: {
      routine_ids: routineIds,
      routines: parsed.routines.map((r, i) => ({
        id: routineIds[i],
        name: r.name,
        phase_label: r.phase_label ?? null,
        schedule_mode: r.schedule_mode,
        day_count: r.days.length,
      })),
      phases: parsed.routines.length,
      total_exercises: totalExercises,
      status: "draft",
    },
  };
}

export async function listRoutines(): Promise<Card> {
  const rows = await query(
    `SELECT r.id, r.name, r.status, r.schedule_mode, r.phase_label, r.created_at,
            COUNT(DISTINCT rd.id)::int as day_count
     FROM routines r
     LEFT JOIN routine_days rd ON rd.routine_id = r.id
     WHERE r.athlete_profile_id = 1
     GROUP BY r.id
     ORDER BY
       CASE r.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
       r.created_at DESC`
  );

  return {
    type: "routine_list",
    title: "Your Routines",
    data: { routines: rows },
  };
}

export async function activateRoutine(args: { routine_id: number }): Promise<Card> {
  // Archive current active routine
  await query(
    `UPDATE routines SET status = 'archived' WHERE athlete_profile_id = 1 AND status = 'active'`
  );

  // Activate target; set cycle_start_date if cycle mode (guard ensures ownership)
  await query(
    `UPDATE routines
     SET status = 'active',
         cycle_start_date = CASE WHEN schedule_mode = 'cycle' THEN CURRENT_DATE ELSE cycle_start_date END,
         updated_at = NOW()
     WHERE id = $1 AND athlete_profile_id = 1`,
    [args.routine_id]
  );

  const routine = await queryOne(`SELECT * FROM routines WHERE id = $1`, [args.routine_id]);

  return {
    type: "routine_list",
    title: "Routine Activated",
    data: {
      activated: routine,
      message: `${routine?.name as string} is now your active routine.`,
    },
  };
}

export async function deleteRoutine(args: { routine_id: number }): Promise<Card> {
  await query(`DELETE FROM routines WHERE id = $1 AND athlete_profile_id = 1`, [args.routine_id]);
  return {
    type: "routine_list",
    title: "Routine Deleted",
    data: { message: "Routine removed.", routine_id: args.routine_id },
  };
}
