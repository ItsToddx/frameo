import { readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface Encryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export interface CredentialFiles {
  exists(path: string): boolean;
  read(path: string): Buffer;
  write(path: string, value: Buffer): void;
  rename(source: string, target: string): void;
  remove(path: string): void;
}
const localFiles: CredentialFiles = {
  exists: existsSync,
  read: readFileSync,
  write: (path, value) => writeFileSync(path, value, { mode: 0o600, flag: 'wx' }),
  rename: renameSync,
  remove: (path) => rmSync(path, { force: true }),
};
interface Accounts {
  current?: string;
  values: Record<string, string>;
}
export class CredentialVault {
  private readonly path: string;
  constructor(
    directory: string,
    private readonly encryption: Encryption,
    private readonly files: CredentialFiles = localFiles,
  ) {
    this.path = join(directory, 'credentials.enc');
  }
  private read(): Accounts {
    if (!this.files.exists(this.path)) return { values: {} };
    if (!this.encryption.available()) throw new Error('系统钥匙串不可用，无法读取模型账户。');
    const data: unknown = JSON.parse(this.encryption.decrypt(this.files.read(this.path)));
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !('values' in data) ||
      !data.values ||
      typeof data.values !== 'object' ||
      Array.isArray(data.values) ||
      Object.values(data.values).some((value) => typeof value !== 'string') ||
      ('current' in data && data.current !== undefined && typeof data.current !== 'string')
    ) {
      throw new Error('已保存的加密账户数据无法读取，请在设置中重新填写密钥。');
    }
    return data as Accounts;
  }
  currentId(): string | undefined {
    return this.read().current;
  }
  hasKey(): boolean {
    try {
      const d = this.read();
      return !!(d.current && d.values[d.current]);
    } catch {
      return false;
    }
  }
  get(reference?: string): string {
    const data = this.read();
    const key = data.values[reference ?? data.current ?? ''];
    if (!key) throw new Error('请先配置方舟 API Key。');
    return key;
  }
  save(key: string): string {
    if (!this.encryption.available()) throw new Error('系统钥匙串不可用，密钥未保存。');
    let data: Accounts;
    let unreadable = false;
    try {
      data = this.read();
    } catch (error) {
      if (!this.encryption.available() || !this.files.exists(this.path)) throw error;
      // Saving is explicit user authorization to replace an unreadable vault, never to remap old refs.
      data = { values: {} };
      unreadable = true;
    }
    const reference = randomUUID();
    data.values[reference] = key;
    data.current = reference;
    const ciphertext = this.encryption.encrypt(JSON.stringify(data));
    const temporary = `${this.path}.tmp-${randomUUID()}`;
    const backup = unreadable ? `${this.path}.backup-${randomUUID()}` : undefined;
    let backedUp = false;
    try {
      this.files.write(temporary, ciphertext);
      if (backup) {
        this.files.rename(this.path, backup);
        backedUp = true;
      }
      this.files.rename(temporary, this.path);
      return reference;
    } catch (error) {
      if (backup && backedUp) {
        try {
          this.files.rename(backup, this.path);
        } catch {
          throw new Error('密钥保存失败；原加密账户已保留在备份文件中，请核对后重试。', {
            cause: error,
          });
        }
      }
      throw error;
    } finally {
      try {
        this.files.remove(temporary);
      } catch {
        /* A leftover staged file must not undo a committed vault. */
      }
    }
  }
}
