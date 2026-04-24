import { NextRequest, NextResponse } from "next/server";
import { activateRoutine } from "@/lib/tools/routines";

export async function POST(req: NextRequest) {
  try {
    const { routine_id } = await req.json();

    if (!routine_id) {
      return NextResponse.json({ error: "routine_id required" }, { status: 400 });
    }

    const card = await activateRoutine({ routine_id: Number(routine_id) });
    return NextResponse.json({ card });
  } catch (err) {
    console.error("Routine activate error:", err);
    return NextResponse.json({ error: "Activation failed" }, { status: 500 });
  }
}
