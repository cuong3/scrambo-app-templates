import {
  MAX_PHOTOS,
  MIN_PHOTOS,
  buildAuthorTurn,
  buildCaptionsTurn,
  buildCreativeBriefPrompt,
  buildGenerateTurn,
  buildPlannerTurn,
  narrationEstimate,
  splitCreativeBrief,
} from "./tour-flow.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const state = {
  configured: false,
  files: [],
  session: null,
  assets: [],
  busy: false,
  editId: null,
};

const elements = Object.fromEntries([
  "api-dot", "api-label", "screen-select", "screen-analyzing", "screen-review", "screen-progress", "screen-done",
  "project-name", "dropzone", "file-input", "photo-count", "photo-grid", "select-status", "create-button",
  "analyzing-status", "analyzing-bar", "analyzing-photos", "review-photos", "video-prompts", "narration",
  "word-count", "duration-estimate", "target-duration", "review-status", "back-button", "generate-button",
  "pipeline", "progress-error", "progress-error-message", "edit-drafts-button", "retry-button",
  "done-photo-count", "done-duration", "snapshot-status", "open-editor-button", "new-tour-button",
].map((id) => [id, document.getElementById(id)]));

function requestId(label) {
  return `${label}-${crypto.randomUUID()}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status}).`);
    error.code = payload?.error?.code ?? "request_failed";
    error.retryable = Boolean(payload?.error?.retryable);
    throw error;
  }
  return payload;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function showScreen(name) {
  for (const id of ["select", "analyzing", "review", "progress", "done"]) {
    elements[`screen-${id}`].hidden = id !== name;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setStatus(element, message, kind = "") {
  element.textContent = message;
  element.className = `status-message${kind ? ` ${kind}` : ""}`;
}

function photoPreview(photo, compact = false) {
  const wrapper = document.createElement("div");
  wrapper.className = compact ? "mini-photo" : "photo-tile";
  const image = document.createElement("img");
  image.src = photo.url;
  image.alt = photo.file.name;
  wrapper.append(image);
  if (compact) return wrapper;

  const footer = document.createElement("div");
  footer.className = "photo-footer";
  const name = document.createElement("span");
  name.textContent = photo.file.name;
  name.title = photo.file.name;
  footer.append(name);

  const actions = document.createElement("div");
  actions.className = "photo-actions";
  for (const [action, label, title] of [["left", "←", "Move earlier"], ["right", "→", "Move later"], ["remove", "×", "Remove"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.photoAction = action;
    button.dataset.photoId = photo.id;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", `${title}: ${photo.file.name}`);
    actions.append(button);
  }
  footer.append(actions);
  wrapper.append(footer);
  return wrapper;
}

function renderPhotos() {
  elements["photo-count"].textContent = `${state.files.length} / ${MAX_PHOTOS}`;
  elements["photo-grid"].replaceChildren();
  if (state.files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-grid";
    empty.textContent = `Choose ${MIN_PHOTOS}–${MAX_PHOTOS} photos to begin.`;
    elements["photo-grid"].append(empty);
  } else {
    state.files.forEach((photo) => elements["photo-grid"].append(photoPreview(photo)));
  }
  const usable = state.files.length >= MIN_PHOTOS && state.files.length <= MAX_PHOTOS;
  elements["create-button"].disabled = !state.configured || !usable || state.busy;
}

function renderMiniPhotos(target) {
  target.replaceChildren(...state.files.map((photo) => photoPreview(photo, true)));
}

function addFiles(fileList) {
  const candidates = [...fileList];
  const badType = candidates.find((file) => !ALLOWED_TYPES.has(file.type));
  if (badType) {
    setStatus(elements["select-status"], `${badType.name} is not a JPEG, PNG, or WebP photo.`, "error");
    return;
  }
  const badSize = candidates.find((file) => file.size === 0 || file.size > MAX_PHOTO_BYTES);
  if (badSize) {
    setStatus(elements["select-status"], `${badSize.name} must be between 1 byte and 25 MB.`, "error");
    return;
  }
  const names = new Set(state.files.map((photo) => photo.file.name.toLowerCase()));
  const unique = [];
  for (const file of candidates) {
    const key = file.name.toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    unique.push(file);
  }
  const room = MAX_PHOTOS - state.files.length;
  for (const file of unique.slice(0, room)) {
    state.files.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  if (unique.length > room) {
    setStatus(elements["select-status"], `This demo uses up to ${MAX_PHOTOS} photos.`, "error");
  } else {
    setStatus(elements["select-status"], "Use the arrow controls to set the walkthrough order.");
  }
  elements["file-input"].value = "";
  renderPhotos();
}

async function uploadPhoto(photo) {
  const params = new URLSearchParams({ name: photo.file.name, mimeType: photo.file.type });
  return api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/uploads?${params}`, {
    method: "POST",
    headers: { "Content-Type": photo.file.type },
    body: photo.file,
  });
}

async function uploadAllPhotos() {
  const results = new Array(state.files.length);
  // V2 serializes mutations within a session, including verified asset uploads.
  for (let index = 0; index < state.files.length; index += 1) {
    elements["analyzing-status"].textContent = `Uploading photo ${index + 1} of ${state.files.length}…`;
    results[index] = await uploadPhoto(state.files[index]);
    elements["analyzing-bar"].style.width = `${10 + ((index + 1) / state.files.length) * 45}%`;
  }
  return results;
}

async function pollOperation(operationId, onProgress = () => {}) {
  let cursor = 0;
  while (true) {
    const operation = await api(`/api/operations/${encodeURIComponent(operationId)}?after=${cursor}`);
    for (const event of operation.events ?? []) {
      if (event.message) onProgress(event.message);
    }
    cursor = operation.cursor ?? cursor;
    if (operation.status === "succeeded") {
      if (!operation.result) throw new Error("Operation succeeded without a result.");
      return operation.result;
    }
    if (operation.status === "failed" || operation.status === "cancelled") {
      const error = new Error(operation.error?.message ?? `Operation ${operation.status}.`);
      error.code = operation.error?.code;
      error.retryable = Boolean(operation.error?.retryable);
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function submitTurn(body, onProgress) {
  const accepted = await api(
    `/api/sessions/${encodeURIComponent(state.session.sessionId)}/turns`,
    jsonOptions("POST", body),
  );
  return pollOperation(accepted.operationId, onProgress);
}

function updateNarrationMeta() {
  const estimate = narrationEstimate(elements.narration.value);
  elements["word-count"].textContent = `${estimate.words} ${estimate.words === 1 ? "word" : "words"}`;
  elements["duration-estimate"].textContent = `≈ ${estimate.seconds} sec`;
  elements["target-duration"].textContent = `Target: ${state.files.length * 4} sec`;
}

async function createCreativeBrief() {
  const project = elements["project-name"].value.trim();
  if (!project || state.files.length < MIN_PHOTOS) return;
  state.busy = true;
  renderPhotos();
  renderMiniPhotos(elements["analyzing-photos"]);
  elements["analyzing-bar"].style.width = "5%";
  elements["analyzing-status"].textContent = "Creating a private editing session…";
  showScreen("analyzing");
  try {
    state.session = await api("/api/sessions", jsonOptions("POST", { project, canvas: [1080, 1920] }));
    elements["analyzing-bar"].style.width = "10%";
    state.assets = await uploadAllPhotos();
    elements["analyzing-status"].textContent = "Inspecting architecture and drafting your creative brief…";
    elements["analyzing-bar"].style.width = "60%";
    const result = await submitTurn({
      requestId: requestId("creative-brief"),
      mode: "ask",
      message: buildCreativeBriefPrompt(state.assets.map((asset) => asset.name)),
    }, (message) => { elements["analyzing-status"].textContent = message; });
    if (result.type !== "answer") throw new Error(`Expected an answer, received ${result.type}.`);
    const brief = splitCreativeBrief(result.answer);
    elements["video-prompts"].value = brief.videoPrompts;
    elements.narration.value = brief.narration;
    updateNarrationMeta();
    renderMiniPhotos(elements["review-photos"]);
    setStatus(
      elements["review-status"],
      brief.parsed ? "Review both drafts before generation." : "Scrambo returned an unusual format. Review the shot plan and add narration before continuing.",
      brief.parsed ? "" : "error",
    );
    elements["analyzing-bar"].style.width = "100%";
    showScreen("review");
  } catch (error) {
    setStatus(elements["select-status"], error.message, "error");
    showScreen("select");
  } finally {
    state.busy = false;
    renderPhotos();
  }
}

function setPipelineStep(index, status, detail = "") {
  const item = elements.pipeline.querySelector(`[data-pipeline-step="${index}"]`);
  item.className = status.toLowerCase();
  item.querySelector(".pipeline-state").textContent = status;
  item.querySelector("p").textContent = detail;
}

function resetPipeline() {
  for (let index = 0; index < 4; index += 1) setPipelineStep(index, "Waiting");
  elements["progress-error"].hidden = true;
}

async function runPipeline() {
  const videoPrompts = elements["video-prompts"].value.trim();
  const narration = elements.narration.value.trim();
  if (!videoPrompts || !narration) {
    setStatus(elements["review-status"], "Both the shot plan and narration are required.", "error");
    return;
  }
  state.busy = true;
  elements["generate-button"].disabled = true;
  resetPipeline();
  showScreen("progress");
  const names = state.assets.map((asset) => asset.name);
  try {
    setPipelineStep(0, "Running", "Starting the generation specialist…");
    const generateTurn = buildGenerateTurn({
      assetNames: names,
      videoPrompts,
      narration,
      requestId: requestId("generate-tour"),
    });
    if (generateTurn.message.length > 20_000) {
      throw new Error("The combined shot plan and narration exceed Scrambo's 20,000-character turn limit.");
    }
    const generated = await submitTurn(generateTurn, (message) => setPipelineStep(0, "Running", message));
    if (generated.type !== "source" || generated.agent !== "source.generate") {
      throw new Error("Generation did not return a source brief.");
    }
    setPipelineStep(0, "Complete", "Generated media and source brief are ready.");

    setPipelineStep(1, "Running", "Transcribing the voiceover and planning phrase-aware cuts…");
    const planned = await submitTurn(buildPlannerTurn({
      narration,
      photoCount: names.length,
      requestId: requestId("plan-tour"),
    }), (message) => setPipelineStep(1, "Running", message));
    if (planned.type !== "plan") throw new Error("Planner did not return an edit plan.");
    setPipelineStep(1, "Complete", "The grounded edit plan is ready.");

    setPipelineStep(2, "Running", "Opening the private editor and assembling the timeline…");
    const authored = await submitTurn(
      buildAuthorTurn(requestId("author-tour")),
      (message) => setPipelineStep(2, "Running", message),
    );
    if (authored.type !== "edit" || !authored.editId) throw new Error("Author did not create an edit revision.");
    state.editId = authored.editId;
    setPipelineStep(2, "Complete", "The first immutable edit revision is ready.");

    setPipelineStep(3, "Running", "Styling transcript-aligned captions…");
    const captioned = await submitTurn(
      buildCaptionsTurn(state.editId, requestId("caption-tour")),
      (message) => setPipelineStep(3, "Running", message),
    );
    if (captioned.type !== "edit" || !captioned.editId) throw new Error("Captions did not create an edit revision.");
    state.editId = captioned.editId;
    state.session.currentEditId = captioned.editId;
    setPipelineStep(3, "Complete", "The captioned reel is ready.");

    const estimate = narrationEstimate(narration);
    elements["done-photo-count"].textContent = String(names.length);
    elements["done-duration"].textContent = `${estimate.seconds}s`;
    elements["snapshot-status"].textContent = "";
    showScreen("done");
  } catch (error) {
    elements["progress-error-message"].textContent = error.message;
    elements["progress-error"].hidden = false;
  } finally {
    state.busy = false;
    elements["generate-button"].disabled = false;
  }
}

async function openEditor() {
  if (!state.editId || state.busy) return;
  const popup = window.open("", "_blank");
  state.busy = true;
  elements["open-editor-button"].disabled = true;
  elements["snapshot-status"].textContent = "Preparing a detached editor snapshot…";
  try {
    const accepted = await api(
      `/api/sessions/${encodeURIComponent(state.session.sessionId)}/view-edit-snapshots`,
      jsonOptions("POST", { editId: state.editId }),
    );
    if (popup) popup.location.replace(accepted.viewUrl);
    else window.open(accepted.viewUrl, "_blank", "noopener,noreferrer");
    await pollOperation(accepted.operationId, (message) => { elements["snapshot-status"].textContent = message; });
    elements["snapshot-status"].textContent = "Snapshot opened in a new tab.";
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    elements["snapshot-status"].textContent = `Could not open the editor: ${error.message}`;
  } finally {
    state.busy = false;
    elements["open-editor-button"].disabled = false;
  }
}

async function resetTour() {
  if (state.busy) return;
  if (state.session?.sessionId) {
    await api(`/api/sessions/${encodeURIComponent(state.session.sessionId)}/close`, { method: "POST" }).catch(() => {});
  }
  for (const photo of state.files) URL.revokeObjectURL(photo.url);
  state.files = [];
  state.session = null;
  state.assets = [];
  state.editId = null;
  elements["video-prompts"].value = "";
  elements.narration.value = "";
  setStatus(elements["select-status"], "");
  renderPhotos();
  showScreen("select");
}

elements.dropzone.addEventListener("click", () => elements["file-input"].click());
elements.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements["file-input"].click();
  }
});
elements["file-input"].addEventListener("change", () => addFiles(elements["file-input"].files));
elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("dragover");
});
elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("dragover"));
elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragover");
  addFiles(event.dataTransfer.files);
});
elements["photo-grid"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-photo-action]");
  if (!button || state.busy) return;
  const index = state.files.findIndex((photo) => photo.id === button.dataset.photoId);
  if (index < 0) return;
  if (button.dataset.photoAction === "remove") {
    URL.revokeObjectURL(state.files[index].url);
    state.files.splice(index, 1);
  } else {
    const offset = button.dataset.photoAction === "left" ? -1 : 1;
    const target = index + offset;
    if (target >= 0 && target < state.files.length) {
      [state.files[index], state.files[target]] = [state.files[target], state.files[index]];
    }
  }
  renderPhotos();
});

elements["create-button"].addEventListener("click", createCreativeBrief);
elements.narration.addEventListener("input", updateNarrationMeta);
elements["back-button"].addEventListener("click", () => showScreen("select"));
elements["generate-button"].addEventListener("click", runPipeline);
elements["retry-button"].addEventListener("click", runPipeline);
elements["edit-drafts-button"].addEventListener("click", () => showScreen("review"));
elements["open-editor-button"].addEventListener("click", openEditor);
elements["new-tour-button"].addEventListener("click", resetTour);

async function initialize() {
  try {
    const config = await api("/api/config");
    state.configured = config.configured;
    elements["api-dot"].classList.add(config.configured ? "online" : "offline");
    elements["api-label"].textContent = config.configured ? "Scrambo API ready" : "Server not configured";
    if (!config.configured) {
      setStatus(elements["select-status"], "Set SCRAMBO_API_TOKEN on the server, then restart the app.", "error");
    }
  } catch {
    elements["api-dot"].classList.add("offline");
    elements["api-label"].textContent = "Server unavailable";
    setStatus(elements["select-status"], "Could not reach the local app server.", "error");
  }
  renderPhotos();
}

initialize();
