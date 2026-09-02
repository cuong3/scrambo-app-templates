import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_API_URL = "https://api.scrambo.dev";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 15 * 60_000;

export class ScramboApiError extends Error {
  constructor(status, error) {
    super(error.message);
    this.name = "ScramboApiError";
    this.status = status;
    this.code = error.code;
    this.retryable = Boolean(error.retryable);
    this.body = { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

function apiError(status, body) {
  const error = body?.error;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return new ScramboApiError(status, error);
  }
  if (typeof body?.detail === "string" && body.detail.trim()) {
    return new ScramboApiError(status, {
      code: "http_error",
      message: body.detail,
      retryable: status >= 500,
    });
  }
  return new ScramboApiError(status, {
    code: "scrambo_error",
    message: `Scrambo API returned HTTP ${status}`,
    retryable: status >= 500,
  });
}

function delay(ms, signal) {
  return new Promise((resolveDelay, reject) => {
    const timer = setTimeout(resolveDelay, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("polling aborted"));
    }, { once: true });
  });
}

function timeoutSignal(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isStream(body) {
  return body !== null && typeof body === "object" && typeof body.pipe === "function";
}

export function requestId(label = "turn") {
  return `${label}-${randomUUID()}`;
}

export function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Small server-side client for the Scrambo Stateful API.
 *
 * It deliberately has no UI or framework dependencies so product teams can
 * copy this file into an existing Node backend or use the workspace package.
 */
export class ScramboClient {
  constructor({
    apiUrl = DEFAULT_API_URL,
    token,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    uploadTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiUrl = String(apiUrl ?? "").replace(/\/$/, "");
    this.token = String(token ?? "").trim();
    this.timeoutMs = timeoutMs;
    this.uploadTimeoutMs = uploadTimeoutMs;
    this.fetch = fetchImpl;
  }

  static fromEnv(options = {}) {
    const apiUrl = process.env.SCRAMBO_API_URL ?? DEFAULT_API_URL;
    const token = process.env.SCRAMBO_API_TOKEN;
    if (!token) throw new Error("Set SCRAMBO_API_TOKEN before creating a Scrambo client.");
    return new ScramboClient({ ...options, apiUrl, token });
  }

  withToken(token) {
    return new ScramboClient({
      apiUrl: this.apiUrl,
      token,
      timeoutMs: this.timeoutMs,
      uploadTimeoutMs: this.uploadTimeoutMs,
      fetchImpl: this.fetch,
    });
  }

  requireConfiguration() {
    if (!this.apiUrl) {
      throw new ScramboApiError(503, {
        code: "not_configured",
        message: "Scrambo API URL is not configured.",
        retryable: false,
      });
    }
    if (!this.token) {
      throw new ScramboApiError(401, {
        code: "missing_api_key",
        message: "A Scrambo API key is required.",
        retryable: false,
      });
    }
  }

  async request(method, path, { json, body, headers = {}, timeoutMs = this.timeoutMs, signal } = {}) {
    this.requireConfiguration();
    let response;
    try {
      response = await this.fetch(`${this.apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(json === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: json === undefined ? body : JSON.stringify(json),
        ...(isStream(body) ? { duplex: "half" } : {}),
        signal: timeoutSignal(timeoutMs, signal),
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new ScramboApiError(504, {
          code: "upstream_timeout",
          message: "Scrambo API request timed out.",
          retryable: true,
        });
      }
      throw new ScramboApiError(502, {
        code: "upstream_unavailable",
        message: "Could not reach the Scrambo API.",
        retryable: true,
      });
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw apiError(response.status, payload);
    return payload;
  }

  createSession(input) {
    return this.request("POST", "/v2/sessions", { json: input });
  }

  getSession(sessionId) {
    return this.request("GET", `/v2/sessions/${encodeURIComponent(sessionId)}`);
  }

  closeSession(sessionId) {
    return this.request("POST", `/v2/sessions/${encodeURIComponent(sessionId)}/close`, { json: {} });
  }

  declareAsset(sessionId, input) {
    return this.request("POST", `/v2/sessions/${encodeURIComponent(sessionId)}/assets`, { json: input });
  }

  uploadAssetContent(sessionId, assetId, content, {
    mimeType = "application/octet-stream",
    size,
    signal,
  } = {}) {
    return this.request(
      "PUT",
      `/v2/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}/content`,
      {
        body: content,
        headers: {
          "Content-Type": mimeType,
          ...(size === undefined ? {} : { "Content-Length": String(size) }),
        },
        timeoutMs: this.uploadTimeoutMs,
        signal,
      },
    );
  }

  submitTurn(sessionId, turn) {
    return this.request("POST", `/v2/sessions/${encodeURIComponent(sessionId)}/turns`, { json: turn });
  }

  getOperation(operationId, after = 0) {
    const cursor = Math.max(0, Number.parseInt(String(after), 10) || 0);
    return this.request("GET", `/v2/operations/${encodeURIComponent(operationId)}?after=${cursor}`);
  }

  async pollOperation(operationId, options = {}) {
    let cursor = 0;
    const intervalMs = options.intervalMs ?? 1_000;
    while (true) {
      options.signal?.throwIfAborted();
      const operation = await this.getOperation(operationId, cursor);
      for (const event of operation.events ?? []) options.onEvent?.(event);
      cursor = operation.cursor ?? cursor;
      if (operation.status === "succeeded") {
        if (operation.result === null || operation.result === undefined) {
          throw new ScramboApiError(200, {
            code: "invalid_response",
            message: "Successful operation returned no result.",
            retryable: false,
          });
        }
        return operation.result;
      }
      if (operation.status === "failed" || operation.status === "cancelled") {
        throw new ScramboApiError(200, operation.error ?? {
          code: "operation_failed",
          message: `Operation ${operation.status}.`,
          retryable: false,
        });
      }
      await delay(intervalMs, options.signal);
    }
  }

  createPublicSnapshot(sessionId, editId) {
    return this.request(
      "POST",
      `/v2/sessions/${encodeURIComponent(sessionId)}/view-edit-snapshots`,
      { json: editId === undefined ? {} : { editId } },
    );
  }

  createRenderHandoff(sessionId, input) {
    return this.request(
      "POST",
      `/v2/sessions/${encodeURIComponent(sessionId)}/render-handoffs`,
      { json: input },
    );
  }

  getRenderHandoff(sessionId, handoffId) {
    return this.request(
      "GET",
      `/v2/sessions/${encodeURIComponent(sessionId)}/render-handoffs/${encodeURIComponent(handoffId)}`,
    );
  }
}

/**
 * Convenience state holder for scripts and single-user workflows.
 * Product backends can use ScramboClient directly when they store state in a
 * database or job system.
 */
export class StatefulSession {
  constructor(client, session) {
    this.client = client;
    this.sessionId = session.sessionId;
    this.currentEditId = session.currentEditId;
    this.closed = session.state === "closed";
    this.localAssets = {
      byAssetId: new Map(),
      bySha256: new Map(),
    };
  }

  async refresh() {
    const session = await this.client.getSession(this.sessionId);
    this.currentEditId = session.currentEditId;
    this.closed = session.state === "closed";
    return session;
  }

  async declareAndUpload(name, content, mimeType = "application/octet-stream") {
    const asset = await this.client.declareAsset(this.sessionId, {
      name,
      size: content.byteLength,
      mimeType,
      sha256: sha256Hex(content),
    });
    await this.client.uploadAssetContent(this.sessionId, asset.assetId, content, {
      mimeType,
      size: content.byteLength,
    });
    return { ...asset, uploaded: true };
  }

  async uploadFile(filePath, mimeType = "application/octet-stream") {
    const localPath = resolve(filePath);
    const content = await readFile(localPath);
    const asset = await this.declareAndUpload(basename(localPath), content, mimeType);
    this.localAssets.byAssetId.set(asset.assetId, localPath);
    this.localAssets.bySha256.set(asset.sha256, localPath);
    return asset;
  }

  async ask(message, id = requestId("ask"), options = {}) {
    const accepted = await this.client.submitTurn(this.sessionId, {
      requestId: id,
      mode: "ask",
      message,
    });
    const result = await this.client.pollOperation(accepted.operationId, options);
    if (result.type !== "answer") throw new Error(`Expected answer result, received ${result.type}.`);
    return result;
  }

  async edit(input, options = {}) {
    const startsRoot = input.agent === "source.work"
      || input.agent === "source.generate"
      || input.agent === "planner.compile"
      || (input.agent === "timeline.author" && input.message === undefined);
    const baseEditId = input.baseEditId ?? (startsRoot ? undefined : this.currentEditId ?? undefined);
    const turn = {
      requestId: input.requestId ?? requestId(input.agent),
      mode: "edit",
      agent: input.agent,
      ...(input.message === undefined ? {} : { message: input.message }),
      ...(baseEditId === undefined ? {} : { baseEditId }),
      ...(input.tools === undefined ? {} : { tools: input.tools }),
      ...(input.toolConfig === undefined ? {} : { toolConfig: input.toolConfig }),
      ...(input.budgetUsd === undefined ? {} : { budgetUsd: input.budgetUsd }),
      ...(input.maxCalls === undefined ? {} : { maxCalls: input.maxCalls }),
      ...(input.name === undefined ? {} : { name: input.name }),
    };
    const accepted = await this.client.submitTurn(this.sessionId, turn);
    const result = await this.client.pollOperation(accepted.operationId, options);
    if (!["source", "plan", "edit"].includes(result.type)) {
      throw new Error(`Expected edit result, received ${result.type}.`);
    }
    if (result.type === "edit") this.currentEditId = result.editId;
    return result;
  }

  createPublicSnapshot(editId = this.currentEditId ?? undefined) {
    return this.client.createPublicSnapshot(this.sessionId, editId);
  }

  async createRenderHandoff(options = {}, editId = this.currentEditId ?? undefined) {
    const accepted = await this.client.createRenderHandoff(this.sessionId, {
      requestId: requestId("render-handoff"),
      ...(editId === undefined ? {} : { editId }),
    });
    const result = await this.client.pollOperation(accepted.operationId, options);
    if (result.type !== "render_handoff") {
      throw new Error(`Expected render handoff result, received ${result.type}.`);
    }
    const downloaded = await this.client.getRenderHandoff(this.sessionId, result.handoffId);
    return downloaded.handoff;
  }

  async close() {
    if (this.closed) return;
    await this.client.closeSession(this.sessionId);
    this.closed = true;
  }
}
