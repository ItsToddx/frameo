import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  Captions,
  Check,
  Download,
  Film,
  LockKeyhole,
  LockKeyholeOpen,
  Maximize2,
  Music2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Asset, Caption, Clip, EditCommand, Job, Sequence } from '../adapters/contracts/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import {
  ClipManipulation,
  TimelineDraft,
  type ClipManipulationMode,
  type ClipProposal,
  type TimelineDraftState,
} from './timeline-interactions';
import { Button, Empty, IconButton, mediaUrl, timecode, uid } from './ui';
import { useI18n } from './i18n';
import type { MessageKey } from '../localization';

interface Props {
  sequence: Sequence;
  assets: Asset[];
  jobs: Job[];
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onApply: (commands: EditCommand[], expectedRevision?: number) => Promise<boolean>;
  onDraftChange: (dirty: boolean) => Promise<boolean>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onPreview: () => void;
  onExport: () => void;
  onClose: () => void;
  busy: boolean;
}

type InspectorTab = 'clip' | 'captions' | 'sequence';
interface GestureDraft {
  manipulation: ClipManipulation;
  proposal: ClipProposal;
}
interface PointerGesture {
  pointerId: number;
  originX: number;
  initialDelta: number;
  manipulation: ClipManipulation;
  changed: boolean;
}
const numeric = (form: FormData, key: string) => Number(form.get(key));
const modeLabels = {
  move: 'timeline.move',
  'trim-start': 'timeline.trimStart',
  'trim-end': 'timeline.trimEnd',
} as const satisfies Record<ClipManipulationMode, MessageKey>;
const acceptsAsset = (asset: Asset, kind: 'video' | 'audio') =>
  kind === 'video'
    ? asset.kind !== 'audio'
    : asset.kind === 'audio' || (asset.kind === 'video' && !!asset.hasAudio);

