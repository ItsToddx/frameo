import { useI18n, normalizeLocale } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture,
  ArrowUpRight,
  Brain,
  ChevronDown,
  Film,
  FolderOpen,
  Image,
  Layers3,
  LoaderCircle,
  Music2,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Share2,
  Undo2,
  Upload,
  X,
  CheckCircle2,
  Clock3,
  Sparkles,
} from 'lucide-react';
import type {
  AppBootstrap,
  Asset,
  CanvasItem,
  EditCommand,
  ProjectSnapshot,
  Settings,
  Session,
  KitInfo,
} from '../adapters/contracts/api';
import type { MessageKey, Parameters } from '../localization';
import { presentKit } from '../localization/panels';
import { FrameMark } from './FrameMark';
import { Canvas } from './Canvas';
import { Chat } from './Chat';
import { Timeline } from './Timeline';
import {
  CreateModal,
  GenerateModal,
  JobsModal,
  KitsModal,
  MemoriesModal,
  SettingsModal,
} from './Panels';
import { Button, Empty, IconButton, Modal, LanguagePicker, uid } from './ui';

type Notice = string | { key: MessageKey; parameters?: Parameters };

type ModalType =
  | 'settings'
  | 'project'
  | 'sequence'
  | 'generation'
  | 'jobs'
  | 'kits'
  | 'memories'
  | 'share'
  | 'recipe'
  | null;
