# Shared Scrambo client

`@scrambo/shared` is the small server-side reference client used by every app
in this repository. It is intentionally framework-free and dependency-free so
a product team can read it, copy it, and adapt it quickly.

It requires Node.js 22 or newer. Do not import it into browser code: a Scrambo
API key is a server credential.

## Configure a client

```js
import { ScramboClient } from "@scrambo/shared";

const client = new ScramboClient({
  apiUrl: process.env.SCRAMBO_API_URL ?? "https://api.scrambo.dev",
  token: process.env.SCRAMBO_API_TOKEN,
});
```

`ScramboClient.fromEnv()` provides the same setup using
`SCRAMBO_API_URL` and `SCRAMBO_API_TOKEN`.

If your backend selects a credential for each tenant, construct a client per
request or use `client.withToken(token)`. Do not accept an arbitrary API key
from an unauthenticated request.

## Client layers

Use `ScramboClient` when your application stores its own session, asset, edit,
and operation records. Its methods are thin wrappers around Stateful API V2.

Use `StatefulSession` for local scripts and simple background jobs. It remembers
the current edit and chains subsequent editing agents from that revision.

## Upload flow

Scrambo uploads have two steps:

1. Calculate the byte size and SHA-256 digest, then declare the asset.
2. Upload exactly those bytes to the returned asset ID.

```js
import { readFile } from "node:fs/promises";
import { ScramboClient, sha256Hex } from "@scrambo/shared";

const bytes = await readFile("./clip.mp4");
const asset = await client.declareAsset(sessionId, {
  name: "clip.mp4",
  size: bytes.byteLength,
  mimeType: "video/mp4",
  sha256: sha256Hex(bytes),
});

await client.uploadAssetContent(sessionId, asset.assetId, bytes, {
  mimeType: "video/mp4",
  size: bytes.byteLength,
});
```

For large or user-provided files, do not buffer them in memory. The web apps
demonstrate a bounded streaming approach using temporary storage.

## Asynchronous operations

Turns and render-handoff creation return an operation ID. Poll it directly if
your product already has a job runner:

```js
const operation = await client.getOperation(operationId, lastCursor);
```

Or use the convenience poller:

```js
const result = await client.pollOperation(operationId, {
  intervalMs: 1000,
  signal: abortController.signal,
  onEvent: (event) => publishProgress(event),
});
```

Persist operation IDs and cursors if work must survive a process restart.

## Errors

Failed requests throw `ScramboApiError`:

```js
import { ScramboApiError } from "@scrambo/shared";

try {
  await client.getSession(sessionId);
} catch (error) {
  if (error instanceof ScramboApiError) {
    console.error(error.status, error.code, error.message, error.retryable);
  }
  throw error;
}
```

Network failures and timeouts are normalized to the same error type. Use
bounded retries with backoff only for operations that are safe to retry, and
reuse the original request ID for retried mutations.

## Copying the client

For a JavaScript backend, copy `client.js`. For TypeScript editor support, copy
`client.d.ts` beside it. The code has no runtime dependencies outside Node.js.

This package is private because it is a reference client inside the examples
repository. If it becomes an independently versioned public SDK, move it to a
dedicated repository and add compatibility, release, and support policies.
