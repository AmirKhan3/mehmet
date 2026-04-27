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
};

export type TodayState = {
  today_date: string;
  meals_logged_today: number;
  last_workout_date: string | null;
  is_training_day_today: boolean;
  today_session_name: string | null;
  last_message_age_minutes: number;
};

export async function loadProfile(): Promise<ProfileSnapshot> {
  try {
    const row = await queryOne(
      `SELECT weight, height, goals, preferences FROM athlete_profile WHERE id = 1 LIMIT 1`
    );
    return {
      weight_lbs: (row?.weight as number | null) ?? null,
      height_in: (row?.height as number | null) ?? null,
      goals: (row?.goals as string | null) ?? null,
      preferences: (row?.preferences as Record<string, unknown>) ?? {},
    };
  } catch {
    return { weight_lbs: null, height_in: null, goals: null, preferences: {} };
  }
}

export async function applyProfileUpdates(updates: ProfileUpdates): Promise<void> {
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
    // Deep-merge new keys into existing JSONB
    setClauses.push(`preferences = preferences || $${i++}::jsonb`);
    params.push(JSON.stringify(updates.preferences));
  }

  if (setClauses.length === 0) return;

  params.push(1); // WHERE id = $n
  await query(
    `UPDATE athlete_profile SET ${setClauses.join(", ")} WHERE id = $${i}`,
    params
  );
}

export async function loadTodayState(): Promise<TodayState> {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
  const todayDayOfWeek = new Date(today + "T12:00:00").getDay(); // 0=Sun

  const [mealsRow, lastWorkoutRow, lastMsgRow, routineRow] = await Promise.all([
    queryOne(
      `SELECT COUNT(*)::int as cnt FROM nutrition_entries
       WHERE athlete_profile_id = 1 AND date = $1 AND deleted_at IS NULL`,
      [today]
    ),
    queryOne(
      `SELECT MAX(date) as last_date FROM workout_logs WHERE athlete_profile_id = 1`
    ),
    queryOne(
      `SELECT created_at FROM chat_messages ORDER BY id DESC LIMIT 1`
    ),
    queryOne(
      `SELECT r.id, r.schedule_mode, r.cycle_start_date FROM routines r
       WHERE r.athlete_profile_id = 1 AND r.status = 'active' LIMIT 1`
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

  return {
    today_date: today,
    meals_logged_today,
    last_workout_date,
    is_training_day_today,
    today_session_name,
    last_message_age_minutes,
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

  if (lines.length === 0) return "What you know about the user:\nNo profile data yet.";
  return `What you know about the user:\n${lines.join("\n")}`;
}

export function renderTodayStateForPrompt(t: TodayState): string {
  const lines: string[] = [];

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

  if (t.last_message_age_minutes > 0) {
    const h = Math.floor(t.last_message_age_minutes / 60);
    const m = t.last_message_age_minutes % 60;
    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
    lines.push(`- last message: ${label} ago`);
  }

  return `What's happening today:\n${lines.join("\n")}`;
}
