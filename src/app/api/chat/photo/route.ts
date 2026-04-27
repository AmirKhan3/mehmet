import { NextRequest, NextResponse } from "next/server";
import { chatCompletionVision } from "@/lib/llm";
import { query } from "@/lib/db";
import { runEngine, getMemory } from "@/lib/chatEngine";

type VisionResult = {
  description: string;
  category: "food" | "body" | "equipment" | "workout" | "other";
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("photo") as File | null;
  if (!file) return NextResponse.json({ error: "No photo" }, { status: 400 });

  const userText = (formData.get("message") as string | null)?.trim() ?? "";
  const historyRaw = formData.get("history") as string | null;
  const history: { role: string; text: string }[] = historyRaw ? JSON.parse(historyRaw) : [];

  const buffer = Buffer.from(await file.arrayBuffer());
  const b64 = buffer.toString("base64");
  const mimeType = file.type || "image/jpeg";

  let vision: VisionResult;
  try {
    vision = await chatCompletionVision<VisionResult>(
      b64,
      `Describe what you see in this image. Be specific and literal.
Return ONLY JSON — no explanation, no markdown:
{"description":"one sentence describing the subject, e.g. a plate of baigan sabzi with rice, a male torso with visible abdominal definition, a pair of dumbbells on a gym floor","category":"food|body|equipment|workout|other"}`,
      mimeType
    );
  } catch (err) {
    console.error("Vision error:", err);
    return NextResponse.json({
      text: "I couldn't make out what's in that image. Try again or describe it in text.",
      cards: [],
    });
  }

  // Build the message the engine sees — photo context prepended so the router
  // can decide what tool to call (or whether to just talk).
  const photoContext = `[Photo: ${vision.description}]`;
  const engineMessage = userText ? `${userText}\n\n${photoContext}` : photoContext;

  // Persist what the user actually sent (the display text in chat).
  const persistedUserText = userText ? `📷 ${userText}` : "📷 pasted image";
  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('user', $1, '[]'::jsonb)`,
    [persistedUserText]
  );

  const memory = await getMemory();
  const { text, cards } = await runEngine(engineMessage, history, memory);

  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('assistant', $1, $2::jsonb)`,
    [text, JSON.stringify(cards)]
  );

  return NextResponse.json({ text, cards });
}
