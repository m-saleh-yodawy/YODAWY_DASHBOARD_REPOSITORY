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
  const body = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(payload)))).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return body + "." + btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
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
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
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
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
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
      return respond(request, env, { success: false, error: "NOT_FOUND" }, 404);
    }
    return env.ASSETS.fetch(request);
  }
};
