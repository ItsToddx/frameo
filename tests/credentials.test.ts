import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialVault, type Encryption } from '../apps/desktop/src/adapters/storage/credentials';

function encryption(identity: string): Encryption {
  return {
    available: () => true,
    encrypt: (value) => Buffer.from(`${identity}:${value}`),
    decrypt: (value) => {
      const text = value.toString();
      if (!text.startsWith(identity + ':'))
        throw new Error('Synthetic cipher belongs to another application identity');
      return text.slice(identity.length + 1);
    },
  };
}
const files = {
  exists: existsSync,
  read: readFileSync,
  write: (path: string, value: Buffer) => writeFileSync(path, value, { mode: 0o600, flag: 'wx' }),
  rename: renameSync,
  remove: (path: string) => rmSync(path, { force: true }),
};

test('explicit replacement preserves unreadable historical ciphertext and creates a new account without remapping old references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-vault-replacement-'));
  try {
    const old = new CredentialVault(directory, encryption('legacy-fixture'));
    const oldRef = old.save('synthetic-old-key');
    const original = readFileSync(join(directory, 'credentials.enc'));
    const current = new CredentialVault(directory, encryption('current-fixture'));
    assert.equal(current.hasKey(), false);
    assert.throws(() => current.get(oldRef), /another application/);
    const newRef = current.save('synthetic-new-key');
    assert.notEqual(newRef, oldRef);
    assert.equal(current.currentId(), newRef);
    assert.equal(current.get(), 'synthetic-new-key');
    assert.throws(() => current.get(oldRef), /API Key/);
    const backups = (await readdir(directory)).filter((name) =>
      name.startsWith('credentials.enc.backup-'),
    );
    assert.equal(backups.length, 1);
    assert.deepEqual(readFileSync(join(directory, backups[0])), original);
    assert.equal(
      new CredentialVault(directory, encryption('current-fixture')).get(newRef),
      'synthetic-new-key',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('readable account rotation retains every previous account reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-vault-rotation-'));
  try {
    const vault = new CredentialVault(directory, encryption('fixture'));
    const first = vault.save('synthetic-first-key'),
      second = vault.save('synthetic-second-key');
    assert.equal(vault.get(first), 'synthetic-first-key');
    assert.equal(vault.get(second), 'synthetic-second-key');
    assert.equal(vault.currentId(), second);
    assert.deepEqual(await readdir(directory), ['credentials.enc']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unavailable keychain never resets an existing encrypted vault', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-vault-unavailable-'));
  try {
    new CredentialVault(directory, encryption('legacy-fixture')).save('synthetic-old-key');
    const path = join(directory, 'credentials.enc'),
      original = readFileSync(path);
    const vault = new CredentialVault(directory, {
      ...encryption('current-fixture'),
      available: () => false,
    });
    assert.equal(vault.hasKey(), false);
    assert.throws(() => vault.save('synthetic-new-key'), /钥匙串不可用/);
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(await readdir(directory), ['credentials.enc']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed staged writes and final installation restore the original unreadable bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-vault-write-failure-'));
  try {
    new CredentialVault(directory, encryption('legacy-fixture')).save('synthetic-old-key');
    const path = join(directory, 'credentials.enc'),
      original = readFileSync(path);
    for (const failure of ['write', 'install']) {
      const faultyFiles = {
        ...files,
        write: (temporary: string, value: Buffer) => {
          files.write(temporary, value);
          if (failure === 'write') throw new Error('Controlled staged write failure');
        },
        rename: (source: string, target: string) => {
          if (failure === 'install' && source.includes('.tmp-') && target === path)
            throw new Error('Controlled atomic install failure');
          files.rename(source, target);
        },
      };
      const vault = new CredentialVault(directory, encryption('current-fixture'), faultyFiles);
      assert.throws(() => vault.save('synthetic-new-key'), /Controlled/);
      assert.deepEqual(readFileSync(path), original);
      assert.equal(vault.hasKey(), false);
      assert.deepEqual(await readdir(directory), ['credentials.enc']);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
