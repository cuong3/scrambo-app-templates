export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 6;
export const GENERATION_BUDGET_USD = 5;

const SHARED_NEGATIVE_PROMPT = [
  "warped architecture", "bending walls", "shifting cabinets", "incorrect reflections",
  "changing windows", "changing doors", "duplicated fixtures", "added objects", "removed objects",
  "moving furniture", "people", "animals", "vehicles appearing", "fisheye distortion",
  "camera shake", "handheld jitter", "sudden acceleration", "fast pan", "dramatic orbit",
  "focus hunting", "exposure flicker", "lighting changes", "morphing", "scene transformation",
].join(", ");

export function buildCreativeBriefPrompt(assetNames) {
  const inventory = assetNames.map((name, index) => `${index + 1}. ${name}`).join("\n");
  return `You are preparing a polished vertical real-estate listing tour from uploaded still photos.

Uploaded photos, in the user's preferred tour order:
${inventory}

Inspect every photo and write exactly one Google Veo image-to-video prompt per filename. Each clip is a single continuous 4-second professional real-estate shot. Use one slow primary camera motion and at most one tiny secondary motion. Use 24mm rectilinear lens language for interiors and 28mm for exteriors, with deep focus, straight architectural lines, constant exposure, slow gimbal movement, and realistic lighting. Preserve the exact architecture, layout, fixtures, landscaping, perspective, and scene geometry. Do not invent features. Prefer a slow push-in for front exteriors, forward walkthrough for side yards, diagonal approach for backyards, sideways slider for decks, and slow push-in for interiors when appropriate.

Append this negative prompt to every shot: ${SHARED_NEGATIVE_PROMPT}.

Also write one warm, concise narration for the complete tour. It should follow the photos in order, avoid unsupported property claims, sound natural when spoken, and fit the combined footage duration (about ${assetNames.length * 4} seconds at roughly 150 words per minute).

Return only these two tagged blocks, with no code fence or extra commentary:
<video_prompts>
For each photo: filename on its own line, followed by its complete Veo prompt.
</video_prompts>
<narration>
The narration script only.
</narration>`;
}

function taggedBlock(answer, tag) {
  const match = String(answer ?? "").match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export function splitCreativeBrief(answer) {
  const videoPrompts = taggedBlock(answer, "video_prompts");
  const narration = taggedBlock(answer, "narration");
  return {
    videoPrompts: videoPrompts || String(answer ?? "").trim(),
    narration,
    parsed: Boolean(videoPrompts && narration),
  };
}

export function narrationEstimate(text) {
  const words = String(text ?? "").trim().match(/\S+/g)?.length ?? 0;
  return { words, seconds: words === 0 ? 0 : Math.ceil(words / 2.5) };
}

export function buildGenerateTurn({ assetNames, videoPrompts, narration, requestId }) {
  const prompt = `Create the approved media for one vertical real-estate listing tour.

Uploaded photos, in final tour order:
${assetNames.map((name, index) => `${index + 1}. ${name}`).join("\n")}

APPROVED VEO SHOT PLAN
${videoPrompts.trim()}

APPROVED NARRATION — USE THIS TEXT VERBATIM
${narration.trim()}

Call img2video once with a batch containing exactly one shot per uploaded photo. Match each shot to its named uploaded photo as the first frame; do not invent or reuse a different seed image. Use the approved prompt for that photo. Then call voiceover exactly once using the approved narration verbatim and a warm, natural voice suitable for a premium property tour. Do not rewrite, summarize, or add to the narration. After generation, inspect every generated video contact sheet and write one complete SourceBrief v2 selecting all generated video clips in tour order plus the generated voiceover as narration.`;

  return {
    requestId,
    mode: "edit",
    agent: "source.generate",
    message: prompt,
    tools: ["img2video", "voiceover"],
    toolConfig: {
      img2video: {
        vendor: "veo-3.1-fast-generate-preview",
        resolution: "720p",
        duration: 4,
        aspectRatio: "16:9",
      },
      voiceover: { vendor: "eleven_multilingual_v2" },
    },
    budgetUsd: GENERATION_BUDGET_USD,
    maxCalls: assetNames.length + 1,
    name: "magic-house-tour-assets",
  };
}

export function buildPlannerTurn({ narration, photoCount, requestId }) {
  return {
    requestId,
    mode: "edit",
    agent: "planner.compile",
    message: `Plan a polished 9:16 real-estate listing reel from the current generated SourceBrief. The generated voiceover is the narrative spine and sets the exact total duration. Import or compute its transcript so section timing follows narration phrase boundaries. Use all ${photoCount} generated house clips in the approved tour order, selecting their clearest moments and cutting cleanly on narration phrase boundaries. Mute all video-source audio. Keep important architecture visible and reserve the lower third for captions. Use clean hard cuts and no unsupported title cards. Approved narration:\n\n${narration.trim()}`,
    tools: ["transcribe"],
  };
}

export function buildAuthorTurn(requestId) {
  return {
    requestId,
    mode: "edit",
    agent: "timeline.author",
  };
}

export function buildCaptionsTurn(baseEditId, requestId) {
  return {
    requestId,
    mode: "edit",
    agent: "timeline.captions",
    baseEditId,
    message: `Add transcript-aligned captions for the generated voiceover only. Reveal one word at a time in sync with speech using clean fades, never pops, bounces, or scale-ins. Group words into short sentence-aware phrases of at most three to four words per line and no more than two lines. Center the compact block in the lower third with generous margins. Use a modern sans-serif, strong white text with a subtle shadow or stroke, and a warm saturated accent on only a few important room or feature words. Keep captions inside safe margins and clear of important architecture.`,
  };
}
