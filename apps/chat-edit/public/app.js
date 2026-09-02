import { COMMAND_CHARACTER_LIMIT, CommandWorkflow, buildTurnBody } from "./command-chain.js";
import { findStoredSessionIds, sessionDialogCopy } from "./session-lifecycle.js";
import { QUICK_ACTIONS, compileMessage, friendlyHeadline, friendlyTag, workflowPreview } from "./chat-intent.js";

const SESSION_STORAGE_KEY = "scrambo-transcript-session";

const state = {
  configured: false,
  session: null,
  uploading: [],
  messages: [],
  activeWorkflow: null,
  turnBusy: false,
  hasTranscribed: false,
  activeTemplateId: null,
};

const elements = Object.fromEntries(
  [
    "topbar-session", "topbar-project", "topbar-session-id", "new-session-button",
    "api-dot", "api-label",
    "screen-session", "session-form", "project-name", "session-warning", "session-submit", "session-status",
    "screen-upload", "dropzone", "browse-button", "file-input", "asset-list", "upload-status", "continue-button",
    "screen-chat", "chat-back-to-upload", "uploaded-file-list",
    "messages", "quick-actions", "chat-input", "workflow-preview", "dsl-errors", "ask-toggle",
    "send-button", "send-label", "open-editor-button", "download-handoff-button", "composer-status", "character-count",
  ].map((id) => [id, document.getElementById(id)]),
);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function shortId(value) {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-6)}`;
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function requestId(label) {
  return `${label}-${crypto.randomUUID()}`;
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    error.code = payload?.error?.code ?? "request_failed";
    error.retryable = Boolean(payload?.error?.retryable);
    throw error;
  }
  return payload;
}

/* ---------- Session persistence ---------- */

function persistSession() {
  if (!state.session) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  localStorage.setItem(SESSION_STORAGE_KEY, state.session.sessionId);
}

function conversationKey() {
  return `scrambo-transcript-messages-${state.session?.sessionId ?? "none"}`;
}

function persistConversation() {
  if (!state.session) return;
  const safeMessages = state.messages.slice(-100);
  localStorage.setItem(conversationKey(), JSON.stringify(safeMessages));
}

function loadConversation() {
  try {
    state.messages = JSON.parse(localStorage.getItem(conversationKey()) ?? "[]");
  } catch {
    state.messages = [];
  }
  state.messages = state.messages.map((message) => message.workflow?.paused
    ? { ...message, error: false, workflow: { ...message.workflow, paused: false, stopped: true } }
    : message);
}

/* ---------- Shared UI ---------- */

function setSessionStatus(message, kind = "") {
  elements["session-status"].textContent = message;
  elements["session-status"].className = `status-line${kind ? ` ${kind}` : ""}`;
}

function setUploadStatus(message, kind = "") {
  elements["upload-status"].textContent = message;
  elements["upload-status"].className = `status-line${kind ? ` ${kind}` : ""}`;
}

function setComposerStatus(message, isError = false) {
  elements["composer-status"].textContent = message;
  elements["composer-status"].style.color = isError ? "var(--red)" : "";
}

function hasOpenSession() {
  return Boolean(state.session && state.session.state !== "closed");
}

function activeTemplate() {
  return QUICK_ACTIONS.find((template) => template.id === state.activeTemplateId) ?? null;
}

function showScreen(screen) {
  for (const id of ["screen-session", "screen-upload", "screen-chat"]) {
    elements[id].hidden = id !== `screen-${screen}`;
  }
}

function renderTopbar() {
  const open = hasOpenSession();
  elements["topbar-session"].hidden = !open;
  if (!open) return;
  elements["topbar-project"].textContent = state.session.project;
  elements["topbar-session-id"].textContent = shortId(state.session.sessionId);
  elements["topbar-session-id"].title = state.session.sessionId;
}

function configureSessionForm() {
  const copy = sessionDialogCopy(state.session);
  elements["session-warning"].hidden = !copy.replacing;
  elements["session-warning"].textContent = copy.warning;
  elements["session-submit"].textContent = copy.submitLabel;
}

/* ---------- Session screen ---------- */

async function createSession(project) {
  setSessionStatus("Creating session…");
  const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ project }) });
  state.session = session;
  state.uploading = [];
  state.messages = [];
  state.hasTranscribed = false;
  resetComposer();
  persistSession();
  renderTopbar();
  renderAssets();
  showScreen("upload");
  setUploadStatus("Session ready. Upload one or more files to begin.");
}

async function closeCurrentSession() {
  if (!hasOpenSession()) return;
  const closing = state.session;
  setSessionStatus(`Closing “${closing.project}”…`);
  try {
    await api(`/api/sessions/${encodeURIComponent(closing.sessionId)}/close`, { method: "POST" });
  } catch (error) {
    if (error.code !== "not_found") throw error;
  }
  state.session = null;
  persistSession();
  renderTopbar();
}

function startNewSession() {
  if (state.turnBusy) {
    setComposerStatus("Wait for the running workflow to finish before starting a new session.", true);
    return;
  }
  configureSessionForm();
  showScreen("session");
  elements["project-name"].value = "";
  elements["project-name"].focus();
  setSessionStatus("");
}

/* ---------- Upload screen ---------- */

function renderAssets() {
  const assets = state.session?.assets ?? [];
  if (assets.length === 0 && state.uploading.length === 0) {
    elements["asset-list"].innerHTML = '<p class="empty-state">No files uploaded.</p>';
  } else {
    const uploaded = assets.map((asset) => `
      <div class="asset-item" title="${escapeHtml(asset.assetId)}">
        <span class="asset-name">${escapeHtml(asset.name)}</span>
        <span class="asset-meta">${escapeHtml(formatBytes(asset.size))}</span>
        <span class="asset-status ready">Ready</span>
      </div>`).join("");
    const uploading = state.uploading.map((item) => `
      <div class="asset-item">
        <div style="flex:1">
          <div style="display:flex;gap:12px;align-items:center">
            <span class="asset-name">${escapeHtml(item.name)}</span>
            <span class="asset-meta">${escapeHtml(formatBytes(item.size))}</span>
            <span class="asset-status ${item.error ? "error" : "uploading"}">${escapeHtml(item.error ?? `${item.progress}%`)}</span>
          </div>
          ${item.error ? "" : `<div class="asset-progress"><span style="width:${item.progress}%"></span></div>`}
        </div>
      </div>`).join("");
    elements["asset-list"].innerHTML = uploaded + uploading;
  }

  elements["uploaded-file-list"].innerHTML = assets.length > 0
    ? assets.map((asset) => `
      <button class="uploaded-file-copy" type="button" data-copy-filename="${escapeHtml(asset.name)}" title="Copy file name: ${escapeHtml(asset.name)}" aria-label="Copy file name ${escapeHtml(asset.name)}">
        <span class="uploaded-file-name">${escapeHtml(asset.name)}</span>
        <span class="uploaded-file-copy-label">Copy</span>
      </button>`).join("")
    : '<p class="uploaded-files-empty">No files uploaded yet.</p>';
}

async function writeToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API but deny access.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy failed");
}

function uploadOne(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `/api/sessions/${encodeURIComponent(state.session.sessionId)}/uploads?name=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(file.type || "application/octet-stream")}`;
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      let payload;
      try { payload = JSON.parse(request.responseText); } catch { payload = undefined; }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload?.error?.message ?? `Upload failed (${request.status})`));
    });
    request.addEventListener("error", () => reject(new Error("Upload connection failed.")));
    request.send(file);
  });
}

async function uploadFiles(files) {
  if (!hasOpenSession() || files.length === 0) return;
  for (const file of files) {
    const pending = { id: crypto.randomUUID(), name: file.name, size: file.size, progress: 0, error: null };
    state.uploading.push(pending);
    renderAssets();
    setUploadStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadOne(file, (progress) => {
        pending.progress = progress;
        renderAssets();
      });
      state.session.assets = [...(state.session.assets ?? []), asset];
      setUploadStatus(`${file.name} uploaded.`, "success");
    } catch (error) {
      pending.error = error.message;
      renderAssets();
      setUploadStatus(`Upload failed: ${error.message}`, "error");
    } finally {
      state.uploading = state.uploading.filter((item) => item.id !== pending.id);
      renderAssets();
    }
  }
  elements["file-input"].value = "";
}

/* ---------- Chat screen ---------- */

function messageAvatar(message) {
  return message.kind === "user" ? "Y" : "✦";
}

function workflowMarkup(message) {
  if (!message.workflow) return "";
  const steps = message.workflow.steps.map((step) => {
    const outcome = step.status === "Complete" && step.result
      ? resultText(step.command, step.result)
      : step.progress;
    return `<li class="workflow-step workflow-${step.status.toLowerCase()}">
      <div class="workflow-step-heading">
        <strong>${escapeHtml(friendlyHeadline(step.command.bot, step.command.agent))}</strong>
        <span class="workflow-state">${escapeHtml(step.status)}</span>
      </div>
      <div class="workflow-tag">${escapeHtml(friendlyTag(step.command.bot, step.command.agent))}</div>
      ${outcome ? `<div class="workflow-outcome">${escapeHtml(outcome)}</div>` : ""}
    </li>`;
  }).join("");
  const actions = message.workflow.paused && !message.workflow.stopped
    ? `<div class="workflow-actions">
        <button class="btn-ghost" type="button" data-workflow-action="retry" data-message-id="${escapeHtml(message.id)}">Try again</button>
        <button class="btn-ghost" type="button" data-workflow-action="stop" data-message-id="${escapeHtml(message.id)}">Stop</button>
      </div>`
    : "";
  const stopped = message.workflow.stopped
    ? '<div class="workflow-stopped">Stopped.</div>'
    : "";
  return `<ol class="workflow-steps">${steps}</ol>${actions}${stopped}`;
}

function renderMessages() {
  elements.messages.replaceChildren();
  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = `message ${message.kind ?? "agent"}${message.error ? " error" : ""}`;
    article.dataset.messageId = message.id;
    const progress = message.progress
      ? `<div class="message-progress">${escapeHtml(message.progress)}</div>`
      : "";
    const workflow = workflowMarkup(message);
    const reuse = message.kind === "user" && message.text && compileMessage(message.text).detected
      ? `<button class="reuse-workflow" type="button" data-reuse-message="${escapeHtml(message.id)}">Use again</button>`
      : "";
    article.innerHTML = `
      <div class="message-avatar">${escapeHtml(messageAvatar(message))}</div>
      <div class="message-body">
        <div class="message-heading"><strong>${escapeHtml(message.sender)}</strong><time>${escapeHtml(message.time)}</time></div>
        <div class="message-text">${escapeHtml(message.text)}</div>
        ${reuse}
        ${progress}${workflow}
      </div>`;
    elements.messages.append(article);
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function addMessage(message) {
  const full = { id: crypto.randomUUID(), time: nowLabel(), ...message };
  state.messages.push(full);
  renderMessages();
  persistConversation();
  return full;
}

function updateMessage(id, patch) {
  const message = state.messages.find((candidate) => candidate.id === id);
  if (!message) return;
  Object.assign(message, patch);
  renderMessages();
  persistConversation();
}

function renderQuickActions() {
  elements["quick-actions"].innerHTML = QUICK_ACTIONS.map((action) => `<button type="button" class="tool-chip" data-quick-action="${escapeHtml(action.id)}">
    <strong>${escapeHtml(action.label)}</strong>
    <span>${escapeHtml(action.description)}</span>
  </button>`).join("");
}

function renderComposerMeta() {
  const hasSession = hasOpenSession();
  const busy = state.turnBusy || Boolean(state.activeWorkflow?.snapshot?.paused);
  const length = elements["chat-input"].value.length;
  const compilation = compileMessage(elements["chat-input"].value, {
    askMode: elements["ask-toggle"].checked,
    hasTranscribed: state.hasTranscribed,
    templateSteps: activeTemplate()?.steps,
  });
  const hasErrors = compilation.errors.length > 0;
  const preview = workflowPreview(compilation.commands);
  elements["workflow-preview"].hidden = !preview;
  const template = compilation.detected ? activeTemplate() : null;
  const templateLabel = template ? `<span><strong>Template:</strong> ${escapeHtml(template.label)} · </span>` : "";
  elements["workflow-preview"].innerHTML = preview ? `${templateLabel}<strong>Runs:</strong> ${escapeHtml(preview)}` : "";
  elements["dsl-errors"].hidden = !hasErrors;
  elements["dsl-errors"].textContent = compilation.errors.join(" ");
  elements["send-button"].disabled = !hasSession || busy || compilation.commands.length === 0 || hasErrors || length > COMMAND_CHARACTER_LIMIT;
  elements["character-count"].textContent = `${length.toLocaleString()} / ${COMMAND_CHARACTER_LIMIT.toLocaleString()}`;
  elements["character-count"].classList.toggle("over-limit", length > COMMAND_CHARACTER_LIMIT);
}

function renderComposer() {
  renderQuickActions();
  renderComposerMeta();
}

function resetComposer() {
  elements["chat-input"].value = "";
  elements["ask-toggle"].checked = false;
  state.activeTemplateId = null;
  renderComposerMeta();
}

async function pollOperation(operationId, onEvent) {
  let cursor = 0;
  while (true) {
    const operation = await api(`/api/operations/${encodeURIComponent(operationId)}?after=${cursor}`);
    for (const event of operation.events ?? []) onEvent?.(event);
    cursor = operation.cursor ?? cursor;
    if (operation.status === "succeeded") {
      if (!operation.result) throw new Error("Operation succeeded without a result.");
      return operation.result;
    }
    if (operation.status === "failed" || operation.status === "cancelled") {
      const error = new Error(operation.error?.message ?? `Operation ${operation.status}.`);
      error.code = operation.error?.code;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function resultText(command, result) {
  if (result.type === "answer") return result.answer;
  if (result.type === "source") {
    if (command.agent === "source.generate") return "Done — your generated assets and editorial brief are ready.";
    return result.artifact?.cached
      ? "Done — reused the preparation already available for this footage."
      : "Done — your footage is prepared and ready.";
  }
  if (result.type === "edit") {
    return "Your edit is ready. Open the editor to see it, or keep telling us what to change.";
  }
  return `${friendlyHeadline(command.bot, command.agent)} — done.`;
}

function renderChatActions() {
  const unavailable = !state.session?.currentEditId || state.turnBusy;
  elements["open-editor-button"].disabled = unavailable;
  elements["download-handoff-button"].disabled = unavailable;
}

function updateChatInterface() {
  const hasSession = hasOpenSession();
  const busy = state.turnBusy || Boolean(state.activeWorkflow?.snapshot?.paused);
  const disabled = !hasSession || busy;
  elements["chat-input"].disabled = disabled;
  elements["ask-toggle"].disabled = disabled;
  elements["quick-actions"].querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
  renderChatActions();
  renderComposerMeta();
}

function summarizeCommands(commands) {
  return `${commands.map((command) => friendlyHeadline(command.bot, command.agent)).join(", then ")}…`;
}

async function refreshSession() {
  if (!state.session) return;
  state.session = await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}`);
  persistSession();
  renderChatActions();
}

