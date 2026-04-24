import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const rows = await query(
      `SELECT r.id, r.name, r.status, r.schedule_mode, r.phase_label, r.parent_routine_id, r.created_at,
              COUNT(DISTINCT rd.id)::int as day_count
       FROM routines r
       LEFT JOIN routine_days rd ON rd.routine_id = r.id
       WHERE r.athlete_profile_id = 1
       GROUP BY r.id
       ORDER BY
         CASE r.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
         r.created_at DESC`
    );
    return NextResponse.json({ routines: rows });
  } catch (err) {
    console.error("List routines error:", err);
    return NextResponse.json({ routines: [] });
  }
}