export function Timeline({
  sequence,
  assets,
  jobs,
  selectedClipId,
  onSelectClip,
  onApply,
  onDraftChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onPreview,
  onExport,
  onClose,
  busy,
}: Props) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const timelineScroll = useRef<HTMLDivElement>(null);
  const inspectorForm = useRef<HTMLFormElement>(null);
  const activePointer = useRef<PointerGesture | null>(null);
  const gestureRef = useRef<GestureDraft | null>(null);
  const draftCommands = useRef<EditCommand[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [scale, setScale] = useState(45);
  const [inspector, setInspector] = useState(false);
  const [tab, setTab] = useState<InspectorTab>('clip');
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null);
  const [addAsset, setAddAsset] = useState('');
  const [addTrack, setAddTrack] = useState('');
  const [draftState, setDraftState] = useState<TimelineDraftState | null>(null);
  const [gestureDraft, setGestureDraft] = useState<GestureDraft | null>(null);
  const [draftReset, setDraftReset] = useState(0);
  const callbacks = useRef({ sequence, onApply, onDraftChange });
  callbacks.current = { sequence, onApply, onDraftChange };
  const draftSession = useRef<TimelineDraft | null>(null);
  if (!draftSession.current) {
    draftSession.current = new TimelineDraft({
      currentSequence: () => callbacks.current.sequence,
      onApply: (commands, revision) => callbacks.current.onApply(commands, revision),
      onDraftChange: (dirty) => callbacks.current.onDraftChange(dirty),
      onStateChange: setDraftState,
    });
  }
  const session = draftSession.current;
  const workingSequence = draftState?.base ?? sequence;
  const draftDirty = !!draftState;
  const draftPending = draftState?.phase === 'saving' || draftState?.phase === 'releasing';
  const draftBlocked = draftState?.phase === 'blocked' || draftState?.phase === 'release-failed';
  const draftConflict = !!draftState && sequence.revision !== draftState.base.revision;
  const editingBusy = busy || draftDirty;
  const durationFrames = Math.max(
    workingSequence.fps * 5,
    ...workingSequence.clips.map((clip) => clip.start + clip.duration),
    ...workingSequence.captions.map((caption) => caption.start + caption.duration),
    gestureDraft ? gestureDraft.proposal.clip.start + gestureDraft.proposal.clip.duration : 0,
  );
  const width = Math.max(600, (durationFrames / workingSequence.fps) * scale + 64);
  const selected = workingSequence.clips.find((clip) => clip.id === selectedClipId);
  const track = workingSequence.tracks.find((item) => item.id === selected?.trackId);
  const selectedAsset = assets.find((asset) => asset.id === selected?.assetVersionId);
  const caption = workingSequence.captions.find((item) => item.id === selectedCaption);
  const currentPreview = [...jobs]
    .reverse()
    .find(
      (job) =>
        job.kind === 'preview' &&
        job.status === 'succeeded' &&
        job.input.sequenceId === sequence.id &&
        Number(job.input.revision) === sequence.revision &&
        job.outputPath,
    );
  const oldPreview = [...jobs]
    .reverse()
    .find(
      (job) =>
        job.kind === 'preview' &&
        job.status === 'succeeded' &&
        job.input.sequenceId === sequence.id &&
        job.outputPath,
    );
  const displayedPreview = currentPreview ?? oldPreview;
  const previewBusy = jobs.some(
    (job) =>
      job.kind === 'preview' &&
      job.input.sequenceId === sequence.id &&
      ['queued', 'running', 'finalizing'].includes(job.status),
  );
  const locked =
    !!track?.locked ||
    busy ||
    draftPending ||
    draftBlocked ||
    draftConflict ||
    (!!draftState && draftState.source !== 'inspector');
  const inspectorInert =
    busy ||
    draftPending ||
    draftBlocked ||
    draftConflict ||
    (!!draftState && draftState.source !== 'inspector');
  const rulerStep = scale < 25 ? 5 : scale < 65 ? 2 : 1;

  useEffect(() => {
    setPlayhead(0);
    onSelectClip(null);
    setSelectedCaption(null);
    setAddTrack('');
  }, [sequence.id]);

  function markDraft(source: string) {
    return session.begin(sequence, source);
  }

  function resetDraftControls() {
    gestureRef.current = null;
    draftCommands.current = [];
    setGestureDraft(null);
    setDraftReset((value) => value + 1);
  }

  async function releaseDraft() {
    if (await session.discard()) resetDraftControls();
  }

  async function saveDraft(commands: EditCommand[]) {
    if (!session.state && !markDraft('inspector')) return false;
    const saved = await session.save(commands);
    if (saved) resetDraftControls();
    return saved;
  }

  function saveCurrentDraft() {
    if (draftState?.source === 'inspector') inspectorForm.current?.requestSubmit();
    else if (draftCommands.current.length) void saveDraft(draftCommands.current);
  }

  function seek(frame: number) {
    const tick = Math.max(0, Math.min(durationFrames, Math.round(frame)));
    setPlayhead(tick);
    if (video.current) video.current.currentTime = tick / workingSequence.fps;
  }

  function selectClip(id: string) {
    if (draftDirty) return;
    onSelectClip(id);
    setTab('clip');
  }

  function pendingDelta(gesture: GestureDraft): number {
    const original = gesture.manipulation.clip;
    return gesture.manipulation.mode === 'trim-end'
      ? gesture.proposal.clip.duration - original.duration
      : gesture.proposal.clip.start - original.start;
  }

  function gestureAllowed(clip: Clip, mode: ClipManipulationMode) {
    const clipTrack = workingSequence.tracks.find((item) => item.id === clip.trackId);
    if (busy || clipTrack?.locked || draftPending || draftBlocked || draftConflict) return false;
    return (
      !draftDirty ||
      (draftState?.source === 'gesture' &&
        gestureRef.current?.manipulation.clip.id === clip.id &&
        gestureRef.current.manipulation.mode === mode)
    );
  }

  function stageGesture(manipulation: ClipManipulation, proposal: ClipProposal) {
    if (!proposal.command && !gestureRef.current) return;
    if (!markDraft('gesture')) return;
    const next = { manipulation, proposal };
    gestureRef.current = next;
    draftCommands.current = proposal.command ? [proposal.command] : [];
    setGestureDraft(next);
  }

  function startGesture(
    event: PointerEvent<HTMLButtonElement>,
    clip: Clip,
    mode: ClipManipulationMode,
  ) {
    if (event.button !== 0 || !gestureAllowed(clip, mode)) return;
    event.stopPropagation();
    selectClip(clip.id);
    const previous = gestureRef.current;
    const manipulation =
      previous?.manipulation ?? new ClipManipulation(workingSequence, assets, clip.id, mode);
    activePointer.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      initialDelta: previous ? pendingDelta(previous) : 0,
      manipulation,
      changed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveGesture(event: PointerEvent<HTMLButtonElement>) {
    const pointer = activePointer.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const deltaPixels = event.clientX - pointer.originX;
    if (!pointer.changed && Math.abs(deltaPixels) < 3) return;
    pointer.changed = true;
    const proposal = pointer.manipulation.atDeltaFrames(
      pointer.initialDelta + (deltaPixels / scale) * workingSequence.fps,
    );
    stageGesture(pointer.manipulation, proposal);
  }

  function finishGesture(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const pointer = activePointer.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointer.changed && (cancelled || !draftCommands.current.length)) void releaseDraft();
  }

  function keyboardGesture(
    event: KeyboardEvent<HTMLButtonElement>,
    clip: Clip,
    mode: ClipManipulationMode,
  ) {
    if (event.key === 'Escape' && draftState?.source === 'gesture') {
      event.preventDefault();
      activePointer.current = null;
      void releaseDraft();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !gestureAllowed(clip, mode)) return;
    event.preventDefault();
    selectClip(clip.id);
    const previous = gestureRef.current;
    const manipulation =
      previous?.manipulation ?? new ClipManipulation(workingSequence, assets, clip.id, mode);
    const delta =
      (previous ? pendingDelta(previous) : 0) +
      (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1);
    stageGesture(manipulation, manipulation.atDeltaFrames(delta));
  }

  async function addClip(event: FormEvent) {
    event.preventDefault();
    const asset = assets.find((item) => item.id === addAsset);
    const target = workingSequence.tracks.find((item) => item.id === addTrack);
    if (!asset || !target || target.locked || !acceptsAsset(asset, target.kind)) return;
    const length =
      asset.kind === 'image'
        ? workingSequence.fps * 5
        : Math.max(1, Math.floor(asset.duration * workingSequence.fps));
    await onApply(
      [
        {
          type: 'addClip',
          clip: {
            id: uid(),
            trackId: target.id,
            assetVersionId: asset.id,
            start: playhead,
            duration: length,
            sourceStart: 0,
            audioGain: 1,
            muted: false,
          },
        },
      ],
      workingSequence.revision,
    );
  }

  async function saveClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || locked) return;
    const form = new FormData(event.currentTarget);
    await saveDraft([
      {
        type: 'updateClip',
        clipId: selected.id,
        patch: {
          start: Math.round(numeric(form, 'start') * workingSequence.fps),
          duration: Math.round(numeric(form, 'duration') * workingSequence.fps),
          sourceStart: numeric(form, 'sourceStart'),
          audioGain: numeric(form, 'audioGain'),
          muted: form.get('muted') === 'on',
          trackId: String(form.get('trackId')),
        },
      },
    ]);
  }

  async function saveCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const entry: Caption = {
      id: caption?.id ?? uid(),
      text: String(form.get('text')).trim(),
      start: Math.round(numeric(form, 'start') * workingSequence.fps),
      duration: Math.round(numeric(form, 'duration') * workingSequence.fps),
      fontSize: numeric(form, 'fontSize'),
      color: String(form.get('color')),
      position: String(form.get('position')) as Caption['position'],
    };
    if (await saveDraft([{ type: 'upsertCaption', caption: entry }])) setSelectedCaption(entry.id);
  }

  const draftMessage = draftConflict
    ? t('timeline.draftConflict', {
        revision: sequence.revision,
        draftRevision: draftState?.base.revision,
      })
    : draftState?.phase === 'blocked'
      ? t('timeline.draftBlocked')
      : draftState?.phase === 'release-failed'
        ? t('timeline.draftReleaseFailed')
        : draftState?.phase === 'saving'
          ? t('timeline.draftSaving')
          : draftState?.phase === 'releasing'
            ? t('timeline.draftReleasing')
            : t('timeline.draftUnsaved');

  return (
    <section className="timeline-shell" data-testid="timeline" aria-label={t('timeline.title')}>
      <header className="timeline-header">
        <div className="timeline-title">
          <Film size={18} />
          <div>
            <strong>{workingSequence.name}</strong>
            <span>
              {workingSequence.width} × {workingSequence.height} · {workingSequence.fps} fps
            </span>
          </div>
        </div>
        <div className="timeline-header-actions">
          <IconButton
            label={t('timeline.undo')}
            disabled={!canUndo || editingBusy}
            onClick={onUndo}
          >
            <Undo2 size={17} />
          </IconButton>
          <IconButton
            label={t('timeline.redo')}
            disabled={!canRedo || editingBusy}
            onClick={onRedo}
          >
            <Redo2 size={17} />
          </IconButton>
          <span className="divider" />
          <Button
            onClick={onPreview}
            disabled={editingBusy || previewBusy || !workingSequence.clips.length}
            testId="preview-button"
          >
            <RefreshCw size={15} className={previewBusy ? 'spin' : ''} />
            {previewBusy ? t('timeline.rendering') : t('timeline.renderPreview')}
          </Button>
          <Button
            kind="accent"
            onClick={onExport}
            disabled={editingBusy || !workingSequence.clips.length}
            testId="export-button"
          >
            <Download size={15} />
            {t('timeline.export')}
          </Button>
          <IconButton
            label={inspector ? t('timeline.collapseInspector') : t('timeline.openInspector')}
            disabled={draftDirty}
            onClick={() => setInspector(!inspector)}
          >
            {inspector ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </IconButton>
          <IconButton label={t('timeline.collapse')} disabled={draftDirty} onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
      </header>
      {draftDirty && (
        <div className="draft-banner" role="status">
          <span>{draftMessage}</span>
          <div className="clip-edit-actions">
            <Button
              kind="accent"
              disabled={
                busy ||
                draftPending ||
                draftBlocked ||
                draftConflict ||
                (draftState?.source !== 'inspector' && !draftCommands.current.length)
              }
              onClick={saveCurrentDraft}
              testId="save-timeline-draft"
            >
              <Check size={15} />
              {t('timeline.saveDraft')}
            </Button>
            <Button
              disabled={busy || draftPending}
              onClick={() => void releaseDraft()}
              testId="discard-timeline-draft"
            >
              {draftState?.phase === 'release-failed'
                ? t('timeline.retryRelease')
                : t('timeline.discardDraft')}
            </Button>
          </div>
        </div>
      )}
      <div className="timeline-main">
        <div className={`editor-stage ${inspector ? 'with-inspector' : ''}`}>
          <div className="sequence-viewer">
            <div className="editor-overview">
              <span>{t('timeline.preview')}</span>
              <span className="preview-metadata">
                {t('timeline.revision', { revision: sequence.revision })}
              </span>
            </div>
            <div
              className="player-frame"
              style={{ aspectRatio: `${workingSequence.width}/${workingSequence.height}` }}
            >
              {displayedPreview?.outputPath ? (
                <video
                  key={displayedPreview.outputPath}
                  ref={video}
                  src={mediaUrl(displayedPreview.outputPath)}
                  controls
                  preload="metadata"
                  onTimeUpdate={(event) =>
                    setPlayhead(Math.round(event.currentTarget.currentTime * workingSequence.fps))
                  }
                  aria-label={t('timeline.previewLabel')}
                  data-testid="preview-video"
                />
              ) : (
                <div className="preview-empty">
                  <Play size={30} />
                  <strong>{t('timeline.previewEmpty')}</strong>
                  <span>{t('timeline.previewEmptyBody')}</span>
                </div>
              )}
            </div>
            <div className="player-status">
              <span className={`status-dot ${currentPreview && !draftDirty ? 'ready' : ''}`} />
              <span>
                {draftDirty
                  ? t('timeline.previewSaved')
                  : currentPreview
                    ? t('timeline.previewCurrent')
                    : oldPreview
                      ? t('timeline.previewOutdated')
                      : t('timeline.previewWaiting')}
              </span>
              <code>{timecode(playhead / workingSequence.fps)}</code>
            </div>
          </div>
          {inspector && (
            <aside className="inspector" aria-label={t('timeline.inspector')}>
              <Tabs value={tab} onValueChange={(value) => setTab(value as InspectorTab)}>
                <TabsList className="tabs" aria-label={t('timeline.editContent')}>
                  <TabsTrigger
                    value="clip"
                    className={tab === 'clip' ? 'active' : undefined}
                    disabled={draftDirty && tab !== 'clip'}
                  >
                    {t('timeline.clip')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="captions"
                    className={tab === 'captions' ? 'active' : undefined}
                    disabled={draftDirty && tab !== 'captions'}
                  >
                    {t('timeline.captions')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="sequence"
                    className={tab === 'sequence' ? 'active' : undefined}
                    disabled={draftDirty && tab !== 'sequence'}
                  >
                    {t('timeline.work')}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="clip">
                  {selected ? (
                    <form
                      ref={inspectorForm}
                      key={`${selected.id}-${workingSequence.revision}-${draftReset}`}
                      onSubmit={(event) => void saveClip(event)}
                      onChange={() => markDraft('inspector')}
                      inert={inspectorInert}
                      className="inspector-form"
                    >
                      <div className="inspector-header">
                        <span className="inspector-name">
                          {selectedAsset?.name ?? t('timeline.clip')}
                        </span>
                        <span className="frame-readout">
                          {t('timeline.frames', { count: selected.duration })}
                        </span>
                      </div>
                      {track?.locked && (
                        <p className="inline-notice">{t('timeline.trackLocked')}</p>
                      )}
                      <div className="inspector-section">
                        <span className="inspector-section-title">{t('timeline.timing')}</span>
                        <div className="field-row">
                          <label>
                            {t('timeline.startSeconds')}
                            <input
                              name="start"
                              type="number"
                              min="0"
                              step="any"
                              defaultValue={selected.start / workingSequence.fps}
                              required
                              disabled={locked}
                            />
                          </label>
                          <label>
                            {t('timeline.durationSeconds')}
                            <input
                              name="duration"
                              type="number"
                              min={1 / workingSequence.fps}
                              step="any"
                              defaultValue={selected.duration / workingSequence.fps}
                              required
                              disabled={locked}
                            />
                          </label>
                        </div>
                        <label>
                          {t('timeline.sourceSeconds')}
                          <input
                            name="sourceStart"
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={selected.sourceStart}
                            required
                            disabled={locked || selectedAsset?.kind === 'image'}
                          />
                        </label>
                        {selectedAsset?.kind === 'image' && (
                          <input name="sourceStart" type="hidden" value="0" />
                        )}
                      </div>
                      <div className="inspector-section">
                        <span className="inspector-section-title">{t('timeline.soundTrack')}</span>
                        <div className="field-row">
                          <label>
                            {t('timeline.gain')}
                            <input
                              name="audioGain"
                              type="number"
                              min="0"
                              max="16"
                              step="0.1"
                              defaultValue={selected.audioGain}
                              required
                              disabled={locked}
                            />
                          </label>
                          <label>
                            {t('timeline.track')}
                            <select
                              name="trackId"
                              defaultValue={selected.trackId}
                              disabled={locked}
                            >
                              {workingSequence.tracks
                                .filter(
                                  (item) => selectedAsset && acceptsAsset(selectedAsset, item.kind),
                                )
                                .map((item) => (
                                  <option
                                    key={item.id}
                                    value={item.id}
                                    disabled={item.locked && item.id !== track?.id}
                                  >
                                    {item.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            name="muted"
                            defaultChecked={selected.muted}
                            disabled={locked}
                          />
                          {t('timeline.muteClip')}
                        </label>
                      </div>
                      <div className="inspector-actions">
                        <Button type="submit" kind="accent" disabled={locked} testId="save-clip">
                          <Check size={15} />
                          {t('timeline.saveClip')}
                        </Button>
                      </div>
                      <label className="replacement-field">
                        {t('timeline.replaceAsset')}
                        <select
                          aria-label={t('timeline.replaceLabel')}
                          value=""
                          disabled={locked || draftDirty}
                          onChange={(event) => {
                            event.stopPropagation();
                            if (event.target.value)
                              void onApply(
                                [
                                  {
                                    type: 'replaceClip',
                                    clipId: selected.id,
                                    assetVersionId: event.target.value,
                                    sourceStart: 0,
                                  },
                                ],
                                workingSequence.revision,
                              );
                          }}
                        >
                          <option value="">{t('timeline.chooseNewAsset')}</option>
                          {assets
                            .filter((asset) => track && acceptsAsset(asset, track.kind))
                            .map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p className="field-hint">
                        {t('timeline.frameAlignment', { fps: workingSequence.fps })}
                      </p>
                    </form>
                  ) : (
                    <Empty icon={<Film size={24} />} title={t('timeline.chooseClip')}>
                      {t('timeline.chooseClipBody')}
                    </Empty>
                  )}
                </TabsContent>
                <TabsContent value="captions">
                  <form
                    ref={inspectorForm}
                    key={`${selectedCaption}-${workingSequence.revision}-${draftReset}`}
                    onSubmit={(event) => void saveCaption(event)}
                    onChange={() => markDraft('inspector')}
                    inert={inspectorInert}
                    className="inspector-form"
                  >
                    <div className="caption-picker">
                      <select
                        aria-label={t('timeline.chooseCaption')}
                        value={selectedCaption ?? ''}
                        disabled={draftDirty}
                        onChange={(event) => {
                          event.stopPropagation();
                          setSelectedCaption(event.target.value || null);
                        }}
                      >
                        <option value="">{t('timeline.newCaption')}</option>
                        {workingSequence.captions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.text}
                          </option>
                        ))}
                      </select>
                      {caption && (
                        <IconButton
                          label={t('timeline.deleteCaption')}
                          disabled={editingBusy}
                          onClick={() =>
                            void onApply(
                              [{ type: 'removeCaption', captionId: caption.id }],
                              workingSequence.revision,
                            ).then((saved) => {
                              if (saved) setSelectedCaption(null);
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                    <label className="caption-text-field">
                      {t('timeline.captionText')}
                      <textarea
                        name="text"
                        defaultValue={caption?.text ?? ''}
                        rows={2}
                        required
                        maxLength={1000}
                      />
                    </label>
                    <div className="inspector-section">
                      <div className="field-row">
                        <label>
                          {t('timeline.startSeconds')}
                          <input
                            name="start"
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={
                              caption
                                ? caption.start / workingSequence.fps
                                : playhead / workingSequence.fps
                            }
                            required
                          />
                        </label>
                        <label>
                          {t('timeline.durationSeconds')}
                          <input
                            name="duration"
                            type="number"
                            min={1 / workingSequence.fps}
                            step="any"
                            defaultValue={caption ? caption.duration / workingSequence.fps : 3}
                            required
                          />
                        </label>
                      </div>
                      <div className="field-row">
                        <label>
                          {t('timeline.fontSize')}
                          <input
                            name="fontSize"
                            type="number"
                            min="8"
                            max="300"
                            defaultValue={caption?.fontSize ?? 48}
                            required
                          />
                        </label>
                        <label>
                          {t('timeline.color')}
                          <input
                            name="color"
                            type="color"
                            defaultValue={caption?.color ?? '#ffffff'}
                          />
                        </label>
                      </div>
                      <label>
                        {t('timeline.captionPosition')}
                        <select name="position" defaultValue={caption?.position ?? 'bottom'}>
                          <option value="bottom">{t('timeline.bottom')}</option>
                          <option value="center">{t('timeline.center')}</option>
                          <option value="top">{t('timeline.top')}</option>
                        </select>
                      </label>
                    </div>
                    <div className="inspector-actions">
                      <Button
                        type="submit"
                        kind="accent"
                        disabled={busy || draftPending || draftBlocked || draftConflict}
                      >
                        <Check size={15} />
                        {caption ? t('timeline.saveCaption') : t('timeline.addCaption')}
                      </Button>
                    </div>
                  </form>
                </TabsContent>
                <TabsContent value="sequence">
                  <form
                    ref={inspectorForm}
                    key={`${workingSequence.revision}-${draftReset}`}
                    inert={inspectorInert}
                    className="inspector-form"
                    onChange={() => markDraft('inspector')}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void saveDraft([
                        {
                          type: 'sequenceSettings',
                          patch: {
                            name: String(data.get('name')),
                            width: numeric(data, 'width'),
                            height: numeric(data, 'height'),
                            fps: numeric(data, 'fps'),
                          },
                        },
                      ]);
                    }}
                  >
                    <label className="sequence-name-field">
                      {t('timeline.workName')}
                      <input
                        name="name"
                        defaultValue={workingSequence.name}
                        required
                        maxLength={100}
                      />
                    </label>
                    <div className="inspector-section">
                      <div className="field-row">
                        <label>
                          {t('timeline.width')}
                          <input
                            name="width"
                            type="number"
                            min="16"
                            max="7680"
                            step="2"
                            defaultValue={workingSequence.width}
                            required
                          />
                        </label>
                        <label>
                          {t('timeline.height')}
                          <input
                            name="height"
                            type="number"
                            min="16"
                            max="7680"
                            step="2"
                            defaultValue={workingSequence.height}
                            required
                          />
                        </label>
                      </div>
                      <label>
                        {t('timeline.fps')}
                        <select name="fps" defaultValue={workingSequence.fps}>
                          {[24, 25, 30, 60].map((fps) => (
                            <option key={fps} value={fps}>
                              {fps} fps
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="field-hint">{t('timeline.fpsHelp')}</p>
                    <div className="inspector-actions">
                      <Button
                        type="submit"
                        kind="accent"
                        disabled={busy || draftPending || draftBlocked || draftConflict}
                      >
                        <Check size={15} />
                        {t('timeline.saveSettings')}
                      </Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </aside>
          )}
        </div>
        <div className="timeline-editor">
          <div className="timeline-tools">
            <div className="timeline-edit-tools">
              <IconButton
                label={t('timeline.split')}
                disabled={
                  !selected ||
                  locked ||
                  draftDirty ||
                  playhead <= selected.start ||
                  playhead >= selected.start + selected.duration
                }
                onClick={() =>
                  selected &&
                  void onApply(
                    [{ type: 'splitClip', clipId: selected.id, at: playhead, newClipId: uid() }],
                    workingSequence.revision,
                  )
                }
              >
                <Scissors size={17} />
              </IconButton>
              <IconButton
                label={t('timeline.removeClip')}
                disabled={!selected || locked || draftDirty}
                onClick={() =>
                  selected &&
                  void onApply(
                    [{ type: 'removeClip', clipId: selected.id }],
                    workingSequence.revision,
                  ).then((saved) => {
                    if (saved) onSelectClip(null);
                  })
                }
              >
                <Trash2 size={17} />
              </IconButton>
              <Button
                disabled={draftDirty}
                onClick={() => {
                  setTab('captions');
                  setSelectedCaption(null);
                  setInspector(true);
                }}
              >
                <Captions size={16} />
                {t('timeline.captions')}
              </Button>
            </div>
            <div className="timeline-zoom-tools">
              <IconButton
                label={t('timeline.fit')}
                onClick={() =>
                  setScale(
                    Math.max(
                      10,
                      Math.min(
                        120,
                        ((timelineScroll.current?.clientWidth ?? 600) - 184) /
                          (durationFrames / workingSequence.fps),
                      ),
                    ),
                  )
                }
              >
                <Maximize2 size={16} />
              </IconButton>
              <label className="zoom-label">
                {t('timeline.zoom')}
                <input
                  aria-label={t('timeline.zoomLabel')}
                  type="range"
                  min="10"
                  max="120"
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
          <p className="sr-only" id="timeline-gesture-help">
            {t('timeline.gestureHelp')}
          </p>
          <div className="timeline-scroll" ref={timelineScroll}>
            <div className="track-labels">
              <div className="ruler-label">{t('timeline.tracks')}</div>
              {workingSequence.tracks.map((item) => (
                <div className="track-label" key={item.id}>
                  <span title={item.name}>
                    {item.kind === 'video' ? <Film size={15} /> : <Music2 size={15} />}
                    <input
                      aria-label={t('timeline.trackNameLabel', { name: item.name })}
                      ref={(element) => {
                        if (element?.validity.customError)
                          element.setCustomValidity(t('timeline.trackNameRequired'));
                      }}
                      defaultValue={item.name}
                      key={`${item.id}-${item.name}-${draftReset}`}
                      disabled={
                        busy ||
                        item.locked ||
                        draftPending ||
                        draftBlocked ||
                        draftConflict ||
                        (draftDirty && draftState?.source !== `track:${item.id}`)
                      }
                      maxLength={100}
                      onChange={(event) => {
                        if (!markDraft(`track:${item.id}`)) return;
                        const name = event.target.value.trim();
                        draftCommands.current = name
                          ? [{ type: 'updateTrack', trackId: item.id, patch: { name } }]
                          : [];
                        event.target.setCustomValidity(name ? '' : t('timeline.trackNameRequired'));
                        setDraftState((current) => (current ? { ...current } : current));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          if (event.currentTarget.reportValidity()) saveCurrentDraft();
                        }
                      }}
                    />
                  </span>
                  <div>
                    <IconButton
                      label={
                        item.muted
                          ? t('timeline.unmuteTrack', { name: item.name })
                          : t('timeline.muteTrack', { name: item.name })
                      }
                      active={item.muted}
                      disabled={editingBusy || item.locked}
                      onClick={() =>
                        void onApply(
                          [
                            {
                              type: 'updateTrack',
                              trackId: item.id,
                              patch: { muted: !item.muted },
                            },
                          ],
                          workingSequence.revision,
                        )
                      }
                    >
                      {item.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                    </IconButton>
                    <IconButton
                      label={
                        item.locked
                          ? t('timeline.unlockTrack', { name: item.name })
                          : t('timeline.lockTrack', { name: item.name })
                      }
                      active={item.locked}
                      disabled={editingBusy}
                      onClick={() =>
                        void onApply(
                          [
                            {
                              type: 'updateTrack',
                              trackId: item.id,
                              patch: { locked: !item.locked },
                            },
                          ],
                          workingSequence.revision,
                        )
                      }
                    >
                      {item.locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}
                    </IconButton>
                    <IconButton
                      label={t('timeline.deleteTrack', { name: item.name })}
                      disabled={editingBusy || item.locked}
                      onClick={() =>
                        void onApply(
                          [{ type: 'removeTrack', trackId: item.id }],
                          workingSequence.revision,
                        )
                      }
                    >
                      <X size={15} />
                    </IconButton>
                  </div>
                </div>
              ))}
              <div className="track-label captions-track">
                <Captions size={15} />
                {t('timeline.captions')}
              </div>
            </div>
            <div className="track-content" style={{ width, minWidth: width }}>
              <div
                className="time-ruler"
                onClick={(event) =>
                  seek(
                    ((event.clientX - event.currentTarget.getBoundingClientRect().left) / scale) *
                      workingSequence.fps,
                  )
                }
                aria-hidden="true"
              >
                {Array.from(
                  { length: Math.ceil(durationFrames / workingSequence.fps / rulerStep) + 1 },
                  (_, index) => (
                    <span key={index} style={{ left: index * rulerStep * scale }}>
                      {timecode(index * rulerStep).slice(0, 5)}
                    </span>
                  ),
                )}
              </div>
              {workingSequence.tracks.map((item) => (
                <div
                  key={item.id}
                  className={`track-lane ${item.kind} ${item.locked ? 'locked' : ''}`}
                  onClick={(event) => {
                    if (event.target === event.currentTarget)
                      seek(
                        ((event.clientX - event.currentTarget.getBoundingClientRect().left) /
                          scale) *
                          workingSequence.fps,
                      );
                  }}
                >
                  {workingSequence.clips
                    .filter((clip) => clip.trackId === item.id)
                    .map((original) => {
                      const clip =
                        gestureDraft?.proposal.clip.id === original.id
                          ? gestureDraft.proposal.clip
                          : original;
                      const asset = assets.find((entry) => entry.id === clip.assetVersionId);
                      const name = asset?.name ?? t('timeline.asset');
                      return (
                        <div
                          key={clip.id}
                          className={`timeline-clip ${clip.id === selectedClipId ? 'selected' : ''} ${clip.muted ? 'muted' : ''} ${gestureDraft?.proposal.clip.id === clip.id ? 'draft' : ''}`}
                          style={{
                            left: (clip.start / workingSequence.fps) * scale,
                            width: Math.max(8, (clip.duration / workingSequence.fps) * scale),
                          }}
                          title={t('timeline.clipRange', {
                            name,
                            start: clip.start,
                            end: clip.start + clip.duration,
                          })}
                        >
                          <button
                            type="button"
                            className="clip-body"
                            onClick={() => selectClip(clip.id)}
                            aria-pressed={clip.id === selectedClipId}
                            aria-label={t('timeline.clipLabel', {
                              name,
                              start: clip.start,
                              duration: clip.duration,
                            })}
                            aria-describedby="timeline-gesture-help"
                            disabled={draftDirty && !gestureAllowed(original, 'move')}
                            data-testid="timeline-clip"
                            onPointerDown={(event) => startGesture(event, original, 'move')}
                            onPointerMove={moveGesture}
                            onPointerUp={(event) => finishGesture(event)}
                            onPointerCancel={(event) => finishGesture(event, true)}
                            onLostPointerCapture={(event) => finishGesture(event, true)}
                            onKeyDown={(event) => keyboardGesture(event, original, 'move')}
                          >
                            {asset?.thumbnailUrl && (
                              <img src={asset.thumbnailUrl} alt="" draggable={false} />
                            )}
                            <span>{name}</span>
                            {clip.muted && <VolumeX size={14} />}
                          </button>
                          {clip.id === selectedClipId &&
                            (['trim-start', 'trim-end'] as const).map((mode) => (
                              <button
                                type="button"
                                key={mode}
                                className={`clip-trim-handle ${mode === 'trim-start' ? 'start' : 'end'}`}
                                aria-label={t('timeline.trimLabel', {
                                  mode: t(modeLabels[mode]),
                                  name,
                                })}
                                aria-describedby="timeline-gesture-help"
                                disabled={!gestureAllowed(original, mode)}
                                onPointerDown={(event) => startGesture(event, original, mode)}
                                onPointerMove={moveGesture}
                                onPointerUp={(event) => finishGesture(event)}
                                onPointerCancel={(event) => finishGesture(event, true)}
                                onLostPointerCapture={(event) => finishGesture(event, true)}
                                onKeyDown={(event) => keyboardGesture(event, original, mode)}
                              >
                                <span />
                              </button>
                            ))}
                        </div>
                      );
                    })}
                </div>
              ))}
              <div className="track-lane captions">
                {workingSequence.captions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`timeline-caption ${selectedCaption === item.id ? 'selected' : ''}`}
                    style={{
                      left: (item.start / workingSequence.fps) * scale,
                      width: Math.max(8, (item.duration / workingSequence.fps) * scale),
                    }}
                    onClick={() => {
                      setSelectedCaption(item.id);
                      setTab('captions');
                      setInspector(true);
                    }}
                    title={item.text}
                    disabled={draftDirty}
                  >
                    {item.text}
                  </button>
                ))}
              </div>
              <div className="playhead" style={{ left: (playhead / workingSequence.fps) * scale }}>
                <span />
              </div>
            </div>
          </div>
          <div className="timeline-selection-summary" role="status">
            {gestureDraft ? (
              <span className="timeline-interaction-status">
                {t('timeline.gestureStatus', {
                  mode: t(modeLabels[gestureDraft.manipulation.mode]),
                  start: gestureDraft.proposal.clip.start,
                  duration: gestureDraft.proposal.clip.duration,
                })}
                {gestureDraft.proposal.constrained ? t('timeline.boundary') : ''}
              </span>
            ) : (
              <span>
                {selected
                  ? t('timeline.selection', {
                      name: selectedAsset?.name ?? t('timeline.clip'),
                      duration: selected.duration,
                    })
                  : t('timeline.selectToEdit')}
              </span>
            )}
            <label className="ruler-control">
              {t('timeline.playhead')}
              <input
                type="number"
                min="0"
                max={durationFrames}
                step="1"
                value={playhead}
                aria-label={t('timeline.playheadLabel')}
                onChange={(event) => seek(Number(event.target.value))}
              />
            </label>
          </div>
          <footer className="timeline-footer">
            <div className="track-add">
              <Button
                disabled={editingBusy}
                onClick={() =>
                  void onApply(
                    [
                      {
                        type: 'addTrack',
                        track: {
                          id: uid(),
                          name: t('timeline.videoName', {
                            count:
                              workingSequence.tracks.filter((item) => item.kind === 'video')
                                .length + 1,
                          }),
                          kind: 'video',
                          muted: false,
                          locked: false,
                        },
                      },
                    ],
                    workingSequence.revision,
                  )
                }
              >
                <Plus size={15} />
                {t('timeline.addVideoTrack')}
              </Button>
              <Button
                disabled={editingBusy}
                onClick={() =>
                  void onApply(
                    [
                      {
                        type: 'addTrack',
                        track: {
                          id: uid(),
                          name: t('timeline.audioName', {
                            count:
                              workingSequence.tracks.filter((item) => item.kind === 'audio')
                                .length + 1,
                          }),
                          kind: 'audio',
                          muted: false,
                          locked: false,
                        },
                      },
                    ],
                    workingSequence.revision,
                  )
                }
              >
                <Plus size={15} />
                {t('timeline.addAudioTrack')}
              </Button>
            </div>
            <code>
              {timecode(playhead / workingSequence.fps)} /{' '}
              {timecode(durationFrames / workingSequence.fps)}
            </code>
          </footer>
          <form className="add-clip-form" onSubmit={(event) => void addClip(event)}>
            <select
              aria-label={t('timeline.chooseAssetLabel')}
              required
              value={addAsset}
              disabled={editingBusy}
              onChange={(event) => {
                setAddAsset(event.target.value);
                setAddTrack('');
              }}
            >
              <option value="">{t('timeline.chooseAsset')}</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t('timeline.chooseTrackLabel')}
              required
              value={addTrack}
              disabled={editingBusy}
              onChange={(event) => setAddTrack(event.target.value)}
            >
              <option value="">{t('timeline.targetTrack')}</option>
              {workingSequence.tracks
                .filter(
                  (item) =>
                    !item.locked &&
                    (!addAsset ||
                      assets.some(
                        (asset) => asset.id === addAsset && acceptsAsset(asset, item.kind),
                      )),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            <Button type="submit" disabled={editingBusy || !addAsset || !addTrack}>
              <Plus size={15} />
              {t('timeline.addAtPlayhead')}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
