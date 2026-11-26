UPDATE network_transactions
SET payload_json = json_set(
  payload_json,
  '$.sites',
  json_insert(
    json_extract(payload_json, '$.sites'),
    '$[#]',
    json_object(
      'host', 'i-care.globemedegypt.com',
      'enabled', true,
      'protocols', json('["https:"]'),
      'paths', json('["/*"]')
    )
  ),
  '$.version', 1
),
updated_at = CURRENT_TIMESTAMP
WHERE request_id = 'SITE_ACCESS_CONFIG_V1'
  AND request_type = 'SITE_ACCESS_CONFIG'
  AND json_type(payload_json, '$.sites') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(payload_json, '$.sites')
    WHERE json_extract(value, '$.host') = 'i-care.globemedegypt.com'
  );
