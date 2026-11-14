PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN', 'SUPER_ADMIN')),
  status TEXT NOT NULL DEFAULT 'Active',
  personal_repository TEXT NOT NULL,
  password_hash TEXT,
  password_changed_at INTEGER,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  session_id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  refresh_token_hash TEXT,
  revoked_at INTEGER,
  device_label TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE UNIQUE INDEX idx_sessions_refresh_hash ON sessions(refresh_token_hash);

CREATE TABLE tools (
  tool_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  asset_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tool_permissions (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL REFERENCES tools(tool_id) ON DELETE CASCADE,
  can_use INTEGER NOT NULL DEFAULT 0 CHECK (can_use IN (0, 1)),
  forced_state INTEGER NOT NULL DEFAULT 0 CHECK (forced_state IN (0, 1)),
  permission_type TEXT NOT NULL DEFAULT 'USER' CHECK (permission_type IN ('USER', 'ADMIN', 'SUPER_ADMIN')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tool_id)
);

CREATE TABLE tool_visibility (
  tool_id TEXT PRIMARY KEY REFERENCES tools(tool_id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (mode IN ('PRIVATE', 'PUBLIC', 'SELECTED_USERS')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tool_visibility_users (
  tool_id TEXT NOT NULL REFERENCES tools(tool_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_id, user_id)
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcements (
  announcement_id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(user_id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cycle TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_announcements_created_at ON announcements(created_at DESC);

CREATE TABLE network_transactions (
  request_id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_network_transactions_status ON network_transactions(status);
CREATE INDEX idx_network_transactions_created_at ON network_transactions(created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

CREATE TABLE auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_events_user_time ON auth_events(user_id, created_at DESC);


CREATE TABLE portal_accounts (
  account_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('METLIFE', 'NEXTCARE')),
  account_type TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (account_type IN ('PERSONAL', 'ALTERNATIVE')),
  label TEXT NOT NULL,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portal_accounts_owner_provider ON portal_accounts(owner_user_id, provider, enabled);
