CREATE TABLE IF NOT EXISTS gym."PasswordResetCode" (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS password_reset_code_member_id_idx
  ON gym."PasswordResetCode"(member_id);

CREATE TABLE IF NOT EXISTS gym."BodyMeasurement" (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  measured_on DATE NOT NULL,
  weight_kg DECIMAL(5, 2) NOT NULL,
  body_fat_percent DECIMAL(4, 1),
  waist_cm DECIMAL(5, 1),
  chest_cm DECIMAL(5, 1),
  hips_cm DECIMAL(5, 1),
  arm_cm DECIMAL(4, 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS body_measurement_member_id_measured_on
  ON gym."BodyMeasurement"(member_id, measured_on);

CREATE TABLE IF NOT EXISTS gym."GymClass" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(400) NOT NULL DEFAULT '',
  instructor VARCHAR(80) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  capacity INTEGER NOT NULL DEFAULT 15,
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS gym_class_starts_at ON gym."GymClass"(starts_at);

CREATE TABLE IF NOT EXISTS gym."ClassBooking" (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES gym."GymClass"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS class_booking_class_id_member_id
  ON gym."ClassBooking"(class_id, member_id);
CREATE INDEX IF NOT EXISTS class_booking_member_id ON gym."ClassBooking"(member_id);

CREATE TABLE IF NOT EXISTS gym."NotificationLog" (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL,
  ref_key VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_log_member_id_kind_ref_key
  ON gym."NotificationLog"(member_id, kind, ref_key);