async function finishWorkflowRun() {
  const active = state.activeWorkflow;
  if (!active) return;
  const snapshot = active.runner.snapshot();
  active.snapshot = snapshot;
  state.turnBusy = false;
  if (snapshot.currentIndex >= snapshot.steps.length) {
    if (snapshot.editId) state.session.currentEditId = snapshot.editId;
    await refreshSession().catch(() => {});
    const count = snapshot.steps.length;
    state.activeWorkflow = null;
    setComposerStatus(count === 1 ? "Done." : "All done.");
  } else if (snapshot.paused) {
    const failed = snapshot.steps[snapshot.currentIndex];
    if (failed?.error?.code === "edit_conflict") {
      await refreshSession().catch(() => {});
      active.runner.editId = state.session?.currentEditId ?? active.runner.editId;
    }
    setComposerStatus(`Something went wrong: ${failed?.error?.message ?? "step failed"}. Try again or stop.`, true);
  }
  updateChatInterface();
}

async function runWorkflow(commands, { userText, templateId = null } = {}) {
  addMessage({
    sender: "You",
    kind: "user",
    text: userText ?? commands.map((command) => command.prompt).join("\n\n"),
    ...(templateId ? { templateId } : {}),
  });

  let workflowMessageId;
  const executeStep = async (command, context) => {
    const body = buildTurnBody(command, { editId: context.editId, requestId });
    const accepted = await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/turns`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!state.activeWorkflow.cleared) {
      state.activeWorkflow.cleared = true;
      resetComposer();
      renderComposer();
    }
    const progressLines = [];
    const result = await pollOperation(accepted.operationId, (event) => {
      if (event.message && !progressLines.includes(event.message)) progressLines.push(event.message);
      context.setProgress(progressLines.slice(-3).join("\n") || "Working…");
    });
    if (result?.type === "source" && command.tools.includes("transcribe")) {
      state.hasTranscribed = true;
    }
    return result;
  };
  const runner = new CommandWorkflow(commands, {
    executeStep,
    initialEditId: state.session.currentEditId,
    onChange: (snapshot) => {
      if (!state.activeWorkflow) return;
      state.activeWorkflow.snapshot = snapshot;
      if (workflowMessageId) updateMessage(workflowMessageId, { workflow: snapshot, error: snapshot.paused });
    },
  });
  const pending = addMessage({
    sender: "Scrambo",
    kind: "agent",
    text: summarizeCommands(commands),
    workflow: runner.snapshot(),
  });
  workflowMessageId = pending.id;
  state.activeWorkflow = { runner, messageId: pending.id, cleared: false, snapshot: runner.snapshot() };
  state.turnBusy = true;
  updateChatInterface();
  setComposerStatus("Working on it…");
  await runner.run();
  await finishWorkflowRun();
  const snapshot = runner.snapshot();
  if (snapshot.paused) {
    throw new Error(snapshot.steps[snapshot.currentIndex]?.error?.message ?? "Step failed");
  }
}

async function sendMessage() {
  if (!hasOpenSession() || state.turnBusy) return;
  const text = elements["chat-input"].value.trim();
  if (!text) return;
  if (text.length > COMMAND_CHARACTER_LIMIT) {
    setComposerStatus(`Message is ${text.length.toLocaleString()} characters; the limit is ${COMMAND_CHARACTER_LIMIT.toLocaleString()}.`, true);
    return;
  }
  const compilation = compileMessage(text, {
    askMode: elements["ask-toggle"].checked,
    hasTranscribed: state.hasTranscribed,
    templateSteps: activeTemplate()?.steps,
  });
  if (compilation.errors.length) {
    setComposerStatus("Fix the workflow above before sending.", true);
    renderComposerMeta();
    return;
  }
  const commands = compilation.commands;
  const templateId = compilation.detected ? state.activeTemplateId : null;
  try {
    await runWorkflow(commands, { userText: text, templateId });
  } catch {
    // finishWorkflowRun already surfaced the pause/error state in the composer.
  }
}

function enterChat() {
  if (state.messages.length === 0) {
    addMessage({
      sender: "Scrambo",
      kind: "system",
      text: "Your session is ready. Tell us what you'd like to do with your footage — no special commands needed.",
    });
  }
  showScreen("chat");
  renderMessages();
  renderComposer();
  updateChatInterface();
}

/* ---------- Session restore ---------- */

async function restoreSession() {
  if (!state.configured) return false;
  const activeId = localStorage.getItem(SESSION_STORAGE_KEY);
  for (const sessionId of findStoredSessionIds(localStorage)) {
    try {
      const session = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (session.state === "closed") {
        if (sessionId === activeId) localStorage.removeItem(SESSION_STORAGE_KEY);
        continue;
      }
      state.session = session;
      persistSession();
      renderTopbar();
      renderAssets();
      loadConversation();
      if (state.messages.length > 0) {
        enterChat();
        setComposerStatus("Previous active session restored.");
      } else {
        showScreen("upload");
        setUploadStatus("Previous active session restored.");
      }
      return true;
    } catch (error) {
      if (sessionId === activeId && error.code === "not_found") {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }
  return false;
}

/* ---------- Boot ---------- */

async function initialize() {
  try {
    const config = await api("/api/config");
    state.configured = config.configured;
    elements["api-dot"].classList.add(config.configured ? "online" : "offline");
    elements["api-label"].textContent = config.configured ? "Scrambo API ready" : "Server not configured";
    if (!config.configured) {
      setSessionStatus("Set SCRAMBO_API_TOKEN on the server, then restart this app.", "error");
    }
  } catch {
    elements["api-dot"].classList.add("offline");
    elements["api-label"].textContent = "Server unavailable";
  }
  configureSessionForm();
  const restored = await restoreSession();
  if (!restored) showScreen("session");
}

/* ---------- Event wiring ---------- */

elements["session-form"].addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = elements["project-name"].value.trim();
  if (!project || !state.configured) return;
  elements["session-submit"].disabled = true;
  try {
    if (hasOpenSession()) await closeCurrentSession();
    await createSession(project);
    state.configured = true;
    elements["api-dot"].className = "status-dot online";
    elements["api-label"].textContent = "Scrambo API ready";
  } catch (error) {
    setSessionStatus(error.message, "error");
    configureSessionForm();
  } finally {
    elements["session-submit"].disabled = false;
  }
});

elements["new-session-button"].addEventListener("click", startNewSession);

elements["dropzone"].addEventListener("click", () => elements["file-input"].click());
elements["dropzone"].addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements["file-input"].click();
  }
});
elements["browse-button"].addEventListener("click", (event) => {
  event.stopPropagation();
  elements["file-input"].click();
});
elements["file-input"].addEventListener("change", () => uploadFiles([...elements["file-input"].files]));
elements["dropzone"].addEventListener("dragover", (event) => {
  event.preventDefault();
  elements["dropzone"].classList.add("dragover");
});
elements["dropzone"].addEventListener("dragleave", () => elements["dropzone"].classList.remove("dragover"));
elements["dropzone"].addEventListener("drop", (event) => {
  event.preventDefault();
  elements["dropzone"].classList.remove("dragover");
  uploadFiles([...event.dataTransfer.files]);
});
elements["continue-button"].addEventListener("click", enterChat);

elements["chat-back-to-upload"].addEventListener("click", () => showScreen("upload"));
elements["uploaded-file-list"].addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-filename]");
  if (!button) return;
  const label = button.querySelector(".uploaded-file-copy-label");
  try {
    await writeToClipboard(button.dataset.copyFilename);
    label.textContent = "Copied";
    button.classList.add("copied");
    button.title = "File name copied";
    button.setAttribute("aria-label", `Copied file name ${button.dataset.copyFilename}`);
    setTimeout(() => {
      label.textContent = "Copy";
      button.classList.remove("copied");
      button.title = `Copy file name: ${button.dataset.copyFilename}`;
      button.setAttribute("aria-label", `Copy file name ${button.dataset.copyFilename}`);
    }, 1600);
  } catch {
    label.textContent = "Try again";
    button.title = "Could not copy file name";
    button.setAttribute("aria-label", `Could not copy file name ${button.dataset.copyFilename}. Try again`);
  }
});

elements["open-editor-button"].addEventListener("click", async () => {
  if (!state.session?.currentEditId) return;
  const editId = state.session.currentEditId;
  const popup = window.open("", "_blank");
  elements["open-editor-button"].disabled = true;
  elements["open-editor-button"].textContent = "Opening…";
  try {
    const accepted = await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/view-edit-snapshots`, {
      method: "POST",
      body: JSON.stringify({ editId }),
    });
    const editorUrl = accepted.viewUrl || "https://editor.scrambo.dev";
    if (popup) popup.location.replace(editorUrl);
    else window.open(editorUrl, "_blank", "noopener,noreferrer");
    await pollOperation(accepted.operationId);
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    setComposerStatus(`Could not open the Scrambo editor: ${error.message}`, true);
  } finally {
    elements["open-editor-button"].textContent = "Open editor ↗";
    renderChatActions();
  }
});

