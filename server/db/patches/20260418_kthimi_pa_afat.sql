-- ── Kthimi pa afat migration ──────────────────────────────────────────────────

-- Main return request (1 per financial approval)
CREATE TABLE IF NOT EXISTS return_requests (
  id                    BIGSERIAL PRIMARY KEY,
  financial_approval_id INT NOT NULL REFERENCES requests(id) ON DELETE RESTRICT,
  agent_id              INT NOT NULL REFERENCES users(id),
  buyer_id              INT REFERENCES buyers(id),
  site_id               INT REFERENCES buyer_sites(id),
  division_id           INT REFERENCES divisions(id),
  status                req_status DEFAULT 'pending',
  required_role         user_role NOT NULL,
  total_value           NUMERIC(12,2) NOT NULL DEFAULT 0,
  comment               TEXT,
  reason                TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(financial_approval_id)  -- 1 return per financial approval
);

CREATE INDEX IF NOT EXISTS idx_return_requests_agent     ON return_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status    ON return_requests(status);
CREATE INDEX IF NOT EXISTS idx_return_requests_approval  ON return_requests(financial_approval_id);

-- Lines of the return request
CREATE TABLE IF NOT EXISTS return_request_lines (
  id                   BIGSERIAL PRIMARY KEY,
  return_request_id    BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  request_item_id      BIGINT REFERENCES request_items(id),
  article_id           INT REFERENCES articles(id),
  sku                  TEXT NOT NULL,
  name                 TEXT NOT NULL,
  lot_kod              TEXT,
  final_price          NUMERIC(18,6) NOT NULL DEFAULT 0,
  approved_qty         INT NOT NULL DEFAULT 0,
  already_returned_qty INT NOT NULL DEFAULT 0,
  remaining_qty        INT NOT NULL DEFAULT 0,
  requested_return_qty INT NOT NULL DEFAULT 0,
  is_removed           BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_lines_return ON return_request_lines(return_request_id);

-- Approvals for returns (reuse same pattern)
CREATE TABLE IF NOT EXISTS return_approvals (
  id             BIGSERIAL PRIMARY KEY,
  return_id      BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  approver_id    INT NOT NULL REFERENCES users(id),
  approver_role  user_role NOT NULL,
  action         req_status NOT NULL,
  comment        TEXT,
  acted_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_approvals_return    ON return_approvals(return_id);
CREATE INDEX IF NOT EXISTS idx_return_approvals_approver  ON return_approvals(approver_id);

SELECT 'Kthimi pa afat migration complete' AS status;
