import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

function resolveTodayIndex(scheduleMode: string, cycleStartDate: string | null, totalDays: number): number {
  if (scheduleMode === "weekday") {
    return new Date().getUTCDay();
  }
  if (!cycleStartDate) return 0;
  const [y, m, d] = cycleStartDate.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSince = Math.max(0, Math.floor((todayMs - startMs) / 86400000));
  return daysSince % (totalDays || 1);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseInt(rawId);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const routine = await queryOne(
    `SELECT id, name, status, schedule_mode, phase_label, cycle_start_date
     FROM routines WHERE id = $1 AND athlete_profile_id = 1`,
    [id]
  );
  if (!routine) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const days = await query(
    `SELECT id, day_index, name, session_type, is_rest_day, notes
     FROM routine_days WHERE routine_id = $1 ORDER BY day_index`,
    [id]
  );

  const daysWithBlocks = await Promise.all(
    days.map(async (day) => {
      const blocks = await query(
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
        [day.id as number]
      );
      return { ...day, blocks };
    })
  );

  const todayDayIndex = resolveTodayIndex(
    routine.schedule_mode as string,
    routine.cycle_start_date as string | null,
    days.length
  );

  return NextResponse.json({
    routine: { ...routine, today_day_index: todayDayIndex },
    days: daysWithBlocks,
  });
}
