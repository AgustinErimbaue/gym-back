CREATE TABLE IF NOT EXISTS gym."PendingMemberRegistration" (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  dni VARCHAR(8) NOT NULL,
  address VARCHAR(200) NOT NULL,
  phone VARCHAR(30),
  plan_id INTEGER NOT NULL REFERENCES gym."Plan"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pending_member_registration_expires_at_idx
  ON gym."PendingMemberRegistration" (expires_at);
