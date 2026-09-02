import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { ScramboApiError, ScramboClient } from "@scrambo/shared";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = join(MODULE_DIR, "public");
const DEFAULT_API_URL = "https://api.scrambo.dev";
const JSON_LIMIT = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 2;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 180;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 15 * 60_000;

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/tour-flow.js", ["tour-flow.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

class HttpError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function applySecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

function sendJson(response, status, body) {
  applySecurityHeaders(response);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) {
      throw new HttpError(413, {
        error: { code: "request_too_large", message: "JSON body is too large.", retryable: false },
      });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, {
      error: { code: "invalid_json", message: "Request body must be valid JSON.", retryable: false },
    });
  }
}

function clientAddress(request) {
  const flyClientIp = request.headers["fly-client-ip"];
  if (typeof flyClientIp === "string" && flyClientIp.trim()) return flyClientIp.trim();
  return request.socket.remoteAddress ?? "unknown";
}

function createFixedWindowRateLimiter(limit) {
  const clients = new Map();
  const windowMs = 60_000;
  return {
    take(key, now = Date.now()) {
      let entry = clients.get(key);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        clients.set(key, entry);
      }
      entry.count += 1;
      if (clients.size > 1_000) {
        for (const [candidate, value] of clients) {
          if (now >= value.resetAt) clients.delete(candidate);
        }
      }
      return {
        allowed: entry.count <= limit,
        remaining: Math.max(0, limit - entry.count),
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
      };
    },
  };
}

