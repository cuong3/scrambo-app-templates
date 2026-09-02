import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMMAND_CHARACTER_LIMIT,
  CommandWorkflow,
  addCommand,
  buildTurnBody,
  commandToolSummary,
  composerCopy,
  createCommand,
  moveCommand,
  parseCommandText,
  removeCommand,
  toggleCommandTool,
  validateCommand,
  validateCommands,
} from "../public/command-chain.js";

function ids() {
  let next = 0;
  return () => `command-${++next}`;
}

test("single-command parsing and V2 bodies remain backward compatible", () => {
  const parsed = parseCommandText("@Source Understand the footage", { idFactory: ids() });
  assert.equal(parsed.detected, true);
  assert.deepEqual(parsed.commands.map(({ id: _id, ...command }) => command), [
    { bot: "Source", prompt: "Understand the footage", tools: [] },
  ]);
  const body = buildTurnBody({ ...parsed.commands[0], tools: ["transcribe"] }, {
    requestId: (label) => `${label}-request`,
  });
  assert.deepEqual(body, {
    requestId: "source-request",
    mode: "edit",
    agent: "source.work",
    message: "Understand the footage",
    tools: ["transcribe"],
  });
});

test("specialist Timeline agents survive workflow normalization and reach V2 bodies", () => {
  const command = createCommand({
    bot: "Timeline",
    agent: "timeline.captions",
    prompt: "Add captions",
  }, ids());
  assert.equal(command.agent, "timeline.captions");
  assert.deepEqual(buildTurnBody(command, {
    editId: "edit-current",
    requestId: (label) => `${label}-request`,
  }), {
    requestId: "timeline-request",
    mode: "edit",
    agent: "timeline.captions",
    message: "Add captions",
    baseEditId: "edit-current",
  });
});

test("source.generate metadata survives normalization and reaches the V2 body", () => {
  const command = createCommand({
    bot: "Source",
    agent: "source.generate",
    prompt: "Create a narrated listing tour",
    tools: ["img2video", "voiceover", "transcribe"],
    toolConfig: {
      img2video: { vendor: "veo-3.1-lite-generate-preview", resolution: "720p", duration: 6, aspectRatio: "16:9" },
      voiceover: { vendor: "eleven_multilingual_v2" },
      transcribe: { model: "not-allowed" },
    },
    budgetUsd: 5,
    maxCalls: 10,
  }, ids());
  assert.deepEqual(command.tools, ["img2video", "voiceover"]);
  assert.deepEqual(buildTurnBody(command, {
    editId: "edit-must-not-be-sent",
    requestId: (label) => `${label}-request`,
  }), {
    requestId: "source-request",
    mode: "edit",
    agent: "source.generate",
    message: "Create a narrated listing tour",
    tools: ["img2video", "voiceover"],
    toolConfig: {
      img2video: { vendor: "veo-3.1-lite-generate-preview", resolution: "720p", duration: 6, aspectRatio: "16:9" },
      voiceover: { vendor: "eleven_multilingual_v2" },
    },
    budgetUsd: 5,
    maxCalls: 10,
  });
});

test("typed and pasted recognized agent lines become ordered commands", () => {
  const typed = parseCommandText("Find the best moments\n@Planner Plan a 30-second cut", {
    fallbackBot: "Source",
    idFactory: ids(),
  });
  assert.deepEqual(typed.commands.map(({ bot, prompt }) => ({ bot, prompt })), [
    { bot: "Source", prompt: "Find the best moments" },
    { bot: "Planner", prompt: "Plan a 30-second cut" },
  ]);

  const pasted = parseCommandText(`@Source Transcribe everything
and identify speakers
@Planner Choose a story arc
@Timeline Build the first cut`, { idFactory: ids() });
  assert.deepEqual(pasted.commands.map(({ bot, prompt }) => ({ bot, prompt })), [
    { bot: "Source", prompt: "Transcribe everything\nand identify speakers" },
    { bot: "Planner", prompt: "Choose a story arc" },
    { bot: "Timeline", prompt: "Build the first cut" },
  ]);
});

test("ordinary multiline prose stays in one command", () => {
  const text = "Use the first interview.\nThen bring in the wide shot.\nKeep this as one prompt.";
  const parsed = parseCommandText(text, { fallbackBot: "Timeline", idFactory: ids() });
  assert.equal(parsed.detected, false);
  assert.equal(parsed.commands.length, 1);
  assert.equal(parsed.commands[0].bot, "Timeline");
  assert.equal(parsed.commands[0].prompt, text);
});

test("tools are command-local and empty tool states are explicit", () => {
  const source = createCommand({ id: "source", bot: "Source", prompt: "Analyze" });
  const timeline = createCommand({ id: "timeline", bot: "Timeline", prompt: "Edit" });
  let commands = toggleCommandTool([source, timeline], "source", "transcribe");
  assert.deepEqual(commands[0].tools, ["transcribe"]);
  assert.deepEqual(commands[1].tools, []);
  commands = toggleCommandTool(commands, "timeline", "detect_beats");
  assert.deepEqual(commands[0].tools, ["transcribe"]);
  assert.deepEqual(commands[1].tools, ["detect_beats"]);
  assert.equal(commandToolSummary(createCommand({ bot: "Timeline" })), "Tools: none");
  assert.equal(commandToolSummary(createCommand({ bot: "Planner" })), "Tools: none · session context automatic");
});

