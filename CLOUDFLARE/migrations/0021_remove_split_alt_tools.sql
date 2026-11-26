UPDATE user_settings
SET settings_json = json_remove(settings_json, '$.tools."TOOL-019"', '$.tools."TOOL-020"'),
    updated_at = CURRENT_TIMESTAMP
WHERE json_valid(settings_json);

DELETE FROM tool_visibility_users WHERE tool_id IN ('TOOL-019', 'TOOL-020');
DELETE FROM tool_permissions WHERE tool_id IN ('TOOL-019', 'TOOL-020');
DELETE FROM tool_visibility WHERE tool_id IN ('TOOL-019', 'TOOL-020');
DELETE FROM tools WHERE tool_id IN ('TOOL-019', 'TOOL-020');
