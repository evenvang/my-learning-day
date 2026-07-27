const ALLOWED_ORIGINS = new Set([
  "https://evenvang.github.io",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
]);

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://evenvang.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(request, { error: "只接受同步请求" }, 405);
    }

    try {
      const origin = request.headers.get("Origin") || "";
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return jsonResponse(request, { error: "这个来源不允许使用云同步" }, 403);
      }

      if (!env.SYNC_KV) {
        return jsonResponse(request, { error: "Cloudflare 云存储还没有绑定，请重新部署 Worker" }, 500);
      }

      const { action, passphrase, payload } = await request.json();
      if (!passphrase || String(passphrase).length < 6) {
        return jsonResponse(request, { error: "同步密钥至少需要 6 位" }, 400);
      }

      const key = "dashboard:" + await sha256Hex(String(passphrase));

      if (action === "put") {
        await env.SYNC_KV.put(key, JSON.stringify({
          ...payload,
          cloudSavedAt: new Date().toISOString(),
        }));
        return jsonResponse(request, { ok: true, savedAt: new Date().toISOString() });
      }

      if (action === "get") {
        const value = await env.SYNC_KV.get(key, "json");
        if (!value) {
          return jsonResponse(request, { error: "云端还没有这个同步密钥对应的数据。请先在一台设备上上传。" }, 404);
        }
        return jsonResponse(request, value);
      }

      return jsonResponse(request, { error: "不支持的同步动作" }, 400);
    } catch (error) {
      return jsonResponse(request, { error: error?.message || "云同步失败" }, 500);
    }
  },
};
