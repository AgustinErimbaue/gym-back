CREATE TABLE IF NOT EXISTS gym."CommunityProfile" (
  member_id INTEGER PRIMARY KEY REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  is_visible BOOLEAN NOT NULL DEFAULT FALSE,
  training_level VARCHAR(20),
  goal VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT community_profile_training_level_check
    CHECK (training_level IS NULL OR training_level IN ('Principiante', 'Intermedio', 'Experto'))
);

CREATE TABLE IF NOT EXISTS gym."CommunityConnection" (
  id SERIAL PRIMARY KEY,
  member_a INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  member_b INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  requested_by INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT community_connection_distinct_members CHECK (member_a < member_b),
  CONSTRAINT community_connection_requester_check CHECK (requested_by = member_a OR requested_by = member_b),
  CONSTRAINT community_connection_status_check CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT community_connection_pair_unique UNIQUE (member_a, member_b)
);

CREATE INDEX IF NOT EXISTS community_connection_member_a_status_idx
  ON gym."CommunityConnection"(member_a, status);
CREATE INDEX IF NOT EXISTS community_connection_member_b_status_idx
  ON gym."CommunityConnection"(member_b, status);

CREATE TABLE IF NOT EXISTS gym."CommunityBlock" (
  id SERIAL PRIMARY KEY,
  blocked_by INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  blocked_member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT community_block_distinct_members CHECK (blocked_by <> blocked_member_id),
  CONSTRAINT community_block_pair_unique UNIQUE (blocked_by, blocked_member_id)
);

CREATE TABLE IF NOT EXISTS gym."CommunityReport" (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reported_member_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reason VARCHAR(32) NOT NULL,
  details VARCHAR(500),
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT community_report_distinct_members CHECK (reporter_id <> reported_member_id),
  CONSTRAINT community_report_reason_check
    CHECK (reason IN ('inappropriate', 'harassment', 'fake_profile', 'other')),
  CONSTRAINT community_report_status_check CHECK (status IN ('open', 'reviewed', 'resolved'))
);

CREATE INDEX IF NOT EXISTS community_report_status_created_idx
  ON gym."CommunityReport"(status, created_at);

CREATE TABLE IF NOT EXISTS gym."CommunityMessage" (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  recipient_id INTEGER NOT NULL REFERENCES gym."Member"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT community_message_distinct_members CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS community_message_sender_recipient_id_idx
  ON gym."CommunityMessage"(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS community_message_recipient_sender_id_idx
  ON gym."CommunityMessage"(recipient_id, sender_id, id);
