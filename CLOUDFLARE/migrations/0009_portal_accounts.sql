CREATE TABLE portal_accounts (
  account_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('METLIFE', 'NEXTCARE')),
  label TEXT NOT NULL,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (scope IN ('PERSONAL', 'SHARED')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portal_accounts_owner ON portal_accounts(owner_user_id, provider);
CREATE INDEX idx_portal_accounts_scope ON portal_accounts(scope, enabled);

CREATE TABLE portal_account_access (
  account_id TEXT NOT NULL REFERENCES portal_accounts(account_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, user_id)
);

CREATE INDEX idx_portal_account_access_user ON portal_account_access(user_id);
