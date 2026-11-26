CREATE TABLE IF NOT EXISTS user_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  tool_id TEXT,
  tool_name TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_time ON user_activity_logs(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_actor_time ON user_activity_logs(actor_id, id DESC);

INSERT INTO user_activity_logs (user_id, actor_id, event_type, details_json, created_at)
SELECT user_id, user_id, 'ACCOUNT_CREATED', json_object('source', 'MIGRATION'), strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
FROM users;

INSERT INTO user_activity_logs (user_id, actor_id, event_type, details_json, created_at)
SELECT user_id, user_id, UPPER(event_type), json_object('source', 'LEGACY_AUTH_EVENTS'), strftime('%Y-%m-%dT%H:%M:%fZ', created_at, 'unixepoch')
FROM auth_events
WHERE user_id IS NOT NULL AND UPPER(event_type) IN ('LOGIN', 'LOGOUT');

INSERT INTO user_activity_logs (user_id, actor_id, event_type, details_json, created_at)
SELECT s.user_id, s.user_id, 'SESSION_STARTED', json_object('source', 'LEGACY_SESSION', 'deviceLabel', s.device_label, 'note', 'Historical session start; token refresh may also create sessions'), strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at, 'unixepoch')
FROM sessions s
WHERE NOT EXISTS (
  SELECT 1 FROM auth_events a
  WHERE a.user_id = s.user_id AND UPPER(a.event_type) = 'LOGIN'
    AND ABS(a.created_at - s.created_at) <= 3
);

INSERT INTO user_activity_logs (user_id, actor_id, event_type, details_json, created_at)
SELECT s.user_id, s.user_id, 'SESSION_ENDED', json_object('source', 'LEGACY_SESSION', 'note', 'Historical session ended; legacy records do not distinguish logout from token rotation or password change'), strftime('%Y-%m-%dT%H:%M:%fZ', s.revoked_at, 'unixepoch')
FROM sessions s
WHERE s.revoked_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM auth_events a
  WHERE a.user_id = s.user_id AND UPPER(a.event_type) = 'LOGOUT'
    AND ABS(a.created_at - s.revoked_at) <= 3
);
