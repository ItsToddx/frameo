import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Asset, Sequence } from '../packages/core/src/model';
import { applyCommands } from '../packages/core/src/editor';
import {
  ClipManipulation,
  TimelineDraft,
} from '../apps/desktop/src/renderer/timeline-interactions';
import { EditCoordinator } from '../apps/desktop/src/adapters/application/edit-coordinator';

const asset: Asset = {
  id: 'source',
  name: 'Source',
  kind: 'video',
  path: '/source.mp4',
  url: '',
  hash: 'source',
  duration: 12,
  hasAudio: true,
  createdAt: '',
};
const sequence = (): Sequence => ({
  id: 'sequence',
  name: 'Sequence',
  revision: 4,
  width: 1280,
  height: 720,
  fps: 30,
  tracks: [{ id: 'video', name: 'Video', kind: 'video', locked: false, muted: false }],
  clips: [
    {
      id: 'left',
      trackId: 'video',
      assetVersionId: 'source',
      start: 0,
      duration: 60,
      sourceStart: 0,
      audioGain: 1,
      muted: false,
    },
    {
      id: 'selected',
      trackId: 'video',
      assetVersionId: 'source',
      start: 90,
      duration: 90,
      sourceStart: 1,
      audioGain: 0.5,
      muted: true,
    },
    {
      id: 'right',
      trackId: 'video',
      assetVersionId: 'source',
      start: 240,
      duration: 60,
      sourceStart: 0,
      audioGain: 1,
      muted: false,
    },
  ],
  captions: [],
});

test('dragging a clip respects adjacent clips, exact frames and immutable source metadata', () => {
  const initial = sequence();
  const move = new ClipManipulation(initial, [asset], 'selected', 'move');
  const proposal = move.atDeltaPixels(37.7, 30);
  assert.equal(proposal.clip.start, 128);
  assert.equal(proposal.clip.duration, 90);
  assert.equal(proposal.clip.sourceStart, 1);
  assert.equal(move.atDeltaFrames(-200).clip.start, 60);
  const bounded = move.atDeltaFrames(200);
  assert.equal(bounded.clip.start, 150);
  assert.equal(bounded.constrained, true);
  const saved = applyCommands(initial, [asset], [bounded.command!]);
  assert.equal(saved.clips[1].audioGain, 0.5);
  assert.equal(saved.clips[1].muted, true);
  assert.equal(initial.clips[1].start, 90);
});

test('trimming the start preserves the media end and audio sample offset without crossing a neighbor', () => {
  const initial = sequence();
  initial.clips[1].sourceStart = 127 / 48000;
  const trim = new ClipManipulation(initial, [asset], 'selected', 'trim-start');
  assert.equal(trim.atDeltaFrames(-50).clip.start, 90);
  const proposal = trim.atDeltaFrames(15);
  assert.equal(proposal.clip.start, 105);
  assert.equal(proposal.clip.duration, 75);
  assert.equal(proposal.clip.sourceStart, 127 / 48000 + 0.5);
  const saved = applyCommands(initial, [asset], [proposal.command!]);
  assert.equal(saved.clips[1].start + saved.clips[1].duration, 180);
  assert.equal(trim.atDeltaFrames(500).clip.duration, 1);
  initial.clips[1].sourceStart = 3;
  const extended = new ClipManipulation(initial, [asset], 'selected', 'trim-start').atDeltaFrames(
    -50,
  );
  assert.equal(extended.clip.start, 60);
  assert.equal(extended.clip.sourceStart, 2);
});

test('end trims stop at source duration, keep at least one frame and allow longer still images', () => {
  const initial = sequence();
  const shortAsset = { ...asset, duration: 4.4 };
  const trim = new ClipManipulation(initial, [shortAsset], 'selected', 'trim-end');
  const extended = trim.atDeltaFrames(100);
  assert.equal(extended.clip.start, 90);
  assert.equal(extended.clip.duration, 102);
  assert.equal(extended.clip.sourceStart, 1);
  applyCommands(initial, [shortAsset], [extended.command!]);
  assert.equal(trim.atDeltaFrames(-500).clip.duration, 1);
  const still = { ...asset, kind: 'image' as const, duration: 0 };
  initial.clips.forEach((clip) => {
    clip.sourceStart = 0;
  });
  const imageTrim = new ClipManipulation(initial, [still], 'selected', 'trim-end');
  assert.equal(imageTrim.atDeltaFrames(500).clip.duration, 150);
  assert.equal(imageTrim.atDeltaFrames(500).clip.sourceStart, 0);
  assert.equal(
    new ClipManipulation(initial, [still], 'selected', 'trim-start').atDeltaFrames(-30).clip
      .sourceStart,
    0,
  );
  initial.tracks[0].locked = true;
  assert.throws(() => new ClipManipulation(initial, [still], 'selected', 'move'), /锁定/);
});

