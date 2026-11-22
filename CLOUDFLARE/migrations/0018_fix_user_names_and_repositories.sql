UPDATE users
SET
  name = CASE user_id
    WHEN 'Q-001' THEN 'Mohamed Saleh'
    WHEN 'Q-002' THEN 'Salma Mahmoud'
    WHEN 'Q-003' THEN 'Kareem Alaa'
    WHEN 'Q-004' THEN 'Heba Azouz'
    WHEN 'Q-005' THEN 'Hanem Salama'
    WHEN 'Q-006' THEN 'Taghreed Mostafa'
    WHEN 'Q-007' THEN 'Hana Ahmed'
    WHEN 'Q-008' THEN 'Doha Eid'
    ELSE name
  END,
  personal_repository = CASE user_id
    WHEN 'Q-001' THEN 'Q-001_MOHAMED_SALEH'
    WHEN 'Q-002' THEN 'Q-002_SALMA_MAHMOUD'
    WHEN 'Q-003' THEN 'Q-003_KAREEM_ALAA'
    WHEN 'Q-004' THEN 'Q-004_HEBA_AZOUZ'
    WHEN 'Q-005' THEN 'Q-005_HANEM_SALAMA'
    WHEN 'Q-006' THEN 'Q-006_TAGHREED_MOSTAFA'
    WHEN 'Q-007' THEN 'Q-007_HANA_AHMED'
    WHEN 'Q-008' THEN 'Q-008_DOHA_EID'
    ELSE personal_repository
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE user_id IN ('Q-001', 'Q-002', 'Q-003', 'Q-004', 'Q-005', 'Q-006', 'Q-007', 'Q-008');
