export type Id = string;
export type AssetKind = 'video' | 'image' | 'audio';
export interface Asset {
  id: Id; name: string; kind: AssetKind; path: string; url: string; thumbnailUrl?: string;
  hash: string; duration: number; width?: number; height?: number; hasAudio?: boolean;
  originJobId?: Id; createdAt: string;
}
export interface Track {id: Id; name: string; kind: 'video' | 'audio'; muted: boolean; locked: boolean}
export interface Clip {
  id: Id; trackId: Id; assetVersionId: Id; start: number; duration: number;
  sourceStart: number; audioGain: number; muted: boolean;
}
export interface Caption {id: Id; start: number; duration: number; text: string; fontSize: number; color: string; position: 'top' | 'center' | 'bottom'}
export interface Sequence {
  id: Id; name: string; revision: number; width: number; height: number; fps: number;
  tracks: Track[]; clips: Clip[]; captions: Caption[];
}
export type EditCommand =
  | {type: 'addTrack'; track: Track}
  | {type: 'updateTrack'; trackId: Id; patch: Partial<Pick<Track,'name'|'muted'|'locked'>>}
  | {type: 'removeTrack'; trackId: Id}
  | {type: 'addClip'; clip: Clip}
  | {type: 'updateClip'; clipId: Id; patch: Partial<Pick<Clip,'start'|'duration'|'sourceStart'|'trackId'|'audioGain'|'muted'>>}
  | {type: 'removeClip'; clipId: Id}
  | {type: 'splitClip'; clipId: Id; at: number; newClipId: Id}
  | {type: 'replaceClip'; clipId: Id; assetVersionId: Id; sourceStart: number}
  | {type: 'upsertCaption'; caption: Caption}
  | {type: 'removeCaption'; captionId: Id}
  | {type: 'sequenceSettings'; patch: Partial<Pick<Sequence,'name'|'width'|'height'|'fps'>>};
