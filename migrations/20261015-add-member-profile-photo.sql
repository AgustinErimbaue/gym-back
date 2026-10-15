ALTER TABLE gym."Member"
  ADD COLUMN IF NOT EXISTS profile_photo_data TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ;
