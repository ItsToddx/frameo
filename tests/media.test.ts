import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { Asset, Clip, EditCommand } from '../apps/desktop/src/adapters/contracts/api';
import {
  archiveMedia,
  ffmpegPath,
  probe,
  renderSequence,
  runProcess,
} from '../apps/desktop/src/adapters/runtime/media';
import { AppDatabase, ProjectDatabase } from '../apps/desktop/src/adapters/storage/database';
import { ProjectService } from '../apps/desktop/src/adapters/storage/project-service';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-media-'));
  const app = new AppDatabase(join(directory, 'app'));
  const database = ProjectDatabase.create(
    join(directory, 'project'),
    'Render fixture',
    320,
    180,
    24,
  );
  const service = new ProjectService(database, app);
  t.after(async () => {
    database.close();
    app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const video = join(directory, 'red-blue.mp4');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=24:d=1',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:r=24:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=2',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'mpeg4',
    '-q:v',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    '2',
    video,
  ]);
  const image = join(directory, 'green.png');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=320x180',
    '-frames:v',
    '1',
    image,
  ]);
  const audio = join(directory, 'tone.wav');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000:duration=2',
    '-c:a',
    'pcm_s16le',
    audio,
  ]);
  const assets: Asset[] = [];
  for (const file of [video, image, audio]) {
    const asset = await archiveMedia(database.directory, file);
    assets.push(database.addAsset(asset));
  }
  return { directory, app, database, service, assets, video, audio };
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
async function samplePixels(
  path: string,
  directory: string,
  frames: number[],
): Promise<number[][]> {
  const output = join(directory, 'pixels.rgb');
  const select = frames.map((frame) => `eq(n,${frame})`).join('+');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-vf',
    `select='${select}',crop=2:2:4:4,scale=1:1`,
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    output,
  ]);
  const bytes = await readFile(output);
  assert.equal(bytes.length, frames.length * 3, 'Every requested boundary frame must exist');
  return frames.map((_, i) => [...bytes.subarray(i * 3, i * 3 + 3)]);
}
function color(pixel: number[], expected: 'red' | 'blue' | 'green', frame: number) {
  const [r, g, b] = pixel;
  assert.ok(
    expected === 'red'
      ? r > 200 && g < 30 && b < 30
      : expected === 'blue'
        ? b > 200 && r < 30 && g < 30
        : g > 80 && r < 30 && b < 30,
    `Frame ${frame} should be ${expected}, actual RGB=${pixel.join(',')}`,
  );
}
async function decodedAudio(path: string, directory: string, name: string): Promise<Buffer> {
  const output = join(directory, name);
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_f32le',
    '-f',
    'wav',
    output,
  ]);
  const wave = await readFile(output);
  assert.equal(wave.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wave.subarray(8, 12).toString(), 'WAVE');
  for (let offset = 12; offset + 8 <= wave.length;) {
    const length = wave.readUInt32LE(offset + 4);
    if (wave.subarray(offset, offset + 4).toString() === 'data') {
      assert.ok(offset + 8 + length <= wave.length, 'Decoded WAV data must be complete');
      return wave.subarray(offset + 8, offset + 8 + length);
    }
    offset += 8 + length + (length % 2);
  }
  assert.fail('Decoded WAV must contain a PCM data chunk');
}
function rms(audio: Buffer, from: number, to: number): number {
  const start = Math.floor(from * 48000) * 2,
    end = Math.floor(to * 48000) * 2;
  assert.ok(audio.length >= end * 4, 'Decoded PCM must cover the selected audio interval');
  let squares = 0;
  for (let sample = start; sample < end; sample++) {
    const value = audio.readFloatLE(sample * 4);
    assert.ok(Number.isFinite(value));
    squares += value * value;
  }
  return Math.sqrt(squares / (end - start));
}

