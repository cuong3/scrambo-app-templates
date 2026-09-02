import assert from "node:assert/strict";
import { test } from "node:test";

import { findStoredSessionIds, sessionDialogCopy } from "../public/session-lifecycle.js";

function storage(entries) {
  const values = new Map(entries);
  return {
    get length() { return values.size; },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
  };
}

test("finds the active pointer first and recovers session IDs from conversation keys", () => {
  const result = findStoredSessionIds(storage([
    ["scrambo-transcript-session", "sess_current"],
    ["scrambo-transcript-messages-sess_lost", "[]"],
    ["scrambo-transcript-messages-not-a-session", "[]"],
    ["unrelated", "sess_ignored"],
  ]));
  assert.deepEqual(result, ["sess_current", "sess_lost"]);
});

test("new-session confirmation clearly distinguishes create from replacement", () => {
  assert.deepEqual(sessionDialogCopy(null), {
    replacing: false,
    warning: "",
    submitLabel: "Create",
  });
  assert.deepEqual(sessionDialogCopy({ project: "Current cut", state: "ready" }), {
    replacing: true,
    warning: "Scrambo permits one active session per API token. Creating this session will close “Current cut” first.",
    submitLabel: "Close current & create",
  });
});
