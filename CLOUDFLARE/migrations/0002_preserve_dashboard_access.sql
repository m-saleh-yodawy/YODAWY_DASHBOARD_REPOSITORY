ALTER TABLE tool_permissions ADD COLUMN forced_state INTEGER NOT NULL DEFAULT 0 CHECK (forced_state IN (0, 1));
ALTER TABLE tool_permissions ADD COLUMN permission_type TEXT NOT NULL DEFAULT 'USER' CHECK (permission_type IN ('USER', 'ADMIN', 'SUPER_ADMIN'));

CREATE TABLE IF NOT EXISTS tool_visibility_users (
  tool_id TEXT NOT NULL REFERENCES tools(tool_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_visibility_users_user_id ON tool_visibility_users(user_id);

CREATE TABLE IF NOT EXISTS network_transactions (
  request_id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_network_transactions_status ON network_transactions(status);
CREATE INDEX IF NOT EXISTS idx_network_transactions_created_at ON network_transactions(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
