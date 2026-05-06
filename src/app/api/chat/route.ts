import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { runEngine, getMemory } from "@/lib/chatEngine";
import { getCurrentAthleteId } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { message, history = [] } = await req.json();

  if (!message?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const athleteId = await getCurrentAthleteId();

  // Persist user message first so it's never lost if the LLM call fails or the client disconnects.
  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('user', $1, '[]'::jsonb)`,
    [message]
  );

  if (isDestructive(message)) {
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, $2, $3, $4)`,
      [athleteId, "clear_day", JSON.stringify({ message }), expires]
    );
    const text = "Are you sure? This will delete all of today's logs. Reply 'yes' to confirm.";
    const cards = [{
      type: "confirmation",
      title: "Confirm Delete",
      data: { action: "clear_day", message: "Delete today's workout and nutrition logs?", expires_at: expires },
    }];
    await query(
      `INSERT INTO chat_messages (role, text, cards_json) VALUES ('assistant', $1, $2::jsonb)`,
      [text, JSON.stringify(cards)]
    );
    return NextResponse.json({ text, cards });
  }

  let text: string;
  let cards: import("@/types").Card[];
  try {
    const memory = await getMemory(athleteId);
    ({ text, cards } = await runEngine(athleteId, message, history, memory));
  } catch (err) {
    console.error("[/api/chat] runEngine failed:", err);
    text = "Something glitched on my end. Try that again?";
    cards = [];
  }

  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('assistant', $1, $2::jsonb)`,
    [text, JSON.stringify(cards)]
  );

  return NextResponse.json({ text, cards });
}

function isDestructive(message: string): boolean {
  return /\b(delete|clear|undo|reset)\b.*\b(log|workout|nutrition|today|entry|all)\b/i.test(message);
}
