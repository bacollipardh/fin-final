-- V3 Migration: All new features

-- 1. Approval thresholds (configurable from UI)
CREATE TABLE IF NOT EXISTS approval_thresholds (
  id         SERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL, -- 'team_lead_max', 'division_manager_max'
  value      NUMERIC(12,2) NOT NULL,
  label      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO approval_thresholds(key,value,label) VALUES
  ('team_lead_max',       99.00,  'Maksimumi për Team Lead (€)'),
  ('division_manager_max',199.00, 'Maksimumi për Division Manager (€)')
ON CONFLICT(key) DO NOTHING;

-- 2. Approval delegations
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
CREATE INDEX IF NOT EXISTS idx_delegations_from   ON approval_delegations(from_user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON approval_delegations(active, start_date, end_date);

-- 3. Agent limits
CREATE TABLE IF NOT EXISTS agent_limits (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period     TEXT NOT NULL CHECK(period IN ('weekly','monthly')),
  max_amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, period)
);

-- 4. Request comments / discussion threads
CREATE TABLE IF NOT EXISTS request_comments (
  id          BIGSERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_comments_request ON request_comments(request_id);

-- 5. 2FA / TOTP
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret    TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled   BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified  BOOLEAN DEFAULT FALSE;

-- 6. Sessions
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
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_active  ON user_sessions(revoked, last_active);

-- 7. IP whitelist
CREATE TABLE IF NOT EXISTS ip_whitelist (
  id         BIGSERIAL PRIMARY KEY,
  cidr       TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Known devices per user (for suspicious login detection)
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

-- 9. Monthly report schedule
CREATE TABLE IF NOT EXISTS report_runs (
  id         BIGSERIAL PRIMARY KEY,
  period     TEXT NOT NULL, -- '2026-03'
  ran_at     TIMESTAMPTZ DEFAULT now(),
  status     TEXT DEFAULT 'ok',
  detail     JSONB
);

-- indexes already added in v2 migration
SELECT 'V3 migration complete' AS status;

-- ── PricingBridge integration ──────────────────────────────────
-- Shto kolonat e reja në request_items për lot kod + çmim nga PricingBridge
ALTER TABLE request_items
  ADD COLUMN IF NOT EXISTS barkod             TEXT,
  ADD COLUMN IF NOT EXISTS lot_kod            TEXT,
  ADD COLUMN IF NOT EXISTS cmimi_baze         NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS rabat_pct          NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS ddv_pct            NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS cmimi_pas_rabateve NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS price_match_level  TEXT,
  ADD COLUMN IF NOT EXISTS sifra_kup          TEXT,
  ADD COLUMN IF NOT EXISTS sifra_obj          INT;

-- Shto kolonat e reja në articles për barkodin nga PricingBridge
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS barkod     TEXT,
  ADD COLUMN IF NOT EXISTS pb_sifra   TEXT;  -- Sifra_Art nga PricingBridge

SELECT 'PricingBridge migration complete' AS status;

-- ── PricingBridge sync support ────────────────────────────
-- Shto UNIQUE constraint tek buyer_sites për ON CONFLICT
ALTER TABLE buyer_sites
  ADD COLUMN IF NOT EXISTS pb_sifra_obj INT;

ALTER TABLE buyer_sites
  DROP CONSTRAINT IF EXISTS buyer_sites_buyer_id_site_code_key;

ALTER TABLE buyer_sites
  ADD CONSTRAINT IF NOT EXISTS buyer_sites_buyer_id_site_code_key
  UNIQUE(buyer_id, site_code);

-- Shto barkod dhe pb_sifra tek articles nëse mungojnë
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS barkod   TEXT,
  ADD COLUMN IF NOT EXISTS pb_sifra TEXT;

-- Shto pb_sifra_kup tek buyers (kodi nga PricingBridge)
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS pb_sifra_kup TEXT;

UPDATE buyers SET pb_sifra_kup = code WHERE pb_sifra_kup IS NULL;

SELECT 'PricingBridge sync schema ready' AS status;

-- Shto kolonën lejim_pct (lejimi manual i agjentit, i ndarë nga rabat_pct i PricingBridge)
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS lejim_pct NUMERIC(10,4);
