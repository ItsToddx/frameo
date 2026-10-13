import { applyCommands, immutableSequence, validateCommands, validateSequence } from './editor.js';
import { EditorError, type Asset, type EditCommand, type Sequence } from './model.js';

export interface EditHistoryEntry {
  id: string;
  before: Sequence;
  after: Sequence;
}
export interface EditHistory {
  undo: EditHistoryEntry[];
  redo: EditHistoryEntry[];
}
export interface StoredEditReceipt {
  commandId: string;
  requestKey: string;
  sequenceId: string;
  previousRevision: number;
  revision: number;
  kind: 'apply' | 'undo' | 'redo';
  sequence: Sequence;
}
export interface EditCommit {
  sequence: Sequence;
  history: EditHistory;
  receipt: StoredEditReceipt;
}

/** An adapter must commit sequence, history, receipt and its event in one transaction.
 * A thrown callback rolls back all writes. No external calls belong in this transaction.
 */
export interface EditTransaction {
  getSequence(sequenceId: string): Sequence | undefined;
  getAssets(): readonly Asset[];
  getHistory(sequenceId: string): EditHistory;
  getReceipt(commandId: string): StoredEditReceipt | undefined;
  commit(change: EditCommit): void;
}
export interface EditSequenceStore {
  transaction<T>(work: (transaction: EditTransaction) => T): T;
}
export interface EditRequest {
  sequenceId: string;
  expectedRevision: number;
  commandId: string;
  commands: readonly EditCommand[];
}
export interface HistoryRequest {
  sequenceId: string;
  expectedRevision: number;
  commandId: string;
}
export interface ValidationRequest {
  sequenceId: string;
  expectedRevision: number;
  commands: readonly EditCommand[];
}
export interface EditPreview {
  sequenceId: string;
  previousRevision: number;
  sequence: Sequence;
}

/** Deterministic JSON representation makes property order irrelevant to retries. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
function sameContent(a: Sequence, b: Sequence): boolean {
  return canonical({ ...a, revision: 0 }) === canonical({ ...b, revision: 0 });
}
function checkRequest(request: HistoryRequest | ValidationRequest): void {
  if (
    typeof request.sequenceId !== 'string' ||
    !request.sequenceId.trim() ||
    request.sequenceId.length > 256
  ) {
    throw new EditorError('INVALID_COMMAND', 'A valid sequence ID is required');
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new EditorError(
      'INVALID_COMMAND',
      'Expected revision must be a non-negative safe integer',
    );
  }
  if (
    'commandId' in request &&
    (typeof request.commandId !== 'string' ||
      !request.commandId.trim() ||
      request.commandId.length > 256)
  ) {
    throw new EditorError('INVALID_COMMAND', 'A valid command ID is required');
  }
}
function requireSequence(
  transaction: EditTransaction,
  request: HistoryRequest | ValidationRequest,
): Sequence {
  const sequence = transaction.getSequence(request.sequenceId);
  if (!sequence)
    throw new EditorError('NOT_FOUND', `Sequence ${request.sequenceId} does not exist`);
  if (sequence.revision !== request.expectedRevision) {
    throw new EditorError(
      'REVISION_CONFLICT',
      'The sequence changed. Read its latest revision and replan this edit.',
      {
        expectedRevision: request.expectedRevision,
        actualRevision: sequence.revision,
      },
    );
  }
  return sequence;
}

/** Shared application use case for manual edits and agent proposals. */
export class EditSequence {
  constructor(private readonly store: EditSequenceStore) {}

  validate(request: ValidationRequest): EditPreview {
    checkRequest(request);
    return this.store.transaction((transaction) => {
      const current = requireSequence(transaction, request);
      const sequence = validateCommands(current, transaction.getAssets(), request.commands);
      return { sequenceId: sequence.id, previousRevision: current.revision, sequence };
    });
  }

  apply(request: EditRequest): StoredEditReceipt {
    return this.edit('apply', request);
  }

  undo(request: HistoryRequest): StoredEditReceipt {
    return this.edit('undo', request);
  }

  redo(request: HistoryRequest): StoredEditReceipt {
    return this.edit('redo', request);
  }

  private edit(
    kind: StoredEditReceipt['kind'],
    request: HistoryRequest | EditRequest,
  ): StoredEditReceipt {
    checkRequest(request);
    const requestKey = canonical({ kind, ...request });
    return this.store.transaction((transaction) => {
      // Lookup occurs before the revision check: a successful timed-out save is safe to retry.
      const existing = transaction.getReceipt(request.commandId);
      if (existing) {
        if (existing.requestKey !== requestKey)
          throw new EditorError(
            'IDEMPOTENCY_CONFLICT',
            'This command ID was already used with different input',
          );
        return Object.freeze({ ...existing, sequence: immutableSequence(existing.sequence) });
      }
      const current = requireSequence(transaction, request);
      const assets = transaction.getAssets();
      const savedHistory = transaction.getHistory(current.id);
      const history: EditHistory = { undo: [...savedHistory.undo], redo: [...savedHistory.redo] };
      let sequence: Sequence;
      if (kind === 'apply') {
        if (!('commands' in request))
          throw new EditorError('INVALID_COMMAND', 'Edit commands are required');
        sequence = applyCommands(current, assets, request.commands);
        history.undo.push({
          id: request.commandId,
          before: immutableSequence(current),
          after: sequence,
        });
        history.redo = [];
      } else {
        const stack = kind === 'undo' ? history.undo : history.redo;
        const entry = stack.at(-1);
        if (!entry) throw new EditorError('HISTORY_EMPTY', `There is no edit to ${kind}`);
        const expected = kind === 'undo' ? entry.after : entry.before;
        if (!sameContent(current, expected)) {
          throw new EditorError(
            'HISTORY_CONFLICT',
            `The latest ${kind} entry no longer matches the current sequence`,
          );
        }
        // Restore only the latest matching edit, validate current media, and create a new revision.
        const target = kind === 'undo' ? entry.before : entry.after;
        sequence = { ...target, revision: current.revision + 1 };
        validateSequence(sequence, assets);
        sequence = immutableSequence(sequence);
        stack.pop();
        (kind === 'undo' ? history.redo : history.undo).push(entry);
      }
      const receipt: StoredEditReceipt = Object.freeze({
        commandId: request.commandId,
        requestKey,
        sequenceId: sequence.id,
        previousRevision: current.revision,
        revision: sequence.revision,
        kind,
        sequence,
      });
      transaction.commit({ sequence, history, receipt });
      return receipt;
    });
  }
}
