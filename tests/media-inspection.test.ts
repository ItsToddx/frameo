import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { inspectMedia } from '../apps/desktop/src/adapters/runtime/inspect-media.js';
import {
  archiveMedia,
  ffmpegPath,
  runProcess,
} from '../apps/desktop/src/adapters/runtime/media.js';
import { WorkerEngine } from '../apps/desktop/src/agent-worker/engine.js';
import type { WorkerRun } from '../apps/desktop/src/agent-worker/protocol.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-inspection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const videoFile = join(directory, 'red-blue.mp4');
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
    'sine=frequency=440:sample_rate=16000:duration=2',
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
    '-c:a',
    'aac',
    '-t',
    '2',
    videoFile,
  ]);
  const imageFile = join(directory, 'portrait.png'),
    canvas = createCanvas(1000, 2000),
    context = canvas.getContext('2d');
  context.fillStyle = '#00ff00';
  context.fillRect(0, 0, 1000, 2000);
  await writeFile(imageFile, canvas.toBuffer('image/png'));
  const audioFile = join(directory, 'tone.wav');
  await runProcess(ffmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=16000:duration=2',
    '-c:a',
    'pcm_s16le',
    audioFile,
  ]);
  const project = join(directory, 'project'),
    video = await archiveMedia(project, videoFile),
    image = await archiveMedia(project, imageFile),
    audio = await archiveMedia(project, audioFile);
  return { directory: project, root: directory, video, image, audio };
}
async function pixel(data: string): Promise<number[]> {
  const image = await loadImage(Buffer.from(data, 'base64')),
    canvas = createCanvas(1, 1),
    context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
}
test('inspection decodes real video source frames at both sides of a shot boundary and measures its actual audio', async (t) => {
  const f = await fixture(t),
    before = (await readdir(join(f.directory, 'cache'))).sort();
  const red = await inspectMedia({ directory: f.directory, asset: f.video, timeSeconds: 0.5 }),
    blue = await inspectMedia({ directory: f.directory, asset: f.video, timeSeconds: 1.5 });
  assert.ok(red.image && blue.image);
  const r = await pixel(red.image.data),
    b = await pixel(blue.image.data);
  assert.ok(r[0] > 200 && r[2] < 20);
  assert.ok(b[2] > 200 && b[0] < 20);
  assert.equal(blue.value.assetVersionId, f.video.id);
  assert.equal(blue.value.hash, f.video.hash);
  assert.equal(blue.value.timeSeconds, 1.5);
  assert.ok(blue.value.audioSummary);
  assert.ok(blue.value.audioSummary.rms > 0.05);
  assert.ok(blue.value.audioSummary.peak < 0.2);
  assert.ok(blue.value.audioSummary.sampleDurationSeconds <= 0.51);
  const end = await inspectMedia({
    directory: f.directory,
    asset: f.video,
    timeSeconds: f.video.duration,
  });
  assert.ok(end.image);
  assert.ok((await pixel(end.image.data))[2] > 200);
  assert.deepEqual(
    (await readdir(join(f.directory, 'cache'))).sort(),
    before,
    'Every temporary inspection directory must be cleaned',
  );
});
test('portrait reference images produce an actual JPEG bounded to 640 pixels and 128 KiB', async (t) => {
  const f = await fixture(t),
    result = await inspectMedia({ directory: f.directory, asset: f.image });
  assert.ok(result.image);
  const bytes = Buffer.from(result.image.data, 'base64'),
    decoded = await loadImage(bytes);
  assert.ok(bytes.length <= 128 * 1024);
  assert.ok(decoded.width <= 640 && decoded.height <= 640);
  assert.equal(result.image.mimeType, 'image/jpeg');
  assert.equal(result.value.width, 1000);
  assert.equal(result.value.height, 2000);
  assert.equal(result.value.duration, 0);
  const color = await pixel(result.image.data);
  assert.ok(color[1] > 240 && color[0] < 20 && color[2] < 20);
});
test('audio inspection reports finite measured PCM facts without sending raw sound bytes', async (t) => {
  const f = await fixture(t),
    result = await inspectMedia({ directory: f.directory, asset: f.audio, timeSeconds: 0.25 });
  assert.equal(result.image, undefined);
  const audio = result.value.audioSummary!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channels, 1);
  assert.equal(audio.sampleStartSeconds, 0.25);
  assert.ok(Math.abs(audio.rms - 0.0884) < 0.003);
  assert.ok(Math.abs(audio.peak - 0.125) < 0.003);
  assert.equal(audio.clippedSamples, 0);
  assert.ok(audio.rmsDbfs !== null && audio.rmsDbfs < -20);
  assert.equal(Object.hasOwn(result, 'audio'), false);
  assert.ok(JSON.stringify(result).length < 1500);
});
test('high-detail image inspections remain below the upload byte limit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-inspection-noise-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const canvas = createCanvas(800, 800),
    context = canvas.getContext('2d'),
    pixels = context.createImageData(800, 800);
  let random = 123456789;
  for (let n = 0; n < pixels.data.length; n += 4) {
    for (let channel = 0; channel < 3; channel++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      pixels.data[n + channel] = random >>> 24;
    }
    pixels.data[n + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const source = join(directory, 'noise.png');
  await writeFile(source, canvas.toBuffer('image/png'));
  const project = join(directory, 'project'),
    asset = await archiveMedia(project, source),
    result = await inspectMedia({ directory: project, asset });
  assert.ok(result.image);
  assert.ok(Buffer.from(result.image.data, 'base64').length <= 128 * 1024);
  const decoded = await loadImage(Buffer.from(result.image.data, 'base64'));
  assert.ok(decoded.width <= 640 && decoded.height <= 640);
});
test('silence has null dBFS and clipped PCM is measured without subjective sound claims', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'frameo-inspection-pcm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const raw of [0, 32767]) {
    const samples = 16000,
      data = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index++) data.writeInt16LE(raw, index * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(data.length + 36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    const source = join(directory, `pcm-${raw}.wav`);
    await writeFile(source, Buffer.concat([header, data]));
    const project = join(directory, 'project'),
      asset = await archiveMedia(project, source),
      result = await inspectMedia({ directory: project, asset });
    const audio = result.value.audioSummary!;
    if (raw === 0) {
      assert.equal(audio.rms, 0);
      assert.equal(audio.peak, 0);
      assert.equal(audio.rmsDbfs, null);
      assert.equal(audio.peakDbfs, null);
    } else {
      assert.ok(audio.peak > 0.99);
      assert.equal(audio.clippedSamples, samples);
    }
  }
});
test('inspection refuses spoofed hashes, kinds, dimensions, source paths, times and symlinks before returning content', async (t) => {
  const f = await fixture(t);
  for (const asset of [
    { ...f.video, hash: 'a'.repeat(64) },
    { ...f.video, kind: 'audio' as const },
    { ...f.video, duration: 99 },
    { ...f.video, width: 100 },
    { ...f.video, path: '../red-blue.mp4' },
  ])
    await assert.rejects(inspectMedia({ directory: f.directory, asset }));
  for (const timeSeconds of [-1, NaN, Infinity, 99])
    await assert.rejects(inspectMedia({ directory: f.directory, asset: f.video, timeSeconds }));
  await assert.rejects(inspectMedia({ directory: f.directory, asset: f.image, timeSeconds: 1 }));
  await assert.rejects(
    inspectMedia({ directory: f.directory, asset: f.video, signal: AbortSignal.abort() }),
  );
  const source = join(f.directory, f.video.path),
    backup = join(f.root, 'saved.mp4');
  await rename(source, backup);
  await symlink(backup, source);
  await assert.rejects(inspectMedia({ directory: f.directory, asset: f.video }), /immutable/);
  assert.equal(
    (await readdir(join(f.directory, 'cache'))).filter((name) => name.startsWith('inspect-'))
      .length,
    0,
  );
});
function sse(response: ServerResponse, delta: unknown, finishReason: string) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(
    `data: ${JSON.stringify({ id: 'vision-fixture', object: 'chat.completion.chunk', created: 1, model: 'vision-fixture', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
  );
  response.write(
    `data: ${JSON.stringify({ id: 'vision-fixture', object: 'chat.completion.chunk', created: 1, model: 'vision-fixture', choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}
test('real Pi passes the inspected JPEG to the next model inference and keeps tool details factual', async (t) => {
  const f = await fixture(t),
    requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    requests.push(JSON.parse(text));
    if (requests.length === 1)
      sse(
        response,
        {
          tool_calls: [
            {
              index: 0,
              id: 'inspect-1',
              type: 'function',
              function: {
                name: 'inspect_media',
                arguments: JSON.stringify({ assetVersionId: f.image.id, timeSeconds: 0 }),
              },
            },
          ],
        },
        'tool_calls',
      );
    else sse(response, { content: 'The sampled source image is green.' }, 'stop');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const run: WorkerRun = {
    runId: 'inspection-run',
    sessionId: 'inspection-session',
    rootRequestId: 'inspection-root',
    text: 'Inspect this reference image.',
    settings: {
      arkBaseUrl: `http://127.0.0.1:${address.port}/api/v3`,
      agentModel: 'vision-fixture',
      apiKey: 'fixture-key',
    },
    context: {
      snapshot: {
        project: { id: 'p1', name: 'Inspection', path: f.directory, createdAt: '', updatedAt: '' },
        assets: [f.image],
        sequences: [],
        canvas: { revision: 0, items: [] },
        jobs: [],
        sessions: [],
        memories: [],
        reviews: [],
        recipes: [],
        canUndo: {},
        canRedo: {},
        eventSeq: 0,
      },
    },
  };
  const engine = new WorkerEngine(
    () => {},
    async (request, signal) => {
      assert.equal(request.name, 'inspect_media');
      assert.equal(request.args.assetVersionId, f.image.id);
      return inspectMedia({
        directory: f.directory,
        asset: f.image,
        timeSeconds: Number(request.args.timeSeconds),
        signal,
      });
    },
  );
  const result = await engine.run(run);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.budget.modelCalls, 2);
  assert.equal(result.budget.toolCalls, 1);
  const content = requests[1].messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : [],
  );
  assert.ok(
    content.some(
      (block) =>
        block.type === 'image_url' && block.image_url.url.startsWith('data:image/jpeg;base64,'),
    ),
  );
  const tool = result.history.find((message) => message.role === 'toolResult');
  assert.ok(tool && tool.role === 'toolResult');
  assert.equal(Object.hasOwn(tool.details as object, 'image'), false);
  assert.ok(tool.content.some((block) => block.type === 'image'));
});
