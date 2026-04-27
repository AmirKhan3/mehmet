-- Adds soft-delete support to nutrition_entries
ALTER TABLE nutrition_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_active
  ON nutrition_entries (athlete_profile_id, date)
  WHERE deleted_at IS NULL;
