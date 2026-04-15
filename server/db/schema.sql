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


-- TeamLeader assignment fields (added 2026-01-05)
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_leader_id INT NULL REFERENCES users(id);
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

-- last_login column
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ NULL;

-- Audit log for admin actions
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