test('FFmpeg exports exact split boundaries, later video layers, images, Chinese captions, gain and both mute controls', async (t) => {
  const f = await fixture(t);
  const [video, image, audio] = f.assets;
  const initial = f.service.snapshot().sequences[0];
  const videoTrack = initial.tracks[0].id,
    audioTrack = initial.tracks[1].id;
  const source: Clip = {
    id: 'source',
    trackId: videoTrack,
    assetVersionId: video.id,
    start: 0,
    duration: 48,
    sourceStart: 0,
    audioGain: 1,
    muted: true,
  };
  apply(f.service, 'composition', [
    { type: 'addClip', clip: source },
    { type: 'splitClip', clipId: 'source', at: 24, newClipId: 'blue-half' },
    {
      type: 'addTrack',
      track: { id: 'upper', name: 'Image layer', kind: 'video', muted: false, locked: false },
    },
    {
      type: 'addClip',
      clip: {
        ...source,
        id: 'image',
        trackId: 'upper',
        assetVersionId: image.id,
        start: 36,
        duration: 12,
        muted: false,
      },
    },
    {
      type: 'addClip',
      clip: {
        ...source,
        id: 'gain',
        trackId: audioTrack,
        assetVersionId: audio.id,
        duration: 24,
        audioGain: 0.25,
        muted: false,
      },
    },
    {
      type: 'addClip',
      clip: {
        ...source,
        id: 'clip-muted',
        trackId: audioTrack,
        assetVersionId: audio.id,
        start: 24,
        duration: 24,
        sourceStart: 1,
        audioGain: 3,
      },
    },
    {
      type: 'addTrack',
      track: { id: 'muted-track', name: 'Muted track', kind: 'audio', muted: true, locked: false },
    },
    {
      type: 'addClip',
      clip: {
        ...source,
        id: 'track-muted',
        trackId: 'muted-track',
        assetVersionId: audio.id,
        audioGain: 3,
        muted: false,
      },
    },
    {
      type: 'upsertCaption',
      caption: {
        id: 'caption',
        start: 0,
        duration: 48,
        text: '你好，Frameo',
        fontSize: 30,
        color: '#ffffff',
        position: 'bottom',
      },
    },
  ]);
  const snapshot = f.service.snapshot();
  const output = join(f.directory, 'composition.mp4');
  const progress: number[] = [];
  const result = await renderSequence({
    directory: f.database.directory,
    sequence: snapshot.sequences[0],
    assets: snapshot.assets,
    output,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.frames, 48);
  assert.equal(result.duration, 2);
  assert.equal(progress.at(-1), 1);
  const metadata = await probe(output);
  const stream = metadata.streams.find((item) => item.codec_type === 'video')!;
  assert.equal((stream as typeof stream & { codec_name?: string }).codec_name, 'h264');
  assert.equal(Number(stream.nb_frames), 48);
  assert.equal(stream.width, 320);
  assert.equal(stream.height, 180);
  assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 1 / 24);
  const frames = [0, 23, 24, 35, 36, 47];
  const pixels = await samplePixels(output, f.directory, frames);
  for (let i = 0; i < frames.length; i++)
    color(pixels[i], frames[i] < 24 ? 'red' : frames[i] < 36 ? 'blue' : 'green', frames[i]);
  const captionFrame = join(f.directory, 'caption.rgb');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-i',
    output,
    '-vf',
    "select='eq(n,12)'",
    '-fps_mode',
    'passthrough',
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    captionFrame,
  ]);
  const captionPixels = await readFile(captionFrame);
  let whitePixels = 0;
  for (let offset = 320 * 100 * 3; offset < captionPixels.length; offset += 3)
    if (
      captionPixels[offset] > 200 &&
      captionPixels[offset + 1] > 200 &&
      captionPixels[offset + 2] > 200
    )
      whitePixels++;
  assert.ok(
    whitePixels > 100,
    `Chinese/Latin caption should visibly render, found ${whitePixels} white pixels`,
  );
  const actualAudio = await decodedAudio(output, f.directory, 'exported.f32');
  const referenceAudio = await decodedAudio(f.audio, f.directory, 'reference.f32');
  const gainRatio = rms(actualAudio, 0.2, 0.7) / rms(referenceAudio, 0.2, 0.7);
  assert.ok(
    gainRatio > 0.2 && gainRatio < 0.3,
    `Expected gain 0.25, measured RMS ratio ${gainRatio}`,
  );
  assert.ok(
    rms(actualAudio, 1.2, 1.7) < 0.001,
    'Muted clip and muted track must contribute no audible signal',
  );
  assert.ok(actualAudio.length >= 2 * 48000 * 2 * 4);
  await runProcess(ffmpegPath(), ['-v', 'error', '-i', output, '-f', 'null', '-']);
  assert.equal(
    (await readdir(join(f.database.directory, 'cache'))).some((name) =>
      /^caption-.*\.(txt|png)$/.test(name),
    ),
    false,
  );
  assert.equal(
    (await readdir(f.directory)).some((name) => name.endsWith('.partial.mp4')),
    false,
  );
});

