import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommands,
  EditSequence,
  EditorError,
  immutableSequence,
  sequenceDuration,
  ticksToSeconds,
  validateCommands,
  validateSequence,
  type Asset,
  type Clip,
  type EditCommit,
  type EditHistory,
  type EditSequenceStore,
  type EditTransaction,
  type Sequence,
  type StoredEditReceipt,
} from '../packages/core/src/index.js';

const media = (id: string, kind: Asset['kind'] = 'video', duration = 20): Asset => ({
  id,
  kind,
  duration,
  name: id,
  path: `${id}.mp4`,
  url: `media://${id}`,
  hash: id,
  hasAudio: kind !== 'image',
  width: 1920,
  height: 1080,
  createdAt: '2026-10-13T00:00:00Z',
});
const assets = [
  media('a'),
  media('b'),
  media('short', 'video', 1),
  media('photo', 'image', 0),
  media('music', 'audio'),
];
const clip = (id = 'clip'): Clip => ({
  id,
  trackId: 'video',
  assetVersionId: 'a',
  start: 0,
  duration: 90,
  sourceStart: 1,
  audioGain: 0.8,
  muted: false,
});
const sequence = (): Sequence => ({
  id: 'sequence',
  name: 'Sequence',
  revision: 0,
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [
    { id: 'video', name: 'Video', kind: 'video', muted: false, locked: false },
    { id: 'audio', name: 'Audio', kind: 'audio', muted: false, locked: false },
  ],
  clips: [clip()],
  captions: [
    {
      id: 'caption',
      start: 15,
      duration: 30,
      text: 'Keep this text',
      fontSize: 36,
      color: '#ffffff',
      position: 'bottom',
    },
  ],
});
const error =
  (code: EditorError['code']) =>
  (value: unknown): boolean =>
    value instanceof EditorError && value.code === code;

test('a batch is one immutable revision and does not mutate its inputs', () => {
  const initial = sequence();
  const result = applyCommands(initial, assets, [
    {
      type: 'updateClip',
      clipId: 'clip',
      patch: { start: 30, duration: 60, sourceStart: 2, muted: true },
    },
    { type: 'updateTrack', trackId: 'audio', patch: { name: 'Music', muted: true } },
  ]);
  assert.equal(result.revision, 1);
  assert.equal(result.clips[0].start, 30);
  assert.equal(initial.revision, 0);
  assert.equal(initial.clips[0].start, 0);
  assert.equal(initial.tracks[1].name, 'Audio');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.clips));
  assert.ok(Object.isFrozen(result.clips[0]));
  assert.throws(() => {
    result.clips[0].duration = 1;
  }, TypeError);
});

test('invalid final state rejects the whole batch, and intermediate overlaps may be resolved', () => {
  const initial = sequence();
  assert.throws(
    () =>
      applyCommands(initial, assets, [
        { type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.3 } },
        { type: 'replaceClip', clipId: 'clip', assetVersionId: 'short', sourceStart: 0 },
      ]),
    error('INVALID_MEDIA'),
  );
  assert.equal(initial.clips[0].audioGain, 0.8);
  assert.equal(initial.revision, 0);
  const result = applyCommands(initial, assets, [
    { type: 'addClip', clip: { ...clip('second'), start: 60 } },
    { type: 'updateClip', clipId: 'clip', patch: { duration: 60 } },
  ]);
  assert.equal(result.clips[0].start + result.clips[0].duration, result.clips[1].start);
});

test('replacement preserves identity, position, duration, audio and independent captions', () => {
  const initial = sequence();
  const result = applyCommands(initial, assets, [
    { type: 'replaceClip', clipId: 'clip', assetVersionId: 'b', sourceStart: 4 },
  ]);
  assert.deepEqual(result.clips[0], { ...initial.clips[0], assetVersionId: 'b', sourceStart: 4 });
  assert.deepEqual(result.captions, initial.captions);
  assert.equal(initial.clips[0].assetVersionId, 'a');
  assert.throws(
    () =>
      applyCommands(initial, assets, [
        { type: 'replaceClip', clipId: 'clip', assetVersionId: 'b', sourceStart: 18 },
      ]),
    error('INVALID_MEDIA'),
  );
});

