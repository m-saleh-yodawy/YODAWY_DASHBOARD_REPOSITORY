INSERT INTO tools (tool_id, name, description, version, asset_path, sha256, enabled)
VALUES
('TOOL-001', 'CONFIRMATION TYPE BUTTONS', 'Add confirmation type controls to Odoo tickets.', '1', 'TOOLS/confirmation-type-buttons.js', '149daeb005648e076d23d418e01f69cd25f6b21279f756c1bbdc65548d201e50', 1),
('TOOL-002', 'PORTAL AUTO LOGIN', 'Open Yodawy Portal sessions from Odoo.', '1', 'TOOLS/portal-auto-login.js', 'c88ee40da88710237100fa70e839a3f959c02d06dfa4c0f31bad367056418b4e', 1),
('TOOL-003', 'ODOO >>> SPLIT SELECTOR', 'Find and select suitable alternatives for prescription splitting in Odoo.', '1', 'TOOLS/ODOO-SPLIT-SELECTOR.js', 'e217dc6257de853c8968d427add37d679be4d53be64d43ca01d9ba91d684b965', 1),
('TOOL-004', 'ODOO >>> LIMITED DRUG ACCORDION', 'Display limited drug alternatives, pricing, and actions in Odoo.', '1', 'TOOLS/limited-drug-accordion.js', 'ff6dd64f46d1e87d4009468fb5e9dc1f1c90c6bdf8ddd1d123de43efbc8b2352', 1),
('TOOL-005', 'SPLIT PRESCRIPTIONS', 'Select prescription items in Odoo and complete splitting in Portal.', '1', 'TOOLS/split-prescriptions.js', '0198c35d3040ba16f677e47745fde469e3fba18fd4d34c893db959889bfb793b', 1),
('TOOL-006', 'ODOO >>> ALTERNATIVE QUANTITY WARNING', 'Warn when alternative medication quantities exceed the allowed pack-size difference.', '1', 'TOOLS/ALTERNATIVE-QUANTITY-WARNING.js', 'c3ae79e8586a2a596d20c299e88e21252f1739230ddfb3c40f61a18af4ace137', 1),
('TOOL-007', 'METLIFE >>> CARD NUMBER AUTOMATION', 'Automate card number handling in the MetLife portal.', '1', 'TOOLS/METLIFE-CARD-NUMBER-AUTOMATION.js', '778caeb3f2d35ee48e4e1b7a171304f26c94d3a77d3572b431be6684cf822d10', 1),
('TOOL-008', 'ODOO >>> NO ITEMS SCREENSHOT', 'Capture Odoo tickets that return no items requiring checks and attach the evidence.', '1', 'TOOLS/NO-ITEMS-SCREENSHOT.js', '9b8f2a61198b349d16e4dfb1b09151249924b5c701aa924cdc84683730836c92', 1),
('TOOL-009', 'ODOO >>> AUTO LOGIN', 'Open Yodawy ERX directly from the Odoo customer card.', '1', 'TOOLS/ODOO-AUTO-LOGIN.js', 'ca0bcba8b70b4752248384d91beba30df67f36bc4f96d7ba2c5215d2dd7cebd9', 1),
('TOOL-010', 'ODOO >>> LOG NOTE TOOLS', 'Add edit and delete actions to Odoo log notes.', '1', 'TOOLS/ODOO-LOG-NOTE-TOOLS.js', '2776f294b2323d362600b1524325f5ae3103f5f1572402b1d85d6eb4228942ed', 1),
('TOOL-011', 'ODOO >>> MOVE COMMUNICATION', 'Move Odoo communications between ticket records.', '1', 'TOOLS/ODOO-MOVE-COMMUNICATION.js', '50186fa414bb27be17cc8d9216a30777983598f3827d58ff22583b9ffb37c884', 1),
('TOOL-012', 'ODOO >>> ORDERED BY WH AUTOMATION', 'Automate ordered-by-warehouse workflows in Odoo.', '1', 'TOOLS/ODOO-ORDERED-BY-WH-AUTOMATION.js', 'd560e0f4f9426b22f262ea1589c52d67625a52d55a5299f1aec8041c729098b3', 1),
('TOOL-013', 'PORTAL >>> AUTO SPLIT', 'Automate prescription splitting in Yodawy Portal.', '1', 'TOOLS/PORTAL-AUTO-SPLIT.js', '538f7f109763531199960953c379458aaf084d63c046193e1270beb928423ef6', 1),
('TOOL-014', 'ODOO >>> STOCK', 'Check product stock across Yodawy warehouses.', '1', 'TOOLS/STOCK.js', '2a32a5f222b0a5581a1f8f4e528df8b21af0ee95548c459b9155d7656508a94c', 1)
ON CONFLICT(tool_id) DO UPDATE SET
name = excluded.name,
description = excluded.description,
version = excluded.version,
asset_path = excluded.asset_path,
sha256 = excluded.sha256,
enabled = 1,
updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO tool_visibility (tool_id, mode, updated_at)
VALUES
('TOOL-001', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-002', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-003', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-004', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-005', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-006', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-007', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-008', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-009', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-010', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-011', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-012', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-013', 'PRIVATE', CURRENT_TIMESTAMP),
('TOOL-014', 'PRIVATE', CURRENT_TIMESTAMP);
