import { NextRequest, NextResponse } from "next/server";
import { resolvePendingAction } from "@/lib/pending";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      pending_id: number;
      action: "confirm" | "cancel" | "edit";
      patch?: Record<string, unknown>;
    };

    const { pending_id, action, patch } = body;
    if (!pending_id || !action) {
      return NextResponse.json({ error: "pending_id and action are required" }, { status: 400 });
    }

    const result = await resolvePendingAction(pending_id, action, patch);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return NextResponse.json({ error: e.message }, { status: e.statusCode ?? 500 });
  }
}
