CREATE TABLE IF NOT EXISTS gym."Workout" (
  id SERIAL PRIMARY KEY,
  method VARCHAR(16) NOT NULL CHECK (method IN ('heavyDuty', 'weider')),
  level VARCHAR(16) NOT NULL CHECK (level IN ('Principiante', 'Intermedio', 'Experto')),
  routine_name VARCHAR(120) NOT NULL,
  exercises JSONB NOT NULL,
  feedback VARCHAR(1000) NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS workout_member_performed_at_idx
  ON gym."Workout"(member_id, performed_at DESC);
