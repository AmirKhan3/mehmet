import { query, queryOne } from "./db";

export type ProfileUpdates = {
  weight_lbs?: number;
  height_in?: number;
  goals?: string;
  preferences?: Record<string, unknown>;
};

export type ProfileSnapshot = {
  weight_lbs: number | null;
  height_in: number | null;
  goals: string | null;
  preferences: Record<string, unknown>;
  routine_snapshot_md: string | null;
  nutrition_snapshot_md: string | null;
  nutrition_enabled: boolean;
};

export type TodayState = {
  today_date: string;
  meals_logged_today: number;
  last_workout_date: string | null;
  is_training_day_today: boolean;
  today_session_name: string | null;
  last_message_age_minutes: number;
  applicable_day_type: "training" | "rest" | "default";
};

export async function loadProfile(athleteId: number): Promise<ProfileSnapshot> {
  try {
    const row = await queryOne(
      `SELECT weight, height, goals, preferences, nutrition_enabled FROM athlete_profile WHERE id = $1 LIMIT 1`,
      [athleteId]
    );
    const nutritionEnabled = (row?.nutrition_enabled as boolean) ?? false;
    const [routineMd, nutritionMd] = await Promise.all([
      buildRoutineSnapshotMd(athleteId),
      nutritionEnabled ? buildNutritionSnapshotMd(athleteId) : Promise.resolve(null),
    ]);
    return {
      weight_lbs: (row?.weight as number | null) ?? null,
      height_in: (row?.height as number | null) ?? null,
      goals: (row?.goals as string | null) ?? null,
      preferences: (row?.preferences as Record<string, unknown>) ?? {},
      routine_snapshot_md: routineMd,
      nutrition_snapshot_md: nutritionMd,
      nutrition_enabled: nutritionEnabled,
    };
  } catch {
    return { weight_lbs: null, height_in: null, goals: null, preferences: {}, routine_snapshot_md: null, nutrition_snapshot_md: null, nutrition_enabled: false };
  }
}

