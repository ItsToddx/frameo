import {
  EDITOR_LIMITS,
  EditorError,
  type Asset,
  type Caption,
  type Clip,
  type EditCommand,
  type Sequence,
  type Track,
} from './model.js';

function fail(
  code: ConstructorParameters<typeof EditorError>[0],
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new EditorError(code, message, details);
}
const object = (value: unknown, label: string): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_SEQUENCE', `${label} must be an object`);
};
const id = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    fail('INVALID_SEQUENCE', `${label} must be a non-empty ID of at most 256 characters`);
};
const name = (value: unknown, label: string): void => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160)
    fail('INVALID_SEQUENCE', `${label} must contain 1–160 characters`);
};
const bool = (value: unknown, label: string): void => {
  if (typeof value !== 'boolean') fail('INVALID_SEQUENCE', `${label} must be a boolean`);
};
const integer = (value: number, min: number, max: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail('INVALID_TIME', `${label} must be a safe integer between ${min} and ${max}`);
};
const finite = (value: number, min: number, max: number, label: string): void => {
  if (!Number.isFinite(value) || value < min || value > max)
    fail('INVALID_TIME', `${label} must be between ${min} and ${max}`);
};
const unique = <T extends { id: string }>(values: readonly T[], label: string): Map<string, T> => {
  const result = new Map<string, T>();
  for (const value of values) {
    object(value, label);
    id(value.id, `${label}.id`);
    if (result.has(value.id))
      fail('DUPLICATE_ID', `Duplicate ${label} ID: ${value.id}`, { id: value.id });
    result.set(value.id, value);
  }
  return result;
};
const interval = (start: number, duration: number, fps: number, label: string): void => {
  const maximum = EDITOR_LIMITS.maxSeconds * fps;
  integer(start, 0, maximum, `${label}.start`);
  integer(duration, 1, maximum, `${label}.duration`);
  integer(start + duration, 1, maximum, `${label}.end`);
};

