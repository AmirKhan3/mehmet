import { NextRequest, NextResponse } from "next/server";
import { importRoutine } from "@/lib/tools/routines";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = (body.text as string)?.trim();

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Routine text too short" }, { status: 400 });
    }

    const card = await importRoutine({ text });
    return NextResponse.json({ card });
  } catch (err) {
    console.error("Routine import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
