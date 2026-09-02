# Scrambo Magic House Tour

<img src="../assets/housetour.png" alt="Magic House Tour UI" width="480">

A focused browser and Node.js demo for the Scrambo Stateful Agent API V2. It
turns 2–6 listing photos into a narrated, captioned vertical reel while keeping
the paid generation step behind a human review gate.

## Run locally

Node.js 22 or newer is required. From the repository root:

```bash
pnpm install
export SCRAMBO_API_URL="https://api.scrambo.dev"
export SCRAMBO_API_TOKEN="replace-with-partner-token"
pnpm --filter @scrambo/magic-house-tour start
```

Open <http://127.0.0.1:4175>. The Scrambo credential stays in the Node server;
the browser only calls same-origin proxy routes. This sample does not include
end-user authentication, so add application auth before deploying it publicly.

## Workflow

1. The browser previews and orders 2–6 JPEG, PNG, or WebP listing photos.
2. The backend creates a private 1080×1920 V2 session and streams each photo
   through Scrambo's declared SHA-256 upload flow.
3. One read-only `ask` turn inspects the photos and returns editable Veo shot
   prompts plus a narration draft and duration estimate.
4. After approval, one `source.generate` turn receives both drafts and the
   `img2video` and `voiceover` capabilities. The demo pins 4-second 720p Veo
   clips, 16:9 generated footage, ElevenLabs narration, a $5 spend cap, and one
   output per photo plus one voiceover.
5. `planner.compile` transcribes the generated voiceover, a plan-backed
   `timeline.author` turn assembles the vertical reel, and
   `timeline.captions` adds the final caption revision.
6. The finished screen opens a detached Scrambo editor snapshot for review.

The prompts in `public/tour-flow.js` distill the architecture-preserving motion
guidance from the Kim13430 real-estate prompting guide into the runnable demo;
the app does not depend on that external file at runtime.

## Verify

```bash
pnpm --filter @scrambo/magic-house-tour check
pnpm --filter @scrambo/magic-house-tour test
```

Tests cover prompt/result shaping, narration timing, generation controls,
timeline revision chaining, upload validation, server-side credential
forwarding, operation polling, snapshots, and session closing.
