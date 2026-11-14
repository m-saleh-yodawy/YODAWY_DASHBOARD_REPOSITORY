ALTER TABLE portal_accounts ADD COLUMN account_type TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (account_type IN ('PERSONAL', 'ALTERNATIVE'));
UPDATE portal_accounts SET account_type = 'ALTERNATIVE' WHERE lower(label) LIKE '%b.kamal%' OR lower(label) LIKE '%alternative%';
CREATE INDEX IF NOT EXISTS idx_portal_accounts_owner_provider_type ON portal_accounts(owner_user_id, provider, account_type, enabled);
