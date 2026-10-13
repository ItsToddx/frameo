import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export interface Encryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export class CredentialVault {
  private readonly path: string;
  constructor(
    directory: string,
    private readonly encryption: Encryption,
  ) {
    this.path = join(directory, 'credentials.enc');
  }
  private read(): { current?: string; values: Record<string, string> } {
    if (!existsSync(this.path)) return { values: {} };
    if (!this.encryption.available()) throw new Error('系统钥匙串不可用，无法读取模型账户。');
    return JSON.parse(this.encryption.decrypt(readFileSync(this.path)));
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
    const data = this.read();
    const reference = randomUUID();
    data.values[reference] = key;
    data.current = reference;
    writeFileSync(this.path + '.tmp', this.encryption.encrypt(JSON.stringify(data)), {
      mode: 0o600,
    });
    renameSync(this.path + '.tmp', this.path);
    return reference;
  }
}
