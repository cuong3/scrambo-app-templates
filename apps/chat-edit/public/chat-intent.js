export const TRANSCRIBE_PROMPT = "Transcribe all spoken dialogue and understand this footage.";

const TEMPLATE_DEFINITIONS = [
  {
    id: "ai-listing-tour",
    label: "🏡 AI listing tour",
    description: "Generate architectural motion and narration, then cut and caption a listing tour.",
    steps: [
      {
        type: "generate",
        prompt: `Create a narrated 16:9 tour from the listing photos of this custom home. Turn the strongest stills into slow, low-motion 6-second push-ins (24mm interiors, 28mm exteriors) that preserve the exact architecture.

Write a warm, concise narration and produce a voiceover mp3 that walks a buyer from the front exterior through the kitchen and great room out to the deck and backyard.

Here's the listing description for reference:
[Paste the listing description here.]`,
        tools: ["img2video", "voiceover"],
        toolConfig: {
          img2video: {
            vendor: "veo-3.1-lite-generate-preview",
            resolution: "720p",
            duration: 6,
            aspectRatio: "16:9",
          },
          voiceover: { vendor: "eleven_multilingual_v2" },
        },
        budgetUsd: 5.0,
        maxCalls: 10,
      },
      {
        type: "edit",
        prompt: `Create a real-estate listing reel that matches the exact length of the voiceover audio file. Import or compute the voiceover transcript so section timing follows the narration's phrase boundaries. Cut on narration phrase boundaries with clean hard cuts, no dialogue other than the voiceover. If background music is used, keep it as a very low bed under the narration. All house videos should be muted.`,
        tools: ["transcribe"],
      },
      {
        type: "edit-captions",
        prompt: `Add transcript-aligned captions for the voiceover narration only, styled as a premium real-estate reel. Reveal one word at a time in sync with speech, and fade each word in as it appears.

Group words into short, sentence-aware phrases of at most three to four words per line, at most two lines on screen at once, centered horizontally in the lower third with generous side margins and tight, even line spacing so the block reads as one clean, compact unit.

Use a clean modern sans-serif, strong legibility with a subtle stroke or shadow so text stays readable over bright interiors and exteriors alike.

Most words are clean white; pick out a few key words per sentence and render just those in bold with a warm, saturated accent color so they pop.`,
      },
    ],
  },
  {
    id: "captions",
    label: "💬 Normal captions",
    description: "Transcribe the dialogue, then add clear captions.",
    steps: [
      {
        type: "prepare",
        prompt: "Transcribe all spoken dialogue and understand this footage.",
        tools: ["transcribe"],
      },
      {
        type: "edit",
        prompt: "Add clear, readable captions for all spoken dialogue.",
      },
    ],
  },
  {
    id: "rich-captions",
    label: "💬 Expressive captions",
    description: "Turn speech into expressive, full-screen phrase captions.",
    steps: [
      {
        type: "prepare",
        prompt: "Transcribe the speaker video. If a transcript JSON file is included, use it as the transcript source for the speaker video.",
        tools: ["transcribe"],
      },
      {
        type: "edit",
        prompt: `Create expressive, full-screen phrase captions instead of conventional subtitles.

Group the speech into phrases of 3–5 words. Reveal each word one at a time, building a complete poster-like composition that fills the screen.

Use large, staggered text with varied word sizes and tight spacing. Begin each phrase near the top or center, then arrange the remaining words creatively across the frame.

Style the text with a soft white color, a pink glow, and a subtle dark edge.`,
      },
    ],
  },
  {
    id: "cut-to-beat",
    label: "🥁 Cut to the beat",
    description: "Analyze a music track and build a beat-synced travel reel.",
    steps: [
      {
        type: "prepare",
        prompt: `Analyze all video clips against the music track. Treat the music as the fixed audio spine that determines the total duration.
Identify the strongest beats in the music.`,
        tools: ["detect_beats"],
      },
      {
        type: "edit",
        prompt: `Create a landscape 16:9 beat-synced travel reel. Sequence the clips into a sensible visual story.
Mix wide establishing shots with tighter detail shots to create a sense of place and immersion.
Land cuts on as many strong beats as possible.
Prefer short, fast cuts near the beginning and longer-paced cuts toward the end.`,
      },
    ],
  },
  {
    id: "hook-sfx-grid",
    label: "✨ Hook + SFX grid",
    description: "Build a rapid hook with a grid reveal, sound design, and title treatment.",
    steps: [
      {
        type: "edit",
        prompt: `Create a polished landscape 16:9 hook video, targeting roughly 3.5 seconds overall. Use actual source-video media throughout. Do not substitute stills, screenshots, frame exports, or raster title-card artwork. Mute all source videos.

Structure:
- Open: Use one continuous 1.5-second clip—the most beautiful, vibrant, aesthetic source shot.
- Fast montage: Follow with 1.5 seconds of visually distinct, energetic source clips, holding each shot for approximately 0.1 seconds.
- End: Finish on one continuous calm, visually uniform source-video clip for the remaining duration.`,
      },
      {
        type: "edit-graphics",
        prompt: `Add a grid reveal effect to the opening clip.
Cover it with black 3-by-3 grid lines approximately 3 pixels wide and nine separate opaque black rectangles.
Reveal one tile approximately every 0.1 seconds in this order: top-left, top-center, top-right, middle-right, bottom-right, bottom-center, bottom-left, middle-left, center.
Finish the last tile reveal 0.2 seconds before the opening clip ends. Each tile must be its own timeline overlay or graphic.`,
      },
      {
        type: "edit-sound",
        prompt: `Add a short UI click for every grid-tile removal and at the entry of every montage clip.
Start a riser with the first grid reveal; do not substitute a swoosh.
Place a soft punch with its transient precisely on the transition into the final calm clip.
Make all sound effects clearly audible.`,
      },
      {
        type: "edit-titles",
        prompt: `Add native title text above all visual tracks for the entire video. Do not generate title-card imagery, SVG title art, or rasterized text.
Use bright red typography near #E00000 with a stroke or shadow where needed for legibility.
Center a compact stacked composition: “Pov” as oversized flowing calligraphy with dramatic swashes; “ROASTING” beneath it in a heavy condensed all-caps serif; and a bottom row with “Jul” left-aligned, “2026” centered, and “batch” right-aligned in a small classic serif.
Register or load the fonts, measure and position the native text precisely, and visually verify the opening typography.`,
      },
    ],
  },
  {
    id: "mask-behind-effect",
    label: "✨ Mask-behind card",
    description: "Place a glowing video card behind a speaker with a timed pop effect.",
    steps: [
      {
        type: "edit",
        prompt: `Create a vertical 9:16 vlog-style video using the speaker clip.
Compute a mask for the speaker from 3 seconds to 5 seconds.
At 3 seconds, place the “travel clips window mp4” clip behind the speaker's head as a glowing pop-in video-card effect.`,
        tools: ["masking"],
      },
      {
        type: "edit-sound",
        prompt: "Add a loud pop sound effect exactly when the video card appears. Make it louder than the source-video audio.",
      },
    ],
  },
];

