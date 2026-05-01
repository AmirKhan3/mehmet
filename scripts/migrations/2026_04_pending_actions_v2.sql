-- Upgrade pending_actions to support full preview→confirm lifecycle
ALTER TABLE pending_actions
  ADD COLUMN IF NOT EXISTS athlete_profile_id INTEGER REFERENCES athlete_profile(id) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_card_json JSONB;

CREATE INDEX IF NOT EXISTS idx_pending_actions_open
  ON pending_actions(athlete_profile_id, status, created_at DESC)
  WHERE status = 'pending';
