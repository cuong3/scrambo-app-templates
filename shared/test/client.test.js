import assert from "node:assert/strict";
import { test } from "node:test";

import { ScramboApiError, ScramboClient, StatefulSession } from "../client.js";

test("builds authenticated Stateful API requests", async () => {
  const calls = [];
  const client = new ScramboClient({
    apiUrl: "https://api.example.test/",
    token: "secret",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ sessionId: "sess_123", currentEditId: null, state: "open" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  await client.createSession({ project: "demo" });
  assert.equal(calls[0].url, "https://api.example.test/v2/sessions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].init.body, JSON.stringify({ project: "demo" }));
});

test("normalizes API error envelopes", async () => {
  const client = new ScramboClient({
    token: "secret",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "bad_turn", message: "Turn is invalid.", retryable: false },
    }), { status: 422, headers: { "Content-Type": "application/json" } }),
  });

  await assert.rejects(
    () => client.submitTurn("sess_123", {}),
    (error) => error instanceof ScramboApiError
      && error.status === 422
      && error.code === "bad_turn"
      && error.retryable === false,
  );
});

test("polls until an operation succeeds and forwards progress", async () => {
  const events = [];
  const responses = [
    { operationId: "op_123", status: "running", cursor: 1, events: [{ cursor: 1, message: "Working" }], result: null },
    { operationId: "op_123", status: "succeeded", cursor: 2, events: [{ cursor: 2, message: "Done" }], result: { type: "edit", editId: "edit_123" } },
  ];
  const client = new ScramboClient({
    token: "secret",
    fetchImpl: async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  const result = await client.pollOperation("op_123", {
    intervalMs: 0,
    onEvent: (event) => events.push(event.message),
  });
  assert.deepEqual(result, { type: "edit", editId: "edit_123" });
  assert.deepEqual(events, ["Working", "Done"]);
});

test("StatefulSession chains edits from the latest revision", async () => {
  const turns = [];
  const results = [
    { type: "source", editId: null },
    { type: "edit", editId: "edit_1" },
    { type: "edit", editId: "edit_2" },
  ];
  const client = {
    async submitTurn(_sessionId, turn) {
      turns.push(turn);
      return { operationId: `op_${turns.length}`, status: "queued" };
    },
    async pollOperation() {
      return results.shift();
    },
  };
  const session = new StatefulSession(client, {
    sessionId: "sess_123",
    currentEditId: null,
    state: "open",
  });

  await session.edit({ agent: "source.work", message: "Inspect" });
  await session.edit({ agent: "timeline.author", message: "Make a cut" });
  await session.edit({ agent: "timeline.captions", message: "Add captions" });

  assert.equal(turns[0].baseEditId, undefined);
  assert.equal(turns[1].baseEditId, undefined);
  assert.equal(turns[2].baseEditId, "edit_1");
  assert.equal(session.currentEditId, "edit_2");
});

test("StatefulSession forwards V2 generation limits without an edit base", async () => {
  let submitted;
  const client = {
    async submitTurn(_sessionId, turn) {
      submitted = turn;
      return { operationId: "op_generate", status: "queued" };
    },
    async pollOperation() {
      return { type: "source", agent: "source.generate", editId: "edit_existing" };
    },
  };
  const session = new StatefulSession(client, {
    sessionId: "sess_123",
    currentEditId: "edit_existing",
    state: "open",
  });

  await session.edit({
    agent: "source.generate",
    message: "Generate a narrated introduction.",
    tools: ["img2video", "voiceover"],
    budgetUsd: 4,
    maxCalls: 3,
    name: "introduction-assets",
  });

  assert.equal(submitted.baseEditId, undefined);
  assert.equal(submitted.budgetUsd, 4);
  assert.equal(submitted.maxCalls, 3);
  assert.equal(submitted.name, "introduction-assets");
});