export function validateSequence(sequence: Sequence, assets: readonly Asset[]): void {
  object(sequence, 'Sequence');
  id(sequence.id, 'Sequence.id');
  name(sequence.name, 'Sequence.name');
  integer(sequence.revision, 0, Number.MAX_SAFE_INTEGER, 'Sequence.revision');
  integer(sequence.fps, 1, EDITOR_LIMITS.maxFps, 'Sequence.fps');
  for (const dimension of ['width', 'height'] as const) {
    integer(
      sequence[dimension],
      EDITOR_LIMITS.minDimension,
      EDITOR_LIMITS.maxDimension,
      `Sequence.${dimension}`,
    );
    if (sequence[dimension] % 2)
      fail('INVALID_SEQUENCE', `Sequence.${dimension} must be even for video encoding`);
  }
  for (const [label, values, maximum] of [
    ['tracks', sequence.tracks, EDITOR_LIMITS.maxTracks],
    ['clips', sequence.clips, EDITOR_LIMITS.maxClips],
    ['captions', sequence.captions, EDITOR_LIMITS.maxCaptions],
  ] as const) {
    if (!Array.isArray(values) || values.length > maximum)
      fail('INVALID_SEQUENCE', `Sequence.${label} must be an array of at most ${maximum} items`);
  }
  if (!Array.isArray(assets)) fail('INVALID_MEDIA', 'Assets must be an array');
  const tracks = unique(sequence.tracks, 'Track');
  unique(sequence.clips, 'Clip');
  unique(sequence.captions, 'Caption');
  const media = unique(assets, 'Asset');
  for (const track of tracks.values()) {
    name(track.name, 'Track.name');
    bool(track.muted, 'Track.muted');
    bool(track.locked, 'Track.locked');
    if (!['video', 'audio'].includes(track.kind))
      fail('INVALID_SEQUENCE', `Unknown track kind: ${track.kind}`);
  }
  const onTracks = new Map<string, Clip[]>();
  for (const clip of sequence.clips) {
    id(clip.trackId, 'Clip.trackId');
    id(clip.assetVersionId, 'Clip.assetVersionId');
    interval(clip.start, clip.duration, sequence.fps, `Clip ${clip.id}`);
    finite(clip.sourceStart, 0, EDITOR_LIMITS.maxSeconds, 'Clip.sourceStart');
    finite(clip.audioGain, 0, EDITOR_LIMITS.maxGain, 'Clip.audioGain');
    bool(clip.muted, 'Clip.muted');
    const track = tracks.get(clip.trackId);
    if (!track)
      fail('NOT_FOUND', `Track ${clip.trackId} does not exist`, { trackId: clip.trackId });
    const asset = media.get(clip.assetVersionId);
    if (!asset)
      fail('NOT_FOUND', `Asset ${clip.assetVersionId} does not exist`, {
        assetVersionId: clip.assetVersionId,
      });
    if (!['video', 'audio', 'image'].includes(asset.kind))
      fail('INVALID_MEDIA', `Unknown asset kind: ${asset.kind}`);
    finite(asset.duration, 0, EDITOR_LIMITS.maxSeconds, `Asset ${asset.id}.duration`);
    if (track.kind === 'video' && asset.kind === 'audio')
      fail('INVALID_MEDIA', 'Audio assets require an audio track', { clipId: clip.id });
    if (
      track.kind === 'audio' &&
      (asset.kind === 'image' || (asset.kind === 'video' && !asset.hasAudio))
    ) {
      fail('INVALID_MEDIA', 'An audio track requires audio media or a video with audio', {
        clipId: clip.id,
      });
    }
    if (asset.kind === 'image') {
      if (clip.sourceStart !== 0)
        fail('INVALID_MEDIA', 'Image clips must start at source offset zero', { clipId: clip.id });
    } else {
      const sourceEnd = clip.sourceStart + clip.duration / sequence.fps;
      // A small arithmetic tolerance avoids rejecting an exact frame/sample boundary.
      if (asset.duration <= 0 || sourceEnd - asset.duration > 1e-7) {
        fail('INVALID_MEDIA', `Asset ${asset.id} is too short for this clip`, {
          clipId: clip.id,
          sourceEnd,
          available: asset.duration,
        });
      }
    }
    const group = onTracks.get(clip.trackId) ?? [];
    group.push(clip);
    onTracks.set(clip.trackId, group);
  }
  for (const clips of onTracks.values()) {
    clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let index = 1; index < clips.length; index++) {
      const previous = clips[index - 1],
        current = clips[index];
      if (previous.start + previous.duration > current.start)
        fail('OVERLAP', 'Clips on the same track must not overlap', {
          clipIds: [previous.id, current.id],
        });
    }
  }
  for (const caption of sequence.captions) {
    interval(caption.start, caption.duration, sequence.fps, `Caption ${caption.id}`);
    if (typeof caption.text !== 'string' || !caption.text.trim() || caption.text.length > 4000)
      fail('INVALID_SEQUENCE', 'Caption text must contain 1–4000 characters');
    finite(caption.fontSize, 8, 300, 'Caption.fontSize');
    if (typeof caption.color !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(caption.color))
      fail('INVALID_SEQUENCE', 'Caption color must be a hex RGB or RGBA color');
    if (!['top', 'center', 'bottom'].includes(caption.position))
      fail('INVALID_SEQUENCE', 'Caption position must be top, center, or bottom');
  }
}

export function cloneSequence(sequence: Sequence): Sequence {
  return {
    ...sequence,
    tracks: sequence.tracks.map((track) => ({ ...track })),
    clips: sequence.clips.map((clip) => ({ ...clip })),
    captions: sequence.captions.map((caption) => ({ ...caption })),
  };
}