async function buildRoutineSnapshotMd(athleteId: number): Promise<string | null> {
  try {
    const routine = await queryOne(
      `SELECT id, name, schedule_mode, phase_label FROM routines WHERE athlete_profile_id = $1 AND status = 'active' LIMIT 1`,
      [athleteId]
    );
    if (!routine) return null;

    const days = await query(
      `SELECT rd.id, rd.day_index, rd.name, rd.session_type, rd.is_rest_day,
         COALESCE(json_agg(
           json_build_object(
             'block_type', rb.block_type, 'rounds', rb.rounds,
             'exercises', (
               SELECT COALESCE(json_agg(json_build_object(
                 'name', COALESCE(ec.name, re.name_raw),
                 'sets', re.sets, 'reps_min', re.reps_min, 'reps_max', re.reps_max,
                 'is_amrap', re.is_amrap, 'load_notes', re.load_notes
               ) ORDER BY re.sort_order), '[]')
               FROM routine_exercises re
               LEFT JOIN exercise_catalog ec ON ec.id = re.exercise_id
               WHERE re.routine_block_id = rb.id
             )
           ) ORDER BY rb.sort_order
         ) FILTER (WHERE rb.id IS NOT NULL), '[]') as blocks
       FROM routine_days rd
       LEFT JOIN routine_blocks rb ON rb.routine_day_id = rd.id
       WHERE rd.routine_id = $1
       GROUP BY rd.id ORDER BY rd.day_index`,
      [routine.id]
    );

    const label = `${routine.name as string}${routine.phase_label ? ` — ${routine.phase_label as string}` : ""} (${routine.schedule_mode as string})`;
    const lines: string[] = [`Active Routine: ${label}`, ""];

    for (const day of days) {
      if (day.is_rest_day) {
        lines.push(`${day.name} — Rest`);
        continue;
      }
      lines.push(`${day.name} — ${(day.session_type as string) || (day.name as string)}`);
      const blocks = day.blocks as { block_type: string; rounds: number | null; exercises: { name: string; sets: number | null; reps_min: number | null; reps_max: number | null; is_amrap: boolean; load_notes: string | null }[] }[];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const rounds = b.rounds ? `x${b.rounds}` : "";
        const exList = (b.exercises || []).map((e) => {
          if (e.is_amrap) return `${e.name} (AMRAP)`;
          if (e.load_notes) return `${e.name} ${e.reps_min ?? ""}${e.reps_max && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps (${e.load_notes})`;
          const reps = e.reps_min ? `${e.reps_min}${e.reps_max && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ""} reps` : "";
          return `${e.name}${reps ? " " + reps : ""}`;
        }).join(", ");
        lines.push(`  Block ${bi + 1} (${b.block_type} ${rounds}): ${exList}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  } catch {
    return null;
  }
}

async function buildNutritionSnapshotMd(athleteId: number): Promise<string | null> {
  try {
    const [rows, profileRow] = await Promise.all([
      query(
        `SELECT day_type, calories_min, calories_max, protein_min_g, protein_max_g,
                carbs_min_g, carbs_max_g, fats_min_g, fats_max_g
         FROM nutrition_targets WHERE athlete_profile_id = $1
         ORDER BY CASE day_type WHEN 'default' THEN 0 WHEN 'training' THEN 1 WHEN 'rest' THEN 2 ELSE 3 END`,
        [athleteId]
      ),
      queryOne(`SELECT preferences, goals FROM athlete_profile WHERE id = $1 LIMIT 1`, [athleteId]),
    ]);

    const lines: string[] = [];
    for (const t of rows) {
      const calMin = Number(t.calories_min);
      const calMax = Number(t.calories_max);
      const cal = calMin === calMax ? String(calMax) : `${calMin}-${calMax}`;
      const label = (t.day_type as string) === "default" ? "Macro Targets" : `Macro Targets (${t.day_type as string} day)`;
      lines.push(`${label}: ${cal} kcal`);
      lines.push(`  protein: ${t.protein_min_g}-${t.protein_max_g}g`);
      lines.push(`  carbs:   ${t.carbs_min_g}-${t.carbs_max_g}g`);
      lines.push(`  fats:    ${t.fats_min_g}-${t.fats_max_g}g`);
      lines.push("");
    }
    if (rows.length > 0 && profileRow?.goals) {
      lines.push(`Goal: ${profileRow.goals as string}`);
      lines.push("");
    }

    const prefs = (profileRow?.preferences as Record<string, unknown>) ?? {};
    const eatingRules = (prefs.nutrition_rules as Array<{ name: string; definition: string }>) ?? [];
    if (eatingRules.length > 0) {
      lines.push("Eating Protocols:");
      for (const r of eatingRules) lines.push(`  - ${r.name}: ${r.definition}`);
    }

    if (lines.length === 0) return null;
    return lines.join("\n").trimEnd();
  } catch {
    return null;
  }
}

export async function applyProfileUpdates(athleteId: number, updates: ProfileUpdates): Promise<void> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (updates.weight_lbs != null) {
    setClauses.push(`weight = $${i++}`);
    params.push(updates.weight_lbs);
  }
  if (updates.height_in != null) {
    setClauses.push(`height = $${i++}`);
    params.push(updates.height_in);
  }
  if (updates.goals != null) {
    setClauses.push(`goals = $${i++}`);
    params.push(updates.goals);
  }
  if (updates.preferences && Object.keys(updates.preferences).length > 0) {
    setClauses.push(`preferences = preferences || $${i++}::jsonb`);
    params.push(JSON.stringify(updates.preferences));
  }

  if (setClauses.length === 0) return;

  params.push(athleteId);
  await query(
    `UPDATE athlete_profile SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params
  );
}

export async function loadTodayState(athleteId: number): Promise<TodayState> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
  const todayDayOfWeek = new Date(today + "T12:00:00").getDay();

  const [mealsRow, lastWorkoutRow, lastMsgRow, routineRow] = await Promise.all([
    queryOne(
      `SELECT COUNT(*)::int as cnt FROM nutrition_entries
       WHERE athlete_profile_id = $1 AND date = $2 AND deleted_at IS NULL`,
      [athleteId, today]
    ),
    queryOne(
      `SELECT MAX(date) as last_date FROM workout_logs WHERE athlete_profile_id = $1`,
      [athleteId]
    ),
    queryOne(
      `SELECT created_at FROM chat_messages ORDER BY id DESC LIMIT 1`
    ),
    queryOne(
      `SELECT r.id, r.schedule_mode, r.cycle_start_date FROM routines r
       WHERE r.athlete_profile_id = $1 AND r.status = 'active' LIMIT 1`,
      [athleteId]
    ),
  ]).catch(() => [null, null, null, null]);

  const meals_logged_today = (mealsRow?.cnt as number) ?? 0;
  const last_workout_date = (lastWorkoutRow?.last_date as string | null) ?? null;

  let last_message_age_minutes = 0;
  if (lastMsgRow?.created_at) {
    const diffMs = Date.now() - new Date(lastMsgRow.created_at as string).getTime();
    last_message_age_minutes = Math.floor(diffMs / 60000);
  }

  let is_training_day_today = false;
  let today_session_name: string | null = null;

  if (routineRow) {
    try {
      const routineId = routineRow.id as number;
      const mode = routineRow.schedule_mode as string;

      let dayIndex: number;
      if (mode === "weekday") {
        dayIndex = todayDayOfWeek;
      } else {
        const startStr = routineRow.cycle_start_date as string | null;
        if (startStr) {
          const start = new Date(startStr + "T12:00:00").getTime();
          const now = new Date(today + "T12:00:00").getTime();
          const daysSince = Math.max(0, Math.floor((now - start) / 86400000));
          const countRow = await queryOne(
            `SELECT COUNT(*)::int as total FROM routine_days WHERE routine_id = $1`,
            [routineId]
          );
          dayIndex = daysSince % ((countRow?.total as number) || 1);
        } else {
          dayIndex = 0;
        }
      }

      const dayRow = await queryOne(
        `SELECT name, is_rest_day FROM routine_days WHERE routine_id = $1 AND day_index = $2 LIMIT 1`,
        [routineId, dayIndex]
      );
      if (dayRow) {
        is_training_day_today = !dayRow.is_rest_day;
        today_session_name = (dayRow.name as string) || null;
      }
    } catch {
      // leave defaults
    }
  }

  let applicable_day_type: "training" | "rest" | "default" = "default";
  try {
    const desired = is_training_day_today ? "training" : "rest";
    const dayTypeRow = await queryOne(
      `SELECT 1 FROM nutrition_targets WHERE athlete_profile_id = $1 AND day_type = $2 LIMIT 1`,
      [athleteId, desired]
    );
    if (dayTypeRow) applicable_day_type = desired;
  } catch {
    // leave as default
  }

  return {
    today_date: today,
    meals_logged_today,
    last_workout_date,
    is_training_day_today,
    today_session_name,
    last_message_age_minutes,
    applicable_day_type,
  };
}

export function renderProfileForPrompt(p: ProfileSnapshot): string {
  const lines: string[] = [];

  if (p.weight_lbs != null) lines.push(`- weight: ${p.weight_lbs} lbs`);
  if (p.height_in != null) {
    const ft = Math.floor(p.height_in / 12);
    const inches = Math.round(p.height_in % 12);
    lines.push(`- height: ${ft}'${inches}" (${p.height_in} in)`);
  }
  if (p.goals) lines.push(`- goals: ${p.goals}`);

  const prefs = p.preferences;
  if (prefs.training_style) lines.push(`- training style: ${prefs.training_style}`);
  if (prefs.training_history_months) lines.push(`- training history: ~${prefs.training_history_months} months`);
  if (prefs.training_freq_per_week) lines.push(`- training freq: ${prefs.training_freq_per_week} days/week`);
  if (prefs.equipment) lines.push(`- equipment: ${prefs.equipment}`);
  if (prefs.body_aspiration) lines.push(`- body aspiration: ${prefs.body_aspiration}`);
  if (prefs.concerns) {
    const c = Array.isArray(prefs.concerns) ? prefs.concerns.join(", ") : prefs.concerns;
    lines.push(`- concerns: ${c}`);
  }
  if (prefs.cultural_context) lines.push(`- cultural context: ${prefs.cultural_context}`);
  if (prefs.diet) lines.push(`- diet: ${prefs.diet}`);
  if (prefs.lexicon && typeof prefs.lexicon === "object") {
    const entries = Object.entries(prefs.lexicon as Record<string, string>);
    if (entries.length > 0) {
      lines.push(`- lexicon (user's preferred terms): ${entries.map(([k, v]) => `${k}=${v}`).join("; ")}`);
    }
  }

  if (lines.length === 0) return "What you know about the user:\nNo profile data yet.";
  let out = `What you know about the user:\n${lines.join("\n")}`;
  if (p.routine_snapshot_md) {
    out += `\n\n${p.routine_snapshot_md}`;
  }
  if (p.nutrition_snapshot_md) {
    out += `\n\n${p.nutrition_snapshot_md}`;
  }
  return out;
}

export function renderTodayStateForPrompt(t: TodayState): string {
  const lines: string[] = [];

  if (t.today_date) {
    const weekday = new Date(t.today_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" });
    lines.push(`- today: ${t.today_date} (${weekday})`);
  }

  lines.push(`- meals logged today: ${t.meals_logged_today}`);

  if (t.last_workout_date) {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
    const daysDiff = Math.floor(
      (new Date(today + "T12:00:00").getTime() - new Date(t.last_workout_date + "T12:00:00").getTime()) / 86400000
    );
    const label = daysDiff === 0 ? "today" : daysDiff === 1 ? "yesterday" : `${daysDiff} days ago`;
    lines.push(`- last workout: ${label}`);
  } else {
    lines.push("- last workout: none on record");
  }

  if (t.is_training_day_today) {
    lines.push(`- today is a training day${t.today_session_name ? ` (${t.today_session_name})` : ""}`);
  } else {
    lines.push("- today is a rest day");
  }

  if (t.applicable_day_type !== "default") {
    lines.push(`- macro target type today: ${t.applicable_day_type}`);
  }

  if (t.last_message_age_minutes > 0) {
    const h = Math.floor(t.last_message_age_minutes / 60);
    const m = t.last_message_age_minutes % 60;
    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
    lines.push(`- last message: ${label} ago`);
  }

  return `What's happening today:\n${lines.join("\n")}`;
}
