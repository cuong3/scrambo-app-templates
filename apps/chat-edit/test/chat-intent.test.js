import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUICK_ACTIONS,
  TRANSCRIBE_PROMPT,
  buildCommandsForMessage,
  compileMessage,
  friendlyHeadline,
  friendlyTag,
  parseWorkflowDsl,
  workflowPreview,
} from "../public/chat-intent.js";

test("an edit request before any transcription silently gets a transcribe step first", () => {
  const commands = buildCommandsForMessage("make it shorter", { hasTranscribed: false });
  assert.deepEqual(commands, [
    { bot: "Source", prompt: TRANSCRIBE_PROMPT, tools: ["transcribe"] },
    { bot: "Timeline", prompt: "make it shorter", tools: [] },
  ]);
});

test("an edit request after transcription is a single Timeline turn", () => {
  const commands = buildCommandsForMessage("make it shorter", { hasTranscribed: true });
  assert.deepEqual(commands, [{ bot: "Timeline", prompt: "make it shorter", tools: [] }]);
});

test("ask mode always routes to Planner and never prepends a transcribe step", () => {
  const commands = buildCommandsForMessage("what's the strongest moment?", { askMode: true, hasTranscribed: false });
  assert.deepEqual(commands, [{ bot: "Planner", prompt: "what's the strongest moment?", tools: [] }]);
});

test("blank or whitespace-only messages produce no commands", () => {
  assert.deepEqual(buildCommandsForMessage(""), []);
  assert.deepEqual(buildCommandsForMessage("   "), []);
});

test("friendly labels exist for every agent and fall back to the raw name otherwise", () => {
  assert.equal(friendlyHeadline("Source"), "Preparing your footage");
  assert.equal(friendlyHeadline("Timeline"), "Editing your video");
  assert.equal(friendlyHeadline("Planner"), "Thinking it through");
  assert.equal(friendlyTag("Source"), "Prepare");
  assert.equal(friendlyHeadline("Unknown"), "Unknown");
  assert.equal(friendlyHeadline("Source", "source.generate"), "Generating assets");
  assert.equal(friendlyTag("Source", "source.generate"), "Generate");
});

test("the workflow DSL maps generate blocks to source.generate with safe defaults", () => {
  const result = parseWorkflowDsl(`#generate
Create a narrated property tour.`);
  assert.equal(result.detected, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.commands[0].agent, "source.generate");
  assert.deepEqual(result.commands[0].tools, ["img2video", "voiceover"]);
  assert.equal(result.commands[0].budgetUsd, 5);
  assert.equal(result.commands[0].maxCalls, 4);
  assert.equal(workflowPreview(result.commands), "Generate assets");
});

test("the workflow DSL accepts unindented prompts and compiles specialist edit blocks", () => {
  const result = parseWorkflowDsl(`#prepare
Understand the footage.
Find the strongest moments.

#edit-graphics
Add a grid reveal.

#ask What did you change?`);
  assert.deepEqual(result, {
    detected: true,
    errors: [],
    commands: [
      { bot: "Source", prompt: "Understand the footage.\nFind the strongest moments.", tools: [] },
      { bot: "Timeline", agent: "timeline.graphics", prompt: "Add a grid reveal.", tools: [] },
      { bot: "Planner", prompt: "What did you change?", tools: [] },
    ],
  });
  assert.equal(workflowPreview(result.commands), "Prepare footage → Edit graphics → Ask Scrambo");
});

test("DSL validation rejects removed using lines and unknown specialist steps", () => {
  const result = parseWorkflowDsl(`#prepare
Analyze the footage.
using: masking

#edit-color
Make it blue.`);
  assert.equal(result.detected, true);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join(" "), /remove using/);
  assert.match(result.errors.join(" "), /not a supported workflow step/);
  assert.match(result.errors.join(" "), /start with #prepare/);
});

test("explicit DSL controls the exact workflow without implicit transcription", () => {
  const result = compileMessage(`#edit
Build an opening montage.`, { hasTranscribed: false });
  assert.deepEqual(result.commands, [{ bot: "Timeline", prompt: "Build an opening montage.", tools: [] }]);
});

test("templates keep tools in schema metadata and prompts contain no using lines", () => {
  assert.deepEqual(QUICK_ACTIONS.map(({ id }) => id), [
    "ai-listing-tour",
    "captions",
    "rich-captions",
    "cut-to-beat",
    "hook-sfx-grid",
    "mask-behind-effect",
  ]);
  for (const template of QUICK_ACTIONS) {
    assert.doesNotMatch(template.prompt, /^\s*using:/m, template.id);
    const result = compileMessage(template.prompt, { templateSteps: template.steps });
    assert.equal(result.detected, true, template.id);
    assert.deepEqual(result.errors, [], template.id);
    assert.ok(result.commands.length > 0, template.id);
  }
  const cutToBeat = QUICK_ACTIONS.find(({ id }) => id === "cut-to-beat");
  assert.deepEqual(compileMessage(cutToBeat.prompt, { templateSteps: cutToBeat.steps }).commands[0].tools, ["detect_beats"]);
  const maskBehind = QUICK_ACTIONS.find(({ id }) => id === "mask-behind-effect");
  assert.deepEqual(compileMessage(maskBehind.prompt, { templateSteps: maskBehind.steps }).commands[0].tools, ["masking"]);
  const richCaptions = QUICK_ACTIONS.find(({ id }) => id === "rich-captions");
  const richCommands = compileMessage(richCaptions.prompt, { templateSteps: richCaptions.steps }).commands;
  assert.deepEqual(richCommands[0].tools, ["transcribe"]);
  assert.equal(richCommands[1].agent, undefined);
  assert.match(richCommands[1].prompt, /full-screen phrase captions/);

  const listingTour = QUICK_ACTIONS.find(({ id }) => id === "ai-listing-tour");
  const listingCommands = compileMessage(listingTour.prompt, { templateSteps: listingTour.steps }).commands;
  assert.equal(listingCommands[0].agent, "source.generate");
  assert.deepEqual(listingCommands[0].tools, ["img2video", "voiceover"]);
  assert.deepEqual(listingCommands[0].toolConfig.voiceover, { vendor: "eleven_multilingual_v2" });
  assert.equal(listingCommands[0].toolConfig.img2video.duration, 6);
  assert.equal(listingCommands[0].budgetUsd, 5);
  assert.equal(listingCommands[0].maxCalls, 10);
  assert.deepEqual(listingCommands[1].tools, ["transcribe"]);
  assert.equal(listingCommands[2].agent, "timeline.captions");
});

test("requested specialist block types map to their Stateful Agent identifiers", () => {
  const result = parseWorkflowDsl(`#edit-captions
Add captions.

#edit-graphics
Add graphics.

#edit-sound
Add sound.

#edit-titles
Add titles.`);
  assert.deepEqual(result.commands.map(({ agent }) => agent), [
    "timeline.captions",
    "timeline.graphics",
    "timeline.sound",
    "timeline.titles",
  ]);
  assert.equal(friendlyHeadline("Timeline", "timeline.sound"), "Editing sound");
  assert.equal(friendlyTag("Timeline", "timeline.titles"), "Edit titles");
});
