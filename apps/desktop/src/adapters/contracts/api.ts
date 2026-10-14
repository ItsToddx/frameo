// Desktop transport facade. Application contracts own the data shapes.
import type {
  AgentInput,
  AppBootstrap,
  AppEvent,
  CanvasItem,
  EditCommand,
  GenerationInput,
  Id,
  Job,
  KitInfo,
  ProjectSnapshot,
  Settings,
} from '../../../../../packages/application/src/model.js';
export * from '../../../../../packages/application/src/model.js';
export interface DesktopApi {
  bootstrap(): Promise<AppBootstrap>;
  createProject(input: {
    name: string;
    width: number;
    height: number;
    fps: number;
  }): Promise<ProjectSnapshot | null>;
  openProject(): Promise<ProjectSnapshot | null>;
  openRecent(path: string): Promise<ProjectSnapshot>;
  closeProject(): Promise<void>;
  snapshot(): Promise<ProjectSnapshot>;
  createSequence(input: {
    name: string;
    width: number;
    height: number;
    fps: number;
  }): Promise<ProjectSnapshot>;
  importMedia(): Promise<ProjectSnapshot>;
  beginEdit(input: { sequenceId: Id; interactionId: Id }): Promise<void>;
  endEdit(input: { sequenceId: Id; interactionId: Id }): Promise<void>;
  apply(input: {
    sequenceId: Id;
    expectedRevision: number;
    commandId: Id;
    commands: EditCommand[];
    interactionId?: Id;
  }): Promise<ProjectSnapshot>;
  undo(input: {
    sequenceId: Id;
    expectedRevision: number;
    commandId: Id;
  }): Promise<ProjectSnapshot>;
  redo(input: {
    sequenceId: Id;
    expectedRevision: number;
    commandId: Id;
  }): Promise<ProjectSnapshot>;
  saveCanvas(input: { expectedRevision: number; items: CanvasItem[] }): Promise<ProjectSnapshot>;
  undoCanvas(): Promise<ProjectSnapshot>;
  generate(input: GenerationInput): Promise<Job>;
  cancelJob(jobId: Id): Promise<void>;
  reconcileJob(jobId: Id): Promise<void>;
  exportVideo(input: { sequenceId: Id; expectedRevision: number }): Promise<Job | null>;
  preview(input: { sequenceId: Id; expectedRevision: number }): Promise<Job>;
  revealFile(path: string): Promise<void>;
  createSession(title: string): Promise<ProjectSnapshot>;
  prompt(input: AgentInput): Promise<{ runId: Id }>;
  stopAgent(): Promise<void>;
  decideReview(input: { reviewId: Id; decision: 'accept' | 'reject' }): Promise<ProjectSnapshot>;
  saveMemory(input: {
    id?: Id;
    scope: 'project' | 'user';
    content: string;
    expectedRevision?: number;
  }): Promise<ProjectSnapshot>;
  deleteMemory(input: {
    id: Id;
    scope: 'project' | 'user';
    expectedRevision: number;
  }): Promise<ProjectSnapshot>;
  setLanguage(language: 'en' | 'zh-CN'): Promise<Settings>;
  saveSettings(
    input: Omit<Settings, 'hasApiKey' | 'language'> & { apiKey?: string },
  ): Promise<Settings>;
  listKits(): Promise<KitInfo[]>;
  setKitEnabled(input: { id: Id; enabled: boolean }): Promise<KitInfo[]>;
  installKit(id: Id): Promise<KitInfo[]>;
  importKit(): Promise<KitInfo[]>;
  uninstallKit(id: Id): Promise<KitInfo[]>;
  exportRecipe(input: { recipeId: Id }): Promise<string | null>;
  startRecipe(input: {
    kitId: Id;
    title: string;
    sequenceId?: Id;
    input?: Record<string, unknown>;
  }): Promise<ProjectSnapshot>;
  resumeRecipe(input: { recipeId: Id; redoStepId?: Id }): Promise<void>;
  decideRecipeInput(input: {
    recipeId: Id;
    expectedRevision: number;
    stepId: Id;
    inputHash: string;
    decision: 'accept' | 'reject';
  }): Promise<ProjectSnapshot>;
  decideRecipeResult(input: {
    recipeId: Id;
    expectedRevision: number;
    stepId: Id;
    attempt: number;
    resultHash: string;
    decision: 'accept' | 'reject';
  }): Promise<ProjectSnapshot>;
  exportProject(): Promise<string | null>;
  importProject(): Promise<ProjectSnapshot | null>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    framo: DesktopApi;
  }
}
