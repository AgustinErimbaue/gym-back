CREATE TABLE IF NOT EXISTS gym."MemberPushToken" (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS member_push_token_member_id_idx
  ON gym."MemberPushToken"(member_id);
