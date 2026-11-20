DELETE FROM tool_visibility_users
WHERE tool_id IN ('TOOL-002', 'TOOL-003', 'TOOL-005', 'TOOL-009', 'TOOL-013');

DELETE FROM tool_permissions
WHERE tool_id IN ('TOOL-002', 'TOOL-003', 'TOOL-005', 'TOOL-009', 'TOOL-013');

DELETE FROM tool_visibility
WHERE tool_id IN ('TOOL-002', 'TOOL-003', 'TOOL-005', 'TOOL-009', 'TOOL-013');

DELETE FROM tools
WHERE tool_id IN ('TOOL-002', 'TOOL-003', 'TOOL-005', 'TOOL-009', 'TOOL-013');