const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('an interrupted gesture waits for lease acquisition before releasing ownership', async () => {
  const leases = new EditCoordinator();
  const acquisition = deferred();
  const initial = sequence();
  const draft = new TimelineDraft({
    currentSequence: () => initial,
    onDraftChange: async (dirty) => {
      if (dirty) {
        const acquired = await acquisition.promise;
        if (acquired) leases.begin('project', initial.id, 'manual');
        return acquired;
      }
      leases.end('project', initial.id, 'manual');
      return true;
    },
    onApply: async () => {
      throw new Error('An interrupted gesture cannot save');
    },
    onStateChange: () => {},
  });
  draft.begin(initial, 'gesture');
  const interrupted = draft.discard();
  assert.equal(draft.state?.phase, 'releasing');
  acquisition.resolve(true);
  assert.equal(await interrupted, true);
  assert.equal(draft.state, null);
  leases.assertAvailable('project', initial.id);
});

test('a failed save keeps the original draft and lease until successful revision-checked retry', async () => {
  const leases = new EditCoordinator();
  let current = sequence();
  let diskAvailable = false;
  const draft = new TimelineDraft({
    currentSequence: () => current,
    onDraftChange: async (dirty) => {
      if (dirty) leases.begin('project', current.id, 'manual');
      else leases.end('project', current.id, 'manual');
      return true;
    },
    onApply: async (commands, revision) => {
      leases.assertAvailable('project', current.id, 'manual');
      assert.equal(revision, 4);
      if (!diskAvailable) return false;
      current = applyCommands(current, [asset], commands);
      return true;
    },
    onStateChange: () => {},
  });
  draft.begin(current, 'inspector');
  const commands = [{ type: 'updateClip' as const, clipId: 'selected', patch: { start: 120 } }];
  assert.equal(await draft.save(commands), false);
  assert.equal(draft.state?.base.revision, 4);
  assert.equal(current.clips[1].start, 90);
  assert.throws(() => leases.assertAvailable('project', current.id), /草稿/);
  diskAvailable = true;
  assert.equal(await draft.save(commands), true);
  assert.equal(current.clips[1].start, 120);
  assert.equal(draft.state, null);
  leases.assertAvailable('project', current.id);
});

test('external revisions and failed lease acquisition cannot commit an old draft', async () => {
  let current = sequence();
  let hostWrites = 0;
  const draft = new TimelineDraft({
    currentSequence: () => current,
    onDraftChange: async () => true,
    onApply: async () => {
      hostWrites++;
      return true;
    },
    onStateChange: () => {},
  });
  draft.begin(current, 'gesture');
  current = { ...current, revision: 5 };
  assert.equal(await draft.save([{ type: 'removeClip', clipId: 'selected' }]), false);
  assert.equal(hostWrites, 0);
  assert.equal(draft.state?.base.revision, 4);
  assert.equal(draft.state?.phase, 'conflict');
  await draft.discard();

  const denied = new TimelineDraft({
    currentSequence: () => current,
    onDraftChange: async (dirty) => !dirty,
    onApply: async () => {
      hostWrites++;
      return true;
    },
    onStateChange: () => {},
  });
  denied.begin(current, 'gesture');
  assert.equal(await denied.save([{ type: 'removeClip', clipId: 'selected' }]), false);
  assert.equal(denied.state?.phase, 'blocked');
  assert.equal(hostWrites, 0);
  assert.equal(await denied.discard(), true);
});

test('a save in progress excludes duplicate saves and discards, and release failure never repeats a saved command', async () => {
  let current = sequence();
  const commit = deferred();
  const started = deferred();
  let allowRelease = true;
  let hostWrites = 0;
  const draft = new TimelineDraft({
    currentSequence: () => current,
    onDraftChange: async (dirty) => dirty || allowRelease,
    onApply: async (commands) => {
      hostWrites++;
      started.resolve(true);
      await commit.promise;
      current = applyCommands(current, [asset], commands);
      return true;
    },
    onStateChange: () => {},
  });
  draft.begin(current, 'gesture');
  const commands = [{ type: 'updateClip' as const, clipId: 'selected', patch: { start: 120 } }];
  const saving = draft.save(commands);
  await started.promise;
  assert.equal(draft.state?.phase, 'saving');
  assert.equal(await draft.save(commands), false);
  assert.equal(await draft.discard(), false);
  allowRelease = false;
  commit.resolve(true);
  assert.equal(await saving, false);
  assert.equal(current.clips[1].start, 120);
  assert.equal(draft.state?.phase, 'release-failed');
  assert.equal(await draft.save(commands), false);
  assert.equal(hostWrites, 1);
  allowRelease = true;
  assert.equal(await draft.discard(), true);
  assert.equal(draft.state, null);
});
