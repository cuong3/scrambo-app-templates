import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createAppServer } from "../server.js";

let mockServer;
let appServer;
let baseUrl;
const requests = [];
const sessionId = `sess_${"1".repeat(32)}`;
const assetId = `asset_${"2".repeat(32)}`;
const operationId = `op_${"3".repeat(32)}`;
const snapshotOperationId = `op_${"4".repeat(32)}`;
const handoffOperationId = `op_${"5".repeat(32)}`;
const handoffId = `handoff_${"6".repeat(32)}`;
const editId = "edit_first";
const serviceToken = "test-service-token";

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

before(async () => {
  mockServer = createServer(async (request, response) => {
    const url = new URL(request.url, "http://mock");
    const raw = await body(request);
    const parsed = request.headers["content-type"] === "application/json" && raw.length
      ? JSON.parse(raw.toString())
      : raw;
    requests.push({ method: request.method, path: url.pathname, query: url.search, body: parsed, headers: request.headers });

    if (request.method === "POST" && url.pathname === "/v2/sessions") {
      json(response, 200, { sessionId, project: parsed.project, state: "open", canvas: null, assets: [], currentEditId: null, createdAt: new Date().toISOString() });
    } else if (request.method === "GET" && url.pathname === `/v2/sessions/${sessionId}`) {
      json(response, 200, { sessionId, project: "test-transcript", state: "open", canvas: null, assets: [], currentEditId: editId, createdAt: new Date().toISOString() });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/assets`) {
      json(response, 200, { assetId, ...parsed, uploaded: false });
    } else if (request.method === "PUT" && url.pathname === `/v2/sessions/${sessionId}/assets/${assetId}/content`) {
      json(response, 200, { assetId, uploaded: true, bytes: raw.length });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/turns`) {
      json(response, 202, { operationId, status: "queued" });
    } else if (request.method === "GET" && url.pathname === `/v2/operations/${operationId}`) {
      json(response, 200, { operationId, status: "succeeded", cursor: 1, events: [{ cursor: 1, type: "progress", message: "done", at: new Date().toISOString() }], result: { type: "edit", agent: "timeline.author", editId, previousEditId: null, artifact: {} }, error: null });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/view-edit-snapshots`) {
      json(response, 202, { operationId: snapshotOperationId, status: "queued", editId, viewUrl: "https://editor.example/snapshot", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/render-handoffs`) {
      json(response, 202, { operationId: handoffOperationId, status: "queued" });
    } else if (request.method === "GET" && url.pathname === `/v2/sessions/${sessionId}/render-handoffs/${handoffId}`) {
      json(response, 200, { handoffId, editId, handoff: { schema: "scrambo.render-ir.v1", rendererProfile: "scrambo-remotion-scene-v1", source: { sessionId, editId }, assets: [], compatibility: { unsupported: [] } } });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/close`) {
      json(response, 200, { sessionId, state: "closed" });
    } else {
      json(response, 404, { error: { code: "not_found", message: "not found", retryable: false } });
    }
  });
  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const mockUrl = `http://127.0.0.1:${mockServer.address().port}`;
  appServer = createAppServer({ apiUrl: mockUrl, token: serviceToken, maxUploadBytes: 32 });
  await new Promise((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${appServer.address().port}`;
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => appServer.close(resolve)),
    new Promise((resolve) => mockServer.close(resolve)),
  ]);
});

test("serves the app shell and reusable modules", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const shell = await response.text();
  assert.match(shell, /Scrambo Chat Edit/);
  assert.doesNotMatch(shell, /id="api-key"/);
  assert.match(shell, /Upload more files[\s\S]*id="uploaded-file-list"[\s\S]*How this works/);
  assert.match(shell, /id="send-button"[\s\S]*id="open-editor-button"[\s\S]*id="download-handoff-button"/);
  assert.match(shell, /Templates[\s\S]*id="quick-actions"/);
  const commandHelpers = await fetch(`${baseUrl}/command-chain.js`);
  assert.equal(commandHelpers.status, 200);
  assert.match(commandHelpers.headers.get("content-type"), /text\/javascript/);
  assert.equal((await fetch(`${baseUrl}/session-lifecycle.js`)).status, 200);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
});

test("requires a server-side API token and does not expose it in config", async () => {
  assert.deepEqual(await (await fetch(`${baseUrl}/api/config`)).json(), { configured: true });

  const unconfigured = createAppServer({ apiUrl: "http://unused.invalid", token: "" });
  await new Promise((resolve) => unconfigured.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${unconfigured.address().port}`;
  try {
    const response = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "missing-token" }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "not_configured");
  } finally {
    await new Promise((resolve) => unconfigured.close(resolve));
  }
});

test("rejects oversized uploads before contacting the upstream session", async () => {
  const requestCount = requests.length;
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/uploads?name=large.mp4&mimeType=video%2Fmp4`, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: Buffer.alloc(33),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "upload_too_large");
  assert.equal(requests.length, requestCount);
});

test("rate limits API requests per client without blocking health checks", async () => {
  const limitedServer = createAppServer({ apiUrl: "http://unused.invalid", rateLimitPerMinute: 1 });
  await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
  const limitedUrl = `http://127.0.0.1:${limitedServer.address().port}`;
  try {
    assert.equal((await fetch(`${limitedUrl}/api/config`)).status, 200);
    const limited = await fetch(`${limitedUrl}/api/config`);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await fetch(`${limitedUrl}/healthz`)).status, 200);
  } finally {
    await new Promise((resolve) => limitedServer.close(resolve));
  }
});

test("proxies the Stateful Agent V2 lifecycle with a server-side credential", async () => {
  const createdResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: "test-transcript" }),
  });
  assert.equal(createdResponse.status, 201);
  assert.equal((await createdResponse.json()).sessionId, sessionId);

  const content = Buffer.from("mock-video-bytes");
  const uploadResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/uploads?name=clip.mp4&mimeType=video%2Fmp4`, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: content,
  });
  assert.equal(uploadResponse.status, 201);
  assert.equal((await uploadResponse.json()).uploaded, true);
  const declaration = requests.find((item) => item.method === "POST" && item.path.endsWith("/assets"));
  assert.deepEqual(declaration.body, {
    name: "clip.mp4",
    size: content.length,
    mimeType: "video/mp4",
    sha256: createHash("sha256").update(content).digest("hex"),
  });

  const sourceTurn = { requestId: `source-${randomUUID()}`, mode: "edit", agent: "source.work", message: "Understand footage", tools: ["transcribe"] };
  const timelineTurn = { requestId: `timeline-${randomUUID()}`, mode: "edit", agent: "timeline.author", baseEditId: editId, message: "Make a concise cut" };
  for (const turn of [sourceTurn, timelineTurn]) {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(turn),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).operationId, operationId);
  }
  const turnRequests = requests.filter((item) => item.method === "POST" && item.path.endsWith("/turns"));
  assert.deepEqual(turnRequests.at(-1).body, timelineTurn);

  const operationResponse = await fetch(`${baseUrl}/api/operations/${operationId}?after=0`);
  assert.equal((await operationResponse.json()).result.editId, editId);

  const snapshotResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/view-edit-snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editId }),
  });
  assert.equal((await snapshotResponse.json()).viewUrl, "https://editor.example/snapshot");

  const handoffAccepted = await fetch(`${baseUrl}/api/sessions/${sessionId}/render-handoffs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: `handoff-${randomUUID()}`, editId }),
  });
  assert.equal((await handoffAccepted.json()).operationId, handoffOperationId);
  const handoffResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/render-handoffs/${handoffId}`);
  assert.equal((await handoffResponse.json()).handoff.schema, "scrambo.render-ir.v1");

  const closeResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/close`, { method: "POST" });
  assert.equal((await closeResponse.json()).state, "closed");
  const createRequest = requests.find((item) => item.method === "POST" && item.path === "/v2/sessions");
  assert.equal(createRequest.headers.authorization, `Bearer ${serviceToken}`);
  assert.ok(requests.every((item) => item.headers.authorization === `Bearer ${serviceToken}`));
  assert.ok(requests.every((item) => item.headers["x-scrambo-api-key"] === undefined));
});
