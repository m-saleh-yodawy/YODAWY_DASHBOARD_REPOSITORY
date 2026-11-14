INSERT OR IGNORE INTO tools (tool_id, name, description, version, asset_path, sha256, enabled)
VALUES ('TOOL-005', 'Split Prescriptions', 'Select prescription items in Odoo and complete splitting in Portal', '1', 'TOOLS/split-prescriptions.js', '80619134453dc668d45bea84a7e454a0dfc6d19fe3834d4a73993c1af43dd67e', 1);

INSERT OR IGNORE INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type, updated_at)
SELECT user_id, 'TOOL-005', MAX(can_use), MAX(forced_state), MAX(permission_type), CURRENT_TIMESTAMP
FROM tool_permissions
WHERE tool_id IN (SELECT tool_id FROM tools WHERE lower(name) LIKE '%split%' OR lower(asset_path) LIKE '%split%')
GROUP BY user_id;

INSERT OR IGNORE INTO tool_visibility (tool_id, mode, updated_at)
SELECT 'TOOL-005', mode, CURRENT_TIMESTAMP
FROM tool_visibility
WHERE tool_id IN (SELECT tool_id FROM tools WHERE lower(name) LIKE '%split%' OR lower(asset_path) LIKE '%split%')
ORDER BY updated_at DESC
LIMIT 1;

INSERT OR IGNORE INTO tool_visibility_users (tool_id, user_id)
SELECT 'TOOL-005', user_id
FROM tool_visibility_users
WHERE tool_id IN (SELECT tool_id FROM tools WHERE lower(name) LIKE '%split%' OR lower(asset_path) LIKE '%split%');

UPDATE tools SET enabled = 0
WHERE tool_id <> 'TOOL-005'
AND (lower(asset_path) LIKE '%split-selector%' OR lower(asset_path) LIKE '%auto-split%');