export interface CanvasItem {id: Id; x: number; y: number; width: number; height: number; kind: 'asset'|'sequence'; refId: Id}
export interface CanvasLayout {revision: number; items: CanvasItem[]}
export type JobStatus = 'queued'|'submitting'|'running'|'unknown'|'reconciling'|'finalizing'|'succeeded'|'failed'|'cancelled';
export interface Job {
  id: Id; requestId: Id; kind: 'seedance'|'export'|'preview'|'motion'; status: JobStatus;
  title: string; progress: number; createdAt: string; updatedAt: string;
  remoteId?: string; outputAssetId?: Id; outputPath?: string; error?: string;
  cancelRequested: boolean; input: Record<string, unknown>; estimatedCost?: number;
}
export interface ChatMessage {id: Id; role: 'user'|'assistant'|'tool'; text: string; createdAt: string; agent?: string}
export interface Session {id: Id; title: string; messages: ChatMessage[]}
export interface Memory {id: Id; scope: 'project'|'user'; content: string; revision: number; createdAt: string}
export interface Review {
  id: Id; kind: 'edit'|'generation'; title: string; description: string; status: 'pending'|'accepted'|'rejected';
  sequenceId?: Id; expectedRevision?: number; commands?: EditCommand[]; generation?: GenerationInput;
  createdAt: string;
}
export interface RecipeStep {id: Id; title: string; role: 'creative'|'visual'|'editor'; status: 'pending'|'running'|'review'|'completed'|'failed'|'stale'; result?: string; attempt: number}
export interface RecipeRun {id: Id; title: string; revision: number; status: 'running'|'paused'|'completed'|'failed'; steps: RecipeStep[]}
export interface KitInfo {id: Id; name: string; version: string; description: string; author: string; license: string; category: 'provider'|'tool'|'agent'|'recipe'; installed: boolean; enabled: boolean; source: string; permissions: string[]; updateAvailable?: boolean}
export interface ProjectInfo {id: Id; name: string; path: string; createdAt: string; updatedAt: string}
export interface ProjectSnapshot {
  project: ProjectInfo; sequences: Sequence[]; assets: Asset[]; canvas: CanvasLayout; jobs: Job[];
  sessions: Session[]; memories: Memory[]; reviews: Review[]; recipes: RecipeRun[];
  canUndo: Record<string,boolean>; canRedo: Record<string,boolean>; eventSeq: number;
}
export interface Settings {
  arkBaseUrl: string; agentModel: string; seedanceModel: string;
  hasApiKey: boolean; generationCostLimit: number; maxModelCalls: number;
}
export interface GenerationInput {
  requestId: Id; prompt: string; duration: number; ratio: '16:9'|'9:16'|'1:1';
  referenceAssetId?: Id; estimatedCost: number; model?: string;
}
export interface AgentInput {requestId: Id; sessionId: Id; text: string; sequenceId?: Id; clipId?: Id}
export interface AppEvent {type: 'state'|'chat.delta'|'agent.status'|'error'; projectId?: Id; sessionId?: Id; runId?: Id; text?: string; status?: string; agent?: string; snapshot?: ProjectSnapshot}
export interface AppBootstrap {settings: Settings; recentProjects: ProjectInfo[]; project: ProjectSnapshot|null; kits: KitInfo[]; version: string}
export interface DesktopApi {
  bootstrap(): Promise<AppBootstrap>;
  createProject(input: {name: string; width: number; height: number; fps: number}): Promise<ProjectSnapshot|null>;
  openProject(): Promise<ProjectSnapshot|null>;
  openRecent(path: string): Promise<ProjectSnapshot>;
  closeProject(): Promise<void>;
  snapshot(): Promise<ProjectSnapshot>;
  createSequence(input: {name: string; width: number; height: number; fps: number}): Promise<ProjectSnapshot>;
  importMedia(): Promise<ProjectSnapshot>;
  apply(input: {sequenceId: Id; expectedRevision: number; commandId: Id; commands: EditCommand[]}): Promise<ProjectSnapshot>;
  undo(sequenceId: Id): Promise<ProjectSnapshot>;
  redo(sequenceId: Id): Promise<ProjectSnapshot>;
  saveCanvas(input: {expectedRevision: number; items: CanvasItem[]}): Promise<ProjectSnapshot>;
  undoCanvas(): Promise<ProjectSnapshot>;
  generate(input: GenerationInput): Promise<Job>;
  cancelJob(jobId: Id): Promise<void>;
  reconcileJob(jobId: Id): Promise<void>;
  exportVideo(input: {sequenceId: Id; expectedRevision: number}): Promise<Job|null>;
  preview(input: {sequenceId: Id; expectedRevision: number}): Promise<Job>;
  revealFile(path: string): Promise<void>;
  createSession(title: string): Promise<ProjectSnapshot>;
  prompt(input: AgentInput): Promise<{runId: Id}>;
  stopAgent(): Promise<void>;
  decideReview(input: {reviewId: Id; decision: 'accept'|'reject'}): Promise<ProjectSnapshot>;
  saveMemory(input: {id?: Id; scope: 'project'|'user'; content: string; expectedRevision?: number}): Promise<ProjectSnapshot>;
  deleteMemory(input: {id: Id; scope: 'project'|'user'; expectedRevision: number}): Promise<ProjectSnapshot>;
  saveSettings(input: Omit<Settings,'hasApiKey'> & {apiKey?: string}): Promise<Settings>;
  listKits(): Promise<KitInfo[]>;
  setKitEnabled(input: {id: Id; enabled: boolean}): Promise<KitInfo[]>;
  installKit(id: Id): Promise<KitInfo[]>;
  importKit(): Promise<KitInfo[]>;
  uninstallKit(id: Id): Promise<KitInfo[]>;
  exportRecipe(input: {recipeId: Id}): Promise<string|null>;
  resumeRecipe(input: {recipeId: Id; redoStepId?: Id}): Promise<void>;
  exportProject(): Promise<string|null>;
  importProject(): Promise<ProjectSnapshot|null>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global {interface Window {reelbeam: DesktopApi}}
