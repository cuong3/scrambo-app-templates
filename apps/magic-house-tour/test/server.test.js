import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createAppServer } from "../server.js";

let upstream;
let app;
let baseUrl;
const requests = [];
const sessionId = `sess_${"1".repeat(32)}`;
const assetId = `asset_${"2".repeat(32)}`;
const operationId = `op_${"3".repeat(32)}`;
const snapshotOperationId = `op_${"4".repeat(32)}`;
const editId = "edit_captioned";

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

before(async () => {
  upstream = createServer(async (request, response) => {
    const url = new URL(request.url, "http://upstream");
    const raw = await requestBody(request);
    const parsed = request.headers["content-type"] === "application/json" && raw.length
      ? JSON.parse(raw.toString())
      : raw;
    requests.push({ method: request.method, path: url.pathname, query: url.search, body: parsed, headers: request.headers });

    if (request.method === "POST" && url.pathname === "/v2/sessions") {
      json(response, 200, { sessionId, project: parsed.project, state: "open", canvas: parsed.canvas, assets: [], currentEditId: null, createdAt: new Date().toISOString() });
    } else if (request.method === "GET" && url.pathname === `/v2/sessions/${sessionId}`) {
      json(response, 200, { sessionId, project: "tour", state: "open", canvas: [1080, 1920], assets: [], currentEditId: editId, createdAt: new Date().toISOString() });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/assets`) {
      json(response, 200, { assetId, ...parsed, uploaded: false });
    } else if (request.method === "PUT" && url.pathname === `/v2/sessions/${sessionId}/assets/${assetId}/content`) {
      json(response, 200, { assetId, uploaded: true, bytes: raw.length });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/turns`) {
      json(response, 202, { operationId, status: "queued" });
    } else if (request.method === "GET" && url.pathname === `/v2/operations/${operationId}`) {
      json(response, 200, { operationId, status: "succeeded", cursor: 1, events: [], result: { type: "answer", answer: "draft" }, error: null });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/view-edit-snapshots`) {
      json(response, 202, { operationId: snapshotOperationId, status: "queued", editId, viewUrl: "https://editor.example/view", expiresAt: new Date().toISOString() });
    } else if (request.method === "POST" && url.pathname === `/v2/sessions/${sessionId}/close`) {
      json(response, 200, { sessionId, state: "closed" });
    } else {
      json(response, 404, { error: { code: "not_found", message: "not found", retryable: false } });
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  app = createAppServer({ apiUrl: upstreamUrl, token: "server-secret", maxUploadBytes: 32 });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => app.close(resolve)),
    new Promise((resolve) => upstream.close(resolve)),
  ]);
});

test("serves the dedicated app without exposing a credential field", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  const shell = await response.text();
  assert.match(shell, /Magic House Tour/);
  assert.match(shell, /Create Magic House Tour/);
  assert.doesNotMatch(shell, /api-key|SCRAMBO_API_TOKEN/);
  assert.deepEqual(await (await fetch(`${baseUrl}/healthz`)).json(), { status: "ok" });
});

test("rejects non-image and oversized uploads", async () => {
  const nonImage = await fetch(`${baseUrl}/api/sessions/${sessionId}/uploads?name=clip.mp4&mimeType=video%2Fmp4`, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: Buffer.from("clip"),
  });
  assert.equal(nonImage.status, 415);
  assert.equal((await nonImage.json()).error.code, "unsupported_media_type");

  const tooLarge = await fetch(`${baseUrl}/api/sessions/${sessionId}/uploads?name=large.jpg&mimeType=image%2Fjpeg`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: Buffer.alloc(33),
  });
  assert.equal(tooLarge.status, 413);
});

test("proxies session, verified photo upload, turns, polling, snapshot, and close", async () => {
  const created = await apiFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: "tour", canvas: [1080, 1920] }),
  });
  assert.equal(created.sessionId, sessionId);

  const photo = Buffer.from("photo-bytes");
  const uploaded = await apiFetch(`/api/sessions/${sessionId}/uploads?name=front.jpg&mimeType=image%2Fjpeg`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: photo,
  });
  assert.equal(uploaded.uploaded, true);
  const declaration = requests.find((entry) => entry.method === "POST" && entry.path.endsWith("/assets"));
  assert.deepEqual(declaration.body, {
    name: "front.jpg",
    size: photo.length,
    mimeType: "image/jpeg",
    sha256: createHash("sha256").update(photo).digest("hex"),
  });

  const turn = { requestId: "ask-1", mode: "ask", message: "Draft the tour" };
  const accepted = await apiFetch(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(turn),
  });
  assert.equal(accepted.operationId, operationId);
  assert.equal((await apiFetch(`/api/operations/${operationId}?after=0`)).result.answer, "draft");

  const snapshot = await apiFetch(`/api/sessions/${sessionId}/view-edit-snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editId }),
  });
  assert.equal(snapshot.viewUrl, "https://editor.example/view");
  assert.equal((await apiFetch(`/api/sessions/${sessionId}/close`, { method: "POST" })).state, "closed");

  assert.ok(requests.every((entry) => entry.headers.authorization === "Bearer server-secret"));
  assert.ok(requests.every((entry) => entry.headers["x-scrambo-api-key"] === undefined));
});

async function apiFetch(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    assert.fail(`${response.status}: ${await response.text()}`);
  }
  return response.json();
}