export function createRequestHandler(options = {}) {
  const apiUrl = String(options.apiUrl ?? process.env.SCRAMBO_API_URL ?? DEFAULT_API_URL).replace(/\/$/, "");
  const apiToken = String(options.token ?? process.env.SCRAMBO_API_TOKEN ?? "").trim();
  const publicDir = options.publicDir ?? DEFAULT_PUBLIC_DIR;
  const maxUploadBytes = positiveInteger(options.maxUploadBytes ?? process.env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  const maxConcurrentUploads = positiveInteger(
    options.maxConcurrentUploads ?? process.env.MAX_CONCURRENT_UPLOADS,
    DEFAULT_MAX_CONCURRENT_UPLOADS,
  );
  const rateLimitPerMinute = positiveInteger(
    options.rateLimitPerMinute ?? process.env.RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE,
  );
  const upstreamTimeoutMs = positiveInteger(
    options.upstreamTimeoutMs ?? process.env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_UPSTREAM_TIMEOUT_MS,
  );
  const uploadTimeoutMs = positiveInteger(
    options.uploadTimeoutMs ?? process.env.UPLOAD_TIMEOUT_MS,
    DEFAULT_UPLOAD_TIMEOUT_MS,
  );
  const rateLimiter = createFixedWindowRateLimiter(rateLimitPerMinute);
  let activeUploads = 0;

  function requireApiAccess() {
    if (!apiUrl || !apiToken) {
      throw new HttpError(503, {
        error: { code: "not_configured", message: "Set SCRAMBO_API_TOKEN on the server.", retryable: false },
      });
    }
  }

  function clientFor() {
    requireApiAccess();
    return new ScramboClient({ apiUrl, token: apiToken, timeoutMs: upstreamTimeoutMs, uploadTimeoutMs });
  }

  async function uploadPhoto(request, sessionId, url) {
    const name = url.searchParams.get("name")?.trim();
    const mimeType = url.searchParams.get("mimeType")?.trim() || "application/octet-stream";
    if (!name || name.length > 255 || /[\r\n/\\]/.test(name)) {
      throw new HttpError(400, {
        error: { code: "invalid_upload_name", message: "Photo name is invalid.", retryable: false },
      });
    }
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new HttpError(415, {
        error: { code: "unsupported_media_type", message: "Use a JPEG, PNG, or WebP photo.", retryable: false },
      });
    }
    const declaredLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxUploadBytes) {
      throw new HttpError(413, {
        error: { code: "upload_too_large", message: `Photo exceeds the ${maxUploadBytes}-byte limit.`, retryable: false },
      });
    }
    if (activeUploads >= maxConcurrentUploads) {
      throw new HttpError(429, {
        error: { code: "upload_busy", message: "The upload service is busy. Try again shortly.", retryable: true },
      });
    }

    activeUploads += 1;
    const client = clientFor();
    try {
      await client.getSession(sessionId);
      const tempDirectory = await mkdtemp(join(tmpdir(), "scrambo-house-photo-"));
      const tempPath = join(tempDirectory, "photo.bin");
      const hash = createHash("sha256");
      let size = 0;
      const digestStream = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > maxUploadBytes) {
            callback(new HttpError(413, {
              error: { code: "upload_too_large", message: `Photo exceeds the ${maxUploadBytes}-byte limit.`, retryable: false },
            }));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });

      try {
        await pipeline(request, digestStream, createWriteStream(tempPath, { flags: "wx" }));
        const asset = await client.declareAsset(sessionId, {
          name,
          size,
          mimeType,
          sha256: hash.digest("hex"),
        });
        const receipt = await client.uploadAssetContent(
          sessionId,
          asset.assetId,
          createReadStream(tempPath),
          { mimeType, size },
        );
        return { ...asset, uploaded: true, bytes: receipt?.bytes ?? size };
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    } finally {
      activeUploads -= 1;
    }
  }

  return async function handle(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const staticFile = STATIC_FILES.get(url.pathname);
      if (request.method === "GET" && staticFile) {
        const [file, contentType] = staticFile;
        const content = await readFile(join(publicDir, file));
        applySecurityHeaders(response);
        response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        response.end(content);
        return;
      }

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const rate = rateLimiter.take(clientAddress(request));
        response.setHeader("RateLimit-Limit", String(rateLimitPerMinute));
        response.setHeader("RateLimit-Remaining", String(rate.remaining));
        if (!rate.allowed) {
          response.setHeader("Retry-After", String(rate.retryAfter));
          throw new HttpError(429, {
            error: { code: "rate_limited", message: "Too many requests. Try again shortly.", retryable: true },
          });
        }
        if (url.pathname !== "/api/config") requireApiAccess();
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, { configured: Boolean(apiUrl && apiToken) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        sendJson(response, 201, await clientFor().createSession(await readJson(request)));
        return;
      }

      let match = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (request.method === "GET" && match) {
        sendJson(response, 200, await clientFor().getSession(match[1]));
        return;
      }
      match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/uploads$/);
      if (request.method === "POST" && match) {
        sendJson(response, 201, await uploadPhoto(request, match[1], url));
        return;
      }
      match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/);
      if (request.method === "POST" && match) {
        sendJson(response, 202, await clientFor().submitTurn(match[1], await readJson(request)));
        return;
      }
      match = url.pathname.match(/^\/api\/operations\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
        sendJson(response, 200, await clientFor().getOperation(match[1], after));
        return;
      }
      match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/view-edit-snapshots$/);
      if (request.method === "POST" && match) {
        const input = await readJson(request);
        sendJson(response, 202, await clientFor().createPublicSnapshot(match[1], input.editId));
        return;
      }
      match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/close$/);
      if (request.method === "POST" && match) {
        sendJson(response, 200, await clientFor().closeSession(match[1]));
        return;
      }

      sendJson(response, 404, {
        error: { code: "not_found", message: "Route not found.", retryable: false },
      });
    } catch (error) {
      if (error instanceof HttpError || error instanceof ScramboApiError) {
        sendJson(response, error.status, error.body);
        return;
      }
      console.error(error);
      sendJson(response, 500, {
        error: { code: "server_error", message: "Local server error.", retryable: true },
      });
    }
  };
}

export function createAppServer(options = {}) {
  const server = createHttpServer(createRequestHandler(options));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30 * 60_000;
  return server;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = positiveInteger(process.env.PORT, 4175);
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`Scrambo Magic House Tour is running at http://${host}:${port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
