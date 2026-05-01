-- StrongAI Schema

CREATE TABLE IF NOT EXISTS athlete_profile (
  id SERIAL PRIMARY KEY,
  name TEXT,
  height NUMERIC,
  weight NUMERIC,
  goals TEXT,
  preferences JSONB DEFAULT '{}'
);

INSERT INTO athlete_profile (id, name) VALUES (1, 'Athlete') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS exercise_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  category TEXT,
  equipment TEXT,
  muscles JSONB DEFAULT '[]',
  is_custom BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS schedule_templates (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  session_type TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS schedule_template_exercises (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES schedule_templates(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES exercise_catalog(id),
  sort_order INTEGER DEFAULT 0,
  sets INTEGER,
  reps INTEGER,
  tempo TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS schedule_overrides (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  date DATE NOT NULL,
  override_type TEXT,
  workout_type TEXT,
  is_rest_day BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  exercises JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS workout_logs (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  date DATE NOT NULL,
  exercise_id INTEGER REFERENCES exercise_catalog(id),
  sets INTEGER,
  reps INTEGER,
  round_number INTEGER,
  status TEXT DEFAULT 'completed',
  modifier TEXT,
  exception_type TEXT,
  skipped BOOLEAN DEFAULT FALSE,
  partial BOOLEAN DEFAULT FALSE,
  dedup_key TEXT UNIQUE,
  source_message_id TEXT
);

CREATE TABLE IF NOT EXISTS nutrition_entries (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  date DATE NOT NULL,
  item_name TEXT NOT NULL,
  quantity TEXT,
  calories NUMERIC DEFAULT 0,
  protein_g NUMERIC DEFAULT 0,
  carbs_g NUMERIC DEFAULT 0,
  fat_g NUMERIC DEFAULT 0,
  source TEXT DEFAULT 'llm_estimate',
  source_message_id TEXT
);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  day_type TEXT DEFAULT 'default',
  calories_min NUMERIC,
  calories_max NUMERIC,
  protein_min_g NUMERIC,
  protein_max_g NUMERIC,
  carbs_min_g NUMERIC,
  carbs_max_g NUMERIC,
  fats_min_g NUMERIC,
  fats_max_g NUMERIC
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id) DEFAULT 1,
  type TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  result_card_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_open
  ON pending_actions(athlete_profile_id, status, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  text TEXT,
  cards_json JSONB DEFAULT '[]',
  tool_requests JSONB,
  tool_results JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistant_memory (
  id SERIAL PRIMARY KEY,
  athlete_profile_id INTEGER REFERENCES athlete_profile(id),
  summary TEXT
);

INSERT INTO assistant_memory (athlete_profile_id, summary) VALUES (1, '') ON CONFLICT DO NOTHING;
