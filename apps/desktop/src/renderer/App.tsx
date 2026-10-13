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
import { Button, Empty, IconButton, Modal, uid } from './ui';

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
  const [boot, setBoot] = useState<AppBootstrap | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [kits, setKits] = useState<AppBootstrap['kits']>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [pending, setPending] = useState('');
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
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
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
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
          entry.ready = window.reelbeam
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
            await window.reelbeam.endEdit({
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
      if (!window.reelbeam) throw new Error('桌面连接不可用。请通过 Reelbeam 桌面应用启动工作台。');
      const data = await window.reelbeam.bootstrap();
      setBoot(data);
      setSettings(data.settings);
      setKits(data.kits);
      if (data.project) acceptSnapshot(data.project, 'replace');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [acceptSnapshot]);
  useEffect(() => {
    void initialize();
    if (!window.reelbeam) return;
    return window.reelbeam.onEvent((event) => {
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
        setAgentStatus(event.text || event.agent || 'Agent 正在执行');
        if (terminal) setDelta('');
      }
      if (event.type === 'error') {
        setAgentRunning(false);
        notify(event.text || '操作执行失败', true);
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
    notify('请先保存或放弃时间线草稿，再继续此操作。');
    return false;
  }, [notify]);
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
      notify('请先创建或打开一个工程');
      return;
    }
    setModal('generation');
  };
  async function refresh() {
    const result = await perform('读取工程', () => window.reelbeam.snapshot());
    if (result) acceptSnapshot(result.value);
  }
  async function apply(commands: EditCommand[], expectedRevision?: number): Promise<boolean> {
    if (!sequence) return false;
    const lease = editLeaseRef.current?.sequenceId === sequence.id ? editLeaseRef.current : null;
    const result = await update('保存剪辑', async () => {
      if (lease) await lease.ready;
      return window.reelbeam.apply({
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
      await update('保存画布', () =>
        window.reelbeam.saveCanvas({ expectedRevision: snapshot.canvas.revision, items }),
      );
    },
    [snapshot],
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
        notify('请先新建作品，再将素材加入时间线');
        return;
      }
      const kind = asset.kind === 'audio' ? 'audio' : 'video';
      let track = target.tracks.find((t) => t.kind === kind && !t.locked);
      const commands: EditCommand[] = [];
      if (!track) {
        track = {
          id: uid(),
          kind,
          name: kind === 'audio' ? '音频 1' : '视频 1',
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
      void update('添加片段', () =>
        window.reelbeam.apply({
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
    [snapshot, sequenceId, notify, requireSavedDraft],
  );
  async function sendPrompt(text: string): Promise<boolean> {
    if (!requireSavedDraft() || !needModel() || !snapshot || agentRunning || busy) return false;
    let session: Session | undefined =
      snapshot.sessions.find((s) => s.id === sessionId) || snapshot.sessions[0];
    if (!session) {
      const created = await update('创建对话', () => window.reelbeam.createSession('创作对话'));
      if (!created?.value) return false;
      session = created.value.sessions.at(-1);
      setSessionId(session?.id || null);
    }
    if (!session) return false;
    setAgentRunning(true);
    setStreamSessionId(session.id);
    setDelta('');
    setAgentStatus('Agent 正在理解你的需求…');
    const result = await perform('发送指令', () =>
      window.reelbeam.prompt({
        requestId: uid(),
        sessionId: session!.id,
        text: selectedAsset
          ? `${text}\n\n当前选择的素材：${selectedAsset.name}（Asset ID: ${selectedAsset.id}）`
          : text,
        sequenceId: contextSequence?.id,
        clipId: contextSequence ? selectedClip || undefined : undefined,
      }),
    );
    if (!result) setAgentRunning(false);
    return !!result;
  }
  async function listKits() {
    const result = await perform('读取 Kit 列表', () => window.reelbeam.listKits());
    if (result) setKits(result.value);
  }
  async function kitOperation(label: string, fn: () => Promise<AppBootstrap['kits']>) {
    const result = await perform(label, fn);
    if (result) setKits(result.value);
  }
  async function open(path?: string) {
    if (!requireSavedDraft()) return;
    await update(
      '打开工程',
      () => (path ? window.reelbeam.openRecent(path) : window.reelbeam.openProject()),
      true,
    );
  }
  const closeModal = useCallback(() => setModal(null), []);
  if (loadError)
    return (
      <div className="fatal">
        <Aperture size={34} />
        <h1>无法连接桌面工作台</h1>
        <p>{loadError}</p>
        <Button kind="accent" onClick={() => void initialize()}>
          重试连接
        </Button>
      </div>
    );
  if (!boot)
    return (
      <div className="loading-screen">
        <Aperture size={38} />
        <h1>Reelbeam</h1>
        <span>
          <LoaderCircle size={14} className="spin" />
          正在打开创作工作台
        </span>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Aperture size={21} />
          <span>reelbeam</span>
        </div>
        <div className="header-project">
          <span className={`status-dot ${snapshot ? 'ready' : ''}`} />
          {snapshot ? snapshot.project.name : '尚未打开工程'}
          {snapshot && (
            <span className="local-saved">
              {pending === '保存剪辑' || pending === '保存画布' ? '保存中…' : '本地自动保存'}
            </span>
          )}
        </div>
        <div className="header-actions">
          <Button onClick={() => setModal('jobs')} disabled={!snapshot} testId="jobs-button">
            <Clock3 size={15} />
            <span>任务</span>
            {activeJobs > 0 && <b className="count-badge">{activeJobs}</b>}
          </Button>
          <IconButton
            label="共享工程"
            disabled={!snapshot || busy}
            onClick={() => setModal('share')}
          >
            <Share2 size={16} />
          </IconButton>
          <IconButton label="模型与应用设置" onClick={() => setModal('settings')}>
            <Settings2 size={16} />
          </IconButton>
        </div>
      </header>
      <div className="workspace">
        <nav className="activity-rail" aria-label="工作台工具栏">
          <div>
            <IconButton
              label={sidebar && sidebarTab === 'projects' ? '收起工程列表' : '工程列表'}
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
              <span>工程</span>
            </IconButton>
            <IconButton
              label={sidebar && sidebarTab === 'assets' ? '收起素材库' : '素材库'}
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
              <span>素材</span>
            </IconButton>
            <IconButton
              label="Kit 商店"
              active={modal === 'kits'}
              onClick={() => {
                setModal('kits');
                void listKits();
              }}
            >
              <Package size={19} />
              <span>扩展</span>
            </IconButton>
            <IconButton label="创作记忆" disabled={!snapshot} onClick={() => setModal('memories')}>
              <Brain size={19} />
              <span>记忆</span>
            </IconButton>
          </div>
          <div>
            <IconButton
              label="导入共享工程"
              disabled={busy || dirtyEdit}
              onClick={() => void update('导入工程', () => window.reelbeam.importProject(), true)}
            >
              <Upload size={18} />
              <span>导入</span>
            </IconButton>
            <IconButton label="新建工程" onClick={showCreate}>
              <Plus size={19} />
              <span>新建</span>
            </IconButton>
            <span className="rail-version" title={`Reelbeam ${boot.version}`}>
              0.1
            </span>
          </div>
        </nav>
        {sidebar && (snapshot || sidebarTab === 'projects') && (
          <aside className="library-panel">
            <div className="library-heading">
              <strong>{sidebarTab === 'assets' ? '工程素材' : '工程'}</strong>
              <IconButton label="收起侧栏" onClick={() => setSidebar(false)}>
                <PanelLeftClose size={15} />
              </IconButton>
            </div>
            {sidebarTab === 'assets' && snapshot ? (
              <>
                <div className="library-project">
                  <span className="eyebrow">当前工程</span>
                  <strong>{snapshot.project.name}</strong>
                  <Button
                    disabled={busy}
                    onClick={() => void update('导入素材', () => window.reelbeam.importMedia())}
                    testId="import-media"
                  >
                    <Plus size={14} />
                    导入素材
                  </Button>
                </div>
                <div className="library-section-heading">
                  <span>
                    作品 <b>{snapshot.sequences.length}</b>
                  </span>
                  <IconButton label="新建作品" disabled={busy} onClick={showSequence}>
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
                          {s.width} × {s.height} · {s.clips.length} 个片段
                        </small>
                      </div>
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
                <div className="library-section-heading">
                  <span>
                    素材 <b>{snapshot.assets.length}</b>
                  </span>
                </div>
                <div className="search-input library-search">
                  <Search size={13} />
                  <input
                    aria-label="搜索工程素材"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索素材"
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
                          title="点击显示在画布，双击预览"
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
                              {a.kind === 'image' ? '图片' : a.kind === 'audio' ? '音频' : '视频'}
                              {a.duration > 0 && ` · ${a.duration.toFixed(1)}s`}
                            </span>
                          </div>
                        </button>
                        <IconButton
                          label={`将 ${a.name} 添加至作品`}
                          disabled={busy}
                          onClick={() => addAsset(a)}
                        >
                          <Plus size={13} />
                        </IconButton>
                      </article>
                    ))}
                  {!snapshot.assets.length && (
                    <Empty icon={<Image size={23} />} title="等待第一个素材">
                      导入文件或生成一个镜头。
                    </Empty>
                  )}
                  {snapshot.assets.length > 0 &&
                    !snapshot.assets.some((a) =>
                      a.name.toLowerCase().includes(query.toLowerCase()),
                    ) && <Empty title="没有匹配的素材" />}
                </div>
                <div className="library-footer">
                  <IconButton
                    label="撤销画布布局"
                    disabled={busy}
                    onClick={() => void update('撤销画布', () => window.reelbeam.undoCanvas())}
                  >
                    <Undo2 size={14} />
                  </IconButton>
                  <span>画布隐藏保留原素材</span>
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
                  新建工程
                </Button>
                <Button onClick={() => void open()} disabled={busy}>
                  <FolderOpen size={15} />
                  打开工程
                </Button>
                {snapshot && (
                  <Button
                    onClick={() =>
                      void perform('关闭工程', () => window.reelbeam.closeProject()).then(
                        (result) => {
                          if (result) {
                            snapshotRef.current = null;
                            setSnapshot(null);
                            setSequenceId(null);
                            setSelection(null);
                            onDraftChange(false);
                          }
                        },
                      )
                    }
                    disabled={busy || agentRunning || dirtyEdit}
                  >
                    关闭当前工程
                  </Button>
                )}
                <div className="library-section-heading">
                  <span>最近工程</span>
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
                      <span>{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <ArrowUpRight size={13} />
                  </button>
                ))}
                {!boot.recentProjects.length && (
                  <p className="field-hint">创建的工程会出现在这里。</p>
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
                onImport={() => void update('导入素材', () => window.reelbeam.importMedia())}
                busy={busy}
              />
              {selectedAsset && !sequence && (
                <div className="asset-selection-bar">
                  <span>{selectedAsset.name}</span>
                  <Button onClick={() => setInspectAsset(selectedAsset)}>预览素材</Button>
                  <Button onClick={() => addAsset(selectedAsset)} disabled={busy}>
                    <Plus size={13} />
                    加入作品
                  </Button>
                  <IconButton label="清除素材选择" onClick={() => setSelection(null)}>
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
                    void update('撤销剪辑', () =>
                      window.reelbeam.undo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                        commandId: uid(),
                      }),
                    )
                  }
                  onRedo={() =>
                    void update('重做剪辑', () =>
                      window.reelbeam.redo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                        commandId: uid(),
                      }),
                    )
                  }
                  canUndo={!!snapshot.canUndo[sequence.id]}
                  canRedo={!!snapshot.canRedo[sequence.id]}
                  onPreview={() =>
                    void perform('提交预览', () =>
                      window.reelbeam.preview({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                      }),
                    ).then((result) => {
                      if (result) notify('正在合成作品预览');
                    })
                  }
                  onExport={() =>
                    void perform('提交导出', () =>
                      window.reelbeam.exportVideo({
                        sequenceId: sequence.id,
                        expectedRevision: sequence.revision,
                      }),
                    ).then((result) => {
                      if (result?.value) {
                        notify('导出任务已提交');
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
                <Aperture size={28} />
              </div>
              <span className="eyebrow">REELBEAM STUDIO</span>
              <h1>从一个想法开始创作</h1>
              <p>与 Agent 一起规划镜头，审阅方案，打磨成片。</p>
              <div className="welcome-workflow" aria-label="创作流程">
                <div>
                  <span>01</span>
                  <strong>表达想法</strong>
                  <p>描述目标，添加参考素材</p>
                </div>
                <div>
                  <span>02</span>
                  <strong>审阅方案</strong>
                  <p>确认计划、操作与生成预算</p>
                </div>
                <div>
                  <span>03</span>
                  <strong>完成作品</strong>
                  <p>采纳镜头，剪辑并导出</p>
                </div>
              </div>
              <div className="welcome-actions">
                <Button kind="accent" onClick={showCreate} testId="welcome-create">
                  <Plus size={15} />
                  新建创作工程
                </Button>
                <Button onClick={() => void open()} disabled={busy}>
                  <FolderOpen size={15} />
                  打开工程
                </Button>
              </div>
              <div className={`model-connection ${ready ? 'connected' : ''}`}>
                <span className="status-dot" />
                <span>
                  {ready
                    ? '已配置方舟 · Seedance 视频生成'
                    : '开始创作前，请配置方舟模型和 API Key'}
                </span>
                <button onClick={() => setModal('settings')}>
                  {ready ? '管理配置' : '配置模型'}
                  <ArrowUpRight size={12} />
                </button>
              </div>
              {boot.recentProjects.length > 0 && (
                <div className="welcome-recents">
                  <span className="eyebrow">继续创作</span>
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
            void update('新建对话', () =>
              window.reelbeam.createSession(`创作对话 ${(snapshot?.sessions.length || 0) + 1}`),
            ).then((result) => {
              if (result?.value) setSessionId(result.value.sessions.at(-1)?.id || null);
            })
          }
          onPrompt={sendPrompt}
          onStop={() =>
            void perform('停止 Agent', () => window.reelbeam.stopAgent()).then((result) => {
              if (result) {
                setAgentRunning(false);
                setDelta('');
              }
            })
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
            void update('审阅方案', () => window.reelbeam.decideReview({ reviewId, decision }));
          }}
          onResume={(recipeId) => {
            if (requireSavedDraft())
              void perform('继续工作流', () => window.reelbeam.resumeRecipe({ recipeId }));
          }}
          onRedo={(recipeId, redoStepId) => {
            if (!requireSavedDraft()) return;
            if (activeJobs) {
              notify('有任务尚未结束或状态待确认，请在任务记录中查询或取消后重做。');
              return;
            }
            void perform('重做工作流步骤', () =>
              window.reelbeam.resumeRecipe({ recipeId, redoStepId }),
            );
          }}
          onRecipeResult={(input) => {
            if (input.decision === 'accept' && !requireSavedDraft()) return;
            void update('审阅工作流结果', () => window.reelbeam.decideRecipeResult(input));
          }}
          onRecipeInput={(input) => {
            if (input.decision === 'accept' && !requireSavedDraft()) return;
            void update('审阅工作流输入', () => window.reelbeam.decideRecipeInput(input));
          }}
          onExportRecipe={(recipeId) =>
            void perform('导出工作流', () => window.reelbeam.exportRecipe({ recipeId })).then(
              (result) => {
                if (result?.value) notify('工作流记录已导出');
              },
            )
          }
        />
      </div>
      <footer className="app-status">
        <span>
          <span className={`status-dot ${ready ? 'ready' : ''}`} />
          {ready ? '方舟模型已配置' : '模型未连接'}
        </span>
        <span>
          {snapshot
            ? `${snapshot.assets.length} 个素材 · ${snapshot.sequences.length} 个作品`
            : '欢迎来到 Reelbeam'}
          {busy && (
            <>
              <LoaderCircle size={10} className="spin" /> {pending}
            </>
          )}
        </span>
        <button onClick={() => setModal('kits')}>
          Kit 驱动的创作环境
          <Package size={11} />
        </button>
      </footer>
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          busy={busy}
          onClose={closeModal}
          onSave={async (value) => {
            const result = await perform('保存模型配置', () => window.reelbeam.saveSettings(value));
            if (result) {
              setSettings(result.value);
              setModal(null);
              notify('模型配置已保存');
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
              modal === 'project' ? '创建工程' : '创建作品',
              () =>
                modal === 'project'
                  ? window.reelbeam.createProject(value)
                  : window.reelbeam.createSequence(value),
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
              const next = await perform('读取最近工程', () => window.reelbeam.bootstrap());
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
            const result = await perform('提交 Seedance 生成', () =>
              window.reelbeam.generate(input),
            );
            if (result) {
              setModal(null);
              notify('Seedance 生成任务已提交');
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
          onCancel={(id) => void perform('取消任务', () => window.reelbeam.cancelJob(id))}
          onReconcile={(id) => void perform('查询云端任务', () => window.reelbeam.reconcileJob(id))}
          onReveal={(path) => void perform('查看输出文件', () => window.reelbeam.revealFile(path))}
        />
      )}
      {modal === 'kits' && (
        <KitsModal
          kits={kits}
          busy={busy}
          onClose={closeModal}
          onInstall={(id) => void kitOperation('安装 Kit', () => window.reelbeam.installKit(id))}
          onEnable={(id, enabled) =>
            void kitOperation('更新 Kit 状态', () => window.reelbeam.setKitEnabled({ id, enabled }))
          }
          onUninstall={(id) =>
            void kitOperation('卸载 Kit', () => window.reelbeam.uninstallKit(id))
          }
          onImport={() => void kitOperation('导入 Kit', () => window.reelbeam.importKit())}
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
            const result = await update('保存记忆', () => window.reelbeam.saveMemory(input));
            return !!result?.value;
          }}
          onDelete={(memory) =>
            void update('删除记忆', () =>
              window.reelbeam.deleteMemory({
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
          title={`开始制作 · ${recipeKit.name}`}
          description={recipeKit.description}
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
                  throw new Error('配方输入必须为 JSON 对象。');
              } catch {
                notify('配方参数必须为有效的 JSON 对象。', true);
                return;
              }
              void update('启动创作工作流', () =>
                window.reelbeam.startRecipe({
                  kitId: recipeKit.id,
                  title: String(data.get('title')).trim(),
                  sequenceId: contextSequence?.id,
                  input: parameters,
                }),
              ).then((result) => {
                if (result?.value) {
                  setModal(null);
                  notify('工作流已启动，请在 Agent 工作流中查看进度');
                }
              });
            }}
          >
            <label>
              创作目标
              <textarea
                name="title"
                rows={5}
                required
                maxLength={1000}
                placeholder="告诉工作流你希望制作什么，例如：为一款户外香水制作 15 秒的品牌短片，森林光线、克制的字幕和舒缓的节奏。"
              />
            </label>
            <label>
              可选配方参数 · JSON 对象
              <textarea
                name="parameters"
                rows={3}
                maxLength={16000}
                placeholder='{"brief":"替换创作目标，或填写此配方要求的输入"}'
              />
            </label>
            {contextSequence && (
              <p className="field-hint">
                目标作品：{contextSequence.name}
                。工作流按创意、视觉与剪辑步骤执行，生成和剪辑方案仍需审阅。
              </p>
            )}
            <div className="modal-actions">
              <Button onClick={closeModal}>取消</Button>
              <Button type="submit" kind="accent" disabled={busy || agentRunning}>
                <Sparkles size={14} />
                启动工作流
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === 'share' && snapshot && (
        <Modal
          title="共享创作工程"
          description="导出工程副本，方便在另一台机器继续剪辑。"
          onClose={closeModal}
        >
          <div className="share-body">
            <Share2 size={32} />
            <h3>{snapshot.project.name}</h3>
            <p>包含作品、画布和已导入媒体。账户密钥、聊天、个人记忆与任务记录不会进入共享包。</p>
            <Button
              kind="accent"
              disabled={busy}
              onClick={() =>
                void perform('导出共享工程', () => window.reelbeam.exportProject()).then(
                  (result) => {
                    if (result?.value) {
                      notify('共享工程已导出');
                      setModal(null);
                    }
                  },
                )
              }
            >
              <Share2 size={14} />
              选择位置并导出工程
            </Button>
          </div>
        </Modal>
      )}
      {inspectAsset && (
        <Modal title={inspectAsset.name} onClose={() => setInspectAsset(null)} wide>
          <div className="asset-preview">
            {inspectAsset.kind === 'image' ? (
              <img src={inspectAsset.url} alt={inspectAsset.name} />
            ) : inspectAsset.kind === 'video' ? (
              <video src={inspectAsset.url} controls autoPlay aria-label="素材视频预览" />
            ) : (
              <audio src={inspectAsset.url} controls autoPlay aria-label="音频素材预览" />
            )}
          </div>
          <div className="modal-actions">
            <Button
              onClick={() =>
                void perform('显示素材文件', () => window.reelbeam.revealFile(inspectAsset.path))
              }
            >
              <FolderOpen size={14} />
              显示文件
            </Button>
            <Button
              kind="accent"
              disabled={busy}
              onClick={() => {
                addAsset(inspectAsset);
                setInspectAsset(null);
              }}
            >
              <Plus size={14} />
              加入作品
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
          <span>{toast.text}</span>
          <IconButton label="关闭通知" onClick={() => setToast(null)}>
            <X size={13} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
