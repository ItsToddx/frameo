import type {
  RecipeRun as DomainRecipeRun,
  RecipeStep as DomainRecipeStep,
} from '../../core/src/recipe.js';
import type { Asset, EditCommand, Id, Sequence } from '../../core/src/model.js';
export type {
  Id,
  AssetKind,
  Asset,
  Track,
  Clip,
  Caption,
  Sequence,
  EditCommand,
} from '../../core/src/model.js';
export interface CanvasItem {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'asset' | 'sequence';
  refId: Id;
}
export interface CanvasLayout {
  revision: number;
  items: CanvasItem[];
}
import type { GenerationInput, Job } from '../../core/src/generation.js';
export type { GenerationInput, Job, JobStatus } from '../../core/src/generation.js';
export interface ChatMessage {
  id: Id;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  createdAt: string;
  agent?: string;
}
export interface Session {
  id: Id;
  title: string;
  messages: ChatMessage[];
}
export interface Memory {
  id: Id;
  scope: 'project' | 'user';
  content: string;
  revision: number;
  createdAt: string;
}
export interface Review {
  id: Id;
  kind: 'edit' | 'generation' | 'memory';
  title: string;
  description: string;
  status: 'pending' | 'accepted' | 'rejected';
  sequenceId?: Id;
  expectedRevision?: number;
  commands?: EditCommand[];
  generation?: GenerationInput;
  memory?: {
    scope: 'project' | 'user';
    content: string;
  };
  createdAt: string;
  recipeId?: Id;
  stepId?: Id;
  recipeAttempt?: number;
  jobId?: Id;
  configHash?: string;
  kitId?: Id;
  kitDigest?: string;
}
export interface RecipeStep extends DomainRecipeStep {}
export interface RecipeRun extends DomainRecipeRun {
  kitId: Id;
}
export interface KitInfo {
  id: Id;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  category: 'provider' | 'tool' | 'agent' | 'recipe';
  installed: boolean;
  enabled: boolean;
  source: string;
  permissions: string[];
  updateAvailable?: boolean;
}
export interface ProjectInfo {
  id: Id;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectSnapshot {
  project: ProjectInfo;
  sequences: Sequence[];
  assets: Asset[];
  canvas: CanvasLayout;
  jobs: Job[];
  sessions: Session[];
  memories: Memory[];
  reviews: Review[];
  recipes: RecipeRun[];
  canUndo: Record<string, boolean>;
  canRedo: Record<string, boolean>;
  eventSeq: number;
}
export interface Settings {
  arkBaseUrl: string;
  agentModel: string;
  seedanceModel: string;
  hasApiKey: boolean;
  generationCostLimit: number;
  maxModelCalls: number;
}
export interface AgentInput {
  requestId: Id;
  sessionId: Id;
  text: string;
  sequenceId?: Id;
  clipId?: Id;
}
export interface AppEvent {
  type: 'state' | 'chat.delta' | 'agent.status' | 'error';
  projectId?: Id;
  sessionId?: Id;
  runId?: Id;
  text?: string;
  status?: string;
  agent?: string;
  snapshot?: ProjectSnapshot;
}
export interface AppBootstrap {
  settings: Settings;
  recentProjects: ProjectInfo[];
  project: ProjectSnapshot | null;
  kits: KitInfo[];
  version: string;
}
