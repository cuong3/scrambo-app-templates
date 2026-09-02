# Scrambo Handoff Remotion

Generic Remotion interpreter for `scrambo.render-ir.v1` handoffs using the
`scrambo-remotion-scene-v1` profile.

```bash
pnpm install
pnpm --filter @scrambo/handoff-remotion render /path/to/render_handoff.json /path/to/output.mp4
```

`render.mjs` verifies every media SHA-256, stages media and fonts into a
temporary Remotion public directory, selects composition metadata from the
handoff, renders H.264/AAC, and removes only its temporary staging directory.

## Stateful V2 upload, caption, handoff, and render

Run the full local-first workflow against Scrambo Cloud:

```bash
export SCRAMBO_API_URL="https://api.scrambo.dev"
export SCRAMBO_API_TOKEN="replace-with-partner-token"
pnpm --filter @scrambo/handoff-remotion caption:v2 /path/to/interview.mp4
```

The script uploads each local file, runs Source Work, Author, and Captions,
downloads the authenticated render handoff, closes the cloud session, and asks
Remotion to render it. The two final artifacts are colocated here:

```text
output/render_handoff.json
output/render_handoff.mp4
```

Local paths stay in the Node process. The cloud handoff contains only the V2
upload asset ID, SHA-256, byte size, and MIME type. `render-scrambo.mjs` resolves
the asset from the session's local maps and verifies its size and SHA-256 before
staging it into Remotion's temporary public directory.