/** Freeze the entire snapshot; consumers submit commands instead of mutating it. */
export function immutableSequence(sequence: Sequence): Sequence {
  const copy = cloneSequence(sequence);
  for (const item of [...copy.tracks, ...copy.clips, ...copy.captions]) Object.freeze(item);
  Object.freeze(copy.tracks);
  Object.freeze(copy.clips);
  Object.freeze(copy.captions);
  return Object.freeze(copy);
}

const patchKeys = (patch: object, allowed: readonly string[]): void => {
  object(patch, 'Command.patch');
  for (const key of Object.keys(patch))
    if (!allowed.includes(key)) fail('INVALID_COMMAND', `Unsupported patch field: ${key}`);
};
const trackFor = (sequence: Sequence, trackId: string): Track => {
  const track = sequence.tracks.find((item) => item.id === trackId);
  if (!track) fail('NOT_FOUND', `Track ${trackId} does not exist`, { trackId });
  return track;
};
const editableTrack = (sequence: Sequence, trackId: string): Track => {
  const track = trackFor(sequence, trackId);
  if (track.locked) fail('TRACK_LOCKED', `Track ${track.name} is locked`, { trackId });
  return track;
};
const clipFor = (sequence: Sequence, clipId: string): Clip => {
  const clip = sequence.clips.find((item) => item.id === clipId);
  if (!clip) fail('NOT_FOUND', `Clip ${clipId} does not exist`, { clipId });
  editableTrack(sequence, clip.trackId);
  return clip;
};
const resample = <T extends Clip | Caption>(item: T, fromFps: number, toFps: number): T => {
  const start = Math.round((item.start * toFps) / fromFps);
  const end = Math.round(((item.start + item.duration) * toFps) / fromFps);
  if (end <= start)
    fail(
      'INVALID_TIME',
      'The new frame rate would collapse a clip or caption; increase its duration first',
      { id: item.id },
    );
  return { ...item, start, duration: end - start };
};