test('splits conserve timeline duration and share the exact source boundary with audio sample precision', () => {
  const initial = sequence();
  initial.clips = [
    {
      ...clip(),
      trackId: 'audio',
      assetVersionId: 'music',
      sourceStart: 127 / 48000,
      start: 11,
      duration: 101,
    },
  ];
  const result = applyCommands(initial, assets, [
    { type: 'splitClip', clipId: 'clip', at: 48, newClipId: 'right' },
  ]);
  const [left, right] = result.clips;
  assert.equal(left.start + left.duration, right.start);
  assert.equal(left.duration + right.duration, initial.clips[0].duration);
  assert.equal(left.sourceStart + left.duration / initial.fps, right.sourceStart);
  assert.equal(left.sourceStart, 127 / 48000);
  assert.equal(right.audioGain, left.audioGain);
  assert.deepEqual(result.captions, initial.captions);
  for (const at of [11, 112, 48.5])
    assert.throws(
      () =>
        applyCommands(initial, assets, [
          { type: 'splitClip', clipId: 'clip', at, newClipId: 'right' },
        ]),
      error('INVALID_TIME'),
    );
});

test('images can have arbitrary timeline duration and split at source offset zero', () => {
  const initial = sequence();
  initial.clips = [{ ...clip(), assetVersionId: 'photo', sourceStart: 0, duration: 900 }];
  const result = applyCommands(initial, assets, [
    { type: 'splitClip', clipId: 'clip', at: 333, newClipId: 'right' },
  ]);
  assert.deepEqual(
    result.clips.map((item) => item.sourceStart),
    [0, 0],
  );
  assert.throws(
    () =>
      applyCommands(initial, assets, [
        { type: 'updateClip', clipId: 'clip', patch: { sourceStart: 1 } },
      ]),
    error('INVALID_MEDIA'),
  );
});

test('same-track overlap fails while composited video tracks may overlap', () => {
  assert.throws(
    () =>
      applyCommands(sequence(), assets, [
        { type: 'addClip', clip: { ...clip('second'), start: 89 } },
      ]),
    error('OVERLAP'),
  );
  const result = applyCommands(sequence(), assets, [
    {
      type: 'addTrack',
      track: { id: 'upper', name: 'Upper', kind: 'video', locked: false, muted: false },
    },
    { type: 'addClip', clip: { ...clip('second'), trackId: 'upper', start: 15 } },
  ]);
  assert.equal(result.clips.length, 2);
  assert.throws(
    () =>
      applyCommands(sequence(), assets, [
        { type: 'updateClip', clipId: 'clip', patch: { trackId: 'audio' } },
        { type: 'replaceClip', clipId: 'clip', assetVersionId: 'photo', sourceStart: 0 },
      ]),
    error('INVALID_MEDIA'),
  );
});

test('locks protect add, move, trim, split, delete and replacement, including target tracks', () => {
  const initial = sequence();
  initial.tracks[0].locked = true;
  const commands = [
    { type: 'addClip', clip: { ...clip('second'), start: 120 } },
    { type: 'updateClip', clipId: 'clip', patch: { start: 30 } },
    { type: 'updateClip', clipId: 'clip', patch: { duration: 60 } },
    { type: 'splitClip', clipId: 'clip', at: 30, newClipId: 'right' },
    { type: 'removeClip', clipId: 'clip' },
    { type: 'replaceClip', clipId: 'clip', assetVersionId: 'b', sourceStart: 0 },
    { type: 'removeTrack', trackId: 'video' },
  ] as const;
  for (const command of commands)
    assert.throws(() => applyCommands(initial, assets, [command]), error('TRACK_LOCKED'));
  const move = sequence();
  move.tracks[1].locked = true;
  assert.throws(
    () =>
      applyCommands(move, assets, [
        { type: 'updateClip', clipId: 'clip', patch: { trackId: 'audio' } },
      ]),
    error('TRACK_LOCKED'),
  );
  const unlocked = applyCommands(initial, assets, [
    { type: 'updateTrack', trackId: 'video', patch: { locked: false } },
    { type: 'removeClip', clipId: 'clip' },
  ]);
  assert.equal(unlocked.clips.length, 0);
});

test('track removal cascades its clips and leaves captions and unrelated tracks intact', () => {
  const result = applyCommands(sequence(), assets, [{ type: 'removeTrack', trackId: 'video' }]);
  assert.equal(result.clips.length, 0);
  assert.deepEqual(
    result.tracks.map((track) => track.id),
    ['audio'],
  );
  assert.equal(result.captions[0].text, 'Keep this text');
});

