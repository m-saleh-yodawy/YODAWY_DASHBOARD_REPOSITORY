ALTER TABLE tools ADD COLUMN icon TEXT NOT NULL DEFAULT '';
UPDATE tools SET icon = 'fa-solid fa-camera', updated_at = CURRENT_TIMESTAMP WHERE tool_id = 'TOOL-019';
UPDATE tools SET icon = 'fa-solid fa-clipboard-check', updated_at = CURRENT_TIMESTAMP WHERE tool_id = 'TOOL-008';
UPDATE tools SET icon = 'fa-solid fa-cart-shopping', updated_at = CURRENT_TIMESTAMP WHERE tool_id = 'TOOL-012';
UPDATE tools SET icon = 'fa-solid fa-cubes', updated_at = CURRENT_TIMESTAMP WHERE tool_id = 'TOOL-014';
