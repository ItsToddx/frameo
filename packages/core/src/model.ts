/** All timeline positions and durations are integer frame ticks at Sequence.fps.
 * Source offsets and asset durations are seconds, independent of timeline rate.
 * The seconds representation retains audio sample precision. Intervals are [start, end).
 */
export type Id = string;
export type AssetKind = 'video' | 'image' | 'audio';
export interface Asset {
  id: Id;
  name: string;
  kind: AssetKind;
  path: string;
  url: string;
  thumbnailUrl?: string;
  hash: string;
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  originJobId?: Id;
  createdAt: string;
}
export interface Track {
  id: Id;
  name: string;
  kind: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
}
export interface Clip {
  id: Id;
  trackId: Id;
  assetVersionId: Id;
  start: number;
  duration: number;
  sourceStart: number;
  audioGain: number;
  muted: boolean;
}
export interface Caption {
  id: Id;
  start: number;
  duration: number;
  text: string;
  fontSize: number;
  color: string;
  position: 'top' | 'center' | 'bottom';
}
export interface Sequence {
  id: Id;
  name: string;
  revision: number;
  width: number;
  height: number;
  fps: number;
  tracks: Track[];
  clips: Clip[];
  captions: Caption[];
}
export type EditCommand =
  | { type: 'addTrack'; track: Track }
  | { type: 'updateTrack'; trackId: Id; patch: Partial<Pick<Track, 'name' | 'muted' | 'locked'>> }
  | { type: 'removeTrack'; trackId: Id }
  | { type: 'addClip'; clip: Clip }
  | {
      type: 'updateClip';
      clipId: Id;
      patch: Partial<
        Pick<Clip, 'start' | 'duration' | 'sourceStart' | 'trackId' | 'audioGain' | 'muted'>
      >;
    }
  | { type: 'removeClip'; clipId: Id }
  | { type: 'splitClip'; clipId: Id; at: number; newClipId: Id }
  | { type: 'replaceClip'; clipId: Id; assetVersionId: Id; sourceStart: number }
  | { type: 'upsertCaption'; caption: Caption }
  | { type: 'removeCaption'; captionId: Id }
  | {
      type: 'sequenceSettings';
      patch: Partial<Pick<Sequence, 'name' | 'width' | 'height' | 'fps'>>;
    };

export type EditorErrorCode =
  | 'INVALID_SEQUENCE'
  | 'INVALID_COMMAND'
  | 'INVALID_TIME'
  | 'INVALID_MEDIA'
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'TRACK_LOCKED'
  | 'OVERLAP'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'HISTORY_CONFLICT'
  | 'HISTORY_EMPTY';

export class EditorError extends Error {
  constructor(
    public readonly code: EditorErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'EditorError';
  }
}

export const EDITOR_LIMITS = Object.freeze({
  maxDimension: 8192,
  minDimension: 16,
  maxFps: 120,
  maxSeconds: 24 * 60 * 60,
  maxCommands: 512,
  maxTracks: 64,
  maxClips: 10000,
  maxCaptions: 10000,
  maxGain: 16,
});