test('caption editing and frame-rate changes preserve shared boundaries and real-time positions', () => {
  const initial = sequence();
  initial.clips.push({ ...clip('second'), start: 90, duration: 60 });
  const result = applyCommands(initial, assets, [
    {
      type: 'upsertCaption',
      caption: {
        ...initial.captions[0],
        text: 'Edited',
        fontSize: 48,
        color: '#ff8800',
        position: 'top',
      },
    },
    { type: 'sequenceSettings', patch: { fps: 24, width: 1080, height: 1920, name: 'Portrait' } },
  ]);
  assert.deepEqual(
    result.clips.map((item) => [item.start, item.duration]),
    [
      [0, 72],
      [72, 48],
    ],
  );
  assert.equal(result.clips[1].sourceStart, 1);
  assert.equal(result.captions[0].start, 12);
  assert.equal(result.captions[0].duration, 24);
  assert.equal(result.captions[0].text, 'Edited');
  assert.equal(result.name, 'Portrait');
  assert.equal(ticksToSeconds(sequenceDuration(result), result.fps), 5);
  const removed = applyCommands(result, assets, [{ type: 'removeCaption', captionId: 'caption' }]);
  assert.equal(removed.captions.length, 0);
});

test('invalid IDs, dimensions, frame rates, unsafe ticks, source ranges and duplicate IDs are rejected', () => {
  for (const fps of [0, 121, 29.97, NaN])
    assert.throws(() => validateSequence({ ...sequence(), fps }, assets), error('INVALID_TIME'));
  for (const width of [0, 8194, Number.MAX_SAFE_INTEGER])
    assert.throws(() => validateSequence({ ...sequence(), width }, assets), error('INVALID_TIME'));
  assert.throws(
    () => validateSequence({ ...sequence(), width: 1919 }, assets),
    error('INVALID_SEQUENCE'),
  );
  assert.throws(
    () =>
      applyCommands(sequence(), assets, [
        { type: 'updateClip', clipId: 'clip', patch: { start: Number.MAX_SAFE_INTEGER } },
      ]),
    error('INVALID_TIME'),
  );
  assert.throws(
    () =>
      applyCommands(sequence(), assets, [
        { type: 'updateClip', clipId: 'clip', patch: { duration: 0 } },
      ]),
    error('INVALID_TIME'),
  );
  assert.throws(
    () =>
      applyCommands(sequence(), assets, [
        { type: 'updateClip', clipId: 'clip', patch: { sourceStart: -1 } },
      ]),
    error('INVALID_TIME'),
  );
  assert.throws(
    () => applyCommands(sequence(), assets, [{ type: 'addClip', clip: clip() }]),
    error('DUPLICATE_ID'),
  );
  assert.throws(
    () =>
      applyCommands({ ...sequence(), revision: Number.MAX_SAFE_INTEGER }, assets, [
        { type: 'updateClip', clipId: 'clip', patch: { muted: true } },
      ]),
    error('INVALID_TIME'),
  );
  assert.throws(() => applyCommands(sequence(), assets, []), error('INVALID_COMMAND'));
});

class MemoryStore implements EditSequenceStore {
  current = sequence();
  assets = [...assets];
  history: EditHistory = { undo: [], redo: [] };
  receipts = new Map<string, StoredEditReceipt>();
  commits = 0;
  failCommit = false;
  transaction<T>(work: (transaction: EditTransaction) => T): T {
    const rollback = {
      current: this.current,
      history: this.history,
      receipts: new Map(this.receipts),
      commits: this.commits,
    };
    try {
      return work({
        getSequence: (id) => (id === this.current.id ? this.current : undefined),
        getAssets: () => this.assets,
        getHistory: () => this.history,
        getReceipt: (id) => this.receipts.get(id),
        commit: (change) => this.commit(change),
      });
    } catch (error) {
      Object.assign(this, rollback);
      throw error;
    }
  }
  private commit(change: EditCommit): void {
    this.current = change.sequence;
    this.history = change.history;
    this.receipts.set(change.receipt.commandId, change.receipt);
    this.commits++;
    if (this.failCommit) throw new Error('Disk full');
  }
}
const request = (commandId: string, expectedRevision: number) => ({
  sequenceId: 'sequence',
  commandId,
  expectedRevision,
});

test('preflight predicts an edit without revision, history, receipt or persistence changes', () => {
  const store = new MemoryStore(),
    editor = new EditSequence(store);
  const commands = [{ type: 'updateClip', clipId: 'clip', patch: { muted: true } }] as const;
  const direct = validateCommands(store.current, assets, commands);
  const preview = editor.validate({ sequenceId: 'sequence', expectedRevision: 0, commands });
  assert.equal(direct.revision, 0);
  assert.equal(preview.sequence.revision, 0);
  assert.equal(preview.sequence.clips[0].muted, true);
  assert.equal(store.current.clips[0].muted, false);
  assert.equal(store.commits, 0);
  assert.equal(store.history.undo.length, 0);
  assert.equal(store.receipts.size, 0);
});

