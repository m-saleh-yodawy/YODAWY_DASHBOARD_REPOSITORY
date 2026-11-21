INSERT INTO tools (tool_id, name, description, version, asset_path, sha256, enabled)
VALUES ('TOOL-017', 'PORTAL TOOL OLD', 'Open Yodawy Portal prescriptions from Odoo using the signed-in employee PORTALS accounts.', '1', 'TOOLS/portal-tool-old.js', '8dd7ca1a8806c07d2316233068c38d47395c5820aedae7889cfcfeffa2e77653', 1)
ON CONFLICT(tool_id) DO UPDATE SET
name = excluded.name,
description = excluded.description,
version = excluded.version,
asset_path = excluded.asset_path,
sha256 = excluded.sha256,
enabled = 1,
updated_at = CURRENT_TIMESTAMP;

INSERT INTO tool_visibility (tool_id, mode, updated_at)
VALUES ('TOOL-017', 'PUBLIC', CURRENT_TIMESTAMP)
ON CONFLICT(tool_id) DO UPDATE SET
mode = 'PUBLIC',
updated_at = CURRENT_TIMESTAMP;

INSERT INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type, updated_at)
SELECT user_id, 'TOOL-017', 1, 0, role, CURRENT_TIMESTAMP
FROM users
WHERE status = 'Active' AND role IN ('USER', 'ADMIN')
ON CONFLICT(user_id, tool_id) DO UPDATE SET
can_use = 1,
forced_state = 0,
permission_type = excluded.permission_type,
updated_at = CURRENT_TIMESTAMP;
