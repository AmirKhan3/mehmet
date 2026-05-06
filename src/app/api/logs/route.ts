import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentAthleteId } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const athleteId = await getCurrentAthleteId();
    const date = req.nextUrl.searchParams.get("date");

    const rows = date
      ? await query(
          `SELECT wl.id,
                  TO_CHAR(wl.date, 'YYYY-MM-DD') AS date,
                  COALESCE(ec.name, wl.name_raw) AS exercise_name,
                  wl.sets, wl.reps, wl.round_number, wl.status,
                  wl.modifier, wl.exception_type, wl.skipped
           FROM workout_logs wl
           LEFT JOIN exercise_catalog ec ON ec.id = wl.exercise_id
           WHERE wl.athlete_profile_id = $1 AND wl.date::date = $2::date
           ORDER BY wl.id`,
          [athleteId, date]
        )
      : await query(
          `SELECT DISTINCT TO_CHAR(wl.date, 'YYYY-MM-DD') AS date
           FROM workout_logs wl
           WHERE wl.athlete_profile_id = $1
           ORDER BY date DESC
           LIMIT 60`,
          [athleteId]
        );

    return NextResponse.json(date ? { logs: rows } : { dates: rows.map((r) => r.date as string) });
  } catch (err) {
    console.error("Logs fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
