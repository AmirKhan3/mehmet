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

async function resolveLastLoggedEntryId(): Promise<number | null> {
  const rows = await query(
    `SELECT cards_json FROM chat_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 5`
  );
  for (const row of rows) {
    const cards = (row.cards_json as Array<{ type?: string; data?: Record<string, unknown> }>) || [];
    for (const card of cards) {
      if (card.type === "nutrition_item_logged" && card.data?.entry_id) {
        return card.data.entry_id as number;
      }
    }
  }
  return null;
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

  const rows = await query(
    `INSERT INTO nutrition_entries (athlete_profile_id, date, item_name, quantity, calories, protein_g, carbs_g, fat_g, source)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, 'llm_estimate') RETURNING id`,
    [date, args.item, quantity, macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g]
  );
  const entry_id = rows[0]?.id as number;

  return {
    type: "nutrition_item_logged",
    title: `Logged · ${args.item}`,
    data: { entry_id, date, item: args.item, quantity, ...macros },
  };
}

export async function getNutritionDay(args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = 1 AND date = $1 AND deleted_at IS NULL ORDER BY id`,
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

  const target = await queryOne(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = 1 LIMIT 1`);
  if (!target) {
    return {
      type: "nutrition_setup_required",
      title: "Set up your goals",
      data: { why: "I don't have your macro targets yet. Tell me your weight, goal (cut/bulk/maintain), and how many days/week you train." },
    };
  }

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = 1 AND date = $1 AND deleted_at IS NULL`,
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
  target?: "last" | number;
  changes: Record<string, unknown>;
}): Promise<Card> {
  let entryId: number | null = null;

  if (args.target === "last") {
    entryId = await resolveLastLoggedEntryId();
  } else if (typeof args.target === "number") {
    entryId = args.target;
  }

  if (!entryId) {
    return { type: "nutrition_corrected", title: "Correction", data: { error: "No recent log found to correct" } };
  }

  const fields = ["item_name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"]
    .filter((k) => args.changes[k] !== undefined);

  if (fields.length) {
    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => args.changes[k]);
    await query(`UPDATE nutrition_entries SET ${sets} WHERE id = $1`, [entryId, ...values]);
  }

  return {
    type: "nutrition_corrected",
    title: "Entry Updated",
    data: { entry_id: entryId, changes: args.changes },
  };
}

export async function deleteLastNutritionEntry(_args: Record<string, never>): Promise<Card> {
  const entryId = await resolveLastLoggedEntryId();
  if (!entryId) {
    return { type: "nutrition_deleted", title: "Nothing to remove", data: { error: "No recent log found" } };
  }
  const rows = await query(
    `UPDATE nutrition_entries SET deleted_at = NOW() WHERE id = $1 RETURNING item_name`,
    [entryId]
  );
  const itemName = (rows[0]?.item_name as string) || "entry";
  return { type: "nutrition_deleted", title: `Removed · ${itemName}`, data: { entry_id: entryId, item_name: itemName } };
}

export async function restoreLastNutritionEntry(_args: Record<string, never>): Promise<Card> {
  const rows = await query(
    `UPDATE nutrition_entries SET deleted_at = NULL
     WHERE id = (
       SELECT id FROM nutrition_entries WHERE athlete_profile_id = 1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC LIMIT 1
     ) RETURNING id, item_name`,
    []
  );
  if (!rows.length) {
    return { type: "nutrition_restored", title: "Nothing to restore", data: { error: "No removed entries found" } };
  }
  const itemName = (rows[0]?.item_name as string) || "entry";
  return { type: "nutrition_restored", title: `Restored · ${itemName}`, data: { entry_id: rows[0]?.id, item_name: itemName } };
}

export async function suggestNextMeal(args: {
  intent: "fill_gap" | "post_workout" | "next_meal" | "pair_with_last";
}): Promise<Card> {
  const targetCheck = await queryOne(`SELECT id FROM nutrition_targets WHERE athlete_profile_id = 1 LIMIT 1`);
  if (!targetCheck) {
    return {
      type: "nutrition_setup_required",
      title: "Set up your goals first",
      data: { why: "I need your macro targets before I can suggest meals. Tell me your weight, goal, and training days." },
    };
  }

  const date = todayPT();

  const [workoutRow, weekRows] = await Promise.all([
    queryOne(`
      SELECT rd.name AS day_name, rd.is_rest_day, rd.session_type
      FROM routines r
      JOIN routine_days rd ON rd.routine_id = r.id
      WHERE r.athlete_profile_id = 1 AND r.status = 'active'
        AND rd.day_index = (
          CASE r.schedule_mode
            WHEN 'weekday' THEN EXTRACT(DOW FROM NOW() AT TIME ZONE 'America/Los_Angeles')::int
            ELSE (
              EXTRACT(EPOCH FROM (
                DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Los_Angeles') -
                DATE_TRUNC('day', r.cycle_start_date AT TIME ZONE 'America/Los_Angeles')
              )) / 86400
            )::int % (SELECT COUNT(*) FROM routine_days WHERE routine_id = r.id)
          END
        )
      LIMIT 1
    `),
    query(`
      SELECT date, SUM(calories) AS kcal, SUM(protein_g) AS protein
      FROM nutrition_entries
      WHERE athlete_profile_id = 1 AND date >= $1 AND deleted_at IS NULL
      GROUP BY date ORDER BY date DESC
    `, [(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" }); })()])
  ]);

  const [target, entries] = await Promise.all([
    queryOne(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = 1 LIMIT 1`),
    query(
      `SELECT item_name, quantity, calories, protein_g, carbs_g, fat_g FROM nutrition_entries
       WHERE athlete_profile_id = 1 AND date = $1 AND deleted_at IS NULL ORDER BY id`,
      [date]
    ),
  ]);

  const weekAvgProtein = weekRows.length > 0
    ? Math.round(weekRows.reduce((s, r) => s + Number(r.protein || 0), 0) / weekRows.length)
    : null;
  const todayWorkout = workoutRow ? { name: (workoutRow.session_type as string) || (workoutRow.day_name as string), is_rest_day: !!(workoutRow.is_rest_day) } : null;

  type M = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  const actuals = entries.reduce<M>(
    (acc, r) => ({
      calories: acc.calories + Number(r.calories || 0),
      protein_g: acc.protein_g + Number(r.protein_g || 0),
      carbs_g: acc.carbs_g + Number(r.carbs_g || 0),
      fat_g: acc.fat_g + Number(r.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  const remaining = target
    ? {
        calories: (target.calories_max as number) - actuals.calories,
        protein_g: (target.protein_max_g as number) - actuals.protein_g,
        carbs_g: (target.carbs_max_g as number) - actuals.carbs_g,
        fat_g: (target.fats_max_g as number) - actuals.fat_g,
      }
    : null;

  const lastThree = entries.slice(-3).map((e) => `${e.quantity} ${e.item_name}`).join(", ");

  type SuggestionResult = { meal: string; why: string; timing: string; macros: M };
  const result = await chatCompletionJSON<SuggestionResult>(
    [
      {
        role: "system",
        content: `You are a nutrition assistant. Given the user's macro targets, today's intake, today's workout, and their weekly trend, suggest ONE specific meal. Prioritize protein if below weekly average or on a training day. Return ONLY JSON: {"meal":"...","why":"...","timing":"...","macros":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          intent: args.intent,
          remaining_macros: remaining,
          today_so_far: actuals,
          last_eaten: lastThree || "nothing yet",
          workout_today: todayWorkout,
          week_avg_protein_g: weekAvgProtein,
          yesterday_protein_g: weekRows[1] ? Math.round(Number(weekRows[1].protein)) : null,
        }),
      },
    ],
    { temperature: 0.4, max_tokens: 256 }
  );

  const remaining_after = remaining
    ? {
        calories: remaining.calories - result.macros.calories,
        protein_g: remaining.protein_g - result.macros.protein_g,
        carbs_g: remaining.carbs_g - result.macros.carbs_g,
        fat_g: remaining.fat_g - result.macros.fat_g,
      }
    : null;

  return {
    type: "meal_suggestion",
    title: `Suggestion · ${args.intent.replace(/_/g, " ")}`,
    data: {
      intent: args.intent,
      suggestion: result.meal,
      why: result.why,
      timing: result.timing,
      macros: result.macros,
      remaining_after,
    },
  };
}

export async function setupNutritionTargets(args: {
  weight_lbs: number;
  goal: "cut" | "bulk" | "maintain" | "recomp";
  training_days_per_week: number;
  height_in?: number;
  age?: number;
}): Promise<Card> {
  const weightKg = args.weight_lbs * 0.453592;
  const heightCm = args.height_in ? args.height_in * 2.54 : 175; // default 175cm
  const age = args.age ?? 28; // default age

  // Mifflin-St Jeor (male default — single user app)
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const activityFactor = Math.min(1.9, 1.55 + 0.05 * args.training_days_per_week);
  const tdee = Math.round(bmr * activityFactor);

  const calTarget = args.goal === "cut" ? tdee - 500
    : args.goal === "bulk" ? tdee + 300
    : tdee;

  const proteinG = Math.round(args.weight_lbs); // 1g per lb
  const fatG = Math.round((calTarget * 0.25) / 9);
  const carbG = Math.round((calTarget - proteinG * 4 - fatG * 9) / 4);

  // No unique constraint on (athlete_profile_id, day_type) — use DELETE+INSERT
  await query(
    `DELETE FROM nutrition_targets WHERE athlete_profile_id = 1 AND day_type = 'default'`,
    []
  );
  await query(
    `INSERT INTO nutrition_targets (athlete_profile_id, day_type, calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g)
     VALUES (1, 'default', $1, $2, $3, $4, $5, $6, $7, $8)`,
    [calTarget - 100, calTarget, proteinG - 10, proteinG, carbG - 20, carbG, fatG - 5, fatG]
  );

  await query(
    `UPDATE athlete_profile SET weight = $1, goals = $2 WHERE id = 1`,
    [args.weight_lbs, args.goal]
  );

  return getNutritionTargetsVsActuals({ date: "today" });
}

export async function getNutritionWeekSummary(_args: { weeks_back?: number }): Promise<Card> {
  const weeksBack = _args.weeks_back ?? 0;
  // Week boundaries in PT (Mon-Sun)
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) - weeksBack * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toLocaleDateString("sv-SE");
  const weekEnd = sunday.toLocaleDateString("sv-SE");

  const [target, entries] = await Promise.all([
    queryOne(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = 1 LIMIT 1`),
    query(
      `SELECT date, SUM(calories) AS kcal, SUM(protein_g) AS protein_g, SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g
       FROM nutrition_entries
       WHERE athlete_profile_id = 1 AND date BETWEEN $1 AND $2 AND deleted_at IS NULL
       GROUP BY date ORDER BY date ASC`,
      [weekStart, weekEnd]
    ),
  ]);

  const days = entries.map((r) => ({
    date: r.date as string,
    kcal: Math.round(Number(r.kcal || 0)),
    protein_g: Math.round(Number(r.protein_g || 0)),
    hit_protein: target ? Number(r.protein_g || 0) >= (target.protein_min_g as number) : false,
    hit_calories: target ? Number(r.kcal || 0) >= (target.calories_min as number) : false,
  }));

  const totalDays = days.length;
  const proteinHitDays = days.filter((d) => d.hit_protein).length;
  const avgProtein = totalDays > 0 ? Math.round(days.reduce((s, d) => s + d.protein_g, 0) / totalDays) : 0;
  const avgKcal = totalDays > 0 ? Math.round(days.reduce((s, d) => s + d.kcal, 0) / totalDays) : 0;

  return {
    type: "nutrition_week",
    title: `Week of ${weekStart}`,
    data: { week_start: weekStart, week_end: weekEnd, days, targets: target || null, averages: { protein_g: avgProtein, kcal: avgKcal }, adherence: { protein_hit_days: proteinHitDays, total_days: totalDays } },
  };
}

function resolveDate(date?: string): string {
  if (!date || date === "today") return todayPT();
  if (date === "yesterday") return yesterdayPT();
  return date;
}

function todayPT(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function yesterdayPT(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