const defaultSettings: Settings = {
  arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  agentModel: '',
  seedanceModel: '',
  hasApiKey: false,
  generationCostLimit: 10,
  maxModelCalls: 12,
};
export function App() {
  const { t, date, hostText, locale, setLocale } = useI18n();
  const [boot, setBoot] = useState<AppBootstrap | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [kits, setKits] = useState<AppBootstrap['kits']>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [pending, setPending] = useState('');
  const [toast, setToast] = useState<{ text: Notice; error: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'assets' | 'projects'>('assets');
  const [query, setQuery] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState('');
  const [delta, setDelta] = useState('');
  const [streamSessionId, setStreamSessionId] = useState<string | null>(null);
  const [inspectAsset, setInspectAsset] = useState<Asset | null>(null);
  const [recipeKit, setRecipeKit] = useState<KitInfo | null>(null);
  const snapshotRef = useRef<ProjectSnapshot | null>(null);
  const [dirtyEdit, setDirtyEdit] = useState(false);
  const dirtyEditRef = useRef(false);
  const editLeaseRef = useRef<{
    sequenceId: string;
    interactionId: string;
    ready: Promise<void>;
    acquired: boolean;
  } | null>(null);
  const ready =
    settings.hasApiKey && !!settings.agentModel.trim() && !!settings.seedanceModel.trim();
  const busy = !!pending;
  const sequence = snapshot?.sequences.find((s) => s.id === sequenceId);
  const contextSequence = selection === sequence?.id ? sequence : undefined;
  const selectedAsset = snapshot?.assets.find((a) => a.id === selection);
  const activeJobs =
    snapshot?.jobs.filter((j) => !['succeeded', 'failed', 'cancelled'].includes(j.status)).length ||
    0;
  const notify = useCallback((text: Notice, error = false) => setToast({ text, error }), []);
  const onDraftChange = useCallback(
    async (dirty: boolean, targetSequenceId?: string): Promise<boolean> => {
      if (dirty) {
        dirtyEditRef.current = true;
        setDirtyEdit(true);
        if (!targetSequenceId) return false;
        let lease = editLeaseRef.current;
        if (!lease) {
          lease = {
            sequenceId: targetSequenceId,
            interactionId: uid(),
            ready: Promise.resolve(),
            acquired: false,
          };
          editLeaseRef.current = lease;
          const entry = lease;
          entry.ready = window.frameo
            .beginEdit({ sequenceId: entry.sequenceId, interactionId: entry.interactionId })
            .then(() => {
              entry.acquired = true;
            });
        }
        try {
          await lease.ready;
          return true;
        } catch (error) {
          notify(error instanceof Error ? error.message : String(error), true);
          return false;
        }
      }
      const lease = editLeaseRef.current;
      if (lease) {
        await lease.ready.catch(() => {});
        if (lease.acquired) {
          try {
            await window.frameo.endEdit({
              sequenceId: lease.sequenceId,
              interactionId: lease.interactionId,
            });
          } catch (error) {
            notify(error instanceof Error ? error.message : String(error), true);
            return false;
          }
        }
        if (editLeaseRef.current === lease) editLeaseRef.current = null;
      }
      dirtyEditRef.current = false;
      setDirtyEdit(false);
      return true;
    },
    [notify],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const acceptSnapshot = useCallback(
    (next: ProjectSnapshot, source: 'event' | 'operation' | 'replace' = 'operation') => {
      const previous = snapshotRef.current;
      if (source === 'event' && (!previous || previous.project.id !== next.project.id)) return;
      if (source !== 'replace' && previous && previous.project.id !== next.project.id) return;
      if (previous?.project.id === next.project.id && next.eventSeq < previous.eventSeq) return;
      if (
        source === 'event' &&
        previous?.project.id === next.project.id &&
        next.eventSeq === previous.eventSeq
      )
        return;
      // Events contain complete snapshots, so forward sequence gaps are recovered atomically.
      snapshotRef.current = next;
      if (previous?.project.id !== next.project.id) {
        setSelection(null);
        setSequenceId(null);
        setSelectedClip(null);
        setSessionId(next.sessions[0]?.id || null);
        setStreamSessionId(null);
        setAgentRunning(false);
        setDelta('');
        onDraftChange(false);
      }
      setSnapshot(next);
    },
    [onDraftChange],
  );
  const initialize = useCallback(async () => {
    setLoadError('');
    try {
      if (!window.frameo)
        throw new Error(
          'Desktop connection unavailable. Open the workbench through the Framo desktop app.',
        );
      const data = await window.frameo.bootstrap();
      setBoot(data);
      setSettings(data.settings);
      setLocale(normalizeLocale(data.settings.language));
      setKits(data.kits);
      if (data.project) acceptSnapshot(data.project, 'replace');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [acceptSnapshot, setLocale]);
  useEffect(() => {
    void initialize();
    if (!window.frameo) return;
    return window.frameo.onEvent((event) => {
      if (event.projectId && event.projectId !== snapshotRef.current?.project.id) return;
      if (event.type === 'state' && event.snapshot) acceptSnapshot(event.snapshot, 'event');
      if (event.type === 'chat.delta') {
        if (event.sessionId) setStreamSessionId(event.sessionId);
        setDelta((previous) => previous + (event.text || ''));
      }
      if (event.type === 'agent.status') {
        const terminal = ['idle', 'completed', 'complete', 'stopped', 'failed', 'error'].includes(
          event.status || '',
        );
        setAgentRunning(!terminal);
        setAgentStatus(event.text || event.agent || 'Agent is working');
        if (terminal) setDelta('');
      }
      if (event.type === 'error') {
        setAgentRunning(false);
        notify(event.text || 'Operation failed', true);
      }
    });
  }, [initialize, acceptSnapshot, notify]);
  async function perform<T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<{ value: T } | undefined> {
    setPending(label);
    try {
      return { value: await operation() };
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), true);
      return undefined;
    } finally {
      setPending('');
    }
  }
  async function update(
    label: string,
    operation: () => Promise<ProjectSnapshot | null>,
    replaceProject = false,
  ) {
    const result = await perform(label, operation);
    if (result?.value) acceptSnapshot(result.value, replaceProject ? 'replace' : 'operation');
    return result;
  }
  const requireSavedDraft = useCallback(() => {
    if (!dirtyEditRef.current) return true;
    notify({ key: 'workbench.draft.saveFirst' });
    return false;
  }, [notify, t]);
  function needModel() {
    if (ready) return true;
    setModal('settings');
    return false;
  }
  const showCreate = () => {
    if (requireSavedDraft() && needModel()) setModal('project');
  };
  const showSequence = () => {
    if (requireSavedDraft() && needModel() && snapshot) setModal('sequence');
  };
  const showGenerate = () => {
    if (!needModel()) return;
    if (!snapshot) {
      notify({ key: 'workbench.project.openFirst' });
      return;
    }
    setModal('generation');
  };
  async function refresh() {
    const result = await perform(t('workbench.project.read'), () => window.frameo.snapshot());
    if (result) acceptSnapshot(result.value);
  }
  async function apply(commands: EditCommand[], expectedRevision?: number): Promise<boolean> {
    if (!sequence) return false;
    const lease = editLeaseRef.current?.sequenceId === sequence.id ? editLeaseRef.current : null;
    const result = await update(t('workbench.edit.save'), async () => {
      if (lease) await lease.ready;
      return window.frameo.apply({
        sequenceId: sequence.id,
        expectedRevision: expectedRevision ?? sequence.revision,
        commandId: uid(),
        commands,
        interactionId: lease?.interactionId,
      });
    });
    return !!result?.value;
  }
  const saveCanvas = useCallback(
    async (items: CanvasItem[]) => {
      if (!snapshot) return;
      await update(t('workbench.canvas.save'), () =>
        window.frameo.saveCanvas({ expectedRevision: snapshot.canvas.revision, items }),
      );
    },
    [snapshot, t],
  );
  const hideCard = useCallback(
    (id: string) => {
      if (snapshot) void saveCanvas(snapshot.canvas.items.filter((item) => item.id !== id));
    },
    [snapshot, saveCanvas],
  );
  const selectItem = useCallback(
    (item: CanvasItem) => {
      if (!requireSavedDraft()) return;
      setSelection(item.refId);
      if (item.kind === 'sequence') {
        setSequenceId(item.refId);
        setSelectedClip(null);
      } else {
        setInspectAsset(null);
        setSelectedClip(null);
      }
    },
    [requireSavedDraft],
  );
  async function addToCanvas(kind: 'asset' | 'sequence', refId: string) {
    if (!snapshot || !requireSavedDraft()) return;
    const existing = snapshot.canvas.items.find(
      (item) => item.kind === kind && item.refId === refId,
    );
    if (existing) {
      selectItem(existing);
      return;
    }
    const index = snapshot.canvas.items.length;
    await saveCanvas([
      ...snapshot.canvas.items,
      {
        id: uid(),
        refId,
        kind,
        x: (index % 3) * 300,
        y: Math.floor(index / 3) * 250,
        width: 260,
        height: 210,
      },
    ]);
    setSelection(refId);
    if (kind === 'sequence') setSequenceId(refId);
  }
  const addAsset = useCallback(
    (asset: Asset) => {
      if (!requireSavedDraft()) return;
      const target = snapshot?.sequences.find((s) => s.id === sequenceId) || snapshot?.sequences[0];
      if (!target) {
        notify({ key: 'workbench.sequence.createFirst' });
        return;
      }
      const kind = asset.kind === 'audio' ? 'audio' : 'video';
      let track = target.tracks.find((t) => t.kind === kind && !t.locked);
      const commands: EditCommand[] = [];
      if (!track) {
        track = {
          id: uid(),
          kind,
          name: kind === 'audio' ? t('workbench.track.audio') : t('workbench.track.video'),
          muted: false,
          locked: false,
        };
        commands.push({ type: 'addTrack', track });
      }
      const start = Math.max(
        0,
        ...target.clips.filter((c) => c.trackId === track!.id).map((c) => c.start + c.duration),
      );
      commands.push({
        type: 'addClip',
        clip: {
          id: uid(),
          trackId: track.id,
          assetVersionId: asset.id,
          start,
          duration:
            asset.kind === 'image'
              ? target.fps * 5
              : Math.max(1, Math.floor(asset.duration * target.fps)),
          sourceStart: 0,
          audioGain: 1,
          muted: false,
        },
      });
      void update(t('workbench.clip.add'), () =>
        window.frameo.apply({
          sequenceId: target.id,
          expectedRevision: target.revision,
          commandId: uid(),
          commands,
        }),
      ).then((result) => {
        if (result) {
          setSelection(target.id);
          setSequenceId(target.id);
        }
      });
    },
    [snapshot, sequenceId, notify, requireSavedDraft, t],
  );
  async function sendPrompt(text: string): Promise<boolean> {
    if (!requireSavedDraft() || !needModel() || !snapshot || agentRunning || busy) return false;
    let session: Session | undefined =
      snapshot.sessions.find((s) => s.id === sessionId) || snapshot.sessions[0];
    if (!session) {
      const created = await update(t('workbench.chat.create'), () =>
        window.frameo.createSession(t('workbench.chat.default')),
      );
      if (!created?.value) return false;
      session = created.value.sessions.at(-1);
      setSessionId(session?.id || null);
    }
    if (!session) return false;
    setAgentRunning(true);
    setStreamSessionId(session.id);
    setDelta('');
    setAgentStatus(t('workbench.agent.understanding'));
    const result = await perform(t('workbench.prompt.send'), () =>
      window.frameo.prompt({
        requestId: uid(),
        sessionId: session!.id,
        text: selectedAsset
          ? `${text}\n\n${t('workbench.prompt.assetContext', { name: selectedAsset.name, id: selectedAsset.id })}`
          : text,
        sequenceId: contextSequence?.id,
        clipId: contextSequence ? selectedClip || undefined : undefined,
      }),
    );
    if (!result) setAgentRunning(false);
    return !!result;
  }
  async function listKits() {
    const result = await perform(t('workbench.kits.read'), () => window.frameo.listKits());
    if (result) setKits(result.value);
  }
  async function kitOperation(label: string, fn: () => Promise<AppBootstrap['kits']>) {
    const result = await perform(label, fn);
    if (result) setKits(result.value);
  }
  async function open(path?: string) {
    if (!requireSavedDraft()) return;
    await update(
      t('workbench.project.open'),
      () => (path ? window.frameo.openRecent(path) : window.frameo.openProject()),
      true,
    );
  }
  const closeModal = useCallback(() => {
    if (!busy) setModal(null);
  }, [busy]);
  if (loadError)
    return (
      <div className="fatal">
        <Aperture size={34} />
        <h1>{t('workbench.desktop.unavailable')}</h1>
        <p>{hostText(loadError)}</p>
        <Button kind="accent" onClick={() => void initialize()}>
          {t('workbench.desktop.retry')}
        </Button>
      </div>
    );
  if (!boot)
    return (
      <div className="loading-screen">
        <Aperture size={38} />
        <h1>Frameo</h1>
        <span>
          <LoaderCircle size={14} className="spin" />
          {t('workbench.desktop.loading')}
        </span>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <FrameMark size={25} />
          <span>frameo</span>
        </div>
        <div className="header-project">
          <span className={`status-dot ${snapshot ? 'ready' : ''}`} />
          {snapshot ? snapshot.project.name : t('workbench.project.none')}
          {snapshot && (
            <span className="local-saved">
              {pending === t('workbench.edit.save') || pending === t('workbench.canvas.save')
                ? t('workbench.save.pending')
                : t('workbench.save.local')}
            </span>
          )}
        </div>
        <div className="header-actions">
          <LanguagePicker disabled={busy} />
          <Button onClick={() => setModal('jobs')} disabled={!snapshot} testId="jobs-button">
            <Clock3 size={15} />
            <span>{t('workbench.jobs')}</span>
            {activeJobs > 0 && <b className="count-badge">{activeJobs}</b>}
          </Button>
          <IconButton
            label={t('workbench.share')}
            disabled={!snapshot || busy}
            onClick={() => setModal('share')}
          >
            <Share2 size={16} />
          </IconButton>
          <IconButton label={t('workbench.settings')} onClick={() => setModal('settings')}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </header>
      <div className="workspace">
        <nav className="activity-rail" aria-label={t('workbench.toolbar')}>
          <div>
            <IconButton
              label={
                sidebar && sidebarTab === 'projects'
                  ? t('workbench.projects.collapse')
                  : t('workbench.projects.list')
              }
              active={sidebar && sidebarTab === 'projects'}
              onClick={() => {
                if (sidebar && sidebarTab === 'projects') setSidebar(false);
                else {
                  setSidebar(true);
                  setSidebarTab('projects');
                }
              }}
            >
              <FolderOpen size={19} />
              <span>{t('workbench.projects')}</span>
            </IconButton>
            <IconButton
              label={
                sidebar && sidebarTab === 'assets'
                  ? t('workbench.assets.collapse')
                  : t('workbench.assets.library')
              }
              active={sidebar && sidebarTab === 'assets'}
              onClick={() => {
                if (sidebar && sidebarTab === 'assets') setSidebar(false);
                else {
                  setSidebar(true);
                  setSidebarTab('assets');
                }
              }}
            >
              <Layers3 size={19} />
              <span>{t('workbench.assets')}</span>
            </IconButton>
            <IconButton
              label={t('workbench.kits')}
              active={modal === 'kits'}
              onClick={() => {
                setModal('kits');
                void listKits();
              }}
            >
              <Package size={19} />
              <span>{t('workbench.extensions')}</span>
            </IconButton>
            <IconButton
              label={t('workbench.memories.open')}
              disabled={!snapshot}
              onClick={() => setModal('memories')}
            >
              <Brain size={19} />
              <span>{t('workbench.memories')}</span>
            </IconButton>
          </div>
          <div>
            <IconButton
              label={t('workbench.share.import')}
              disabled={busy || dirtyEdit}
              onClick={() =>
                void update(
                  t('workbench.project.import'),
                  () => window.frameo.importProject(),
                  true,
                )
              }
            >
              <Upload size={18} />
              <span>{t('workbench.import')}</span>
            </IconButton>
            <IconButton label={t('workbench.project.new')} onClick={showCreate}>
              <Plus size={19} />
              <span>{t('workbench.new')}</span>
            </IconButton>
            <span className="rail-version" title={`Frameo ${boot.version}`}>
              {boot.version}
            </span>
          </div>
        </nav>
        {sidebar && (snapshot || sidebarTab === 'projects') && (
          <aside className="library-panel">
            <div className="library-heading">
              <strong>
                {sidebarTab === 'assets' ? t('workbench.assets.project') : t('workbench.projects')}
              </strong>
              <IconButton label={t('workbench.sidebar.collapse')} onClick={() => setSidebar(false)}>
                <PanelLeftClose size={15} />
              </IconButton>
            </div>
            {sidebarTab === 'assets' && snapshot ? (
              <>
                <div className="library-project">
                  <span className="eyebrow">{t('workbench.project.current')}</span>
                  <strong>{snapshot.project.name}</strong>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void update(t('workbench.media.import'), () => window.frameo.importMedia())
                    }
                    testId="import-media"
                  >
                    <Plus size={14} />
                    {t('workbench.media.import')}
                  </Button>
                </div>
                <div className="library-section-heading">
                  <span>
                    {t('workbench.sequences')}
                    <b>{snapshot.sequences.length}</b>
                  </span>
                  <IconButton
                    label={t('workbench.sequence.new')}
                    disabled={busy}
                    onClick={showSequence}
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
                <div className="sequence-list">
                  {snapshot.sequences.map((s) => (
                    <button
                      key={s.id}
                      className={`sequence-list-row ${selection === s.id ? 'active' : ''}`}
                      onClick={() => void addToCanvas('sequence', s.id)}
                    >
                      <span>
                        <Film size={15} />
                      </span>
                      <div>
                        <strong>{s.name}</strong>
                        <small>
                          {s.width} × {s.height} · {t('workbench.clips', { count: s.clips.length })}
                        </small>
                      </div>
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
                <div className="library-section-heading">
                  <span>
                    {t('workbench.assets')}
                    <b>{snapshot.assets.length}</b>
                  </span>
                </div>
                <div className="search-input library-search">
                  <Search size={13} />
                  <input
                    aria-label={t('workbench.assets.searchLabel')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('workbench.assets.search')}
                  />
                </div>
                <div className="asset-list">
                  {snapshot.assets
                    .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
                    .map((a) => (
                      <article
                        key={a.id}
                        className={`asset-list-row ${selection === a.id ? 'active' : ''}`}
                      >
                        <button
                          className="asset-list-main"
                          onClick={() => void addToCanvas('asset', a.id)}
                          onDoubleClick={() => setInspectAsset(a)}
                          title={t('workbench.assets.cardHelp')}
                        >
                          <div className="asset-thumbnail">
                            {a.thumbnailUrl ? (
                              <img src={a.thumbnailUrl} alt="" />
                            ) : a.kind === 'image' ? (
                              <img src={a.url} alt="" />
                            ) : a.kind === 'audio' ? (
                              <Music2 size={17} />
                            ) : (
                              <Film size={17} />
                            )}
                          </div>
                          <div>
                            <strong>{a.name}</strong>
                            <span>
                              {a.kind === 'image'
                                ? t('workbench.kind.image')
                                : a.kind === 'audio'
                                  ? t('workbench.kind.audio')
                                  : t('workbench.kind.video')}
                              {a.duration > 0 && ` · ${a.duration.toFixed(1)}s`}
                            </span>
                          </div>
                        </button>
                        <IconButton
                          label={t('workbench.asset.addName', { name: a.name })}
                          disabled={busy}
                          onClick={() => addAsset(a)}
                        >
                          <Plus size={13} />
                        </IconButton>
                      </article>
                    ))}
                  {!snapshot.assets.length && (
                    <Empty icon={<Image size={23} />} title={t('workbench.assets.first')}>
                      {t('workbench.assets.firstHelp')}
                    </Empty>
                  )}
                  {snapshot.assets.length > 0 &&
                    !snapshot.assets.some((a) =>
                      a.name.toLowerCase().includes(query.toLowerCase()),
                    ) && <Empty title={t('workbench.assets.noMatch')} />}
                </div>
                <div className="library-footer">
                  <IconButton
                    label={t('workbench.canvas.undoLabel')}
                    disabled={busy}
                    onClick={() =>
                      void update(t('workbench.canvas.undo'), () => window.frameo.undoCanvas())
                    }
                  >
                    <Undo2 size={14} />
                  </IconButton>
                  <span>{t('workbench.canvas.hiddenHelp')}</span>
                </div>
              </>
            ) : (
              <div className="projects-panel">
                <Button
                  kind="accent"
                  onClick={showCreate}
                  disabled={busy}
                  testId="new-project-button"
                >
                  <Plus size={15} />
                  {t('workbench.project.new')}
                </Button>
                <Button onClick={() => void open()} disabled={busy}>
                  <FolderOpen size={15} />
                  {t('workbench.project.open')}
                </Button>
                {snapshot && (
                  <Button
                    onClick={() =>
                      void perform(t('workbench.project.close'), () =>
                        window.frameo.closeProject(),
                      ).then((result) => {
                        if (result) {
                          snapshotRef.current = null;
                          setSnapshot(null);
                          setSequenceId(null);
                          setSelection(null);
                          onDraftChange(false);
                        }
                      })
                    }
                    disabled={busy || agentRunning || dirtyEdit}
                  >
                    {t('workbench.project.closeCurrent')}
                  </Button>
                )}
                <div className="library-section-heading">
                  <span>{t('workbench.projects.recent')}</span>
                </div>
                {boot.recentProjects.map((p) => (
                  <button
                    key={p.id}
                    className="recent-project"
                    disabled={busy}
                    onClick={() => void open(p.path)}
                  >
                    <FolderOpen size={17} />
                    <div>
                      <strong>{p.name}</strong>
                      <span>{date(p.updatedAt)}</span>
                    </div>
                    <ArrowUpRight size={13} />
                  </button>
                ))}
                {!boot.recentProjects.length && (
                  <p className="field-hint">{t('workbench.projects.empty')}</p>
                )}
              </div>
            )}
          </aside>
        )}
        <main className={`creative-main ${sequence ? 'editing' : ''}`}>
          {snapshot ? (
            <>
              <Canvas
                snapshot={snapshot}
                selection={selection}
                timelineOpen={!!sequence}
                onBack={() => {
                  if (requireSavedDraft()) {
                    setSequenceId(null);
                    setSelectedClip(null);
                  }
                }}
                onInspect={setInspectAsset}
                onSelect={selectItem}
                onSave={saveCanvas}
                onHide={hideCard}
                onAdd={addAsset}
                onGenerate={showGenerate}
                onImport={() =>
                  void update(t('workbench.media.import'), () => window.frameo.importMedia())
                }
                busy={busy}
              />
              {selectedAsset && !sequence && (
                <div className="asset-selection-bar">
                  <span>{selectedAsset.name}</span>
                  <Button onClick={() => setInspectAsset(selectedAsset)}>
                    {t('workbench.asset.preview')}
                  </Button>
                  <Button onClick={() => addAsset(selectedAsset)} disabled={busy}>
                    <Plus size={13} />
                    {t('workbench.asset.add')}
                  </Button>
                  <IconButton label={t('workbench.asset.clear')} onClick={() => setSelection(null)}>
                    <X size={14} />
                  </IconButton>
                </div>
              )}
              {sequence && (
                <Timeline
                  sequence={sequence}
                  assets={snapshot.assets}
                  jobs={snapshot.jobs}
                  selectedClipId={selectedClip}
                  onSelectClip={(id) => {
                    setSelectedClip(id);
                    if (id) setSelection(sequence.id);
                  }}
                  onApply={apply}
                  onDraftChange={(dirty) => onDraftChange(dirty, sequence.id)}
                  onUndo={() =>
                    void update(t('workbench.edit.undo'), () =>
                      window.frameo.undo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                        commandId: uid(),
                      }),
                    )
                  }
                  onRedo={() =>
                    void update(t('workbench.edit.redo'), () =>
                      window.frameo.redo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                        commandId: uid(),
                      }),
                    )
                  }
                  canUndo={!!snapshot.canUndo[sequence.id]}
                  canRedo={!!snapshot.canRedo[sequence.id]}
                  onPreview={() =>
                    void perform(t('workbench.preview.submit'), () =>
                      window.frameo.preview({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                      }),
                    ).then((result) => {
                      if (result) notify({ key: 'workbench.preview.rendering' });
                    })
                  }
                  onExport={() =>
                    void perform(t('workbench.export.submit'), () =>
                      window.frameo.exportVideo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                      }),
                    ).then((result) => {
                      if (result?.value) {
                        notify({ key: 'workbench.export.submitted' });
                        setModal('jobs');
                      }
                    })
                  }
                  onClose={() => {
                    if (requireSavedDraft()) {
                      setSequenceId(null);
                      setSelectedClip(null);
                    }
                  }}
                  busy={busy}
                />
              )}
            </>
          ) : (
            <div className="welcome-screen">
              <div className="welcome-mark">
                <FrameMark size={32} />
              </div>
              <span className="eyebrow">FRAMEO STUDIO</span>
              <h1>{t('workbench.welcome.title')}</h1>
              <p>{t('workbench.welcome.description')}</p>
              <div className="welcome-workflow" aria-label={t('workbench.welcome.workflow')}>
                <div>
                  <span>01</span>
                  <strong>{t('workbench.welcome.idea')}</strong>
                  <p>{t('workbench.welcome.ideaHelp')}</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>{t('workbench.welcome.review')}</strong>
                  <p>{t('workbench.welcome.reviewHelp')}</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>{t('workbench.welcome.finish')}</strong>
                  <p>{t('workbench.welcome.finishHelp')}</p>
                </div>
              </div>
              <div className="welcome-actions">
                <Button kind="accent" onClick={showCreate} testId="welcome-create">
                  <Plus size={15} />
                  {t('workbench.welcome.create')}
                </Button>
                <Button onClick={() => void open()} disabled={busy}>
                  <FolderOpen size={15} />
                  {t('workbench.project.open')}
                </Button>
              </div>
              <div className={`model-connection ${ready ? 'connected' : ''}`}>
                <span className="status-dot" />
                <span>
                  {ready ? t('workbench.model.connected') : t('workbench.model.required')}
                </span>
                <button onClick={() => setModal('settings')}>
                  {ready ? t('workbench.model.manage') : t('workbench.model.setup')}
                  <ArrowUpRight size={12} />
                </button>
              </div>
              {boot.recentProjects.length > 0 && (
                <div className="welcome-recents">
                  <span className="eyebrow">{t('workbench.welcome.continue')}</span>
                  {boot.recentProjects.slice(0, 3).map((p) => (
                    <button key={p.id} onClick={() => void open(p.path)} disabled={busy}>
                      <FolderOpen size={17} />
                      <strong>{p.name}</strong>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
        <Chat
          snapshot={snapshot}
          settings={{ ...settings, hasApiKey: ready }}
          sessionId={sessionId}
          onSession={setSessionId}
          onNewSession={() =>
            void update(t('workbench.chat.new'), () =>
              window.frameo.createSession(
                t('workbench.chat.numbered', { count: (snapshot?.sessions.length || 0) + 1 }),
              ),
            ).then((result) => {
              if (result?.value) setSessionId(result.value.sessions.at(-1)?.id || null);
            })
          }
          onPrompt={sendPrompt}
          onStop={() =>
            void perform(t('workbench.agent.stop'), () => window.frameo.stopAgent()).then(
              (result) => {
                if (result) {
                  setAgentRunning(false);
                  setDelta('');
                }
              },
            )
          }
          running={agentRunning}
          status={agentStatus}
          delta={delta}
          streamSessionId={streamSessionId}
          selectedSequence={contextSequence?.id}
          selectedClip={contextSequence ? selectedClip || undefined : undefined}
          selectedAsset={selectedAsset?.name}
          dirty={dirtyEdit}
          busy={busy}
          onSetup={() => setModal('settings')}
          onReview={(reviewId, decision) => {
            if (decision === 'accept' && !requireSavedDraft()) return;
            void update(t('workbench.review'), () =>
              window.frameo.decideReview({ reviewId, decision }),
            );
          }}
          onResume={(recipeId) => {
            if (requireSavedDraft())
              void perform(t('workbench.recipe.resume'), () =>
                window.frameo.resumeRecipe({ recipeId }),
              );
          }}
          onRedo={(recipeId, redoStepId) => {
            if (!requireSavedDraft()) return;
            if (activeJobs) {
              notify({ key: 'workbench.recipe.activeJobs' });
              return;
            }
            void perform(t('workbench.recipe.redo'), () =>
              window.frameo.resumeRecipe({ recipeId, redoStepId }),
            );
          }}
          onRecipeResult={(input) => {
            if (input.decision === 'accept' && !requireSavedDraft()) return;
            void update(t('workbench.recipe.reviewResult'), () =>
              window.frameo.decideRecipeResult(input),
            );
          }}
          onRecipeInput={(input) => {
            if (input.decision === 'accept' && !requireSavedDraft()) return;
            void update(t('workbench.recipe.reviewInput'), () =>
              window.frameo.decideRecipeInput(input),
            );
          }}
          onExportRecipe={(recipeId) =>
            void perform(t('workbench.recipe.export'), () =>
              window.frameo.exportRecipe({ recipeId }),
            ).then((result) => {
              if (result?.value) notify({ key: 'workbench.recipe.exported' });
            })
          }
        />
      </div>
      <footer className="app-status">
        <span>
          <span className={`status-dot ${ready ? 'ready' : ''}`} />
          {ready ? t('workbench.model.ready') : t('workbench.model.offline')}
        </span>
        <span>
          {snapshot
            ? t('workbench.project.stats', {
                assets: snapshot.assets.length,
                sequences: snapshot.sequences.length,
              })
            : t('workbench.welcome')}
          {busy && (
            <>
              <LoaderCircle size={10} className="spin" /> {pending}
            </>
          )}
        </span>
        <button onClick={() => setModal('kits')}>
          {t('workbench.kits.environment')}
          <Package size={11} />
        </button>
      </footer>
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          busy={busy}
          onClose={closeModal}
          onSave={async (value) => {
            const result = await perform(t('workbench.model.save'), () =>
              window.frameo.saveSettings(value),
            );
            if (result) {
              setSettings(result.value);
              setModal(null);
              notify({ key: 'workbench.model.saved' });
            }
            return !!result;
          }}
        />
      )}
      {(modal === 'project' || modal === 'sequence') && (
        <CreateModal
          kind={modal}
          busy={busy}
          onClose={closeModal}
          onCreate={async (value) => {
            if (!needModel()) return false;
            const result = await update(
              modal === 'project' ? t('workbench.project.create') : t('workbench.sequence.create'),
              () =>
                modal === 'project'
                  ? window.frameo.createProject(value)
                  : window.frameo.createSequence(value),
              modal === 'project',
            );
            if (result?.value) {
              setModal(null);
              setSidebarTab('assets');
              const created = result.value.sequences.at(-1);
              if (created) {
                setSelection(created.id);
                setSequenceId(created.id);
              }
              const next = await perform(t('workbench.projects.read'), () =>
                window.frameo.bootstrap(),
              );
              if (next) setBoot(next.value);
            }
            return !!result?.value;
          }}
        />
      )}
      {modal === 'generation' && snapshot && (
        <GenerateModal
          settings={settings}
          assets={snapshot.assets}
          busy={busy}
          onClose={closeModal}
          onSubmit={async (input) => {
            if (!needModel()) return false;
            const result = await perform(t('workbench.seedance.submit'), () =>
              window.frameo.generate(input),
            );
            if (result) {
              setModal(null);
              notify({ key: 'workbench.seedance.submitted' });
            }
            return !!result;
          }}
        />
      )}
      {modal === 'jobs' && snapshot && (
        <JobsModal
          jobs={snapshot.jobs}
          busy={busy}
          onClose={closeModal}
          onCancel={(id) =>
            void perform(t('workbench.task.cancel'), () => window.frameo.cancelJob(id))
          }
          onReconcile={(id) =>
            void perform(t('workbench.task.query'), () => window.frameo.reconcileJob(id))
          }
          onReveal={(path) =>
            void perform(t('workbench.output.reveal'), () => window.frameo.revealFile(path))
          }
        />
      )}
      {modal === 'kits' && (
        <KitsModal
          kits={kits}
          busy={busy}
          onClose={closeModal}
          onInstall={(id) =>
            void kitOperation(t('workbench.kit.install'), () => window.frameo.installKit(id))
          }
          onEnable={(id, enabled) =>
            void kitOperation(t('workbench.kit.enable'), () =>
              window.frameo.setKitEnabled({ id, enabled }),
            )
          }
          onUninstall={(id) =>
            void kitOperation(t('workbench.kit.uninstall'), () => window.frameo.uninstallKit(id))
          }
          onImport={() =>
            void kitOperation(t('workbench.kit.import'), () => window.frameo.importKit())
          }
          onRefresh={() => void listKits()}
          canStart={!!snapshot}
          onStart={(kit) => {
            if (!requireSavedDraft() || !needModel()) return;
            setRecipeKit(kit);
            setModal('recipe');
          }}
        />
      )}
      {modal === 'memories' && snapshot && (
        <MemoriesModal
          memories={snapshot.memories}
          busy={busy}
          onClose={closeModal}
          onSave={async (input) => {
            const result = await update(t('workbench.memory.save'), () =>
              window.frameo.saveMemory(input),
            );
            return !!result?.value;
          }}
          onDelete={(memory) =>
            void update(t('workbench.memory.delete'), () =>
              window.frameo.deleteMemory({
                id: memory.id,
                scope: memory.scope,
                expectedRevision: memory.revision,
              }),
            )
          }
        />
      )}
      {modal === 'recipe' && recipeKit && snapshot && (
        <Modal
          title={t('workbench.recipe.title', { name: presentKit(locale, recipeKit).name })}
          description={presentKit(locale, recipeKit).description}
          busy={busy}
          onClose={closeModal}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!requireSavedDraft() || !needModel()) return;
              const data = new FormData(e.currentTarget);
              let parameters: Record<string, unknown> | undefined;
              try {
                const raw = String(data.get('parameters') || '').trim();
                parameters = raw ? JSON.parse(raw) : undefined;
                if (parameters && (typeof parameters !== 'object' || Array.isArray(parameters)))
                  throw new Error(t('workbench.recipe.inputObject'));
              } catch {
                notify({ key: 'workbench.recipe.invalidJson' }, true);
                return;
              }
              void update(t('workbench.recipe.starting'), () =>
                window.frameo.startRecipe({
                  kitId: recipeKit.id,
                  title: String(data.get('title')).trim(),
                  sequenceId: contextSequence?.id,
                  input: parameters,
                }),
              ).then((result) => {
                if (result?.value) {
                  setModal(null);
                  notify({ key: 'workbench.recipe.started' });
                }
              });
            }}
          >
            <label>
              {t('workbench.recipe.goal')}
              <textarea
                name="title"
                rows={5}
                required
                maxLength={1000}
                placeholder={t('workbench.recipe.goalPlaceholder')}
              />
            </label>
            <label>
              {t('workbench.recipe.parameters')}
              <textarea
                name="parameters"
                rows={3}
                maxLength={16000}
                placeholder={t('workbench.recipe.parametersPlaceholder')}
              />
            </label>
            {contextSequence && (
              <p className="field-hint">
                {t('workbench.recipe.target', { name: contextSequence.name })}
              </p>
            )}
            <div className="modal-actions">
              <Button onClick={closeModal} disabled={busy}>
                {t('workbench.cancel')}
              </Button>
              <Button type="submit" kind="accent" disabled={busy || agentRunning}>
                <Sparkles size={14} />
                {t('workbench.recipe.start')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'share' && snapshot && (
        <Modal
          title={t('workbench.share.title')}
          description={t('workbench.share.description')}
          busy={busy}
          onClose={closeModal}
        >
          <div className="share-body">
            <Share2 size={32} />
            <h3>{snapshot.project.name}</h3>
            <p>{t('workbench.share.contents')}</p>
            <Button
              kind="accent"
              disabled={busy}
              onClick={() =>
                void perform(t('workbench.share.export'), () => window.frameo.exportProject()).then(
                  (result) => {
                    if (result?.value) {
                      notify({ key: 'workbench.share.exported' });
                      setModal(null);
                    }
                  },
                )
              }
            >
              <Share2 size={14} />
              {t('workbench.share.choose')}
            </Button>
          </div>
        </Modal>
      )}
      {inspectAsset && (
        <Modal
          title={inspectAsset.name}
          busy={busy}
          onClose={() => {
            if (!busy) setInspectAsset(null);
          }}
          wide
        >
          <div className="asset-preview">
            {inspectAsset.kind === 'image' ? (
              <img src={inspectAsset.url} alt={inspectAsset.name} />
            ) : inspectAsset.kind === 'video' ? (
              <video
                src={inspectAsset.url}
                controls
                autoPlay
                aria-label={t('workbench.preview.video')}
              />
            ) : (
              <audio
                src={inspectAsset.url}
                controls
                autoPlay
                aria-label={t('workbench.preview.audio')}
              />
            )}
          </div>
          <div className="modal-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void perform(t('workbench.file.showing'), () =>
                  window.frameo.revealFile(inspectAsset.path),
                )
              }
            >
              <FolderOpen size={14} />
              {t('workbench.file.show')}
            </Button>
            <Button
              kind="accent"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                addAsset(inspectAsset);
                setInspectAsset(null);
              }}
            >
              <Plus size={14} />
              {t('workbench.asset.add')}
            </Button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <X size={16} /> : <CheckCircle2 size={16} />}
          <span>
            {typeof toast.text === 'string'
              ? hostText(toast.text)
              : t(toast.text.key, toast.text.parameters)}
          </span>
          <IconButton label={t('workbench.toast.close')} onClick={() => setToast(null)}>
            <X size={13} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
