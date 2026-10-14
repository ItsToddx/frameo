import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, stat, writeFile, rm } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { Asset, Sequence } from '../contracts/api';
import { id, now } from '../storage/database';

function bundledBinary(name: string): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packaged = resources ? join(resources, 'bin', name) : '';
  const mediaDirectory = process.env.FRAMO_MEDIA_DIR ?? process.env.FRAMEO_MEDIA_DIR;
  const path = mediaDirectory
    ? join(mediaDirectory, name)
    : packaged && existsSync(packaged)
      ? packaged
      : resolve('resources/bin', name);
  if (!existsSync(path)) throw new Error('媒体运行时尚未构建，请运行 npm run media:build。');
  return path;
}
export function ffmpegPath(): string {
  return process.env.FRAMO_FFMPEG ?? process.env.FRAMEO_FFMPEG ?? bundledBinary('ffmpeg');
}
export function ffprobePath(): string {
  return process.env.FRAMO_FFPROBE ?? process.env.FRAMEO_FFPROBE ?? bundledBinary('ffprobe');
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
}
export function runProcess(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; onProgress?: (text: string) => void; maxOutput?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('操作已取消。'));
      return;
    }
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const maximum = options.maxOutput ?? 4 * 1024 * 1024;
    const abort = () => {
      child.kill('SIGTERM');
      timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout = (stdout + text).slice(-maximum);
      options.onProgress?.(text);
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-maximum);
    });
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) reject(new Error('操作已取消。'));
      else if (code !== 0) reject(new Error(`媒体处理失败：${stderr.slice(-2000)}`));
      else resolvePromise({ stdout, stderr });
    });
  });
}
interface Probe {
  format: { duration?: string };
  streams: {
    codec_type: string;
    width?: number;
    height?: number;
    duration?: string;
    nb_frames?: string;
    r_frame_rate?: string;
    sample_rate?: string;
  }[];
}
export async function probe(path: string, signal?: AbortSignal): Promise<Probe> {
  const result = await runProcess(
    ffprobePath(),
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
    { signal },
  );
  return JSON.parse(result.stdout) as Probe;
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function archiveMedia(
  directory: string,
  source: string,
  name?: string,
  originJobId?: string,
  signal?: AbortSignal,
): Promise<Asset> {
  const sourceStat = await stat(source);
  if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error('素材文件为空或不可用。');
  const extension = extname(source).toLowerCase();
  if (extension && !/^\.[a-z0-9]{1,10}$/.test(extension)) throw new Error('素材扩展名不可用。');
  await mkdir(join(directory, 'media'), { recursive: true });
  const staged = join(directory, 'media', `${randomUUID()}${extension || '.mp4'}`);
  await copyFile(source, staged);
  try {
    if (signal?.aborted) throw new Error('操作已取消。');
    const metadata = await probe(staged, signal);
    const video = metadata.streams.find((s) => s.codec_type === 'video');
    const audio = metadata.streams.some((s) => s.codec_type === 'audio');
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'];
    const kind =
      imageExtensions.includes(extension) && video
        ? 'image'
        : video
          ? 'video'
          : audio
            ? 'audio'
            : undefined;
    if (!kind) throw new Error('不支持此素材格式，请选择图片、视频或音频。');
    const duration =
      kind === 'image' ? 0 : Number(metadata.format.duration ?? video?.duration ?? 0);
    if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0))
      throw new Error('素材时长无法读取。');
    const hash = await hashFile(staged);
    const assetId = id();
    const path = `media/${hash}${extension || '.mp4'}`;
    const destination = join(directory, path);
    if (signal?.aborted) throw new Error('操作已取消。');
    if (!existsSync(destination)) await rename(staged, destination);
    else if ((await hashFile(destination)) !== hash)
      throw new Error('已归档素材被外部修改，请恢复该素材版本。');
    const thumbnail = kind === 'audio' ? undefined : `cache/${hash}.jpg`;
    if (thumbnail && !existsSync(join(directory, thumbnail))) {
      await mkdir(join(directory, 'cache'), { recursive: true });
      try {
        await runProcess(
          ffmpegPath(),
          [
            '-y',
            '-v',
            'error',
            '-i',
            destination,
            '-frames:v',
            '1',
            '-vf',
            'scale=480:-2',
            join(directory, thumbnail),
          ],
          { signal },
        );
      } catch {
        /* Media remains usable if its optional thumbnail fails. */
      }
    }
    return {
      id: assetId,
      name: name ?? source.split(/[\\/]/).pop() ?? '素材',
      kind,
      path,
      url: '',
      thumbnailUrl: thumbnail,
      hash,
      duration,
      width: video?.width,
      height: video?.height,
      hasAudio: audio,
      originJobId,
      createdAt: now(),
    };
  } finally {
    await rm(staged, { force: true });
  }
}
const number = (value: number) => Number(value.toFixed(9)).toString();
function filterPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "'\\''");
}
export function sequenceDuration(sequence: Sequence): number {
  return Math.max(
    0,
    ...sequence.clips.map((c) => c.start + c.duration),
    ...sequence.captions.map((c) => c.start + c.duration),
  );
}
export interface RenderOptions {
  directory: string;
  sequence: Sequence;
  assets: Asset[];
  output: string;
  preview?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}
