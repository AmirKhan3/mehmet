import { NextRequest, NextResponse } from "next/server";
import { importRoutine } from "@/lib/tools/routines";
import { getCurrentAthleteId } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = (body.text as string)?.trim();

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Routine text too short" }, { status: 400 });
    }

    const athleteId = await getCurrentAthleteId();
    const card = await importRoutine(athleteId, { text });
    return NextResponse.json({ card });
  } catch (err) {
    console.error("Routine import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
