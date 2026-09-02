# Stateful API V2 integration guide

This guide distills the Scrambo Stateful Agent API V2 contract into the parts a
product backend needs. `shared/client.js` implements these calls with Node's
built-in `fetch`; it is a reference layer, not a required SDK.

## Authentication and ownership

Send this header on every `/v2` request:

```http
Authorization: Bearer <partner credential>
```

Keep the credential in a server-side secret store. Do not return it in config
routes, embed it in browser bundles, accept it from an unauthenticated browser,
or write it to logs.

All resources are owner-scoped. Each owner has one current non-terminal
session; creating another closes and cancels the previous one. If your product
needs independent tenants to work concurrently, give them distinct provisioned
identities.

## Request lifecycle

| Step | Method and path | Keep |
| --- | --- | --- |
| Create | `POST /v2/sessions` | `sessionId` |
| Declare asset | `POST /v2/sessions/{sessionId}/assets` | `assetId`, SHA-256, size |
| Upload bytes | `PUT /v2/sessions/{sessionId}/assets/{assetId}/content` | upload receipt |
| Submit turn | `POST /v2/sessions/{sessionId}/turns` | `requestId`, `operationId` |
| Poll | `GET /v2/operations/{operationId}?after={cursor}` | status and latest cursor |
| Snapshot | `POST /v2/sessions/{sessionId}/view-edit-snapshots` | URL, operation, expiry |
| Create handoff | `POST /v2/sessions/{sessionId}/render-handoffs` | operation ID |
| Download handoff | `GET /v2/sessions/{sessionId}/render-handoffs/{handoffId}` | manifest |
| Close | `POST /v2/sessions/{sessionId}/close` | terminal state |

JSON request objects are closed: unknown fields are errors. API failures use a
consistent envelope:

```json
{
  "error": {
    "code": "edit_conflict",
    "message": "baseEditId is stale",
    "retryable": false
  }
}
```

Treat `retryable` as guidance for bounded backoff, not permission for unlimited
retries.

## Verified uploads

Uploads are intentionally two-step. Calculate the exact byte length and
lowercase SHA-256 digest before declaring an asset:

```js
const asset = await scrambo.declareAsset(sessionId, {
  name: "clip.mp4",
  size: bytes.byteLength,
  mimeType: "video/mp4",
  sha256: sha256Hex(bytes),
});

await scrambo.uploadAssetContent(sessionId, asset.assetId, bytes, {
  mimeType: "video/mp4",
  size: bytes.byteLength,
});
```

The server rejects bytes that do not match the declaration. For public uploads,
stream incoming data to bounded temporary storage while calculating the hash;
do not buffer large files in memory. `apps/chat-edit/server.js` demonstrates
that pattern.

## Turns and immutable edits

An ask is read-only:

```json
{
  "requestId": "question-1",
  "mode": "ask",
  "message": "Which answer is the strongest opening and why?"
}
```

An edit invokes one public agent:

```json
{
  "requestId": "captions-1",
  "mode": "edit",
  "agent": "timeline.captions",
  "baseEditId": "current-edit-id",
  "message": "Add readable transcript-aligned captions."
}
```

Agents fall into two groups:

- `source.work`, `source.generate`, and `planner.compile` publish artifacts but
  do not advance the timeline.
- `timeline.author`, `timeline.graphics`, `timeline.sound`, `timeline.titles`,
  and `timeline.captions` create immutable edit revisions.

A direct first `timeline.author` turn has no base. Once an edit exists, every
timeline revision must use the exact current `editId` as `baseEditId`.
Specialists other than Author always require a current base. A stale or missing
base returns `409 edit_conflict` and does not run the agent.

To build from a grounded plan, run `planner.compile`, then call
`timeline.author` with no `message` and no `baseEditId`. This creates a new root
revision from the current plan.

## Polling and idempotency

Turns and render handoffs are asynchronous. Poll with the last cursor you have
processed and stop only on `succeeded`, `failed`, or `cancelled`. Persist the
operation ID and cursor if the job must survive a process restart.

`requestId` is an idempotency key scoped to the session. Retrying the identical
canonical request with the same ID returns the original operation. Reusing the
ID with a changed body returns `409 idempotency_conflict`. Generate and persist
a new ID for every new instruction.

Only one mutation or operation may use a session at once. A concurrent attempt
returns retryable `409 server_busy`; queue work per session and retry with
bounded backoff.

## Snapshots and render handoffs

A public snapshot is a detached view of one edit revision. Open its `viewUrl`
immediately, then poll the returned hydration operation. Later private edits do
not update the snapshot, and manual changes in the public editor do not become
durable V2 revisions.

A render handoff is authenticated JSON using the independent
`scrambo.render-ir.v1` schema. Resolve uploaded media by `assetId` or SHA-256 and
verify the digest before rendering. Inspect `compatibility.unsupported` before
starting a render.

## Production checklist

- Authenticate your own users before exposing proxy routes.
- Map Scrambo sessions, assets, operations, and edit IDs to product records.
- Keep the partner credential in a server-side secret manager.
- Apply upload size/type limits, rate limiting, timeouts, and retention rules.
- Redact authorization headers and user media from logs and error telemetry.
- Queue mutations per session and use bounded retries.
- Reuse request IDs only for exact retries.
- Close sessions when the product workflow is finished.

For TypeScript-oriented signatures, read `shared/client.d.ts`. For a runnable
flow, start with `examples/basic-integration.mjs`.
