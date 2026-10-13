import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Asset, Clip, EditCommand } from '../apps/desktop/src/adapters/contracts/api';
import { AppDatabase, ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { ProjectService } from '../apps/desktop/src/adapters/storage/project-service';

const asset = (id: string, originJobId?: string): Asset => ({
  id,
  originJobId,
  name: id,
  kind: 'video',
  path: `media/${id}.mp4`,
  url: '',
  hash: id,
  duration: 10,
  hasAudio: true,
  createdAt: new Date().toISOString(),
});
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-storage-'));
  const app = new AppDatabase(join(directory, 'app'));
  let database = ProjectDatabase.create(
    join(directory, 'project'),
    'Persistent project',
    320,
    180,
    24,
  );
  let service = new ProjectService(database, app);
  t.after(async () => {
    database.close();
    app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    app,
    get database() {
      return database;
    },
    get service() {
      return service;
    },
    reopen() {
      const projectDirectory = database.directory;
      database.close();
      database = new ProjectDatabase(projectDirectory);
      service = new ProjectService(database, app);
    },
  };
}
function addClip(service: ProjectService, commandId = 'add-clip') {
  const current = service.snapshot().sequences[0];
  const clip: Clip = {
    id: 'clip',
    trackId: current.tracks[0].id,
    assetVersionId: 'original',
    start: 0,
    duration: 48,
    sourceStart: 1,
    audioGain: 0.5,
    muted: false,
  };
  return service.apply({
    sequenceId: current.id,
    expectedRevision: current.revision,
    commandId,
    commands: [{ type: 'addClip', clip }],
  });
}
function apply(service: ProjectService, commandId: string, commands: EditCommand[]) {
  const sequence = service.snapshot().sequences[0];
  return service.apply({
    sequenceId: sequence.id,
    expectedRevision: sequence.revision,
    commandId,
    commands,
  });
}

test('SQLite edits, history, receipts and event sequence survive close and reopen', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  const saved = addClip(f.service);
  assert.equal(saved.sequences[0].revision, 1);
  assert.equal(saved.canUndo[saved.sequences[0].id], true);
  f.reopen();
  const reopened = f.service.snapshot();
  assert.deepEqual(reopened, saved);
  const header = await readFile(join(f.database.directory, 'project.sqlite'));
  assert.equal(header.subarray(0, 16).toString(), 'SQLite format 3\0');
  const sequence = reopened.sequences[0];
  const originalRequest = {
    sequenceId: sequence.id,
    expectedRevision: 0,
    commandId: 'add-clip',
    commands: [{ type: 'addClip', clip: sequence.clips[0] }] as EditCommand[],
  };
  const retry = f.service.apply(originalRequest);
  assert.equal(retry.eventSeq, saved.eventSeq);
  assert.equal(retry.sequences[0].revision, 1);
  assert.throws(() => f.service.apply({ ...originalRequest, commandId: 'stale-edit' }));
  assert.throws(() =>
    f.service.apply({ ...originalRequest, commands: [{ type: 'removeClip', clipId: 'clip' }] }),
  );
  assert.equal(f.service.snapshot().eventSeq, saved.eventSeq);
  const undone = f.service.history(sequence.id, 'undo');
  assert.equal(undone.sequences[0].revision, 2);
  assert.equal(undone.sequences[0].clips.length, 0);
  f.reopen();
  const redone = f.service.history(sequence.id, 'redo');
  assert.equal(redone.sequences[0].revision, 3);
  assert.equal(redone.sequences[0].clips[0].id, 'clip');
});

test('retry treats identical JSON fields in a different property order as the same request', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  addClip(f.service);
  const sequence = f.service.snapshot().sequences[0];
  const request = {
    sequenceId: sequence.id,
    expectedRevision: 1,
    commandId: 'gain-edit',
    commands: [
      { type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.25, muted: true } },
    ] as EditCommand[],
  };
  f.service.apply(request);
  const before = f.service.snapshot();
  f.service.apply({
    commands: [{ patch: { muted: true, audioGain: 0.25 }, clipId: 'clip', type: 'updateClip' }],
    commandId: 'gain-edit',
    expectedRevision: 1,
    sequenceId: sequence.id,
  });
  assert.deepEqual(f.service.snapshot(), before);
});

