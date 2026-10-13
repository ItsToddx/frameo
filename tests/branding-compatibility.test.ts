import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { shareProject, importSharedProject } from '../apps/desktop/src/adapters/storage/share';
import { profileLocation } from '../apps/desktop/src/adapters/storage/profile-location';
import { builtinManifests } from '../kits/builtin';

test('Frameo opens legacy projects and shared manifests without rewriting source or task identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frameo-compat-'));
  let source: ProjectDatabase | undefined, imported: ProjectDatabase | undefined;
  try {
    const path = join(root, 'Original.reelbeam');
    source = ProjectDatabase.create(path, 'Original', 1280, 720, 24);
    source.transaction((state) => {
      state.jobs.push({
        id: 'old-job',
        requestId: 'old-request',
        kind: 'seedance',
        status: 'unknown',
        title: 'Uncertain shot',
        progress: 0,
        createdAt: '2026-10-13',
        updatedAt: '2026-10-13',
        cancelRequested: false,
        input: {
          model: 'old-pinned-model',
          accountReference: 'old-account',
          kitId: 'reelbeam.seedance-kit',
        },
      });
    });
    source.close();
    source = new ProjectDatabase(path);
    assert.equal(source.read().formatVersion, 1);
    assert.equal(source.read().jobs[0].id, 'old-job');
    assert.equal(source.read().jobs[0].input.accountReference, 'old-account');
    assert.equal(source.read().jobs[0].status, 'unknown');
    const archive = join(root, 'Legacy.reelbeamproject');
    await shareProject(source, archive);
    const zip = new AdmZip(archive);
    const manifest = JSON.parse(zip.readAsText('project.json'));
    manifest.format = 'reelbeam-project';
    zip.updateFile('project.json', Buffer.from(JSON.stringify(manifest)));
    zip.writeZip(archive);
    imported = await importSharedProject(archive, join(root, 'Imported.frameo'));
    assert.equal(imported.read().project.name, 'Original');
    assert.equal(imported.read().sequences[0].fps, 24);
    assert.notEqual(imported.read().project.id, source.read().project.id);
    assert.equal(imported.read().jobs.length, 0);
    assert.ok(
      builtinManifests.some((manifest) => manifest.id === 'reelbeam.seedance-kit'),
      'Authored legacy graphs retain stable built-in capability references',
    );
  } finally {
    source?.close();
    imported?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('profile rename preserves the existing encrypted-account directory and respects explicit profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frameo-profile-'));
  try {
    const legacy = join(root, 'Reelbeam'),
      current = join(root, 'Frameo');
    await mkdir(legacy);
    await writeFile(join(legacy, 'app.sqlite'), 'existing-profile');
    assert.equal(profileLocation(current), legacy);
    assert.equal(profileLocation(current, join(root, 'isolated')), join(root, 'isolated'));
    await mkdir(current);
    await writeFile(join(current, 'app.sqlite'), 'new-profile');
    assert.equal(profileLocation(current), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
