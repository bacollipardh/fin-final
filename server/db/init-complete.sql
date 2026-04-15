-- Complete DB initialization: schema + all patches in order
-- Run this ONCE on a fresh database

-- ══════════════════════════════════════════════════════
-- BASE SCHEMA
-- ══════════════════════════════════════════════════════

CREATE TYPE user_role AS ENUM ('agent','avancues','team_lead','division_manager','sales_director','admin');

CREATE TABLE divisions(
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE users(
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  division_id INT REFERENCES divisions(id),
  pda_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE buyers(
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE buyer_sites(
  id SERIAL PRIMARY KEY,
  buyer_id INT REFERENCES buyers(id) ON DELETE CASCADE,
  site_code TEXT NOT NULL,
  site_name TEXT NOT NULL
);

CREATE TABLE articles(
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  sell_price NUMERIC(12,2) NOT NULL
);

CREATE TYPE req_status AS ENUM ('pending','approved','rejected');

CREATE TABLE requests(
  id SERIAL PRIMARY KEY,
  agent_id INT REFERENCES users(id),
  division_id INT REFERENCES divisions(id),
  buyer_id INT REFERENCES buyers(id),
  site_id INT REFERENCES buyer_sites(id),
  article_id INT REFERENCES articles(id),
  quantity INT DEFAULT 1,
  amount NUMERIC(12,2) NOT NULL,
  invoice_ref TEXT,
  reason TEXT,
  status req_status DEFAULT 'pending',
  required_role user_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approvals(
  id SERIAL PRIMARY KEY,
  request_id INT REFERENCES requests(id) ON DELETE CASCADE,
  approver_id INT REFERENCES users(id),
  approver_role user_role NOT NULL,
  action req_status NOT NULL,
  comment TEXT,
  acted_at TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════
-- V1 PATCH: TeamLeader assignment
-- ══════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_leader_id INT NULL REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ NULL;
ALTER TABLE divisions ADD COLUMN IF NOT EXISTS default_team_leader_id INT NULL REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_to_user_id INT NULL REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_reason TEXT NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_requests_agent_id ON requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_required_role_status ON requests(required_role, status);
CREATE INDEX IF NOT EXISTS idx_requests_assigned_to ON requests(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver_id ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver_role ON approvals(approver_role);

-- ══════════════════════════════════════════════════════
-- V2 PATCH: Audit, password reset, refresh tokens, items, photos
-- ══════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

CREATE TABLE IF NOT EXISTS request_items (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  article_id  INT NOT NULL REFERENCES articles(id),
  quantity    INT NOT NULL DEFAULT 1,
  line_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_items_req ON request_items(request_id);

CREATE TABLE IF NOT EXISTS request_photos (
  id         BIGSERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_photos_req ON request_photos(request_id);

-- ══════════════════════════════════════════════════════
-- V3 PATCH: Thresholds, delegations, limits, comments, TOTP, sessions, etc.
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval_thresholds (
  id         SERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  value      NUMERIC(12,2) NOT NULL,
  label      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO approval_thresholds(key,value,label) VALUES
  ('team_lead_max',       99.00,  'Maksimumi për Team Lead'),
  ('division_manager_max',199.00, 'Maksimumi për Division Manager')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS approval_delegations (
  id          BIGSERIAL PRIMARY KEY,
  from_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  reason       TEXT,
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT no_self_delegation CHECK (from_user_id <> to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_delegations_from ON approval_delegations(from_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON approval_delegations(active, start_date, end_date);

CREATE TABLE IF NOT EXISTS agent_limits (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period     TEXT NOT NULL CHECK(period IN ('weekly','monthly')),
  max_amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, period)
);

CREATE TABLE IF NOT EXISTS request_comments (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comments_request ON request_comments(request_id);

-- 2FA / TOTP
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret    TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled   BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified  BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  device_name TEXT,
  ip          TEXT,
  user_agent  TEXT,
  last_active TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  revoked     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(revoked, last_active);

CREATE TABLE IF NOT EXISTS ip_whitelist (
  id         BIGSERIAL PRIMARY KEY,
  cidr       TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS known_devices (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  ip          TEXT,
  label       TEXT,
  first_seen  TIMESTAMPTZ DEFAULT now(),
  last_seen   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_known_devices_user ON known_devices(user_id);

CREATE TABLE IF NOT EXISTS report_runs (
  id         BIGSERIAL PRIMARY KEY,
  period     TEXT NOT NULL,
  ran_at     TIMESTAMPTZ DEFAULT now(),
  status     TEXT DEFAULT 'ok',
  detail     JSONB
);

-- ══════════════════════════════════════════════════════
-- V3 PATCH: PricingBridge columns
-- ══════════════════════════════════════════════════════

ALTER TABLE request_items
  ADD COLUMN IF NOT EXISTS barkod             TEXT,
  ADD COLUMN IF NOT EXISTS lot_kod            TEXT,
  ADD COLUMN IF NOT EXISTS cmimi_baze         NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS rabat_pct          NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS lejim_pct          NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS ddv_pct            NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS cmimi_pas_rabateve NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS price_match_level  TEXT,
  ADD COLUMN IF NOT EXISTS sifra_kup          TEXT,
  ADD COLUMN IF NOT EXISTS sifra_obj          INT;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS barkod     TEXT,
  ADD COLUMN IF NOT EXISTS pb_sifra   TEXT;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS division_id INT REFERENCES divisions(id);

ALTER TABLE buyer_sites
  ADD COLUMN IF NOT EXISTS pb_sifra_obj INT;

ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS pb_sifra_kup TEXT;

-- ══════════════════════════════════════════════════════
-- AGENT_DIVISIONS table (many-to-many: agent <-> divisions)
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_divisions (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id INT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_id, division_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_divisions_agent ON agent_divisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_divisions_div ON agent_divisions(division_id);

-- ══════════════════════════════════════════════════════
-- Done
-- ══════════════════════════════════════════════════════
SELECT 'Complete DB initialization done' AS status;