test('an invalid atomic edit writes no sequence, undo record, receipt or event', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  addClip(f.service);
  const before = f.database.read();
  assert.throws(() =>
    apply(f.service, 'invalid-batch', [
      { type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.1 } },
      { type: 'replaceClip', clipId: 'clip', assetVersionId: 'missing', sourceStart: 0 },
    ]),
  );
  assert.deepEqual(f.database.read(), before);
  assert.equal(
    f.database.db.prepare('SELECT count(*) AS count FROM receipts WHERE id=?').get('invalid-batch')
      ?.count,
    0,
  );
  assert.equal(
    f.database.db.prepare('SELECT count(*) AS count FROM events').get()?.count,
    before.eventSeq,
  );
  assert.throws(
    () =>
      f.database.transaction((state) => {
        state.sequences[0].name = 'Partial write';
        f.database.saveReceipt('partial', { id: 'partial' }, {});
        throw new Error('Disk failure');
      }),
    /Disk failure/,
  );
  assert.deepEqual(f.database.read(), before);
  assert.equal(f.database.receipt('partial', { id: 'partial' }), undefined);
});

test('manual subtitle edits and subsequent agent replacements share latest-only undo and redo', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  f.database.addAsset(asset('candidate', 'generation'));
  addClip(f.service);
  apply(f.service, 'human-subtitle', [
    {
      type: 'upsertCaption',
      caption: {
        id: 'subtitle',
        start: 0,
        duration: 48,
        text: '手动调整的字幕',
        fontSize: 30,
        color: '#ffffff',
        position: 'bottom',
      },
    },
  ]);
  apply(f.service, 'agent-replacement', [
    { type: 'replaceClip', clipId: 'clip', assetVersionId: 'candidate', sourceStart: 2 },
  ]);
  const target = f.service.snapshot().sequences[0].id;
  const undone = f.service.history(target, 'undo').sequences[0];
  assert.equal(undone.revision, 4);
  assert.equal(undone.clips[0].assetVersionId, 'original');
  assert.equal(undone.captions[0].text, '手动调整的字幕');
  const redone = f.service.history(target, 'redo').sequences[0];
  assert.equal(redone.revision, 5);
  assert.equal(redone.clips[0].assetVersionId, 'candidate');
  assert.equal(redone.captions[0].text, '手动调整的字幕');
  f.service.history(target, 'undo');
  apply(f.service, 'new-volume', [
    { type: 'updateClip', clipId: 'clip', patch: { audioGain: 0.8 } },
  ]);
  assert.throws(() => f.service.history(target, 'redo'));
  assert.equal(f.service.snapshot().canRedo[target], false);
  assert.equal(f.database.read().assets.length, 2);
});

test('undo refuses a changed history condition and missing source media without consuming history', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  f.database.addAsset(asset('candidate'));
  addClip(f.service);
  apply(f.service, 'replacement', [
    { type: 'replaceClip', clipId: 'clip', assetVersionId: 'candidate', sourceStart: 2 },
  ]);
  const target = f.service.snapshot().sequences[0].id;
  f.database.transaction((state) => {
    state.assets = state.assets.filter((a) => a.id !== 'original');
  });
  const beforeMissing = f.database.read();
  assert.throws(() => f.service.history(target, 'undo'));
  assert.deepEqual(f.database.read(), beforeMissing);
  f.database.addAsset(asset('original'));
  f.database.transaction((state) => {
    state.sequences[0].name = 'A later external modification';
    state.sequences[0].revision++;
  });
  const beforeChanged = f.database.read();
  assert.throws(() => f.service.history(target, 'undo'));
  assert.deepEqual(f.database.read(), beforeChanged);
});