test('trimming by source seconds renders the requested source segment from its first through last frame', async (t) => {
  const f = await fixture(t);
  const current = f.service.snapshot().sequences[0];
  apply(f.service, 'trim', [
    {
      type: 'addClip',
      clip: {
        id: 'trimmed',
        trackId: current.tracks[0].id,
        assetVersionId: f.assets[0].id,
        start: 0,
        duration: 24,
        sourceStart: 1,
        audioGain: 0,
        muted: true,
      },
    },
  ]);
  const snapshot = f.service.snapshot();
  const output = join(f.directory, 'trimmed.mp4');
  const result = await renderSequence({
    directory: f.database.directory,
    sequence: snapshot.sequences[0],
    assets: snapshot.assets,
    output,
  });
  assert.equal(result.frames, 24);
  assert.equal(result.duration, 1);
  const pixels = await samplePixels(output, f.directory, [0, 23]);
  color(pixels[0], 'blue', 0);
  color(pixels[1], 'blue', 23);
  assert.ok(rms(await decodedAudio(output, f.directory, 'silence.f32'), 0.2, 0.7) < 0.001);
});

test('a clip at a fractional-second frame tick is visible on its exact first frame and absent at its end', async (t) => {
  const f = await fixture(t);
  const current = f.service.snapshot().sequences[0];
  const source: Clip = {
    id: 'base',
    trackId: current.tracks[0].id,
    assetVersionId: f.assets[0].id,
    start: 0,
    duration: 24,
    sourceStart: 0,
    audioGain: 0,
    muted: true,
  };
  apply(f.service, 'fractional-boundary', [
    { type: 'addClip', clip: source },
    {
      type: 'addTrack',
      track: { id: 'upper', name: 'Upper', kind: 'video', muted: false, locked: false },
    },
    {
      type: 'addClip',
      clip: {
        ...source,
        id: 'image',
        trackId: 'upper',
        assetVersionId: f.assets[1].id,
        start: 7,
        duration: 12,
      },
    },
  ]);
  const snapshot = f.service.snapshot();
  const output = join(f.directory, 'fractional.mp4');
  await renderSequence({
    directory: f.database.directory,
    sequence: snapshot.sequences[0],
    assets: snapshot.assets,
    output,
  });
  const frames = [6, 7, 18, 19];
  const pixels = await samplePixels(output, f.directory, frames);
  for (let i = 0; i < frames.length; i++)
    color(pixels[i], frames[i] >= 7 && frames[i] < 19 ? 'green' : 'red', frames[i]);
});

