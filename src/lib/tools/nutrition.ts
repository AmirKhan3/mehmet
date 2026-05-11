import { query, queryOne } from "../db";
import { chatCompletionJSON, parseNutritionPlan } from "../llm";
import { buildPreviewCard } from "../pending";
import type { Card } from "@/types";

const EXPIRES_MINUTES = 120;

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
        { role: "system", content: "You are a nutrition database. Return estimated macros as JSON only. No explanation." },
        { role: "user", content: `Estimate macros for: ${quantity} ${item}. Return: {"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}` },
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

export async function logNutritionItem(athleteId: number, args: {
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'llm_estimate') RETURNING id`,
    [athleteId, date, args.item, quantity, macros.calories, macros.protein_g, macros.carbs_g, macros.fat_g]
  );
  const entry_id = rows[0]?.id as number;

  return {
    type: "nutrition_item_logged",
    title: `Logged · ${args.item}`,
    data: { entry_id, date, item: args.item, quantity, ...macros },
  };
}

export async function getNutritionDay(athleteId: number, args: { date?: string }): Promise<Card> {
  const date = resolveDate(args.date);

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = $1 AND date = $2 AND deleted_at IS NULL ORDER BY id`,
    [athleteId, date]
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

export async function getNutritionTargetsVsActuals(athleteId: number, args: { date?: string; day_type?: string }): Promise<Card> {
  const date = resolveDate(args.date);
  const dayType = args.day_type ?? "default";

  const target = await queryOne(
    `SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2 LIMIT 1`,
    [athleteId, dayType]
  ) ?? await queryOne(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = 'default' LIMIT 1`, [athleteId]);

  if (!target) {
    return {
      type: "nutrition_setup_required",
      title: "Set up your goals",
      data: { why: "I don't have your macro targets yet. Tell me your weight, goal (cut/bulk/maintain), and how many days/week you train." },
    };
  }

  const entries = await query(
    `SELECT * FROM nutrition_entries WHERE athlete_profile_id = $1 AND date = $2 AND deleted_at IS NULL`,
    [athleteId, date]
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

export async function correctNutritionEntry(athleteId: number, args: {
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

  const existing = await queryOne(
    `SELECT item_name, quantity, calories, protein_g, carbs_g, fat_g FROM nutrition_entries WHERE id = $1`,
    [entryId]
  );
  if (!existing) {
    return { type: "nutrition_corrected", title: "Correction", data: { error: "Entry not found" } };
  }

  const before = { item_name: existing.item_name, quantity: existing.quantity, calories: existing.calories, protein_g: existing.protein_g, carbs_g: existing.carbs_g, fat_g: existing.fat_g };
  const after = { ...before, ...args.changes };

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { entry_id: entryId, before, after };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'correct_nutrition', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("correct_nutrition", payload, pendingId);
}

export async function commitCorrectNutrition(_athleteId: number, payload: {
  entry_id: number;
  after: Record<string, unknown>;
}): Promise<Card> {
  const fields = ["item_name", "quantity", "calories", "protein_g", "carbs_g", "fat_g"].filter((k) => payload.after[k] !== undefined);
  if (fields.length) {
    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = fields.map((k) => payload.after[k]);
    await query(`UPDATE nutrition_entries SET ${sets} WHERE id = $1`, [payload.entry_id, ...values]);
  }
  return { type: "nutrition_corrected", title: "Entry Updated", data: { entry_id: payload.entry_id, changes: payload.after } };
}

export async function deleteLastNutritionEntry(athleteId: number, _args: Record<string, never>): Promise<Card> {
  const entryId = await resolveLastLoggedEntryId();
  if (!entryId) {
    return { type: "nutrition_deleted", title: "Nothing to remove", data: { error: "No recent log found" } };
  }
  const rows = await query(`SELECT item_name FROM nutrition_entries WHERE id = $1`, [entryId]);
  const itemName = (rows[0]?.item_name as string) || "entry";

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { entry_id: entryId, item_name: itemName };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'delete_nutrition_entry', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("delete_nutrition_entry", payload, pendingId);
}

export async function commitDeleteNutritionEntry(_athleteId: number, payload: { entry_id: number; item_name: string }): Promise<Card> {
  await query(`UPDATE nutrition_entries SET deleted_at = NOW() WHERE id = $1`, [payload.entry_id]);
  return { type: "nutrition_deleted", title: `Removed · ${payload.item_name}`, data: { entry_id: payload.entry_id, item_name: payload.item_name } };
}

export async function restoreLastNutritionEntry(athleteId: number, _args: Record<string, never>): Promise<Card> {
  const rows = await query(
    `UPDATE nutrition_entries SET deleted_at = NULL
     WHERE id = (
       SELECT id FROM nutrition_entries WHERE athlete_profile_id = $1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC LIMIT 1
     ) RETURNING id, item_name`,
    [athleteId]
  );
  if (!rows.length) {
    return { type: "nutrition_restored", title: "Nothing to restore", data: { error: "No removed entries found" } };
  }
  const itemName = (rows[0]?.item_name as string) || "entry";
  return { type: "nutrition_restored", title: `Restored · ${itemName}`, data: { entry_id: rows[0]?.id, item_name: itemName } };
}

export async function suggestNextMeal(athleteId: number, args: {
  intent: "fill_gap" | "post_workout" | "next_meal" | "pair_with_last";
  day_type?: string;
}): Promise<Card> {
  const targetCheck = await queryOne(`SELECT id FROM nutrition_targets WHERE athlete_profile_id = $1 LIMIT 1`, [athleteId]);
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
      WHERE r.athlete_profile_id = $1 AND r.status = 'active'
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
    `, [athleteId]),
    query(`
      SELECT date, SUM(calories) AS kcal, SUM(protein_g) AS protein
      FROM nutrition_entries
      WHERE athlete_profile_id = $1 AND date >= $2 AND deleted_at IS NULL
      GROUP BY date ORDER BY date DESC
    `, [athleteId, (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" }); })()])
  ]);

  const dayType = args.day_type ?? "default";
  const [target, entries] = await Promise.all([
    queryOne(
      `SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2 LIMIT 1`,
      [athleteId, dayType]
    ).then(r => r ?? queryOne(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = 'default' LIMIT 1`, [athleteId])),
    query(
      `SELECT item_name, quantity, calories, protein_g, carbs_g, fat_g FROM nutrition_entries
       WHERE athlete_profile_id = $1 AND date = $2 AND deleted_at IS NULL ORDER BY id`,
      [athleteId, date]
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

export async function setupNutritionTargets(athleteId: number, args: {
  weight_lbs: number;
  goal: "cut" | "bulk" | "maintain" | "recomp";
  training_days_per_week: number;
  height_in?: number;
  age?: number;
  day_type?: "default" | "training" | "rest";
}): Promise<Card> {
  const computed = computeNutritionTargets(args);
  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = {
    weight_lbs: args.weight_lbs, goal: args.goal,
    training_days_per_week: args.training_days_per_week,
    height_in: args.height_in ?? null, age: args.age ?? null,
    day_type: args.day_type ?? "default",
    computed,
  };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'setup_nutrition_targets', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  const pendingId = res[0].id as number;
  return buildPreviewCard("setup_nutrition_targets", payload, pendingId);
}

export async function commitSetupNutritionTargets(athleteId: number, payload: {
  weight_lbs: number;
  goal: string;
  day_type?: string;
  computed: { calories_min: number; calories_max: number; protein_min_g: number; protein_max_g: number; carbs_min_g: number; carbs_max_g: number; fats_min_g: number; fats_max_g: number };
}): Promise<Card> {
  const c = payload.computed;
  const dayType = payload.day_type ?? "default";
  await query(`DELETE FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2`, [athleteId, dayType]);
  await query(
    `INSERT INTO nutrition_targets (athlete_profile_id, day_type, calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [athleteId, dayType, c.calories_min, c.calories_max, c.protein_min_g, c.protein_max_g, c.carbs_min_g, c.carbs_max_g, c.fats_min_g, c.fats_max_g]
  );
  if (dayType === "default") {
    await query(`UPDATE athlete_profile SET weight = $1, goals = $2 WHERE id = $3`, [payload.weight_lbs, payload.goal, athleteId]);
  }
  return getNutritionTargetsVsActuals(athleteId, { date: "today" });
}

function computeNutritionTargets(args: { weight_lbs: number; goal: string; training_days_per_week?: number | null; height_in?: number | null; age?: number | null }) {
  const weightKg = args.weight_lbs * 0.453592;
  const heightCm = args.height_in ? args.height_in * 2.54 : 175;
  const age = args.age ?? 28;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const trainingDays = (Number.isFinite(args.training_days_per_week) && (args.training_days_per_week as number) >= 0) ? (args.training_days_per_week as number) : 4;
  const activityFactor = Math.min(1.9, 1.55 + 0.05 * trainingDays);
  const tdee = Math.round(bmr * activityFactor);
  const calTarget = args.goal === "cut" ? tdee - 500 : args.goal === "bulk" ? tdee + 300 : tdee;
  const proteinG = Math.round(args.weight_lbs);
  const fatG = Math.round((calTarget * 0.25) / 9);
  const carbG = Math.round((calTarget - proteinG * 4 - fatG * 9) / 4);
  return { calories_min: calTarget - 100, calories_max: calTarget, protein_min_g: proteinG - 10, protein_max_g: proteinG, carbs_min_g: carbG - 20, carbs_max_g: carbG, fats_min_g: fatG - 5, fats_max_g: fatG };
}

export async function getNutritionWeekSummary(athleteId: number, _args: { weeks_back?: number }): Promise<Card> {
  const weeksBack = _args.weeks_back ?? 0;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) - weeksBack * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toLocaleDateString("sv-SE");
  const weekEnd = sunday.toLocaleDateString("sv-SE");

  const [allTargets, entries] = await Promise.all([
    query(`SELECT * FROM nutrition_targets WHERE athlete_profile_id = $1`, [athleteId]),
    query(
      `SELECT date, SUM(calories) AS kcal, SUM(protein_g) AS protein_g, SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g
       FROM nutrition_entries
       WHERE athlete_profile_id = $1 AND date BETWEEN $2 AND $3 AND deleted_at IS NULL
       GROUP BY date ORDER BY date ASC`,
      [athleteId, weekStart, weekEnd]
    ),
  ]);

  const targetByType = Object.fromEntries(allTargets.map(t => [t.day_type as string, t]));
  const defaultTarget = targetByType["default"] ?? null;

  const routineRow = await queryOne(
    `SELECT r.id, r.schedule_mode, r.cycle_start_date FROM routines r
     WHERE r.athlete_profile_id = $1 AND r.status = 'active' LIMIT 1`,
    [athleteId]
  );

  const days = await Promise.all(entries.map(async (r) => {
    const dateStr = r.date as string;
    let dayTarget = defaultTarget;
    if (routineRow && (targetByType["training"] || targetByType["rest"])) {
      try {
        const dow = new Date(dateStr + "T12:00:00").getDay();
        const mode = routineRow.schedule_mode as string;
        let dayIndex: number;
        if (mode === "weekday") {
          dayIndex = dow;
        } else {
          const startStr = routineRow.cycle_start_date as string | null;
          if (startStr) {
            const daysSince = Math.max(0, Math.floor(
              (new Date(dateStr + "T12:00:00").getTime() - new Date(startStr + "T12:00:00").getTime()) / 86400000
            ));
            const countRow = await queryOne(`SELECT COUNT(*)::int as total FROM routine_days WHERE routine_id = $1`, [routineRow.id as number]);
            dayIndex = daysSince % ((countRow?.total as number) || 1);
          } else {
            dayIndex = 0;
          }
        }
        const dayRow = await queryOne(
          `SELECT is_rest_day FROM routine_days WHERE routine_id = $1 AND day_index = $2 LIMIT 1`,
          [routineRow.id as number, dayIndex]
        );
        if (dayRow) {
          const isTraining = !dayRow.is_rest_day;
          const desired = isTraining ? "training" : "rest";
          dayTarget = targetByType[desired] ?? defaultTarget;
        }
      } catch {
        // leave as defaultTarget
      }
    }
    return {
      date: dateStr,
      kcal: Math.round(Number(r.kcal || 0)),
      protein_g: Math.round(Number(r.protein_g || 0)),
      hit_protein: dayTarget ? Number(r.protein_g || 0) >= (dayTarget.protein_min_g as number) : false,
      hit_calories: dayTarget ? Number(r.kcal || 0) >= (dayTarget.calories_min as number) : false,
    };
  }));
  const target = defaultTarget;

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

export async function addNutritionRule(athleteId: number, args: { name: string; definition: string }): Promise<Card> {
  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { name: args.name, definition: args.definition };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'add_nutrition_rule', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  return buildPreviewCard("add_nutrition_rule", payload, res[0].id as number);
}

export async function commitAddNutritionRule(athleteId: number, payload: { name: string; definition: string }): Promise<Card> {
  await query(
    `UPDATE athlete_profile SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{nutrition_rules}', COALESCE(preferences->'nutrition_rules', '[]'::jsonb) || $1::jsonb) WHERE id = $2`,
    [JSON.stringify([payload]), athleteId]
  );
  return { type: "nutrition_rule_added", title: `Saved · ${payload.name}`, data: payload };
}

export async function editNutritionRule(athleteId: number, args: { name: string; new_name?: string; new_definition?: string }): Promise<Card> {
  const profile = await queryOne(`SELECT preferences FROM athlete_profile WHERE id = $1 LIMIT 1`, [athleteId]);
  const rules = ((profile?.preferences as Record<string, unknown>)?.nutrition_rules as Array<{ name: string; definition: string }>) ?? [];
  const before = rules.find(r => r.name === args.name);
  if (!before) return { type: "nutrition_rule_edited", title: "Not found", data: { error: `No rule named "${args.name}"` } };

  const after = { name: args.new_name ?? before.name, definition: args.new_definition ?? before.definition };
  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { original_name: args.name, before, after };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'edit_nutrition_rule', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  return buildPreviewCard("edit_nutrition_rule", payload, res[0].id as number);
}

export async function commitEditNutritionRule(athleteId: number, payload: { original_name: string; after: { name: string; definition: string } }): Promise<Card> {
  const profile = await queryOne(`SELECT preferences FROM athlete_profile WHERE id = $1 LIMIT 1`, [athleteId]);
  const prefs = (profile?.preferences as Record<string, unknown>) ?? {};
  const rules = (prefs.nutrition_rules as Array<{ name: string; definition: string }>) ?? [];
  const idx = rules.findIndex(r => r.name === payload.original_name);
  if (idx < 0) return { type: "nutrition_rule_edited", title: "Not found", data: { error: "Rule disappeared" } };
  rules[idx] = payload.after;
  await query(
    `UPDATE athlete_profile SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{nutrition_rules}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify(rules), athleteId]
  );
  return { type: "nutrition_rule_edited", title: `Updated · ${payload.after.name}`, data: payload.after };
}

export async function removeNutritionRule(athleteId: number, args: { name: string }): Promise<Card> {
  const profile = await queryOne(`SELECT preferences FROM athlete_profile WHERE id = $1 LIMIT 1`, [athleteId]);
  const rules = ((profile?.preferences as Record<string, unknown>)?.nutrition_rules as Array<{ name: string; definition: string }>) ?? [];
  const target = rules.find(r => r.name === args.name);
  if (!target) return { type: "nutrition_rule_removed", title: "Not found", data: { error: `No rule named "${args.name}"` } };

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { name: args.name, definition: target.definition };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'remove_nutrition_rule', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  return buildPreviewCard("remove_nutrition_rule", payload, res[0].id as number);
}

export async function commitRemoveNutritionRule(athleteId: number, payload: { name: string }): Promise<Card> {
  const profile = await queryOne(`SELECT preferences FROM athlete_profile WHERE id = $1 LIMIT 1`, [athleteId]);
  const prefs = (profile?.preferences as Record<string, unknown>) ?? {};
  const rules = (prefs.nutrition_rules as Array<{ name: string; definition: string }>) ?? [];
  await query(
    `UPDATE athlete_profile SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{nutrition_rules}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify(rules.filter(r => r.name !== payload.name)), athleteId]
  );
  return { type: "nutrition_rule_removed", title: `Removed · ${payload.name}`, data: payload };
}

export async function removeDayTypeTarget(athleteId: number, args: { day_type: "training" | "rest" }): Promise<Card> {
  const existing = await queryOne(
    `SELECT id FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2 LIMIT 1`,
    [athleteId, args.day_type]
  );
  if (!existing) return { type: "nutrition_targets_removed", title: "Nothing to drop", data: { error: `No ${args.day_type}-day target set` } };

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = { day_type: args.day_type };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'remove_day_type_target', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  return buildPreviewCard("remove_day_type_target", payload, res[0].id as number);
}

export async function commitRemoveDayTypeTarget(athleteId: number, payload: { day_type: string }): Promise<Card> {
  await query(
    `DELETE FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2 AND day_type != 'default'`,
    [athleteId, payload.day_type]
  );
  return { type: "nutrition_targets_removed", title: `Dropped ${payload.day_type}-day split`, data: payload };
}

type ParsedNutritionTarget = {
  day_type: "default" | "training" | "rest";
  calories_min: number | null; calories_max: number | null;
  protein_min_g: number; protein_max_g: number;
  carbs_min_g: number; carbs_max_g: number;
  fats_min_g: number; fats_max_g: number;
};

export async function importNutritionPlan(athleteId: number, args: { text: string }): Promise<Card> {
  let parsed: Awaited<ReturnType<typeof parseNutritionPlan>>;
  try {
    parsed = await parseNutritionPlan(args.text);
  } catch (err) {
    return {
      type: "nutrition_plan_import_preview",
      title: "Parse Error",
      data: { error: "Could not parse the plan. Paste cleaner text or describe the targets directly.", detail: String(err) },
    };
  }

  if (!parsed.targets?.length && !parsed.rules?.length) {
    return {
      type: "nutrition_plan_import_preview",
      title: "Import Failed",
      data: { error: "No targets or rules found in the input." },
    };
  }

  const expires = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
  const payload = {
    targets: parsed.targets ?? [],
    rules: parsed.rules ?? [],
    diet: parsed.diet ?? null,
    goal: parsed.goal ?? null,
    source_text: args.text.slice(0, 4000),
  };
  const res = await query(
    `INSERT INTO pending_actions (athlete_profile_id, type, payload, expires_at) VALUES ($1, 'import_nutrition_plan', $2::jsonb, $3) RETURNING id`,
    [athleteId, JSON.stringify(payload), expires]
  );
  return buildPreviewCard("import_nutrition_plan", payload, res[0].id as number);
}

export async function commitImportNutritionPlan(athleteId: number, payload: {
  targets: ParsedNutritionTarget[];
  rules: Array<{ name: string; definition: string }>;
  diet: string | null;
  goal: string | null;
}): Promise<Card> {
  for (const t of payload.targets) {
    const calMin = (t.calories_min && t.calories_min > 0) ? t.calories_min : Math.round(t.protein_min_g * 4 + t.carbs_min_g * 4 + t.fats_min_g * 9);
    const calMax = (t.calories_max && t.calories_max > 0) ? t.calories_max : Math.round(t.protein_max_g * 4 + t.carbs_max_g * 4 + t.fats_max_g * 9);
    await query(`DELETE FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2`, [athleteId, t.day_type]);
    await query(
      `INSERT INTO nutrition_targets (athlete_profile_id, day_type, calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [athleteId, t.day_type, calMin, calMax, t.protein_min_g, t.protein_max_g, t.carbs_min_g, t.carbs_max_g, t.fats_min_g, t.fats_max_g]
    );
  }
  if (payload.rules.length > 0) {
    await query(
      `UPDATE athlete_profile SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{nutrition_rules}', COALESCE(preferences->'nutrition_rules', '[]'::jsonb) || $1::jsonb) WHERE id = $2`,
      [JSON.stringify(payload.rules), athleteId]
    );
  }
  if (payload.diet) {
    await query(
      `UPDATE athlete_profile SET preferences = jsonb_set(COALESCE(preferences, '{}'::jsonb), '{diet}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(payload.diet), athleteId]
    );
  }
  if (payload.goal) {
    await query(`UPDATE athlete_profile SET goals = $1 WHERE id = $2`, [payload.goal, athleteId]);
  }
  return {
    type: "nutrition_plan_imported",
    title: "Plan Imported",
    data: { targets_added: payload.targets.length, rules_added: payload.rules.length, diet: payload.diet, goal: payload.goal },
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