export function serializeWorkflow(steps) {
  return steps.map((step) => `#${step.type}\n${String(step.prompt ?? "").trim()}`).join("\n\n");
}

export const QUICK_ACTIONS = TEMPLATE_DEFINITIONS.map((template) => ({
  ...template,
  prompt: serializeWorkflow(template.steps),
}));

const BLOCK_TYPES = {
  prepare: { bot: "Source" },
  generate: {
    bot: "Source",
    agent: "source.generate",
    tools: ["img2video", "voiceover"],
    toolConfig: {
      img2video: {
        vendor: "veo-3.1-lite-generate-preview",
        resolution: "720p",
        duration: 4,
        aspectRatio: "16:9",
      },
    },
    budgetUsd: 5.0,
    maxCalls: 4,
  },
  edit: { bot: "Timeline", agent: "timeline.author" },
  "edit-captions": { bot: "Timeline", agent: "timeline.captions" },
  "edit-graphics": { bot: "Timeline", agent: "timeline.graphics" },
  "edit-sound": { bot: "Timeline", agent: "timeline.sound" },
  "edit-titles": { bot: "Timeline", agent: "timeline.titles" },
  ask: { bot: "Planner" },
};

const HEADER = /^#(prepare|generate|edit|ask|edit-[a-z-]+)(?:\s+(.*))?$/i;

function normalizePrompt(lines) {
  const content = lines.slice();
  while (content[0] !== undefined && !content[0].trim()) content.shift();
  while (content.at(-1) !== undefined && !content.at(-1).trim()) content.pop();
  const nonblank = content.filter((line) => line.trim());
  if (nonblank.length && nonblank.every((line) => line.startsWith("  "))) {
    return content.map((line) => line.startsWith("  ") ? line.slice(2) : line).join("\n").trim();
  }
  return content.join("\n").trim();
}

