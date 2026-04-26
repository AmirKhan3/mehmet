import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const rows = await query(
      `SELECT id, role, text, cards_json, created_at
       FROM (
         SELECT id, role, text, cards_json, created_at
         FROM chat_messages
         ORDER BY id DESC
         LIMIT 60
       ) recent
       ORDER BY id ASC`
    );
    const messages = rows.map((r) => ({
      id: String(r.id),
      role: r.role as "user" | "assistant",
      text: (r.text as string) || "",
      cards: (r.cards_json as unknown[]) || [],
      timestamp: new Date(r.created_at as string).getTime(),
    }));
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Fetch messages error:", err);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