test('revision conflicts require rereading and idempotent retry returns the original receipt after later edits', () => {
  const store = new MemoryStore(),
    editor = new EditSequence(store);
  const first = {
    ...request('edit-1', 0),
    commands: [
      { type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.5, muted: true } },
    ] as const,
  };
  const saved = editor.apply(first);
  editor.apply({
    ...request('edit-2', 1),
    commands: [{ type: 'updateTrack', trackId: 'audio', patch: { name: 'Score' } }],
  });
  const retried = editor.apply({
    ...first,
    commands: [{ type: 'updateClip', clipId: 'clip', patch: { muted: true, audioGain: 0.5 } }],
  });
  assert.deepEqual(retried, saved);
  assert.equal(retried.revision, 1);
  assert.equal(store.current.revision, 2);
  assert.equal(store.commits, 2);
  assert.throws(() => editor.apply({ ...first, commandId: 'stale' }), error('REVISION_CONFLICT'));
  assert.throws(
    () => editor.apply({ ...first, commands: [{ type: 'removeClip', clipId: 'clip' }] }),
    error('IDEMPOTENCY_CONFLICT'),
  );
});

test('undo and redo affect only the latest shared edit and each produce a fresh revision', () => {
  const store = new MemoryStore(),
    editor = new EditSequence(store);
  editor.apply({
    ...request('caption-edit', 0),
    commands: [
      { type: 'upsertCaption', caption: { ...store.current.captions[0], text: 'Human subtitle' } },
    ],
  });
  editor.apply({
    ...request('agent-replace', 1),
    commands: [{ type: 'replaceClip', clipId: 'clip', assetVersionId: 'b', sourceStart: 2 }],
  });
  const undone = editor.undo(request('undo-1', 2));
  assert.equal(undone.revision, 3);
  assert.equal(undone.sequence.clips[0].assetVersionId, 'a');
  assert.equal(undone.sequence.captions[0].text, 'Human subtitle');
  const redone = editor.redo(request('redo-1', 3));
  assert.equal(redone.revision, 4);
  assert.equal(redone.sequence.clips[0].assetVersionId, 'b');
  assert.equal(redone.sequence.captions[0].text, 'Human subtitle');
  editor.undo(request('undo-2', 4));
  editor.undo(request('undo-3', 5));
  assert.equal(store.current.revision, 6);
  assert.equal(store.current.captions[0].text, 'Keep this text');
  editor.redo(request('redo-2', 6));
  editor.redo(request('redo-3', 7));
  assert.equal(store.current.revision, 8);
  assert.equal(store.current.captions[0].text, 'Human subtitle');
});

test('new edits clear redo and changed current state cannot be overwritten by old history', () => {
  const store = new MemoryStore(),
    editor = new EditSequence(store);
  editor.apply({
    ...request('edit-1', 0),
    commands: [{ type: 'updateClip', clipId: 'clip', patch: { muted: true } }],
  });
  editor.undo(request('undo-1', 1));
  editor.apply({
    ...request('edit-2', 2),
    commands: [{ type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.4 } }],
  });
  assert.throws(() => editor.redo(request('redo-1', 3)), error('HISTORY_EMPTY'));
  store.current = immutableSequence({ ...store.current, name: 'External edit' });
  assert.throws(() => editor.undo(request('undo-2', 3)), error('HISTORY_CONFLICT'));
  assert.equal(store.current.name, 'External edit');
  assert.equal(store.history.undo.length, 1);
});

test('undo revalidates available assets and a failed transaction preserves revision and history', () => {
  const store = new MemoryStore(),
    editor = new EditSequence(store);
  store.failCommit = true;
  assert.throws(
    () =>
      editor.apply({
        ...request('failed-edit', 0),
        commands: [{ type: 'updateClip', clipId: 'clip', patch: { muted: true } }],
      }),
    /Disk full/,
  );
  assert.equal(store.current.revision, 0);
  assert.equal(store.history.undo.length, 0);
  assert.equal(store.receipts.size, 0);
  store.failCommit = false;
  editor.apply({
    ...request('replace', 0),
    commands: [{ type: 'replaceClip', clipId: 'clip', assetVersionId: 'b', sourceStart: 2 }],
  });
  store.assets = store.assets.filter((asset) => asset.id !== 'a');
  assert.throws(() => editor.undo(request('undo-missing', 1)), error('NOT_FOUND'));
  assert.equal(store.current.revision, 1);
  assert.equal(store.history.undo.length, 1);
  assert.equal(store.history.redo.length, 0);
});