function commandsForBlocks(blocks, templateSteps) {
  return blocks.map((block, index) => {
    const definition = BLOCK_TYPES[block.type];
    const metadata = templateSteps[index]?.type === block.type ? templateSteps[index] : null;
    const options = { ...definition, ...(metadata ?? {}) };
    return {
      bot: definition.bot,
      prompt: block.prompt,
      tools: options.tools?.slice() ?? [],
      ...(options.agent && options.agent !== "timeline.author" ? { agent: options.agent } : {}),
      ...(options.toolConfig ? { toolConfig: structuredClone(options.toolConfig) } : {}),
      ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
      ...(options.maxCalls !== undefined ? { maxCalls: options.maxCalls } : {}),
      ...(options.name ? { name: options.name } : {}),
    };
  });
}

/**
 * Parse the customer-facing workflow DSL. Headers stay at the left edge, and
 * every line until the next recognized header is ordinary prompt text.
 */
export function parseWorkflowDsl(value, { templateSteps = [] } = {}) {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = text.split("\n");
  const detected = lines.some((line) => HEADER.test(line));
  if (!detected) return { detected: false, commands: [], errors: [] };

  const blocks = [];
  const errors = [];
  let block = null;

  const finishBlock = () => {
    if (!block) return;
    block.prompt = normalizePrompt(block.promptLines);
    if (!block.prompt) errors.push(`Line ${block.line}: ${block.type}: needs an instruction.`);
    blocks.push(block);
    block = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const header = line.match(HEADER);
    if (header) {
      finishBlock();
      const type = header[1].toLowerCase();
      if (!BLOCK_TYPES[type]) {
        errors.push(`Line ${lineNumber}: “#${type}” is not a supported workflow step.`);
        continue;
      }
      block = { type, line: lineNumber, promptLines: header[2] ? [header[2]] : [] };
      continue;
    }
    if (/^\s*using:/i.test(line)) {
      errors.push(`Line ${lineNumber}: remove using:. Templates select tools automatically.`);
      continue;
    }
    if (!block) {
      if (line.trim()) errors.push(`Line ${lineNumber}: start with #prepare, #generate, #edit, #edit-captions, #edit-graphics, #edit-sound, #edit-titles, or #ask.`);
      continue;
    }
    block.promptLines.push(line);
  }

  finishBlock();
  return { detected: true, commands: commandsForBlocks(blocks, templateSteps), errors };
}

/** Compile either explicit DSL or ordinary chat. Plain edits retain automatic transcription. */
export function compileMessage(text, { askMode = false, hasTranscribed = false, templateSteps = [] } = {}) {
  const prompt = String(text ?? "").trim();
  if (!prompt) return { detected: false, commands: [], errors: [] };
  const workflow = parseWorkflowDsl(prompt, { templateSteps });
  if (workflow.detected) return workflow;
  if (askMode) return { detected: false, commands: [{ bot: "Planner", prompt, tools: [] }], errors: [] };
  const commands = [];
  if (!hasTranscribed) commands.push({ bot: "Source", prompt: TRANSCRIBE_PROMPT, tools: ["transcribe"] });
  commands.push({ bot: "Timeline", prompt, tools: [] });
  return { detected: false, commands, errors: [] };
}

export function buildCommandsForMessage(text, options = {}) {
  return compileMessage(text, options).commands;
}

const AGENT_COPY = {
  "timeline.author": { preview: "Edit video", headline: "Editing your video", tag: "Edit" },
  "timeline.captions": { preview: "Edit captions", headline: "Editing captions", tag: "Edit captions" },
  "timeline.graphics": { preview: "Edit graphics", headline: "Editing graphics", tag: "Edit graphics" },
  "timeline.sound": { preview: "Edit sound", headline: "Editing sound", tag: "Edit sound" },
  "timeline.titles": { preview: "Edit titles", headline: "Editing titles", tag: "Edit titles" },
};

export function workflowPreview(commands) {
  return commands.map((command) => {
    if (command.bot === "Source") return command.agent === "source.generate" ? "Generate assets" : "Prepare footage";
    if (command.bot === "Planner") return "Ask Scrambo";
    return AGENT_COPY[command.agent ?? "timeline.author"]?.preview ?? "Edit video";
  }).join(" → ");
}

export function friendlyHeadline(bot, agent = null) {
  if (bot === "Source") return agent === "source.generate" ? "Generating assets" : "Preparing your footage";
  if (bot === "Planner") return "Thinking it through";
  if (bot === "Timeline") return AGENT_COPY[agent ?? "timeline.author"]?.headline ?? "Editing your video";
  return bot;
}

export function friendlyTag(bot, agent = null) {
  if (bot === "Source") return agent === "source.generate" ? "Generate" : "Prepare";
  if (bot === "Planner") return "Ask";
  if (bot === "Timeline") return AGENT_COPY[agent ?? "timeline.author"]?.tag ?? "Edit";
  return bot;
}