export async function renderSequence(
  options: RenderOptions,
): Promise<{ path: string; duration: number; frames: number }> {
  const { sequence, assets, directory, signal } = options;
  const durationTicks = sequenceDuration(sequence);
  if (durationTicks <= 0) throw new Error('作品为空，请先添加片段。');
  const seconds = durationTicks / sequence.fps;
  if (seconds > 3600) throw new Error('当前版本单次导出最长 60 分钟。');
  const width = options.preview
    ? Math.max(2, Math.floor(Math.min(sequence.width, 960) / 2) * 2)
    : sequence.width;
  const height = options.preview
    ? Math.max(2, Math.floor(((width / sequence.width) * sequence.height) / 2) * 2)
    : sequence.height;
  const args = [
    '-y',
    '-v',
    'error',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${width}x${height}:r=${sequence.fps}:d=${number(seconds)}`,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=48000:cl=stereo:d=${number(seconds)}`,
  ];
  const filters: string[] = [];
  const audioLabels = ['[1:a]'];
  let currentVideo = '[0:v]';
  let input = 2;
  let layer = 0;
  const clips = [...sequence.clips].sort(
    (a, b) =>
      sequence.tracks.findIndex((t) => t.id === a.trackId) -
        sequence.tracks.findIndex((t) => t.id === b.trackId) || a.start - b.start,
  );
  const verified = new Set<string>();
  for (const clip of clips) {
    const asset = assets.find((a) => a.id === clip.assetVersionId);
    const track = sequence.tracks.find((t) => t.id === clip.trackId);
    if (!asset || !track) throw new Error('作品引用了缺失的素材或轨道。');
    const source = resolve(directory, asset.path);
    if (!source.startsWith(resolve(directory) + '/') || !existsSync(source))
      throw new Error(`素材缺失：${asset.name}`);
    if (!verified.has(asset.id)) {
      if ((await hashFile(source)) !== asset.hash)
        throw new Error(`素材版本被外部修改：${asset.name}`);
      verified.add(asset.id);
      if (signal?.aborted) throw new Error('操作已取消。');
    }
    const start = clip.start / sequence.fps;
    const duration = clip.duration / sequence.fps;
    if (asset.kind === 'image')
      args.push('-loop', '1', '-framerate', String(sequence.fps), '-t', number(duration));
    args.push('-i', source);
    const idx = input++;
    if (track.kind === 'video' && asset.kind !== 'audio') {
      const label = `v${layer}`;
      const out = `o${layer++}`;
      filters.push(
        `[${idx}:v]trim=start=${number(asset.kind === 'image' ? 0 : clip.sourceStart)}:duration=${number(duration)},setpts=PTS-STARTPTS,fps=${sequence.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,setpts=PTS+${clip.start}/(${sequence.fps}*TB)[${label}]`,
      );
      filters.push(
        `${currentVideo}[${label}]overlay=eof_action=pass:repeatlast=0:enable='gte(n,${clip.start})*lt(n,${clip.start + clip.duration})'[${out}]`,
      );
      currentVideo = `[${out}]`;
    }
    if (asset.hasAudio && !track.muted && !clip.muted && clip.audioGain > 0) {
      const label = `a${idx}`;
      const delay = Math.round(start * 48000);
      filters.push(
        `[${idx}:a]atrim=start=${number(clip.sourceStart)}:duration=${number(duration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${number(clip.audioGain)},adelay=${delay}S:all=1[${label}]`,
      );
      audioLabels.push(`[${label}]`);
    }
  }
  const captionFiles: string[] = [];
  try {
    for (let i = 0; i < sequence.captions.length; i++) {
      const caption = sequence.captions[i];
      const imagePath = join(directory, 'cache', `caption-${randomUUID()}.png`);
      await mkdir(join(directory, 'cache'), { recursive: true });
      captionFiles.push(imagePath);
      const fontCandidates = [
        process.env.FRAMO_FONT ?? process.env.FRAMEO_FONT,
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/Supplemental/Songti.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      ].filter((p): p is string => !!p && existsSync(p));
      if (!fontCandidates.length) throw new Error('缺少字幕字体，请配置 FRAMO_FONT。');
      GlobalFonts.registerFromPath(fontCandidates[0], 'Framo Caption');
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const fontSize = Math.max(8, Math.round((caption.fontSize * width) / sequence.width));
      ctx.font = `${fontSize}px "Framo Caption"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = caption.color;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.lineWidth = Math.max(2, fontSize / 14);
      ctx.lineJoin = 'round';
      const lines: string[] = [];
      for (const paragraph of caption.text.split('\n')) {
        let line = '';
        for (const character of paragraph) {
          if (line && ctx.measureText(line + character).width > width * 0.9) {
            lines.push(line);
            line = character;
          } else line += character;
        }
        lines.push(line);
      }
      const lineHeight = fontSize * 1.25;
      const center =
        caption.position === 'top'
          ? height * 0.12
          : caption.position === 'center'
            ? height * 0.5
            : height * 0.88;
      const initial = center - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, index) => {
        ctx.strokeText(line, width / 2, initial + index * lineHeight);
        ctx.fillText(line, width / 2, initial + index * lineHeight);
      });
      await writeFile(imagePath, canvas.toBuffer('image/png'));
      args.push(
        '-loop',
        '1',
        '-framerate',
        String(sequence.fps),
        '-t',
        number(seconds),
        '-i',
        imagePath,
      );
      const idx = input++;
      const out = `c${i}`;
      filters.push(
        `${currentVideo}[${idx}:v]overlay=eof_action=pass:repeatlast=0:enable='gte(n,${caption.start})*lt(n,${caption.start + caption.duration})'[${out}]`,
      );
      currentVideo = `[${out}]`;
    }
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,atrim=duration=${number(seconds)}[mix]`,
    );
    const temporary = options.output + `.${randomUUID()}.partial.mp4`;
    await mkdir(resolve(options.output, '..'), { recursive: true });
    const encoder =
      process.env.FRAMO_ENCODER ??
      process.env.FRAMEO_ENCODER ??
      (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264');
    const encodeArgs =
      encoder === 'h264_videotoolbox'
        ? ['-allow_sw', '1', '-b:v', options.preview ? '4M' : '12M']
        : [
            '-preset',
            options.preview ? 'ultrafast' : 'medium',
            '-crf',
            options.preview ? '26' : '18',
          ];
    args.push(
      '-filter_complex_threads',
      '1',
      '-filter_complex',
      filters.join(';'),
      '-map',
      currentVideo,
      '-map',
      '[mix]',
      '-c:v',
      encoder,
      ...encodeArgs,
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(sequence.fps),
      '-frames:v',
      String(durationTicks),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      number(seconds),
      '-movflags',
      '+faststart',
      temporary,
    );
    try {
      await runProcess(ffmpegPath(), args, {
        signal,
        onProgress: (text) => {
          const match = /out_time_us=(\d+)/.exec(text);
          if (match) options.onProgress?.(Math.min(0.96, Number(match[1]) / 1e6 / seconds));
        },
      });
      const metadata = await probe(temporary, signal);
      const video = metadata.streams.find((s) => s.codec_type === 'video');
      const audio = metadata.streams.find((s) => s.codec_type === 'audio');
      if (
        !video ||
        !audio ||
        video.width !== width ||
        video.height !== height ||
        Math.abs(Number(metadata.format.duration) - seconds) > 1 / sequence.fps + 0.05 ||
        Number(video.nb_frames) !== durationTicks
      )
        throw new Error('导出校验失败：尺寸、时长、帧数或音轨不符合要求。');
      // Decode the complete file before publishing it.
      await runProcess(ffmpegPath(), ['-v', 'error', '-i', temporary, '-f', 'null', '-'], {
        signal,
      });
      if (signal?.aborted) throw new Error('操作已取消。');
      await rename(temporary, options.output);
      options.onProgress?.(1);
      return { path: options.output, duration: seconds, frames: durationTicks };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  } finally {
    await Promise.all(captionFiles.map((path) => rm(path, { force: true })));
  }
}
