import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_aksECxpW7nX3@ep-autumn-mode-am8zlyh7-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const sql = neon(DATABASE_URL);

const statements = [
  `DROP TABLE IF EXISTS schedule_template_exercises CASCADE`,
  `DROP TABLE IF EXISTS schedule_templates CASCADE`,
  `CREATE TABLE IF NOT EXISTS routines (
    id SERIAL PRIMARY KEY,
    athlete_profile_id INTEGER REFERENCES athlete_profile(id),
    name TEXT NOT NULL,
    source_text TEXT,
    schedule_mode TEXT NOT NULL DEFAULT 'weekday',
    status TEXT NOT NULL DEFAULT 'draft',
    phase_label TEXT,
    parent_routine_id INTEGER REFERENCES routines(id),
    cycle_start_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS routine_days (
    id SERIAL PRIMARY KEY,
    routine_id INTEGER REFERENCES routines(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL,
    name TEXT,
    session_type TEXT,
    is_rest_day BOOLEAN DEFAULT FALSE,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS routine_blocks (
    id SERIAL PRIMARY KEY,
    routine_day_id INTEGER REFERENCES routine_days(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    block_type TEXT NOT NULL DEFAULT 'straight',
    rounds INTEGER,
    rest_between_exercises_sec INTEGER,
    rest_between_rounds_sec INTEGER,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS routine_exercises (
    id SERIAL PRIMARY KEY,
    routine_block_id INTEGER REFERENCES routine_blocks(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 0,
    exercise_id INTEGER REFERENCES exercise_catalog(id),
    name_raw TEXT NOT NULL,
    sets INTEGER,
    reps_min INTEGER,
    reps_max INTEGER,
    tempo TEXT,
    rir_min INTEGER,
    rir_max INTEGER,
    load_notes TEXT,
    duration_sec INTEGER,
    is_amrap BOOLEAN DEFAULT FALSE
  )`,
];

let ok = 0;
let fail = 0;

for (const stmt of statements) {
  try {
    await sql.query(stmt);
    ok++;
    console.log(`OK: ${stmt.slice(0, 60).replace(/\n/g, " ")}...`);
  } catch (err) {
    fail++;
    console.error(`FAIL: ${stmt.slice(0, 80).replace(/\n/g, " ")}...\n  ${err.message}`);
  }
}

console.log(`\nRoutine migration done: ${ok} ok, ${fail} failed`);