elements["download-handoff-button"].addEventListener("click", async () => {
  if (!state.session?.currentEditId) return;
  const editId = state.session.currentEditId;
  elements["download-handoff-button"].disabled = true;
  elements["download-handoff-button"].textContent = "Preparing…";
  try {
    const accepted = await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/render-handoffs`, {
      method: "POST",
      body: JSON.stringify({ requestId: requestId("render-handoff"), editId }),
    });
    const result = await pollOperation(accepted.operationId);
    const response = await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/render-handoffs/${encodeURIComponent(result.handoffId)}`);
    const blob = new Blob([JSON.stringify(response.handoff, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `render_handoff_${shortId(response.editId).replace("…", "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    setComposerStatus(`Could not download the render handoff: ${error.message}`, true);
  } finally {
    elements["download-handoff-button"].textContent = "Download handoff ⇩";
    renderChatActions();
  }
});

elements["quick-actions"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-action]");
  if (!button) return;
  const action = QUICK_ACTIONS.find((candidate) => candidate.id === button.dataset.quickAction);
  if (!action) return;
  state.activeTemplateId = action.id;
  elements["chat-input"].value = action.prompt;
  elements["ask-toggle"].checked = false;
  elements["chat-input"].focus();
  renderComposerMeta();
});

elements["chat-input"].addEventListener("input", () => {
  if (!elements["chat-input"].value.trim()) state.activeTemplateId = null;
  renderComposerMeta();
});
elements["ask-toggle"].addEventListener("change", renderComposerMeta);
elements["chat-input"].addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendMessage();
  }
});

elements["send-button"].addEventListener("click", sendMessage);

elements.messages.addEventListener("click", async (event) => {
  const reuseButton = event.target.closest("[data-reuse-message]");
  if (reuseButton) {
    const message = state.messages.find((candidate) => candidate.id === reuseButton.dataset.reuseMessage);
    if (!message || state.turnBusy) return;
    state.activeTemplateId = message.templateId ?? null;
    elements["chat-input"].value = message.text;
    elements["ask-toggle"].checked = false;
    elements["chat-input"].focus();
    renderComposerMeta();
    return;
  }
  const button = event.target.closest("[data-workflow-action]");
  if (!button || button.dataset.messageId !== state.activeWorkflow?.messageId) return;
  const { runner } = state.activeWorkflow;
  if (button.dataset.workflowAction === "retry") {
    state.turnBusy = true;
    updateChatInterface();
    setComposerStatus("Trying again…");
    await runner.retry();
    await finishWorkflowRun();
    return;
  }
  runner.stop();
  state.turnBusy = false;
  state.activeWorkflow = null;
  setComposerStatus("Stopped. Ready when you are.");
  updateChatInterface();
});

initialize();
