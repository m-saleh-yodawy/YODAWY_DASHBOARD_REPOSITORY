UPDATE tools
SET match_patterns = '["https://odoo.yodawy.com/*","https://portal.yodawy.com/*"]',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_id = 'TOOL-017';
