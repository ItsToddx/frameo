import { mkdir, rm, stat, realpath, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import type { Job } from '../../../../../packages/application/src/model.js';
import { GenerationJobs } from '../../../../../packages/application/src/generation-jobs.js';
import type { GenerationMedia } from '../../../../../packages/application/src/generation-ports.js';
import { ProjectDatabase, id, now } from '../storage/database.js';
import { CredentialVault } from '../storage/credentials.js';
import { archiveMedia, renderSequence, hashFile, probe } from './media.js';
import { SeedanceProvider } from './seedance.js';
function privateAddress(address: string): boolean {
  return (
    address === '::1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80:') ||
    address.startsWith('::ffff:') ||
    /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
  );
}
export async function downloadMedia(
  url: string,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  let current = url;
  let response: Response | undefined;
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw new Error('供应商返回了不安全的下载地址。');
    const addresses = isIP(parsed.hostname)
      ? [{ address: parsed.hostname }]
      : await lookup(parsed.hostname, { all: true });
    if (addresses.some((a) => privateAddress(a.address)))
      throw new Error('供应商下载地址指向私有网络。');
    response = await fetch(current, {
      signal: signal ?? AbortSignal.timeout(120000),
      redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('下载重定向缺少地址。');
      current = new URL(location, current).href;
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body)
    throw new Error(`下载视频失败（HTTP ${response?.status ?? '未知'}），可核对原任务后重新下载。`);
  const limit = 2 * 1024 * 1024 * 1024;
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error('供应商输出超过 2 GB 限制。');
  let bytes = 0;
  const source = Readable.fromWeb(response.body as never);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limit) source.destroy(new Error('供应商输出超过 2 GB 限制。'));
  });
  try {
    await pipeline(source, createWriteStream(path, { flags: 'wx' }), { signal });
    if (bytes === 0) throw new Error('供应商返回空输出。');
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}
export interface JobRunnerPorts {
  renderTitle?: (sequence: import('../contracts/api').Sequence, preview: boolean) => string;
  provider?: (job: Job) => Pick<SeedanceProvider, 'submit' | 'status' | 'cancel'>;
  download?: typeof downloadMedia;
  archive?: typeof archiveMedia;
  render?: typeof renderSequence;
  probe?: typeof probe;
}
/** Desktop composition facade; generation policy depends only on its inward ports. */
export class JobRunner extends GenerationJobs {
  constructor(
    vault: CredentialVault,
    changed: (database: ProjectDatabase) => void,
    canStart: () => boolean = () => true,
    ports: JobRunnerPorts = {},
  ) {
    const media: GenerationMedia = {
      async reference(directory, asset, expectedHash) {
        const source = join(directory, asset.path);
        if ((await stat(source)).size > 20 * 1024 * 1024) throw new Error('参考图片超过 20 MB。');
        const bytes = await readFile(source);
        if (createHash('sha256').update(bytes).digest('hex') !== expectedHash)
          throw new Error('参考图片文件与固定版本不一致。');
        const extension = asset.path.split('.').pop();
        const mime =
          extension === 'jpg' || extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'webp'
              ? 'image/webp'
              : 'image/png';
        return `data:${mime};base64,${bytes.toString('base64')}`;
      },
      async prepareDownload(directory, jobId) {
        await mkdir(join(directory, 'cache'), { recursive: true });
        const path = join(directory, 'cache', `${jobId}-download.mp4`);
        await rm(path, { force: true });
        return path;
      },
      download: ports.download ?? downloadMedia,
      async validateDownload(path, signal) {
        const metadata = await (ports.probe ?? probe)(path, signal);
        if (
          !metadata.streams.some((stream) => stream.codec_type === 'video') ||
          !Number.isFinite(Number(metadata.format.duration)) ||
          Number(metadata.format.duration) <= 0
        )
          throw new Error('生成输出不是可用视频。');
        return hashFile(path);
      },
      async verifyStage(directory, stage) {
        const path = resolve(directory, stage.path);
        if (
          (await realpath(path)) !== path ||
          !(await stat(path)).isFile() ||
          (await hashFile(path)) !== stage.hash
        )
          throw new Error('已验证的生成暂存文件缺失或内容改变，请核对原任务。');
        return path;
      },
      archive: ports.archive ?? archiveMedia,
      render: ports.render ?? renderSequence,
      remove: (path) => rm(path, { force: true }),
    };
    super({
      id,
      now,
      media,
      canStart,
      renderTitle: ports.renderTitle,
      accountRef: () => vault.currentId(),
      provider: (job) =>
        ports.provider?.(job) ??
        new SeedanceProvider({
          baseUrl: String(job.input.baseUrl),
          apiKey: vault.get(String(job.input.accountRef)),
        }),
      changed: (database) => changed(database as ProjectDatabase),
    });
  }
}
