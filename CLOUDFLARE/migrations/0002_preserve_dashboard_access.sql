ALTER TABLE users ADD COLUMN personal_repository TEXT NOT NULL DEFAULT '';

ALTER TABLE tool_permissions ADD COLUMN forced_state INTEGER NOT NULL DEFAULT 0 CHECK (forced_state IN (0, 1));
ALTER TABLE tool_permissions ADD COLUMN permission_type TEXT NOT NULL DEFAULT 'USER' CHECK (permission_type IN ('USER', 'ADMIN', 'SUPER_ADMIN'));

CREATE TABLE IF NOT EXISTS tool_visibility_users (
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_visibility_users_user_id ON tool_visibility_users(user_id);

INSERT OR IGNORE INTO users (id, name, role, status) VALUES
  ('Q-001', 'MOHAMED SALEH', 'SUPER_ADMIN', 'ACTIVE'),
  ('Q-002', 'Omar Saleh', 'USER', 'ACTIVE'),
  ('Q-003', 'MOAAZ SALEH', 'ADMIN', 'ACTIVE'),
  ('Q-004', 'Ahmed Saleh', 'ADMIN', 'ACTIVE'),
  ('Q-005', 'Mahmoud Saleh', 'USER', 'ACTIVE');

UPDATE users SET personal_repository = CASE id
  WHEN 'Q-001' THEN 'Q-001_MOHAMED_SALEH'
  WHEN 'Q-002' THEN 'Q-002_OMAR_SALEH'
  WHEN 'Q-003' THEN 'Q-003_MOAAZ_SALEH'
  WHEN 'Q-004' THEN 'Q-004_AHMED_SALEH'
  WHEN 'Q-005' THEN 'Q-005_MAHMOUD_SALEH'
  ELSE personal_repository
END;

INSERT OR IGNORE INTO tools (id, name, description, source_repo, source_path, version, status, content_hash) VALUES
  ('TOOL-001', 'CONFIRMATION TYPE BUTTONS', '', 'YODAWY_DASHBOARD_REPOSITORY', 'CLOUDFLARE/public/tools/confirmation-type-buttons.js', '1', 'ACTIVE', '05cf99782083be0b235ad890853d19d3ee696f6a237b87ab93927bd51ab5978a'),
  ('TOOL-002', 'PORTAL AUTO LOGIN', '', 'YODAWY_DASHBOARD_REPOSITORY', 'CLOUDFLARE/public/tools/portal-auto-login.js', '1', 'ACTIVE', '11569a0f0e36491d8f6c974d60a4d7c9e6bf21e7ab19d8e25b7d581516330595'),
  ('TOOL-004', 'ODOO >>> LIMITED DRUG ACCORDION', '', 'YODAWY_DASHBOARD_REPOSITORY', 'CLOUDFLARE/public/tools/limited-drug-accordion.js', '1', 'ACTIVE', '8e00aac7fb835392c9094b1e161a0313d03ecdf7d948b16634a78daa50579b23');

INSERT OR IGNORE INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type) VALUES
  ('Q-002', 'TOOL-001', 1, 0, 'SUPER_ADMIN'),
  ('Q-002', 'TOOL-002', 1, 0, 'SUPER_ADMIN'),
  ('Q-002', 'TOOL-004', 1, 0, 'SUPER_ADMIN'),
  ('Q-003', 'TOOL-001', 0, 0, 'ADMIN'),
  ('Q-003', 'TOOL-002', 0, 0, 'SUPER_ADMIN'),
  ('Q-003', 'TOOL-004', 0, 0, 'ADMIN'),
  ('Q-004', 'TOOL-001', 1, 1, 'SUPER_ADMIN'),
  ('Q-004', 'TOOL-002', 1, 0, 'SUPER_ADMIN'),
  ('Q-004', 'TOOL-004', 1, 0, 'SUPER_ADMIN'),
  ('Q-005', 'TOOL-001', 1, 0, 'SUPER_ADMIN'),
  ('Q-005', 'TOOL-002', 1, 0, 'SUPER_ADMIN'),
  ('Q-005', 'TOOL-004', 1, 0, 'SUPER_ADMIN');

INSERT OR IGNORE INTO tool_visibility (tool_id, mode) VALUES
  ('TOOL-001', 'SELECTED_USERS'),
  ('TOOL-002', 'SELECTED_USERS'),
  ('TOOL-004', 'SELECTED_USERS');

INSERT OR IGNORE INTO tool_visibility_users (tool_id, user_id) VALUES
  ('TOOL-001', 'Q-001'),
  ('TOOL-001', 'Q-003'),
  ('TOOL-001', 'Q-005'),
  ('TOOL-001', 'Q-004'),
  ('TOOL-002', 'Q-002'),
  ('TOOL-002', 'Q-003'),
  ('TOOL-002', 'Q-001'),
  ('TOOL-002', 'Q-004'),
  ('TOOL-004', 'Q-001'),
  ('TOOL-004', 'Q-004');
