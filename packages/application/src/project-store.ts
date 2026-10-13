import type { CanvasLayout, ChatMessage, Job, Memory, ProjectSnapshot, Sequence } from './model.js';
import type { RunBudget } from '../../core/src/request-budget.js';
interface HistoryEntry {
  before: Sequence;
  after: Sequence;
  commandId: string;
}
export interface ProjectState extends ProjectSnapshot {
  formatVersion: 1;
  undo: Record<string, HistoryEntry[]>;
  redo: Record<string, HistoryEntry[]>;
  canvasUndo: (CanvasLayout & {
    afterIds?: string[];
  })[];
  canvasRedo: CanvasLayout[];
  budgets?: Record<string, RunBudget>;
  agentRuns?: Record<
    string,
    {
      rootRequestId: string;
      sessionId: string;
      status: string;
      sequenceId?: string;
      clipId?: string;
    }
  >;
}
/** Atomic project transaction; thrown callbacks roll back state, receipts, and event. */
export interface ProjectStore {
  readonly directory: string;
  read(): ProjectState;
  transaction<T>(work: (state: ProjectState) => T, event?: string): T;
  receipt<T>(requestId: string, payload: unknown): T | undefined;
  storedReceipt<T>(requestId: string): T | undefined;
  saveReceipt(requestId: string, payload: unknown, result: unknown): void;
  snapshot(userMemories?: Memory[]): ProjectSnapshot;
  updateJob(jobId: string, patch: Partial<Job>): void;
  appendMessage(sessionId: string, message: ChatMessage): void;
}
export interface UserMemoryRepository {
  read(): Memory[];
  save(memories: Memory[]): void;
}
export interface IdentityClock {
  id(): string;
  now(): string;
}