test("commands can be added, removed, and reordered", () => {
  const makeId = ids();
  let commands = [createCommand({ bot: "Source", prompt: "One" }, makeId)];
  commands = addCommand(commands, { bot: "Planner", prompt: "Two" }, makeId);
  commands = addCommand(commands, { bot: "Timeline", prompt: "Three" }, makeId);
  commands = moveCommand(commands, commands[2].id, -1);
  assert.deepEqual(commands.map((command) => command.bot), ["Source", "Timeline", "Planner"]);
  commands = removeCommand(commands, commands[1].id, makeId);
  assert.deepEqual(commands.map((command) => command.bot), ["Source", "Planner"]);
  commands = removeCommand(removeCommand(commands, commands[0].id, makeId), commands[1].id, makeId);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].bot, null);
});

test("workflow executes sequentially and chains the newest Timeline edit", async () => {
  const bodies = [];
  const commands = [
    createCommand({ bot: "Timeline", prompt: "First cut" }),
    createCommand({ bot: "Planner", prompt: "Check pacing" }),
    createCommand({ bot: "Timeline", prompt: "Tighten it" }),
  ];
  const workflow = new CommandWorkflow(commands, {
    initialEditId: "edit-base",
    executeStep: async (command, context) => {
      bodies.push(buildTurnBody(command, {
        editId: context.editId,
        requestId: (label) => `${label}-${bodies.length + 1}`,
      }));
      if (command.bot === "Timeline") return { type: "edit", editId: bodies.length === 1 ? "edit-first" : "edit-newest" };
      return { type: "answer", answer: "Looks good" };
    },
  });
  const result = await workflow.run();
  assert.deepEqual(bodies.map((body) => body.baseEditId), ["edit-base", undefined, "edit-first"]);
  assert.deepEqual(result.steps.map((step) => step.status), ["Complete", "Complete", "Complete"]);
  assert.equal(result.editId, "edit-newest");
});

test("workflow pauses, retries the failed step, and can continue", async () => {
  let failedOnce = false;
  const calls = [];
  const workflow = new CommandWorkflow([
    createCommand({ bot: "Source", prompt: "Analyze" }),
    createCommand({ bot: "Timeline", prompt: "Edit" }),
    createCommand({ bot: "Planner", prompt: "Review" }),
  ], {
    executeStep: async (_command, { index }) => {
      calls.push(index);
      if (index === 1 && !failedOnce) {
        failedOnce = true;
        throw Object.assign(new Error("Temporary failure"), { code: "temporary" });
      }
      return { type: "answer", answer: "ok" };
    },
  });
  let result = await workflow.run();
  assert.deepEqual(result.steps.map((step) => step.status), ["Complete", "Failed", "Waiting"]);
  assert.equal(result.paused, true);
  assert.deepEqual(workflow.remainingCommands().map((command) => command.bot), ["Timeline", "Planner"]);
  result = await workflow.retry();
  assert.deepEqual(result.steps.map((step) => step.status), ["Complete", "Complete", "Complete"]);
  assert.deepEqual(calls, [0, 1, 1, 2]);
});

test("stopping a paused workflow never skips to waiting commands", async () => {
  const calls = [];
  const workflow = new CommandWorkflow([
    createCommand({ bot: "Source", prompt: "Fail" }),
    createCommand({ bot: "Planner", prompt: "Must not run" }),
  ], {
    executeStep: async (_command, { index }) => {
      calls.push(index);
      throw new Error("Nope");
    },
  });
  await workflow.run();
  assert.equal(workflow.stop(), true);
  const result = await workflow.run();
  assert.deepEqual(calls, [0]);
  assert.equal(result.stopped, true);
  assert.equal(result.steps[1].status, "Waiting");
});

test("help note, button copy, validation, and character limits are dynamic", () => {
  const one = [createCommand({ bot: "Source", prompt: "Analyze" })];
  assert.deepEqual(composerCopy(one), {
    button: "Send",
    helpTitle: "How to chat",
    helpText: "Start with an @mention, choose tools, then write the prompt.",
  });
  const two = [...one, createCommand({ bot: "Planner", prompt: "Plan" })];
  assert.equal(composerCopy(two).button, "Run 2-command workflow");
  assert.equal(composerCopy(two).helpTitle, "How command chains work");
  assert.deepEqual(validateCommands(two), []);
  assert.match(validateCommand(createCommand({ bot: "Source", prompt: "" })), /Write a prompt/);
  assert.match(validateCommand(createCommand({ bot: "Source", prompt: "x".repeat(COMMAND_CHARACTER_LIMIT + 1) })), /limit is 20,000/);
});