test('canvas undo restores hidden assets while preserving later generated projections', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  const before = f.service.snapshot();
  const original = before.canvas.items.find((item) => item.refId === 'original')!;
  f.service.saveCanvas({
    expectedRevision: before.canvas.revision,
    items: before.canvas.items.filter((item) => item.id !== original.id),
  });
  f.database.addAsset(asset('candidate', 'remote-job'));
  const undone = f.service.undoCanvas();
  assert.equal(undone.canvas.items.filter((item) => item.refId === 'original').length, 1);
  assert.equal(undone.canvas.items.filter((item) => item.refId === 'candidate').length, 1);
  assert.equal(undone.assets.length, 2);
  assert.equal(undone.sequences[0].revision, 0);
});

test('undoing a manual re-add of a hidden asset card hides it again', async (t) => {
  const f = await fixture(t);
  f.database.addAsset(asset('original'));
  const before = f.service.snapshot();
  const original = before.canvas.items.find((item) => item.refId === 'original')!;
  const hidden = f.service.saveCanvas({
    expectedRevision: before.canvas.revision,
    items: before.canvas.items.filter((item) => item.id !== original.id),
  });
  f.service.saveCanvas({
    expectedRevision: hidden.canvas.revision,
    items: [...hidden.canvas.items, original],
  });
  const undone = f.service.undoCanvas();
  assert.equal(
    undone.canvas.items.some((item) => item.refId === 'original'),
    false,
  );
  assert.equal(
    undone.assets.some((item) => item.id === 'original'),
    true,
  );
});

test('project and user memories keep scopes and versions across independent projects', async (t) => {
  const f = await fixture(t);
  f.service.saveMemory({ scope: 'project', content: '这个工程使用竖屏' });
  const combined = f.service.saveMemory({ scope: 'user', content: '所有作品的字幕使用中文' });
  const projectMemory = combined.memories.find((memory) => memory.scope === 'project')!;
  const userMemory = combined.memories.find((memory) => memory.scope === 'user')!;
  const updated = f.service.saveMemory({
    id: userMemory.id,
    scope: 'user',
    content: '默认添加中文字幕',
    expectedRevision: 0,
  });
  assert.equal(updated.memories.find((memory) => memory.id === userMemory.id)?.revision, 1);
  assert.throws(() =>
    f.service.saveMemory({
      id: userMemory.id,
      scope: 'user',
      content: 'Stale write',
      expectedRevision: 0,
    }),
  );
  assert.throws(() =>
    f.service.saveMemory({
      id: userMemory.id,
      scope: 'project',
      content: 'Wrong scope',
      expectedRevision: 1,
    }),
  );
  assert.throws(() =>
    f.service.deleteMemory({ id: userMemory.id, scope: 'user', expectedRevision: 0 }),
  );
  const another = ProjectDatabase.create(
    join(f.directory, 'another-project'),
    'Another',
    320,
    180,
    24,
  );
  try {
    const secondService = new ProjectService(another, f.app);
    assert.deepEqual(
      secondService.snapshot().memories.map((memory) => memory.id),
      [userMemory.id],
    );
    f.reopen();
    assert.ok(f.service.snapshot().memories.some((memory) => memory.id === projectMemory.id));
    f.service.deleteMemory({ id: userMemory.id, scope: 'user', expectedRevision: 1 });
    assert.equal(secondService.snapshot().memories.length, 0);
    assert.equal(f.service.snapshot().memories[0].scope, 'project');
  } finally {
    another.close();
  }
  assert.throws(() =>
    f.service.saveMemory({ scope: 'project', content: 'sk-123456789012345678901234567890' }),
  );
});

test('the project service rejects sequence dimensions and rates unsupported by the editor', async (t) => {
  const f = await fixture(t);
  const before = f.database.read();
  for (const input of [
    { width: 2, height: 2, fps: 24 },
    { width: 319, height: 180, fps: 24 },
    { width: 320, height: 180, fps: 0 },
  ]) {
    assert.throws(() => f.service.createSequence({ name: 'Invalid', ...input }));
    assert.deepEqual(f.database.read(), before);
  }
});
