import { query, queryOne } from "../db";
import type { Card } from "@/types";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function getResolvedPlan(args: { date?: string }): Promise<Card> {
  const date = args.date === "today" || !args.date
    ? new Date().toISOString().split("T")[0]
    : args.date;

  const weekday = new Date(date + "T12:00:00").getDay();

  const override = await queryOne(
    `SELECT * FROM schedule_overrides WHERE date = $1 LIMIT 1`,
    [date]
  );

  if (override) {
    const exercises = override.exercises as unknown[] || [];
    return {
      type: "schedule_plan",
      title: `Today · ${formatDate(date)}`,
      data: { date, source: "override", session_type: override.workout_type, exercises, is_rest_day: override.is_rest_day },
    };
  }

  const template = await queryOne(
    `SELECT st.*, json_agg(json_build_object('exercise_id', ste.exercise_id, 'sets', ste.sets, 'reps', ste.reps, 'tempo', ste.tempo, 'notes', ste.notes, 'sort_order', ste.sort_order, 'name', ec.name) ORDER BY ste.sort_order) as exercises
     FROM schedule_templates st
     LEFT JOIN schedule_template_exercises ste ON ste.template_id = st.id
     LEFT JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     WHERE st.weekday = $1
     GROUP BY st.id`,
    [weekday]
  );

  if (!template) {
    return {
      type: "schedule_plan",
      title: `Today · ${formatDate(date)}`,
      data: { date, source: "template", session_type: "Rest", exercises: [], is_rest_day: true },
    };
  }

  return {
    type: "schedule_plan",
    title: `Today · ${formatDate(date)}`,
    data: {
      date,
      source: "template",
      session_type: template.session_type,
      exercises: template.exercises || [],
      is_rest_day: false,
    },
  };
}

export async function getTemplateForWeekday(args: { weekday: string }): Promise<Card> {
  const dayIndex = WEEKDAY_NAMES.findIndex(
    (d) => d.toLowerCase() === args.weekday.toLowerCase()
  );

  if (dayIndex === -1) {
    return { type: "weekday_template", title: args.weekday, data: { error: "Unknown weekday" } };
  }

  const template = await queryOne(
    `SELECT st.*, json_agg(json_build_object('exercise_id', ste.exercise_id, 'sets', ste.sets, 'reps', ste.reps, 'tempo', ste.tempo, 'notes', ste.notes, 'sort_order', ste.sort_order, 'name', ec.name) ORDER BY ste.sort_order) as exercises
     FROM schedule_templates st
     LEFT JOIN schedule_template_exercises ste ON ste.template_id = st.id
     LEFT JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     WHERE st.weekday = $1
     GROUP BY st.id`,
    [dayIndex]
  );

  return {
    type: "weekday_template",
    title: args.weekday,
    data: {
      weekday: args.weekday,
      session_type: template?.session_type || "Rest",
      exercises: template?.exercises || [],
      is_rest_day: !template,
    },
  };
}

export async function getResolvedWeek(args: { range?: string }): Promise<Card> {
  const templates = await query(
    `SELECT st.weekday, st.session_type, st.notes,
      json_agg(json_build_object('name', ec.name, 'sets', ste.sets, 'reps', ste.reps, 'sort_order', ste.sort_order) ORDER BY ste.sort_order) as exercises
     FROM schedule_templates st
     LEFT JOIN schedule_template_exercises ste ON ste.template_id = st.id
     LEFT JOIN exercise_catalog ec ON ec.id = ste.exercise_id
     GROUP BY st.weekday, st.session_type, st.notes
     ORDER BY st.weekday`
  );

  const week = WEEKDAY_NAMES.map((name, i) => {
    const t = templates.find((r) => r.weekday === i);
    return {
      weekday: name,
      weekday_index: i,
      session_type: t?.session_type || "Rest",
      exercises: t?.exercises || [],
      is_rest_day: !t,
    };
  });

  return {
    type: "schedule_week",
    title: "Your Weekly Routine",
    data: { week },
  };
}

export async function previewMoveSession(args: { source: string; targetDate: string }): Promise<Card> {
  const sourceDay = WEEKDAY_NAMES.findIndex(
    (d) => d.toLowerCase() === args.source.toLowerCase()
  );

  const template = sourceDay >= 0
    ? await queryOne(`SELECT * FROM schedule_templates WHERE weekday = $1`, [sourceDay])
    : null;

  const date = args.targetDate === "today" ? new Date().toISOString().split("T")[0] : args.targetDate;

  return {
    type: "program_edit_preview",
    title: `Move ${args.source} → ${formatDate(date)}`,
    data: {
      action: "move_session",
      source: args.source,
      target_date: date,
      session_type: template?.session_type || "Unknown",
      pending_confirmation: true,
      message: `This will move your ${args.source} session to ${formatDate(date)}. Confirm to apply.`,
    },
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
