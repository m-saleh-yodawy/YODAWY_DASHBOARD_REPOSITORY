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
    headers.set("access-control-allow-headers", "content-type, authorization");
    headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
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
  return { accessToken: await sign({ sub: user.user_id, role: user.role, exp: now + ACCESS_TTL, sid: sessionId }, env.AUTH_SECRET), refreshToken: refresh, expiresIn: ACCESS_TTL, user: { id: user.user_id, name: user.name, role: user.role } };
};
const authenticate = async (request, env) => {
  const token = (request.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return null;
  const payload = await verifyAccess(token, env.AUTH_SECRET);
  if (!payload) return null;
  const session = await env.DB.prepare("SELECT s.session_id_hash, u.user_id, u.name, u.role, u.status FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.session_id_hash = ? AND s.user_id = ? AND s.expires_at > ? AND s.revoked_at IS NULL").bind(await digest(payload.sid), payload.sub, Math.floor(Date.now() / 1000)).first();
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
    const session = await env.DB.prepare("SELECT s.session_id_hash, s.user_id, u.name, u.role, u.status FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.refresh_token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL").bind(await digest(token), now).first();
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
    const [users, tools, permissions, visibility, visibleUsers, settings, announcements, transactions] = await Promise.all([
      env.DB.prepare("SELECT user_id AS id, name, role, status, personal_repository AS repository FROM users ORDER BY user_id").all(),
      env.DB.prepare("SELECT tool_id AS id, name, description, version, asset_path AS path, sha256, enabled FROM tools WHERE enabled = 1 ORDER BY name").all(),
      isAdmin ? env.DB.prepare("SELECT user_id, tool_id, can_use, forced_state, permission_type FROM tool_permissions").all() : env.DB.prepare("SELECT user_id, tool_id, can_use, forced_state, permission_type FROM tool_permissions WHERE user_id = ?").bind(actor.user_id).all(),
      env.DB.prepare("SELECT tool_id, mode FROM tool_visibility").all(),
      env.DB.prepare("SELECT tool_id, user_id FROM tool_visibility_users").all(),
      env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(actor.user_id).first(),
      env.DB.prepare("SELECT announcement_id AS id, author_id, author_name, body, created_at, updated_at FROM announcements ORDER BY created_at DESC").all(),
      isSuper ? env.DB.prepare("SELECT request_id, request_type, status, payload_json, result_json, created_at, updated_at FROM network_transactions ORDER BY created_at DESC LIMIT 500").all() : Promise.resolve({ results: [] })
    ]);
    const permissionMap = {};
    for (const item of permissions.results || []) {
      const key = item.user_id;
      (permissionMap[key] ||= {})[item.tool_id] = { enabled: Boolean(item.can_use), forced: Boolean(item.forced_state), type: item.permission_type };
    }
    const visibilityMap = {};
    for (const item of visibility.results || []) visibilityMap[item.tool_id] = { visibility: item.mode, allowedUsers: [] };
    for (const item of visibleUsers.results || []) (visibilityMap[item.tool_id] ||= { visibility: "PRIVATE", allowedUsers: [] }).allowedUsers.push(item.user_id);
    return respond(request, env, { success: true, user: { id: actor.user_id, name: actor.name, role }, users: isAdmin ? users.results : [], tools: tools.results, permissions: permissionMap, visibility: visibilityMap, settings: settings ? JSON.parse(settings.settings_json) : { userId: actor.user_id, tools: {}, startPage: "tools" }, announcements: announcements.results || [], transactions: (transactions.results || []).map(item => ({ ...item, payload: JSON.parse(item.payload_json || "{}"), result: JSON.parse(item.result_json || "{}") })) });
  }
  if (path === "/api/dashboard/settings" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(actor.user_id).first();
    return respond(request, env, { success: true, settings: row ? JSON.parse(row.settings_json) : { userId: actor.user_id, tools: {}, startPage: "tools" } });
  }
  if (path === "/api/dashboard/settings" && request.method === "PUT") {
    const value = body.settings;
    if (!value || typeof value !== "object" || Array.isArray(value) || (value.userId && value.userId !== actor.user_id) || !value.tools || typeof value.tools !== "object" || Array.isArray(value.tools)) return respond(request, env, { success: false, error: "INVALID_SETTINGS" }, 400);
    const settings = { ...value, userId: actor.user_id };
    await env.DB.prepare("INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at").bind(actor.user_id, JSON.stringify(settings), now).run();
    return respond(request, env, { success: true, settings });
  }
  if (path === "/api/dashboard/permissions" && request.method === "PUT") {
    if (!isAdmin || !body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions)) return forbidden();
    const statements = [];
    for (const [userId, tools] of Object.entries(body.permissions)) {
      if (!tools || typeof tools !== "object" || Array.isArray(tools)) continue;
      if (role === "ADMIN") {
        const target = await env.DB.prepare("SELECT role FROM users WHERE user_id = ?").bind(userId).first();
        if (!target || target.role !== "USER") continue;
      }
      for (const [toolId, state] of Object.entries(tools)) {
        const enabled = typeof state === "object" ? Boolean(state.enabled) : Boolean(state);
        const forced = typeof state === "object" && Boolean(state.forced);
        const type = typeof state === "object" && ["USER", "ADMIN", "SUPER_ADMIN"].includes(state.type) ? state.type : "USER";
        statements.push(env.DB.prepare("INSERT INTO tool_permissions (user_id, tool_id, can_use, forced_state, permission_type, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, tool_id) DO UPDATE SET can_use = excluded.can_use, forced_state = excluded.forced_state, permission_type = excluded.permission_type, updated_at = excluded.updated_at").bind(userId, toolId, enabled ? 1 : 0, forced ? 1 : 0, type, now));
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
    const name = String(body.name || "").trim().replace(/\\s+/g, " ");
    const newRole = String(body.role || "USER").trim().toUpperCase();
    if (!name || name.length > 100 || !["USER", "ADMIN"].includes(newRole) || (role === "ADMIN" && newRole !== "USER")) return respond(request, env, { success: false, error: "INVALID_USER" }, 400);
    const sequence = await env.DB.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(user_id, 3) AS INTEGER)), 0) + 1 AS next_id FROM users WHERE user_id GLOB 'Q-[0-9]*'").first();
    const userId = "Q-" + String(sequence?.next_id || 1).padStart(3, "0");
    const repository = userId + "_" + name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    await env.DB.prepare("INSERT INTO users (user_id, name, role, status, personal_repository, created_at, updated_at) VALUES (?, ?, ?, 'Active', ?, ?, ?)").bind(userId, name, newRole, repository, now, now).run();
    return respond(request, env, { success: true, user: { id: userId, name, role: newRole, status: "Active", repository } }, 201);
  }
  if (path.startsWith("/api/dashboard/users/") && request.method === "PATCH") {
    if (!isAdmin) return forbidden();
    const userId = decodeURIComponent(path.split("/").pop()).toUpperCase();
    const target = await env.DB.prepare("SELECT user_id, role, status FROM users WHERE user_id = ?").bind(userId).first();
    if (!target || (role === "ADMIN" && target.role !== "USER") || userId === actor.user_id) return forbidden();
    const nextRole = body.role === undefined ? target.role : String(body.role).toUpperCase();
    const nextStatus = body.status === undefined ? target.status : String(body.status);
    if (!["USER", "ADMIN", "SUPER_ADMIN"].includes(nextRole) || !["Active", "Inactive"].includes(nextStatus) || (role === "ADMIN" && nextRole !== "USER")) return respond(request, env, { success: false, error: "INVALID_USER_UPDATE" }, 400);
    if (target.role === "SUPER_ADMIN" && (nextRole !== "SUPER_ADMIN" || nextStatus !== "Active")) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'SUPER_ADMIN' AND status = 'Active'").first();
      if (Number(count?.total || 0) <= 1) return respond(request, env, { success: false, error: "LAST_SUPER_ADMIN" }, 409);
    }
    await env.DB.prepare("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE user_id = ?").bind(nextRole, nextStatus, now, userId).run();
    if (nextStatus !== "Active") await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), userId).run();
    return respond(request, env, { success: true });
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
    if (!isAdmin || typeof body.body !== "string" || !body.body.trim() || body.body.length > 10000) return forbidden();
    const id = "ANN-" + randomToken().slice(0, 20).toUpperCase();
    await env.DB.prepare("INSERT INTO announcements (announcement_id, author_id, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, actor.user_id, actor.name, body.body.trim(), now, now).run();
    return respond(request, env, { success: true, id });
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
        return new Response(null, { status: 204, headers: origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400", "vary": "Origin" } : {} });
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
