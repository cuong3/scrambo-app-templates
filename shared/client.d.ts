export type AgentId =
  | "source.work"
  | "source.generate"
  | "planner.compile"
  | "timeline.author"
  | "timeline.graphics"
  | "timeline.sound"
  | "timeline.titles"
  | "timeline.captions";

export type ToolId = "transcribe" | "detect_events" | "detect_beats" | "img2video" | "voiceover" | "masking";
export interface ProviderConfig { name: string; model?: string; thinking?: string; [key: string]: unknown }
export interface ApiErrorBody { code: string; message: string; retryable: boolean }
export interface Asset { assetId: string; name: string; size: number; mimeType: string; sha256: string; uploaded: boolean }
export interface Session { sessionId: string; project: string; state: string; canvas: [number, number] | null; assets: Asset[]; currentEditId: string | null; createdAt: string }
export interface OperationEvent { cursor: number; type: string; message: string; at: string }
export interface OperationResult { type: string; [key: string]: unknown }
export interface Operation { operationId: string; status: string; cursor: number; events: OperationEvent[]; result: OperationResult | null; error: ApiErrorBody | null }
export interface PollOptions { intervalMs?: number; onEvent?: (event: OperationEvent) => void; signal?: AbortSignal }
export interface RenderHandoff { schema: "scrambo.render-ir.v1"; rendererProfile: "scrambo-remotion-scene-v1"; source: { sessionId: string; editId: string }; assets: Array<Record<string, unknown>>; compatibility: { unsupported: string[]; [key: string]: unknown }; [key: string]: unknown }

export class ScramboApiError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  body: { error: ApiErrorBody };
}

export interface ScramboClientOptions {
  apiUrl?: string;
  token?: string;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ScramboClient {
  constructor(options?: ScramboClientOptions);
  static fromEnv(options?: Omit<ScramboClientOptions, "apiUrl" | "token">): ScramboClient;
  withToken(token: string): ScramboClient;
  createSession(input: { project: string; canvas?: [number, number]; provider?: ProviderConfig }): Promise<Session>;
  getSession(sessionId: string): Promise<Session>;
  closeSession(sessionId: string): Promise<{ sessionId: string; state: "closed" }>;
  declareAsset(sessionId: string, input: { name: string; size: number; mimeType?: string; sha256: string }): Promise<Asset>;
  uploadAssetContent(sessionId: string, assetId: string, content: BodyInit, options?: { mimeType?: string; size?: number; signal?: AbortSignal }): Promise<{ assetId: string; uploaded: true; bytes: number }>;
  submitTurn(sessionId: string, turn: Record<string, unknown>): Promise<{ operationId: string; status: string }>;
  getOperation(operationId: string, after?: number): Promise<Operation>;
  pollOperation(operationId: string, options?: PollOptions): Promise<OperationResult>;
  createPublicSnapshot(sessionId: string, editId?: string): Promise<Record<string, unknown>>;
  createRenderHandoff(sessionId: string, input: { requestId: string; editId?: string }): Promise<{ operationId: string; status: string }>;
  getRenderHandoff(sessionId: string, handoffId: string): Promise<{ handoffId: string; editId: string; handoff: RenderHandoff }>;
}

export class StatefulSession {
  constructor(client: ScramboClient, session: Session);
  sessionId: string;
  currentEditId: string | null;
  closed: boolean;
  localAssets: { byAssetId: Map<string, string>; bySha256: Map<string, string> };
  refresh(): Promise<Session>;
  declareAndUpload(name: string, content: Uint8Array, mimeType?: string): Promise<Asset>;
  uploadFile(filePath: string, mimeType?: string): Promise<Asset>;
  ask(message: string, id?: string, options?: PollOptions): Promise<OperationResult>;
  edit(input: { agent: AgentId; message?: string; requestId?: string; baseEditId?: string; tools?: ToolId[]; toolConfig?: Partial<Record<ToolId, Record<string, unknown>>>; budgetUsd?: number; maxCalls?: number; name?: string }, options?: PollOptions): Promise<OperationResult>;
  createPublicSnapshot(editId?: string): Promise<Record<string, unknown>>;
  createRenderHandoff(options?: PollOptions, editId?: string): Promise<RenderHandoff>;
  close(): Promise<void>;
}

export function requestId(label?: string): string;
export function sha256Hex(content: Uint8Array): string;
