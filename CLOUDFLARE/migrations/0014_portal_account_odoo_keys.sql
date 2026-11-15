PRAGMA foreign_keys = OFF;

CREATE TABLE portal_accounts_new (
  account_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'PORTAL',
  account_type TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (account_type IN ('PERSONAL', 'NON-PERSONAL')),
  label TEXT NOT NULL,
  username TEXT NOT NULL,
  odoo_key TEXT,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO portal_accounts_new (
  account_id, owner_user_id, provider, account_type, label, username,
  odoo_key, encrypted_password, encryption_iv, encryption_version,
  enabled, created_at, updated_at
)
SELECT
  account_id, owner_user_id, 'PORTAL',
  CASE WHEN account_type = 'ALTERNATIVE' THEN 'NON-PERSONAL' ELSE 'PERSONAL' END,
  label, username, NULL, encrypted_password, encryption_iv,
  encryption_version, enabled, created_at, updated_at
FROM portal_accounts;

DROP TABLE portal_accounts;
ALTER TABLE portal_accounts_new RENAME TO portal_accounts;

CREATE INDEX idx_portal_accounts_owner_provider ON portal_accounts(owner_user_id, provider, enabled);
CREATE INDEX idx_portal_accounts_owner_type_key ON portal_accounts(owner_user_id, account_type, odoo_key, enabled);

PRAGMA foreign_keys = ON;
