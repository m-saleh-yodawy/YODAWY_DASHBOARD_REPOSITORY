const encoder = new TextEncoder();
const ACCESS_TTL = 900;
const REFRESH_TTL = 2592000;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
const hex = data => [...new Uint8Array(data)].map(value => value.toString(16).padStart(2, "0")).join("");
const digest = async value => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, "0")).join("");
const passwordKey = async (password, salt) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = Uint8Array.from(salt.match(/.{2}/g), value => parseInt(value, 16));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 100000 }, material, 256));
};
const createPasswordHash = async password => { const salt = randomToken().slice(0, 32); return salt + ":" + await passwordKey(password, salt); };
const verifyPassword = async (password, stored) => {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = await passwordKey(password, salt);
  return actual.length === expected.length && [...actual].every((value, index) => value === expected[index]);
};
const sign = async (payload, secret) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(payload)))).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return body + "." + btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
};
const verifyAccess = async (token, secret) => {
  try {
    const [body, signature] = token.split(".");
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const raw = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    if (!await crypto.subtle.verify("HMAC", key, raw, encoder.encode(body))) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
};
const allowedOrigin = (request, env) => {
  const origin = request.headers.get("origin") || "";
  return (env.ALLOWED_ORIGINS || "https://odoo.yodawy.com,https://portal.yodawy.com").split(",").map(value => value.trim()).includes(origin) ? origin : "";
};
const respond = (request, env, data, status = 200) => {
  const headers = new Headers(json(data, status).headers);
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "content-type, authorization, x-setup-secret");
    headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
};
const readBody = async request => { try { const value = await request.json(); return value && typeof value === "object" ? value : {}; } catch { return {}; } };
const issueSession = async (env, user, request) => {
  const now = Math.floor(Date.now() / 1000);
  const refresh = randomToken();
  const sessionId = randomToken();
  await env.DB.prepare("INSERT INTO sessions (session_id_hash, user_id, expires_at, created_at, last_seen_at, refresh_token_hash, device_label) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(await digest(sessionId), user.user_id, now + REFRESH_TTL, now, now, await digest(refresh), (request.headers.get("user-agent") || "").slice(0, 160)).run();
  return { accessToken: await sign({ sub: user.user_id, role: user.role, exp: now + ACCESS_TTL, sid: sessionId }, env.AUTH_SECRET), refreshToken: refresh, expiresIn: ACCESS_TTL, user: { id: user.user_id, name: user.name, role: user.role, repository: user.personal_repository || "" } };
};
const authenticate = async (request, env) => {
  const token = (request.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return null;
  const payload = await verifyAccess(token, env.AUTH_SECRET);
  if (!payload) return null;
  const session = await env.DB.prepare("SELECT s.session_id_hash, u.user_id, u.name, u.role, u.status, u.personal_repository FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.session_id_hash = ? AND s.user_id = ? AND s.expires_at > ? AND s.revoked_at IS NULL").bind(await digest(payload.sid), payload.sub, Math.floor(Date.now() / 1000)).first();
  return session && session.status === "Active" ? session : null;
};
const authRoutes = async (request, env, path) => {
  if (!env.AUTH_SECRET) return respond(request, env, { success: false, error: "AUTH_NOT_CONFIGURED" }, 503);
  if (path === "/api/auth/setup-password" && request.method === "POST") {
    const body = await readBody(request);
    const setupSecret = String(request.headers.get("x-setup-secret") || "");
    const userId = String(body.username || "").trim().toUpperCase();
    const password = String(body.password || "");
    if (!env.SETUP_SECRET || setupSecret !== env.SETUP_SECRET) return respond(request, env, { success: false, error: "SETUP_FORBIDDEN" }, 403);
    if (!/^Q-[0-9]{3,}$/.test(userId) || password.length < 10 || password.length > 128) return respond(request, env, { success: false, error: "INVALID_SETUP_DATA" }, 400);
    const hash = await createPasswordHash(password);
    const result = await env.DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE user_id = ? AND status = 'Active' AND password_hash IS NULL").bind(hash, Math.floor(Date.now() / 1000), userId).run();
    return result.meta?.changes === 1 ? respond(request, env, { success: true, userId }) : respond(request, env, { success: false, error: "USER_ALREADY_INITIALIZED_OR_NOT_FOUND" }, 409);
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await readBody(request);
    const userId = String(body.username || "").trim().toUpperCase();
    const password = String(body.password || "");
    if (!/^Q-[0-9]{3,}$/i.test(userId) || !password) return respond(request, env, { success: false, error: "INVALID_CREDENTIALS" }, 400);
    const user = await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first();
    const now = Math.floor(Date.now() / 1000);
    if (!user || user.status !== "Active" || user.locked_until > now || !user.password_hash || !await verifyPassword(password, user.password_hash)) {
      if (user) await env.DB.prepare("UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count + 1 >= 8 THEN ? ELSE locked_until END WHERE user_id = ?").bind(now + 900, userId).run();
      return respond(request, env, { success: false, error: "INVALID_CREDENTIALS" }, 401);
    }
    await env.DB.prepare("UPDATE users SET failed_login_count = 0, locked_until = 0 WHERE user_id = ?").bind(userId).run();
    return respond(request, env, { success: true, ...(await issueSession(env, user, request)) });
  }
  if (path === "/api/auth/refresh" && request.method === "POST") {
    const token = String((await readBody(request)).refreshToken || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return respond(request, env, { success: false, error: "SESSION_INVALID" }, 401);
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare("SELECT s.session_id_hash, s.user_id, u.name, u.role, u.status, u.personal_repository FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.refresh_token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL").bind(await digest(token), now).first();
    if (!session || session.status !== "Active") return respond(request, env, { success: false, error: "SESSION_INVALID" }, 401);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_id_hash = ?").bind(now, session.session_id_hash).run();
    return respond(request, env, { success: true, ...(await issueSession(env, session, request)) });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await authenticate(request, env);
    return user ? respond(request, env, { success: true, user: { id: user.user_id, name: user.name, role: user.role } }) : respond(request, env, { success: false, error: "UNAUTHORIZED" }, 401);
  }
  if (path === "/api/auth/change-password" && request.method === "POST") {
    const user = await authenticate(request, env);
    if (!user) return respond(request, env, { success: false, error: "UNAUTHORIZED" }, 401);
    const body = await readBody(request);
    const next = String(body.newPassword || "");
    if (next.length < 10 || next.length > 128) return respond(request, env, { success: false, error: "PASSWORD_REQUIREMENTS" }, 400);
    const record = await env.DB.prepare("SELECT password_hash FROM users WHERE user_id = ?").bind(user.user_id).first();
    if (!await verifyPassword(String(body.currentPassword || ""), record?.password_hash)) return respond(request, env, { success: false, error: "CURRENT_PASSWORD_INVALID" }, 401);
    const hash = await createPasswordHash(next);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([env.DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_count = 0, locked_until = 0 WHERE user_id = ?").bind(hash, now, user.user_id), env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, user.user_id)]);
    return respond(request, env, { success: true, message: "PASSWORD_CHANGED" });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    const user = await authenticate(request, env);
    if (user) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_id_hash = ?").bind(Math.floor(Date.now() / 1000), user.session_id_hash).run();
    return respond(request, env, { success: true });
  }
  return null;
};

const dashboardRoutes = async (request, env, path) => {
  const actor = await authenticate(request, env);
  if (!actor) return respond(request, env, { success: false, error: "UNAUTHORIZED" }, 401);
  const role = actor.role;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const isSuper = role === "SUPER_ADMIN";
  const now = new Date().toISOString();
  const body = request.method === "GET" ? {} : await readBody(request);
  const forbidden = () => respond(request, env, { success: false, error: "FORBIDDEN" }, 403);
  if (path === "/api/dashboard/bootstrap" && request.method === "GET") {
    const [users, tools, permissions, visibility, visibleUsers, settings, announcements, transactions, activity] = await Promise.all([
      env.DB.prepare("SELECT user_id AS id, name, role, status, personal_repository AS repository FROM users ORDER BY user_id").all(),
      env.DB.prepare("SELECT tool_id AS id, name, description, version, asset_path AS path, sha256, enabled FROM tools WHERE enabled = 1 ORDER BY name").all(),
      isAdmin ? env.DB.prepare("SELECT user_id, tool_id, can_use, forced_state, permission_type FROM tool_permissions").all() : env.DB.prepare("SELECT user_id, tool_id, can_use, forced_state, permission_type FROM tool_permissions WHERE user_id = ?").bind(actor.user_id).all(),
      env.DB.prepare("SELECT tool_id, mode FROM tool_visibility").all(),
      env.DB.prepare("SELECT tool_id, user_id FROM tool_visibility_users").all(),
      env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(actor.user_id).first(),
      env.DB.prepare("SELECT announcement_id AS id, author_id, author_name, body, cycle, created_at, updated_at, updated_by FROM announcements ORDER BY created_at DESC").all(),
      isSuper ? env.DB.prepare("SELECT request_id, request_type, status, payload_json, result_json, created_at, updated_at FROM network_transactions ORDER BY created_at DESC LIMIT 500").all() : Promise.resolve({ results: [] }),
      isAdmin ? env.DB.prepare("SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity_type, a.entity_id, a.details_json, a.created_at FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_id ORDER BY a.id DESC LIMIT 500").all() : env.DB.prepare("SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity_type, a.entity_id, a.details_json, a.created_at FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_id WHERE a.actor_id = ? ORDER BY a.id DESC LIMIT 200").bind(actor.user_id).all()
    ]);
    const permissionMap = {};
    for (const item of permissions.results || []) {
      const key = item.user_id;
      (permissionMap[key] ||= {})[item.tool_id] = { enabled: Boolean(item.can_use), forced: Boolean(item.forced_state), type: item.permission_type };
    }
    const visibilityMap = {};
    for (const item of visibility.results || []) visibilityMap[item.tool_id] = { visibility: item.mode, allowedUsers: [] };
    for (const item of visibleUsers.results || []) (visibilityMap[item.tool_id] ||= { visibility: "PRIVATE", allowedUsers: [] }).allowedUsers.push(item.user_id);
    return respond(request, env, { success: true, user: { id: actor.user_id, name: actor.name, role, repository: actor.personal_repository || "" }, users: isAdmin ? users.results : [], tools: tools.results, permissions: permissionMap, visibility: visibilityMap, settings: settings ? JSON.parse(settings.settings_json) : { userId: actor.user_id, tools: {}, startPage: "tools" }, announcements: announcements.results || [], transactions: (transactions.results || []).map(item => ({ ...item, payload: JSON.parse(item.payload_json || "{}"), result: JSON.parse(item.result_json || "{}") })), auditLogs: (activity.results || []).map(item => ({ ...item, details: JSON.parse(item.details_json || "{}") })) });
  }
  if (path === "/api/dashboard/activity" && request.method === "POST") {
    const action = String(body.action || "").trim().toUpperCase();
    const toolId = String(body.toolId || "").trim();
    const toolName = String(body.toolName || "").trim();
    const summary = String(body.summary || action).trim();
    if (!/^[A-Z0-9_-]{2,80}$/.test(action) || toolId.length > 128 || toolName.length > 160 || !summary || summary.length > 500) return respond(request, env, { success: false, error: "INVALID_ACTIVITY" }, 400);
    const entityType = toolId ? "TOOL" : "DASHBOARD";
    const entityId = toolId || null;
    await env.DB.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(actor.user_id, action, entityType, entityId, JSON.stringify({ summary, toolName }), now).run();
    return respond(request, env, { success: true });
  }
  if (path === "/api/dashboard/settings" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(actor.user_id).first();
    return respond(request, env, { success: true, settings: row ? JSON.parse(row.settings_json) : { userId: actor.user_id, tools: {}, startPage: "tools" } });
  }
  if (path === "/api/dashboard/settings" && request.method === "PUT") {
    const value = body.settings;
    if (!value || typeof value !== "object" || Array.isArray(value) || (value.userId && value.userId !== actor.user_id) || !value.tools || typeof value.tools !== "object" || Array.isArray(value.tools)) return respond(request, env, { success: false, error: "INVALID_SETTINGS" }, 400);
    const entries = Object.entries(value.tools);
    if (entries.length > 500 || entries.some(([id, state]) => !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !["ENABLED", "DISABLED"].includes(state))) return respond(request, env, { success: false, error: "INVALID_TOOL_SETTINGS" }, 400);
    const startPage = String(value.startPage || "tools").toLowerCase();
    if (!["overview", "tools"].includes(startPage)) return respond(request, env, { success: false, error: "INVALID_START_PAGE" }, 400);
    const settings = { userId: actor.user_id, tools: Object.fromEntries(entries), startPage };
    await env.DB.prepare("INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at").bind(actor.user_id, JSON.stringify(settings), now).run();
    return respond(request, env, { success: true, settings });
  }
  if (path === "/api/dashboard/permissions" && request.method === "PUT") {
    if (!isAdmin || !body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions)) return forbidden();
    const statements = [];
    for (const [rawUserId, tools] of Object.entries(body.permissions)) {
      const userId = String(rawUserId).trim().toUpperCase();
      if (!/^Q-[0-9]{3,}$/.test(userId) || !tools || typeof tools !== "object" || Array.isArray(tools)) return respond(request, env, { success: false, error: "INVALID_PERMISSION_TARGET" }, 400);
      const target = await env.DB.prepare("SELECT role FROM users WHERE user_id = ?").bind(userId).first();
      if (!target || !["USER", "ADMIN"].includes(target.role) || (role === "ADMIN" && target.role !== "USER")) return forbidden();
      for (const [toolId, state] of Object.entries(tools)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(toolId)) return respond(request, env, { success: false, error: "INVALID_TOOL_ID" }, 400);
        const objectState = state && typeof state === "object" && !Array.isArray(state);
        if (state !== null && typeof state === "object" && !objectState) return respond(request, env, { success: false, error: "INVALID_PERMISSION_STATE" }, 400);
        if (role === "ADMIN") {
          if (objectState && (Object.prototype.hasOwnProperty.call(state, "forcedState") || Object.prototype.hasOwnProperty.call(state, "forced") || Object.keys(state).some(key => !["granted", "enabled"].includes(key)))) return forbidden();
          const enabled = objectState ? state.granted ?? state.enabled : state;
          if (typeof enabled !== "boolean") return respond(request, env, { success: false, error: "INVALID_PERMISSION_STATE" }, 400);
          const current = await env.DB.prepare("SELECT forced_state FROM tool_permissions WHERE user_id = ? AND tool_id = ?").bind(userId, toolId).first();
          if (current?.forced_state) return respond(request, env, { success: false, error: "PERMISSION_FORCED" }, 409);
          statements.push(env.DB.prepare("INSERT INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type, updated_at) VALUES (?, ?, ?, 0, 'USER', ?) ON CONFLICT(user_id, tool_id) DO UPDATE SET can_use = excluded.can_use, updated_at = excluded.updated_at WHERE tool_permissions.forced_state = 0").bind(userId, toolId, enabled ? 1 : 0, now));
        } else {
          const enabled = objectState ? state.granted ?? state.enabled : state;
          const forcedValue = objectState ? state.forcedState ?? state.forced ?? false : false;
          const type = objectState && ["USER", "ADMIN"].includes(state.type) ? state.type : "USER";
          if (typeof enabled !== "boolean" || typeof forcedValue !== "boolean" || (objectState && Object.keys(state).some(key => !["granted", "enabled", "forcedState", "forced", "type"].includes(key)))) return respond(request, env, { success: false, error: "INVALID_PERMISSION_STATE" }, 400);
          statements.push(env.DB.prepare("INSERT INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, tool_id) DO UPDATE SET can_use = excluded.can_use, forced_state = excluded.forced_state, permission_type = excluded.permission_type, updated_at = excluded.updated_at").bind(userId, toolId, enabled ? 1 : 0, forcedValue ? 1 : 0, type, now));
        }
      }
    }
    if (statements.length) await env.DB.batch(statements);
    return respond(request, env, { success: true, updated: statements.length });
  }
  if (path === "/api/dashboard/visibility" && request.method === "PUT") {
    if (!isSuper || !body.visibility || typeof body.visibility !== "object" || Array.isArray(body.visibility)) return forbidden();
    const statements = [];
    for (const [toolId, record] of Object.entries(body.visibility)) {
      const mode = String(record?.visibility || "PRIVATE").toUpperCase();
      if (!["PRIVATE", "PUBLIC", "SELECTED_USERS"].includes(mode) || !Array.isArray(record.allowedUsers)) continue;
      statements.push(env.DB.prepare("INSERT INTO tool_visibility (tool_id, mode, updated_at) VALUES (?, ?, ?) ON CONFLICT(tool_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at").bind(toolId, mode, now));
      statements.push(env.DB.prepare("DELETE FROM tool_visibility_users WHERE tool_id = ?").bind(toolId));
      for (const userId of [...new Set(record.allowedUsers.map(value => String(value).trim().toUpperCase()).filter(Boolean))]) {
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO tool_visibility_users (tool_id, user_id) VALUES (?, ?)").bind(toolId, userId));
      }
    }
    if (statements.length) await env.DB.batch(statements);
    return respond(request, env, { success: true });
  }
  if (path === "/api/dashboard/users" && request.method === "POST") {
    if (!isAdmin) return forbidden();
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const newRole = String(body.role || "USER").trim().toUpperCase();
    const status = String(body.status || "Active").trim();
    const password = String(body.password || "");
    if (!name || name.length > 100 || (role === "ADMIN" ? !["USER", "ADMIN"].includes(newRole) : !["USER", "ADMIN", "SUPER_ADMIN"].includes(newRole)) || !["Active", "Inactive"].includes(status) || password.length < 10 || password.length > 128) return respond(request, env, { success: false, error: "INVALID_USER" }, 400);
    const duplicate = await env.DB.prepare("SELECT user_id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(name).first();
    if (duplicate) return respond(request, env, { success: false, error: "USER_NAME_EXISTS" }, 409);
    const sequence = await env.DB.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(user_id, 3) AS INTEGER)), 0) + 1 AS next_id FROM users WHERE user_id GLOB 'Q-[0-9]*'").first();
    const userId = "Q-" + String(sequence?.next_id || 1).padStart(3, "0");
    const repository = userId + "_" + name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const passwordHash = await createPasswordHash(password);
    const passwordChangedAt = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO users (user_id, name, role, status, personal_repository, password_hash, password_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(userId, name, newRole, status, repository, passwordHash, passwordChangedAt, now, now).run();
    return respond(request, env, { success: true, user: { id: userId, name, role: newRole, status, repository } }, 201);
  }
  if (path.startsWith("/api/dashboard/users/") && path.endsWith("/password") && request.method === "POST") {
    if (!isAdmin) return forbidden();
    const userId = decodeURIComponent(path.split("/").slice(-2, -1)[0]).trim().toUpperCase();
    const target = await env.DB.prepare("SELECT role, status FROM users WHERE user_id = ?").bind(userId).first();
    const password = String(body.password || "");
    if (!target || target.status !== "Active" || (role === "ADMIN" && target.role !== "USER")) return forbidden();
    if (password.length < 10 || password.length > 128) return respond(request, env, { success: false, error: "PASSWORD_REQUIREMENTS" }, 400);
    const hash = await createPasswordHash(password);
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_count = 0, locked_until = 0 WHERE user_id = ?").bind(hash, timestamp, userId),
      env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(timestamp, userId)
    ]);
    return respond(request, env, { success: true, userId });
  }
  if (path.startsWith("/api/dashboard/users/") && request.method === "PATCH") {
    if (!isAdmin) return forbidden();
    const userId = decodeURIComponent(path.split("/").pop()).trim().toUpperCase();
    const target = await env.DB.prepare("SELECT user_id, role, status FROM users WHERE user_id = ?").bind(userId).first();
    if (!target || (role === "ADMIN" && target.role !== "USER") || userId === actor.user_id) return forbidden();
    if (Object.prototype.hasOwnProperty.call(body, "id") || Object.prototype.hasOwnProperty.call(body, "userId") || Object.prototype.hasOwnProperty.call(body, "username")) return respond(request, env, { success: false, error: "USER_ID_IMMUTABLE" }, 400);
    const nextRole = body.role === undefined ? target.role : String(body.role).toUpperCase();
    const nextStatus = body.status === undefined ? target.status : String(body.status);
    const nextName = body.name === undefined ? null : String(body.name).trim().replace(/\s+/g, " ");
    if (nextName !== null && (!nextName || nextName.length > 100)) return respond(request, env, { success: false, error: "INVALID_NAME" }, 400);
    if (![ "USER", "ADMIN", "SUPER_ADMIN" ].includes(nextRole) || ![ "Active", "Inactive" ].includes(nextStatus) || (role === "ADMIN" && nextRole !== "USER")) return respond(request, env, { success: false, error: "INVALID_USER_UPDATE" }, 400);
    if (target.role === "SUPER_ADMIN" && (nextRole !== "SUPER_ADMIN" || nextStatus !== "Active")) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'SUPER_ADMIN' AND status = 'Active'").first();
      if (Number(count?.total || 0) <= 1) return respond(request, env, { success: false, error: "LAST_SUPER_ADMIN" }, 400);
    }
    await env.DB.prepare("UPDATE users SET name = COALESCE(?, name), role = ?, status = ?, updated_at = ? WHERE user_id = ?").bind(nextName, nextRole, nextStatus, now, userId).run();
    if (nextStatus !== "Active") await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), userId).run();
    return respond(request, env, { success: true, user: { id: userId, role: nextRole, status: nextStatus } });
  }
  if (path.startsWith("/api/dashboard/users/") && request.method === "DELETE") {
    if (!isAdmin) return forbidden();
    const userId = decodeURIComponent(path.split("/").pop()).toUpperCase();
    const target = await env.DB.prepare("SELECT role FROM users WHERE user_id = ?").bind(userId).first();
    if (!target || userId === actor.user_id || (role === "ADMIN" && target.role !== "USER")) return forbidden();
    if (target.role === "SUPER_ADMIN") {
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'SUPER_ADMIN' AND status = 'Active'").first();
      if (Number(count?.total || 0) <= 1) return respond(request, env, { success: false, error: "LAST_SUPER_ADMIN" }, 409);
    }
    await env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
    return respond(request, env, { success: true });
  }
  if (path === "/api/dashboard/users" && request.method === "GET") {
    if (!isAdmin) return forbidden();
    const result = await env.DB.prepare("SELECT user_id AS id, name, role, status, personal_repository AS repository FROM users ORDER BY user_id").all();
    return respond(request, env, { success: true, users: result.results || [] });
  }
  if (path === "/api/dashboard/announcements" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT announcement_id AS id, author_id, author_name, body, created_at, updated_at FROM announcements ORDER BY created_at DESC").all();
    return respond(request, env, { success: true, announcements: result.results || [] });
  }
  if (path === "/api/dashboard/announcements" && request.method === "POST") {
    if (!isAdmin || typeof body.body !== "string" || !body.body.trim() || body.body.length > 6000) return respond(request, env, { success: false, error: "INVALID_ANNOUNCEMENT" }, 400);
    const requestedId = String(body.id || "").trim();
    const id = requestedId && /^[A-Za-z0-9_-]{1,100}$/.test(requestedId) ? requestedId : "ANN-" + randomToken().slice(0, 20).toUpperCase();
    await env.DB.prepare("INSERT INTO announcements (announcement_id, author_id, author_name, body, cycle, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, actor.user_id, actor.name, body.body.trim(), String(body.cycle || ""), now, now, actor.user_id).run();
    return respond(request, env, { success: true, id });
  }
  if (path.startsWith("/api/dashboard/announcements/") && request.method === "PATCH") {
    if (!isAdmin) return forbidden();
    const id = decodeURIComponent(path.split("/").pop());
    const text = String(body.body || "").trim();
    if (!text || text.length > 10000) return respond(request, env, { success: false, error: "INVALID_ANNOUNCEMENT" }, 400);
    const result = await env.DB.prepare("UPDATE announcements SET body = ?, cycle = ?, updated_at = ?, updated_by = ? WHERE announcement_id = ?").bind(text, String(body.cycle || ""), now, actor.user_id, id).run();
    return result.meta?.changes ? respond(request, env, { success: true, id }) : respond(request, env, { success: false, error: "NOT_FOUND" }, 404);
  }
  if (path.startsWith("/api/dashboard/announcements/") && request.method === "DELETE") {
    if (!isAdmin) return forbidden();
    const id = decodeURIComponent(path.split("/").pop());
    await env.DB.prepare("DELETE FROM announcements WHERE announcement_id = ?").bind(id).run();
    return respond(request, env, { success: true });
  }
  if (path === "/api/dashboard/transactions" && request.method === "GET") {
    if (!isSuper) return forbidden();
    const result = await env.DB.prepare("SELECT request_id, request_type, status, payload_json, result_json, created_at, updated_at FROM network_transactions ORDER BY created_at DESC LIMIT 500").all();
    return respond(request, env, { success: true, transactions: (result.results || []).map(item => ({ ...item, payload: JSON.parse(item.payload_json || "{}"), result: JSON.parse(item.result_json || "{}") })) });
  }
  if (path === "/api/dashboard/transactions" && request.method === "POST") {
    if (!isAdmin || !body.requestId || !body.requestType || !body.payload || typeof body.payload !== "object") return forbidden();
    await env.DB.prepare("INSERT INTO network_transactions (request_id, request_type, status, payload_json, result_json, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, '{}', ?, ?)").bind(String(body.requestId), String(body.requestType), JSON.stringify(body.payload), now, now).run();
    return respond(request, env, { success: true, requestId: body.requestId });
  }
  return null;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        const origin = allowedOrigin(request, env);
        return new Response(null, { status: 204, headers: origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "content-type, authorization, x-setup-secret", "access-control-max-age": "86400", "vary": "Origin" } : {} });
      }
      if (url.pathname === "/api/health" && request.method === "GET") return respond(request, env, { success: true, service: "YODAWY Dashboard API", status: "online", version: "2" });
      if (url.pathname === "/api/ready" && request.method === "GET") {
        try { const result = await env.DB.prepare("SELECT 1 AS ready").first(); return respond(request, env, { success: result?.ready === 1, database: result?.ready === 1 ? "connected" : "unavailable" }, result?.ready === 1 ? 200 : 503); }
        catch { return respond(request, env, { success: false, database: "unavailable" }, 503); }
      }
      const auth = await authRoutes(request, env, url.pathname);
      if (auth) return auth;
      if (url.pathname.startsWith("/api/dashboard/")) {
        const dashboard = await dashboardRoutes(request, env, url.pathname);
        if (dashboard) return dashboard;
      }
      return respond(request, env, { success: false, error: "NOT_FOUND" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