test('splitting and moving a video preserves the shared source frame and leaves the intended timeline gap', async (t) => {
  const f = await fixture(t);
  const sourceFile = join(f.directory, 'frame-number.mp4');
  // Each frame has a distinct luma, so dropping one source frame is observable.
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'nullsrc=size=320x180:rate=24:duration=2',
    '-vf',
    "geq=lum='30+N*3':cb=128:cr=128",
    '-c:v',
    'mpeg4',
    '-q:v',
    '2',
    '-pix_fmt',
    'yuv420p',
    sourceFile,
  ]);
  const asset = f.database.addAsset(await archiveMedia(f.database.directory, sourceFile));
  const current = f.service.snapshot().sequences[0];
  apply(f.service, 'split-and-move', [
    {
      type: 'addClip',
      clip: {
        id: 'source',
        trackId: current.tracks[0].id,
        assetVersionId: asset.id,
        start: 0,
        duration: 48,
        sourceStart: 0,
        audioGain: 0,
        muted: true,
      },
    },
    { type: 'splitClip', clipId: 'source', at: 7, newClipId: 'right' },
    { type: 'updateClip', clipId: 'right', patch: { start: 12 } },
  ]);
  const snapshot = f.service.snapshot();
  const output = join(f.directory, 'moved.mp4');
  const result = await renderSequence({
    directory: f.database.directory,
    sequence: snapshot.sequences[0],
    assets: snapshot.assets,
    output,
  });
  assert.equal(result.frames, 53);
  const sourcePixels = await samplePixels(sourceFile, f.directory, [6, 7, 47]);
  const outputPixels = await samplePixels(output, f.directory, [6, 7, 11, 12, 52]);
  for (const index of [1, 2])
    assert.ok(
      outputPixels[index].every((channel) => channel < 5),
      `Timeline gap must be black, pixel=${outputPixels[index]}`,
    );
  for (const [source, target] of [
    [0, 0],
    [1, 3],
    [2, 4],
  ]) {
    assert.ok(
      sourcePixels[source].every(
        (channel, index) => Math.abs(channel - outputPixels[target][index]) <= 2,
      ),
      `Source frame must be preserved: expected ${sourcePixels[source]}, actual ${outputPixels[target]}`,
    );
  }
});

test('a caption with fractional-second boundaries appears exactly on its first tick and disappears at its end', async (t) => {
  const f = await fixture(t);
  const current = f.service.snapshot().sequences[0];
  apply(f.service, 'caption-boundary', [
    {
      type: 'addClip',
      clip: {
        id: 'source',
        trackId: current.tracks[0].id,
        assetVersionId: f.assets[0].id,
        start: 0,
        duration: 24,
        sourceStart: 0,
        audioGain: 0,
        muted: true,
      },
    },
    {
      type: 'upsertCaption',
      caption: {
        id: 'caption',
        start: 7,
        duration: 12,
        text: '字幕时间边界',
        fontSize: 30,
        color: '#ffffff',
        position: 'bottom',
      },
    },
  ]);
  const snapshot = f.service.snapshot();
  const output = join(f.directory, 'caption-boundary.mp4');
  await renderSequence({
    directory: f.database.directory,
    sequence: snapshot.sequences[0],
    assets: snapshot.assets,
    output,
  });
  const frames = [6, 7, 18, 19];
  const raw = join(f.directory, 'caption-boundaries.rgb');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-i',
    output,
    '-vf',
    `select='${frames.map((frame) => `eq(n,${frame})`).join('+')}'`,
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    raw,
  ]);
  const pixels = await readFile(raw);
  const frameBytes = 320 * 180 * 3;
  assert.equal(pixels.length, frameBytes * frames.length);
  for (let index = 0; index < frames.length; index++) {
    let whitePixels = 0;
    for (
      let offset = index * frameBytes + 320 * 100 * 3;
      offset < (index + 1) * frameBytes;
      offset += 3
    ) {
      if (pixels[offset] > 200 && pixels[offset + 1] > 200 && pixels[offset + 2] > 200)
        whitePixels++;
    }
    const expectedVisible = frames[index] >= 7 && frames[index] < 19;
    assert.ok(
      expectedVisible ? whitePixels > 100 : whitePixels === 0,
      `Caption at frame ${frames[index]} should be ${expectedVisible ? 'visible' : 'absent'}, measured ${whitePixels} white pixels`,
    );
  }
});

test('media archiving copies immutable content and deduplicates identical imports in the project', async (t) => {
  const f = await fixture(t);
  const first = f.assets[0];
  const imported = await archiveMedia(f.database.directory, f.video, 'Another display name');
  assert.equal(imported.hash, first.hash);
  assert.equal(imported.path, first.path);
  const archived = f.database.addAsset(imported);
  assert.equal(archived.id, first.id);
  assert.equal(f.service.snapshot().assets.length, 3);
  assert.equal(
    (await readdir(join(f.database.directory, 'media'))).filter((name) => name.includes(first.hash))
      .length,
    1,
  );
  assert.equal(
    (await readFile(join(f.database.directory, first.path))).equals(await readFile(f.video)),
    true,
  );
});
