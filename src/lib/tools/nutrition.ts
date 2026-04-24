import { query, queryOne } from "../db";
import { chatCompletionJSON } from "../llm";
import type { Card } from "@/types";

interface MacroEstimate {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

async function estimateMacros(item: string, quantity: string): Promise<MacroEstimate> {
  try {
    return await chatCompletionJSON<MacroEstimate>(
      [
        {
          role: "system",
          content: "You are a nutrition database. Return estimated macros as JSON only. No explanation.",
        },
        {
          role: "user",
          content: `Estimate macros for: ${quantity} ${item}. Return: {"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}`,
        },
      ],
      { temperature: 0, max_tokens: 128 }
    );
  } catch {
    return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  }
}

export async function logNutritionItem(args: {
  item: string;
  quantity?: string;
  date?: string;
  inlineMacros?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
}): Promise<Card> {
  const date = resolveDate(args.date);
  const quantity = args.quantity || "1 serving";
  const macros = args.inlineMacros
    ? {
        calories: args.inlineMacros.calories ?? 0,
        protein_g: args.inlineMacros.protein_g ?? 0,
        carbs_g: args.inlineMacros.carbs_g ?? 0,
        fat_g: args.inlineMacros.fat_g ?? 0,
      }
    : await estimateMacros(args.item, quantity);

  await query(
    `INSERT INTO nutrition_entries (athlete_profile_id, date, item_name, quantity, calories, protein_g, carbs_g, fat_g, source)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, 'llm_estimate')`,
    [date, args.item, quantity, macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g]
  );

  return {
    type: "nutrition_item_logged",
    title: `Logged · ${args.item}`,
    data: { date, item: args.item, quantity, ...macros },
  };
}

export async function getNutritionDay(args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = 1 AND date = $1 ORDER BY id`,
    [date]
  );

  type MacroAcc = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  const totals = entries.reduce<MacroAcc>(
    (acc, r) => ({
      calories: acc.calories + Number(r.calories || 0),
      protein_g: acc.protein_g + Number(r.protein_g || 0),
      carbs_g: acc.carbs_g + Number(r.carbs_g || 0),
      fat_g: acc.fat_g + Number(r.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  return {
    type: "nutrition_day",
    title: `${formatDate(date)} · Nutrition`,
    data: { date, entries, totals },
  };
}

export async function getNutritionTargetsVsActuals(args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const target = await queryOne(
    `SELECT * FROM nutrition_targets WHERE athlete_profile_id = 1 LIMIT 1`
  );

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = 1 AND date = $1`,
    [date]
  );

  type MacroAcc = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  const actuals = entries.reduce<MacroAcc>(
    (acc, r) => ({
      calories: acc.calories + Number(r.calories || 0),
      protein_g: acc.protein_g + Number(r.protein_g || 0),
      carbs_g: acc.carbs_g + Number(r.carbs_g || 0),
      fat_g: acc.fat_g + Number(r.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  return {
    type: "nutrition_targets_vs_actuals",
    title: `Nutrition · ${formatDate(date)}`,
    data: {
      date,
      targets: target || null,
      actuals,
      remaining: target
        ? {
            calories: (target.calories_max as number) - actuals.calories,
            protein_g: (target.protein_max_g as number) - actuals.protein_g,
            carbs_g: (target.carbs_max_g as number) - actuals.carbs_g,
            fat_g: (target.fats_max_g as number) - actuals.fat_g,
          }
        : null,
    },
  };
}

export async function correctNutritionEntry(args: {
  entry_id?: number;
  changes: Record<string, unknown>;
}): Promise<Card> {
  if (!args.entry_id) {
    return { type: "nutrition_corrected", title: "Correction", data: { error: "No entry ID provided" } };
  }

  const fields = ["item_name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"]
    .filter((k) => args.changes[k] !== undefined);

  if (fields.length) {
    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => args.changes[k]);
    await query(`UPDATE nutrition_entries SET ${sets} WHERE id = $1`, [args.entry_id, ...values]);
  }

  return {
    type: "nutrition_corrected",
    title: "Entry Updated",
    data: { entry_id: args.entry_id, changes: args.changes },
  };
}

function resolveDate(date?: string): string {
  if (!date || date === "today") return new Date().toISOString().split("T")[0];
  if (date === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }
  return date;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
