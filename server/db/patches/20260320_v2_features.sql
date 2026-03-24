-- V2 Migration: refresh tokens, password reset, audit log, new columns
-- Run this on existing databases that already have the base schema

-- users: add missing columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login       TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_leader_id   INT REFERENCES users(id) ON DELETE SET NULL;

-- divisions: add default team leader
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS default_team_leader_id INT REFERENCES users(id) ON DELETE SET NULL;

-- requests: add assignment columns
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_to_user_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_reason     TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_at         TIMESTAMPTZ;

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   INT,
  detail      JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_requests_agent_id   ON requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_requests_status     ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_role_status ON requests(required_role, status);
CREATE INDEX IF NOT EXISTS idx_requests_assigned   ON requests(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver  ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_approvals_role      ON approvals(approver_role);

-- request_items (if not exists)
CREATE TABLE IF NOT EXISTS request_items (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  article_id  INT NOT NULL REFERENCES articles(id),
  quantity    INT NOT NULL DEFAULT 1,
  line_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_items_req ON request_items(request_id);

-- request_photos (if not exists)
CREATE TABLE IF NOT EXISTS request_photos (
  id         BIGSERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_photos_req ON request_photos(request_id);

SELECT 'V2 migration complete' AS status;
