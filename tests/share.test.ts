import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { createCanvas } from '@napi-rs/canvas';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { shareProject, importSharedProject } from '../apps/desktop/src/adapters/storage/share';
import { archiveMedia } from '../apps/desktop/src/adapters/runtime/media';
test('sharing round-trips real archived media and saved edits, strips private state and creates a new identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'framo-share-'));
  const db = ProjectDatabase.create(join(root, 'source'), 'Shared film', 640, 360, 30);
  let imported: ProjectDatabase | undefined;
  try {
    const image = join(root, 'image.png');
    await writeFile(image, createCanvas(640, 360).toBuffer('image/png'));
    const asset = db.addAsset(await archiveMedia(db.directory, image));
    db.transaction((state) => {
      state.sequences[0].clips.push({
        id: 'clip',
        trackId: state.sequences[0].tracks[0].id,
        assetVersionId: asset.id,
        start: 0,
        duration: 90,
        sourceStart: 0,
        audioGain: 1,
        muted: false,
      });
      state.sessions[0].messages.push({
        id: 'private',
        role: 'user',
        text: 'private conversation',
        createdAt: 'x',
      });
      state.memories.push({
        id: 'private-memory',
        scope: 'project',
        revision: 0,
        content: 'private preference',
        createdAt: 'x',
      });
    });
    const archive = join(root, 'share.framoproject');
    await shareProject(db, archive);
    const zip = new AdmZip(archive);
    const manifest = zip.getEntry('project.json')!.getData().toString();
    assert.ok(!manifest.includes('private conversation'));
    assert.ok(!manifest.includes('private preference'));
    imported = await importSharedProject(archive, join(root, 'imported'));
    assert.notEqual(imported.read().project.id, db.read().project.id);
    assert.equal(imported.read().sequences[0].clips[0].duration, 90);
    assert.equal(imported.read().assets[0].hash, asset.hash);
    assert.equal(imported.read().memories.length, 0);
    assert.equal(imported.read().jobs.length, 0);
    assert.equal(imported.read().sessions[0].messages.length, 0);
  } finally {
    imported?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('invalid archives cannot escape or leave an incomplete target directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'framo-share-invalid-'));
  try {
    const archive = join(root, 'bad.zip'),
      target = join(root, 'target');
    const zip = new AdmZip();
    zip.addFile('entry.mjs', Buffer.from('throw Error("must not execute")'));
    zip.writeZip(archive);
    await assert.rejects(importSharedProject(archive, target), /不允许/);
    await assert.rejects(stat(target));
    const bad = new AdmZip();
    bad.addFile(
      'project.json',
      Buffer.from(
        JSON.stringify({
          format: 'framo-project',
          version: 1,
          name: 'Broken',
          sequences: [],
          assets: [
            {
              id: 'asset',
              name: 'Missing',
              kind: 'image',
              path: 'media/' + 'a'.repeat(64) + '.png',
              hash: 'a'.repeat(64),
              duration: 0,
            },
          ],
          canvas: { revision: 0, items: [] },
        }),
      ),
    );
    bad.writeZip(archive);
    await assert.rejects(importSharedProject(archive, target), /缺少素材/);
    await assert.rejects(stat(target));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
