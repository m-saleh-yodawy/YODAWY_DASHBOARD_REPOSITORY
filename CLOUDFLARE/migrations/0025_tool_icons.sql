ALTER TABLE tools ADD COLUMN icon TEXT NOT NULL DEFAULT '';
UPDATE tools SET icon = 'fa-solid fa-camera', updated_at = CURRENT_TIMESTAMP WHERE tool_id = 'TOOL-019';