function evaluateCommands(
  sequence: Sequence,
  assets: readonly Asset[],
  commands: readonly EditCommand[],
  increment: boolean,
): Sequence {
  validateSequence(sequence, assets);
  if (!Array.isArray(commands) || !commands.length || commands.length > EDITOR_LIMITS.maxCommands)
    fail('INVALID_COMMAND', `An edit batch must contain 1–${EDITOR_LIMITS.maxCommands} commands`);
  const next = cloneSequence(sequence);
  for (const command of commands) {
    object(command, 'Command');
    switch (command.type) {
      case 'addTrack': {
        object(command.track, 'Command.track');
        if (next.tracks.some((track) => track.id === command.track.id))
          fail('DUPLICATE_ID', `Track ${command.track.id} already exists`);
        next.tracks.push({ ...command.track });
        break;
      }
      case 'updateTrack': {
        const track = trackFor(next, command.trackId);
        patchKeys(command.patch, ['name', 'muted', 'locked']);
        Object.assign(track, command.patch);
        break;
      }
      case 'removeTrack': {
        editableTrack(next, command.trackId);
        next.tracks = next.tracks.filter((track) => track.id !== command.trackId);
        next.clips = next.clips.filter((clip) => clip.trackId !== command.trackId);
        break;
      }
      case 'addClip': {
        object(command.clip, 'Command.clip');
        editableTrack(next, command.clip.trackId);
        if (next.clips.some((clip) => clip.id === command.clip.id))
          fail('DUPLICATE_ID', `Clip ${command.clip.id} already exists`);
        next.clips.push({ ...command.clip });
        break;
      }
      case 'updateClip': {
        const clip = clipFor(next, command.clipId);
        patchKeys(command.patch, [
          'start',
          'duration',
          'sourceStart',
          'trackId',
          'audioGain',
          'muted',
        ]);
        if (command.patch.trackId !== undefined) editableTrack(next, command.patch.trackId);
        Object.assign(clip, command.patch);
        break;
      }
      case 'removeClip': {
        clipFor(next, command.clipId);
        next.clips = next.clips.filter((clip) => clip.id !== command.clipId);
        break;
      }
      case 'splitClip': {
        const clip = clipFor(next, command.clipId);
        id(command.newClipId, 'Command.newClipId');
        if (next.clips.some((item) => item.id === command.newClipId))
          fail('DUPLICATE_ID', `Clip ${command.newClipId} already exists`);
        integer(command.at, clip.start + 1, clip.start + clip.duration - 1, 'Command.at');
        const leftDuration = command.at - clip.start;
        const asset = assets.find((item) => item.id === clip.assetVersionId);
        if (!asset)
          fail('NOT_FOUND', `Asset ${clip.assetVersionId} does not exist`, {
            assetVersionId: clip.assetVersionId,
          });
        // Calculate this source boundary once. Both sides use the identical cut.
        const sourceBoundary =
          asset.kind === 'image' ? 0 : clip.sourceStart + leftDuration / next.fps;
        const right: Clip = {
          ...clip,
          id: command.newClipId,
          start: command.at,
          duration: clip.duration - leftDuration,
          sourceStart: sourceBoundary,
        };
        clip.duration = leftDuration;
        next.clips.push(right);
        break;
      }
      case 'replaceClip': {
        const clip = clipFor(next, command.clipId);
        clip.assetVersionId = command.assetVersionId;
        clip.sourceStart = command.sourceStart;
        break;
      }
      case 'upsertCaption': {
        object(command.caption, 'Command.caption');
        const index = next.captions.findIndex((caption) => caption.id === command.caption.id);
        if (index === -1) next.captions.push({ ...command.caption });
        else next.captions[index] = { ...command.caption };
        break;
      }
      case 'removeCaption': {
        if (!next.captions.some((caption) => caption.id === command.captionId))
          fail('NOT_FOUND', `Caption ${command.captionId} does not exist`);
        next.captions = next.captions.filter((caption) => caption.id !== command.captionId);
        break;
      }
      case 'sequenceSettings': {
        patchKeys(command.patch, ['name', 'width', 'height', 'fps']);
        if (command.patch.fps !== undefined && command.patch.fps !== next.fps) {
          integer(command.patch.fps, 1, EDITOR_LIMITS.maxFps, 'Sequence.fps');
          if (next.clips.some((clip) => trackFor(next, clip.trackId).locked))
            fail('TRACK_LOCKED', 'Unlock affected tracks before changing the frame rate');
          next.clips = next.clips.map((clip) => resample(clip, next.fps, command.patch.fps!));
          next.captions = next.captions.map((caption) =>
            resample(caption, next.fps, command.patch.fps!),
          );
        }
        Object.assign(next, command.patch);
        break;
      }
      default:
        fail('INVALID_COMMAND', 'Unknown edit command');
    }
  }
  if (increment) integer(++next.revision, 1, Number.MAX_SAFE_INTEGER, 'Sequence.revision');
  validateSequence(next, assets);
  return immutableSequence(next);
}

/** Apply one atomic batch and produce one new, immutable revision. */
export function applyCommands(
  sequence: Sequence,
  assets: readonly Asset[],
  commands: readonly EditCommand[],
): Sequence {
  return evaluateCommands(sequence, assets, commands, true);
}

/** Preview validation never increments revisions or writes to a store. */
export function validateCommands(
  sequence: Sequence,
  assets: readonly Asset[],
  commands: readonly EditCommand[],
): Sequence {
  return evaluateCommands(sequence, assets, commands, false);
}

export function sequenceDuration(sequence: Sequence): number {
  return Math.max(
    0,
    ...sequence.clips.map((clip) => clip.start + clip.duration),
    ...sequence.captions.map((caption) => caption.start + caption.duration),
  );
}

export function ticksToSeconds(ticks: number, fps: number): number {
  integer(fps, 1, EDITOR_LIMITS.maxFps, 'fps');
  integer(ticks, 0, EDITOR_LIMITS.maxSeconds * fps, 'ticks');
  return ticks / fps;
}
