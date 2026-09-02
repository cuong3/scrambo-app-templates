import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAuthorTurn,
  buildCaptionsTurn,
  buildCreativeBriefPrompt,
  buildGenerateTurn,
  buildPlannerTurn,
  narrationEstimate,
  splitCreativeBrief,
} from "../public/tour-flow.js";

test("creative brief prompt grounds every uploaded filename and the house-tour guide", () => {
  const prompt = buildCreativeBriefPrompt(["front.jpg", "kitchen.png", "deck.webp"]);
  assert.match(prompt, /1\. front\.jpg/);
  assert.match(prompt, /2\. kitchen\.png/);
  assert.match(prompt, /3\. deck\.webp/);
  assert.match(prompt, /24mm rectilinear/);
  assert.match(prompt, /28mm/);
  assert.match(prompt, /warped architecture/);
  assert.match(prompt, /about 12 seconds/);
  assert.match(prompt, /<video_prompts>[\s\S]*<narration>/);
});

test("splits the editable Veo plan and narration from an ask answer", () => {
  const answer = `<video_prompts>\nfront.jpg\nSlow push in.\n</video_prompts>\n<narration>\nWelcome home.\n</narration>`;
  assert.deepEqual(splitCreativeBrief(answer), {
    videoPrompts: "front.jpg\nSlow push in.",
    narration: "Welcome home.",
    parsed: true,
  });

  assert.deepEqual(splitCreativeBrief("Unstructured answer"), {
    videoPrompts: "Unstructured answer",
    narration: "",
    parsed: false,
  });
});

test("estimates narration at 150 words per minute", () => {
  assert.deepEqual(narrationEstimate(""), { words: 0, seconds: 0 });
  assert.deepEqual(narrationEstimate("one two three four five"), { words: 5, seconds: 2 });
});

test("builds a single generation turn with both tools and one output per asset plus voiceover", () => {
  const turn = buildGenerateTurn({
    assetNames: ["front.jpg", "kitchen.jpg"],
    videoPrompts: "front.jpg: slow push\nkitchen.jpg: slow glide",
    narration: "Welcome home.",
    requestId: "generate-1",
  });
  assert.equal(turn.agent, "source.generate");
  assert.deepEqual(turn.tools, ["img2video", "voiceover"]);
  assert.equal(turn.maxCalls, 3);
  assert.equal(turn.budgetUsd, 5);
  assert.equal(turn.toolConfig.img2video.duration, 4);
  assert.equal(turn.toolConfig.img2video.aspectRatio, "16:9");
  assert.equal(turn.toolConfig.voiceover.vendor, "eleven_multilingual_v2");
  assert.match(turn.message, /APPROVED NARRATION — USE THIS TEXT VERBATIM\nWelcome home\./);
});

test("builds plan-backed author and chained captions turns", () => {
  const plan = buildPlannerTurn({ narration: "Welcome home.", photoCount: 2, requestId: "plan-1" });
  assert.equal(plan.agent, "planner.compile");
  assert.deepEqual(plan.tools, ["transcribe"]);
  assert.match(plan.message, /9:16/);

  assert.deepEqual(buildAuthorTurn("author-1"), {
    requestId: "author-1",
    mode: "edit",
    agent: "timeline.author",
  });
  const captions = buildCaptionsTurn("edit-1", "captions-1");
  assert.equal(captions.agent, "timeline.captions");
  assert.equal(captions.baseEditId, "edit-1");
});
