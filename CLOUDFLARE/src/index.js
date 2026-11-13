const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": env.APP_ORIGIN || url.origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        success: true,
        service: "YODAWY Dashboard API",
        status: "online",
        version: "1"
      });
    }

    if (url.pathname === "/api/ready" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS ready").first();
        return json({
          success: true,
          database: result?.ready === 1 ? "connected" : "unavailable"
        }, result?.ready === 1 ? 200 : 503);
      } catch {
        return json({
          success: false,
          database: "unavailable"
        }, 503);
      }
    }

    return json({
      success: false,
      error: "NOT_FOUND"
    }, 404);
  }
};