# Scrambo Stateful API V2 examples

This repository is a small Node.js reference for integrating Scrambo's
stateful REST API into an application backend. Start with the one-file example,
then use one of the focused apps when your product needs a complete flow.

The central rule is simple: keep `SCRAMBO_API_TOKEN` on your server. Your
browser or mobile client should call your backend, and your backend should call
Scrambo.

```text
browser / mobile app
        │ your application's authenticated API
        ▼
your backend ── Bearer token ──► Scrambo Stateful API V2
        │
        └── persist sessionId, operationId, cursor, and editId
```

## Five-minute quickstart

Requirements: Node.js 22+, pnpm 11, a Scrambo partner token, and a video file.

```bash
pnpm install
export SCRAMBO_API_URL="https://api.scrambo.dev"
export SCRAMBO_API_TOKEN="replace-with-partner-token"
pnpm quickstart /path/to/video.mp4
```

[`examples/basic-integration.mjs`](examples/basic-integration.mjs) is the best
starting point. It creates a session, performs Scrambo's two-step verified
upload, runs Source Work, creates a root timeline edit, prints the IDs an
application would persist, and closes the session.

Creating a session replaces the current non-terminal session for the same
credential. Use a test credential and do not run the quickstart while another
workflow owned by that credential is active.

## Repository map

```text
examples/basic-integration.mjs  smallest complete backend workflow
shared/client.js                dependency-free Node REST client
shared/client.d.ts              optional TypeScript declarations
apps/chat-edit/                 full browser + backend sample
apps/magic-house-tour/          listing-photo generation + editing sample
apps/handoff-remotion/          optional render-handoff consumer
docs/integration-guide.md       API lifecycle and production guidance
SECURITY.md                     credential and sharing checklist
```

## What your backend must do

1. Create a session and associate its `sessionId` with your own user/project.
2. Hash each asset, declare its name/size/MIME/SHA-256, then upload the exact
   bytes to the returned `assetId`.
3. Submit an edit or ask turn with a unique, persisted `requestId`.
4. Poll the returned `operationId`, retaining the event cursor, until the
   operation succeeds, fails, or is cancelled.
5. Persist each successful timeline `editId`. Pass the current value as
   `baseEditId` for later timeline revisions.
6. Optionally create a hosted snapshot or renderer-neutral handoff, then close
   the private session according to your product lifecycle.

Use [`shared/client.js`](shared/client.js) directly in this workspace or copy it
into an existing Node backend. It has no runtime dependencies. See
[`docs/integration-guide.md`](docs/integration-guide.md) for endpoint semantics,
idempotency, polling, edit chaining, and production responsibilities.

## Run the richer examples

| Example | Purpose | Command |
| --- | --- | --- |
| `chat-edit` | Browser upload, chat workflows, hosted review, and handoff download | `pnpm --filter @scrambo/chat-edit start` |
| `magic-house-tour` | Listing photos → reviewed Veo/narration prompts → generated, captioned reel | `pnpm --filter @scrambo/magic-house-tour start` |
| `handoff-remotion` | Upload, caption, download a handoff, and render locally | `pnpm --filter @scrambo/handoff-remotion caption:v2 /path/to/video.mp4` |

The chat app reads its Scrambo token from the server environment; it never asks
the browser for the credential. Its README covers local and Fly configuration.

## Verify before sharing

```bash
pnpm verify
```

No real credential belongs in this repository. `.env`, private-key files,
rendered media, logs, and common build output are ignored. Review
[`SECURITY.md`](SECURITY.md) before publishing or transferring a copy.
