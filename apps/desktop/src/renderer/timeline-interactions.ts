import type { Asset, Clip, EditCommand, Sequence } from '../adapters/contracts/api';

export type ClipManipulationMode = 'move' | 'trim-start' | 'trim-end';

export interface ClipProposal {
  clip: Clip;
  command: EditCommand | null;
  constrained: boolean;
}

/** A pointer gesture proposes frame-aligned edits within its original track gap. */
export class ClipManipulation {
  readonly clip: Clip;
  private readonly minimumStart: number;
  private readonly maximumEnd: number;

  constructor(
    private readonly sequence: Sequence,
    private readonly assets: readonly Asset[],
    clipId: string,
    readonly mode: ClipManipulationMode,
  ) {
    const clip = sequence.clips.find((item) => item.id === clipId);
    if (!clip) throw new Error('片段不存在');
    if (sequence.tracks.find((track) => track.id === clip.trackId)?.locked) {
      throw new Error('轨道已锁定');
    }
    this.clip = { ...clip };
    const neighbors = sequence.clips.filter(
      (item) => item.trackId === clip.trackId && item.id !== clip.id,
    );
    this.minimumStart = Math.max(
      0,
      ...neighbors
        .filter((item) => item.start < clip.start)
        .map((item) => item.start + item.duration),
    );
    this.maximumEnd = Math.min(
      sequence.fps * 24 * 60 * 60,
      ...neighbors
        .filter((item) => item.start >= clip.start + clip.duration)
        .map((item) => item.start),
    );
  }

  atDeltaPixels(pixels: number, pixelsPerSecond: number): ClipProposal {
    if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0)
      throw new Error('时间线缩放无效');
    return this.atDeltaFrames((pixels / pixelsPerSecond) * this.sequence.fps);
  }

  atDeltaFrames(delta: number): ClipProposal {
    if (!Number.isFinite(delta)) throw new Error('片段位置无效');
    const requested = Math.round(delta);
    if (this.mode === 'trim-start') {
      const asset = this.assets.find((item) => item.id === this.clip.assetVersionId);
      if (!asset) throw new Error('源素材不存在');
      const end = this.clip.start + this.clip.duration;
      const sourceMinimum =
        asset.kind === 'image'
          ? 0
          : this.clip.start - Math.floor((this.clip.sourceStart + 1e-7) * this.sequence.fps);
      const start = Math.max(
        this.minimumStart,
        sourceMinimum,
        Math.min(end - 1, this.clip.start + requested),
      );
      const sourceStart =
        asset.kind === 'image'
          ? 0
          : Math.max(0, this.clip.sourceStart + (start - this.clip.start) / this.sequence.fps);
      const clip = { ...this.clip, start, duration: end - start, sourceStart };
      return {
        clip,
        command:
          start === this.clip.start
            ? null
            : {
                type: 'updateClip',
                clipId: clip.id,
                patch: { start, duration: clip.duration, sourceStart },
              },
        constrained: start !== this.clip.start + requested,
      };
    }
    if (this.mode === 'trim-end') {
      const asset = this.assets.find((item) => item.id === this.clip.assetVersionId);
      if (!asset) throw new Error('源素材不存在');
      const available =
        asset.kind === 'image'
          ? this.maximumEnd - this.clip.start
          : Math.floor((asset.duration - this.clip.sourceStart + 1e-7) * this.sequence.fps);
      const duration = Math.max(
        1,
        Math.min(this.maximumEnd - this.clip.start, available, this.clip.duration + requested),
      );
      const clip = { ...this.clip, duration };
      return {
        clip,
        command:
          duration === this.clip.duration
            ? null
            : { type: 'updateClip', clipId: clip.id, patch: { duration } },
        constrained: duration !== this.clip.duration + requested,
      };
    }
    const start = Math.max(
      this.minimumStart,
      Math.min(this.maximumEnd - this.clip.duration, this.clip.start + requested),
    );
    const clip = { ...this.clip, start };
    return {
      clip,
      command:
        start === this.clip.start
          ? null
          : { type: 'updateClip', clipId: clip.id, patch: { start } },
      constrained: start !== this.clip.start + requested,
    };
  }
}

export type TimelineDraftPhase =
  'acquiring' | 'ready' | 'blocked' | 'saving' | 'releasing' | 'release-failed' | 'conflict';
export interface TimelineDraftState {
  base: Sequence;
  source: string;
  phase: TimelineDraftPhase;
}
interface TimelineDraftPorts {
  currentSequence: () => Sequence;
  onDraftChange: (dirty: boolean) => Promise<boolean>;
  onApply: (commands: EditCommand[], expectedRevision: number) => Promise<boolean>;
  onStateChange: (state: TimelineDraftState | null) => void;
}

/** Owns a single local draft until the host acknowledges its lease release. */
export class TimelineDraft {
  private current: TimelineDraftState | null = null;
  private acquired: Promise<boolean> = Promise.resolve(false);
  private releasing: Promise<boolean> | null = null;

  constructor(private readonly ports: TimelineDraftPorts) {}

  get state(): TimelineDraftState | null {
    return this.current;
  }

  begin(sequence: Sequence, source: string): boolean {
    if (this.current) return this.current.source === source;
    this.current = { base: structuredClone(sequence), source, phase: 'acquiring' };
    this.ports.onStateChange(this.current);
    this.acquired = this.ports
      .onDraftChange(true)
      .catch(() => false)
      .then((acquired) => {
        if (this.current?.phase === 'acquiring') this.setPhase(acquired ? 'ready' : 'blocked');
        return acquired;
      });
    return true;
  }

  discard(): Promise<boolean> {
    if (this.releasing) return this.releasing;
    if (!this.current) return Promise.resolve(true);
    if (this.current.phase === 'saving') return Promise.resolve(false);
    this.setPhase('releasing');
    this.releasing = this.release();
    return this.releasing;
  }

  async save(commands: EditCommand[]): Promise<boolean> {
    const draft = this.current;
    if (!draft || ['saving', 'releasing', 'release-failed'].includes(draft.phase)) return false;
    if (!(await this.acquired) || this.current?.base !== draft.base) return false;
    if (['saving', 'releasing', 'release-failed'].includes(this.current.phase)) return false;
    const current = this.ports.currentSequence();
    if (current.id !== draft.base.id || current.revision !== draft.base.revision) {
      this.setPhase('conflict');
      return false;
    }
    this.setPhase('saving');
    const saved = await this.ports.onApply(commands, draft.base.revision).catch(() => false);
    if (!saved) {
      this.setPhase('ready');
      return false;
    }
    this.setPhase('ready');
    return this.discard();
  }

  private async release(): Promise<boolean> {
    await this.acquired;
    const released = await this.ports.onDraftChange(false).catch(() => false);
    this.releasing = null;
    if (!released) {
      this.setPhase('release-failed');
      return false;
    }
    this.current = null;
    this.ports.onStateChange(null);
    return true;
  }

  private setPhase(phase: TimelineDraftPhase): void {
    if (!this.current) return;
    this.current = { ...this.current, phase };
    this.ports.onStateChange(this.current);
  }
}
