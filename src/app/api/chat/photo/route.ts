import { NextRequest, NextResponse } from "next/server";
import { chatCompletionVision } from "@/lib/llm";
import { logNutritionItem } from "@/lib/tools/nutrition";
import { query } from "@/lib/db";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("photo") as File | null;
  if (!file) return NextResponse.json({ error: "No photo" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const b64 = buffer.toString("base64");
  const mimeType = file.type || "image/jpeg";

  type VisionResult = { food: string; quantity: string; macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number } };

  let result: VisionResult;
  try {
    result = await chatCompletionVision<VisionResult>(
      b64,
      `Identify this food. Estimate the quantity and macros. Return ONLY JSON with no explanation: {"food":"name of the food","quantity":"e.g. 1 bowl or 200g","macros":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}}`,
      mimeType
    );
  } catch (err) {
    console.error("Vision error:", err);
    return NextResponse.json({ text: "I couldn't identify that food. Try again or type it instead.", cards: [] });
  }

  const food = result.food || "unknown food";
  const card = await logNutritionItem({ item: food, quantity: result.quantity, inlineMacros: result.macros });

  const userText = `📷 ${food}`;
  const assistantText = `Logged ${food} — ${Math.round(result.macros?.calories ?? 0)} kcal, ${Math.round(result.macros?.protein_g ?? 0)}g protein.`;

  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('user', $1, '[]'::jsonb)`,
    [userText]
  );
  await query(
    `INSERT INTO chat_messages (role, text, cards_json) VALUES ('assistant', $1, $2::jsonb)`,
    [assistantText, JSON.stringify([card])]
  );

  return NextResponse.json({ text: assistantText, cards: [card] });
}
