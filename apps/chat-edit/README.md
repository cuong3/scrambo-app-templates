# Scrambo Chat Edit

A dependency-free browser and Node.js sample for the Scrambo Stateful Agent API
V2. It covers session creation, streaming uploads, plain-language and templated
agent turns, progress polling, hosted edit review, and render-handoff download.

This is the richer product example. Start with
[`../../examples/basic-integration.mjs`](../../examples/basic-integration.mjs)
if you only need the core REST lifecycle.

## Run locally

Node.js 22 or newer is required. From the repository root:

```bash
pnpm install
export SCRAMBO_API_URL="https://api.scrambo.dev"
export SCRAMBO_API_TOKEN="replace-with-partner-token"
pnpm --filter @scrambo/chat-edit start
```

Open <http://127.0.0.1:4174>. The browser never receives or stores the Scrambo
credential; it calls this app's backend, which adds the bearer token upstream.
The backend sample does not implement end-user authentication, so add your own
auth and authorization before exposing it publicly.

Uploads are limited to 2 GiB by default, with at most two active uploads. See
`.env.example` for configurable limits and timeouts.

## Workflow

1. Create a private session for a project.
2. Upload one or more video, audio, or image files. The backend calculates the
   size and SHA-256 while streaming to temporary storage, then performs the
   declare/upload API sequence.
3. Describe an edit or customize the `#generate`, `#prepare`, `#edit`, and
   `#ask` workflow blocks. Specialist edit blocks cover captions, graphics,
   sound, and titles.
4. Open a detached hosted snapshot for review.
5. Download the `scrambo.render-ir.v1` handoff for a renderer such as the
   sibling `handoff-remotion` example.

## Deploy to Fly.io

The included image runs as a non-root user. Create an app, set the partner
credential as a Fly secret, and deploy from the repository root:

```bash
fly apps create your-chat-edit-name
fly secrets set SCRAMBO_API_TOKEN=replace-with-partner-token --app your-chat-edit-name
fly deploy --config apps/chat-edit/fly.toml --app your-chat-edit-name
```

The `fly.toml` deliberately omits an app name because names are globally
unique. Add application authentication before using a public deployment.

## Verify

```bash
pnpm --filter @scrambo/chat-edit check
pnpm --filter @scrambo/chat-edit test
```

Tests cover the workflow compiler, revision chaining, session recovery,
security headers, streaming upload limits, API proxy lifecycle, and server-side
credential forwarding. Browser DOM interactions and responsive layout are not
covered.
