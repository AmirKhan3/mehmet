import { NextRequest, NextResponse } from "next/server";
import { correctWorkoutEntry } from "@/lib/tools/workout";
import { correctNutritionEntry } from "@/lib/tools/nutrition";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      kind: "workout_log" | "nutrition_entry";
      entry_id: number;
    };

    const { kind, entry_id } = body;
    if (!kind || !entry_id) {
      return NextResponse.json({ error: "kind and entry_id are required" }, { status: 400 });
    }

    let card;
    if (kind === "workout_log") {
      card = await correctWorkoutEntry({ entry_id, changes: {} });
    } else if (kind === "nutrition_entry") {
      card = await correctNutritionEntry({ target: entry_id, changes: {} });
    } else {
      return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
    }

    return NextResponse.json({ card });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 });
  }
}
