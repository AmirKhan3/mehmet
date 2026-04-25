import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const rows = await query(
      `SELECT wl.id, wl.date, wl.sets, wl.reps, wl.round_number, wl.status,
              wl.modifier, wl.exception_type, wl.skipped,
              ec.name AS exercise_name
       FROM workout_logs wl
       LEFT JOIN exercise_catalog ec ON ec.id = wl.exercise_id
       WHERE wl.athlete_profile_id = 1
       ORDER BY wl.id DESC
       LIMIT 100`
    );
    return NextResponse.json({ logs: rows });
  } catch (err) {
    console.error("Logs fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
