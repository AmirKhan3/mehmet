import { NextRequest, NextResponse } from "next/server";
import { deleteRoutine } from "@/lib/tools/routines";

export async function POST(req: NextRequest) {
  try {
    const { routine_id } = await req.json();
    if (!routine_id) return NextResponse.json({ error: "routine_id required" }, { status: 400 });
    const card = await deleteRoutine({ routine_id });
    return NextResponse.json({ card });
  } catch (err) {
    console.error("Delete routine error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
