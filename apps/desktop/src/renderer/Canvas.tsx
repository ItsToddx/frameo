import { useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Film, Music2, Maximize, Plus, Minus, X, Play, GripVertical } from 'lucide-react';
import type { Asset, CanvasItem, ProjectSnapshot, Sequence } from '../adapters/contracts/api';
import { Button, IconButton, timecode } from './ui';
import { useI18n } from './i18n';

type CardData = {
  item: CanvasItem;
  asset?: Asset;
  sequence?: Sequence;
  thumbnail?: string;
  selected: boolean;
  busy: boolean;
  dropTarget: boolean;
  onSelect: (item: CanvasItem) => void;
  onHide: (id: string) => void;
  onAdd: (asset: Asset, sequenceId?: string) => void;
  onInspect: (asset: Asset) => void;
  onEdit: (id: string) => void;
};
type CardNode = Node<CardData, 'card'>;
function Card({ data }: NodeProps<CardNode>) {
  const { t } = useI18n();
  const { item, asset, sequence } = data;
  const name = sequence?.name || asset?.name || t('workbench.canvas.unavailable');
  const duration = sequence
    ? Math.max(0, ...sequence.clips.map((c) => (c.start + c.duration) / sequence.fps))
    : asset?.duration || 0;
  function open() {
    if (sequence) data.onEdit(sequence.id);
    else if (asset) data.onInspect(asset);
  }
  return (
    <article
      className={`canvas-card ${data.selected ? 'selected' : ''} ${sequence ? 'sequence-card' : ''} ${data.dropTarget ? 'drop-target' : ''}`}
      data-testid={sequence ? 'sequence-card' : 'asset-card'}
      data-ref-id={item.refId}
    >
      <div className="card-media">
        {data.thumbnail ? (
          <img className="card-image" src={data.thumbnail} alt="" draggable={false} />
        ) : (
          <div className="card-placeholder">
            {asset?.kind === 'audio' ? <Music2 size={25} /> : <Film size={25} />}
          </div>
        )}
        <span className="card-kind">
          {sequence
            ? t('workbench.kind.sequence')
            : t(
                asset?.kind === 'image'
                  ? 'workbench.kind.image'
                  : asset?.kind === 'audio'
                    ? 'workbench.kind.audio'
                    : 'workbench.kind.video',
              )}
        </span>
        {!!duration && <span className="card-duration">{timecode(duration)}</span>}
        <button
          className="card-preview nodrag"
          aria-label={
            sequence
              ? t('workbench.canvas.openSequence', { name })
              : t('workbench.canvas.openAsset', { name })
          }
          onClick={open}
        >
          <Play size={18} />
        </button>
        <button
          className="card-hide nodrag"
          aria-label={t('workbench.canvas.hide', { name })}
          disabled={data.busy}
          onClick={() => data.onHide(item.id)}
        >
          <X size={13} />
        </button>
        {data.dropTarget && <span className="card-drop-label">{t('board.dropSequence')}</span>}
      </div>
      <div className="card-info">
        <div>
          <strong>{name}</strong>
          <span>
            {sequence
              ? t('workbench.clips', { count: sequence.clips.length })
              : asset?.width
                ? `${asset.width} × ${asset.height}`
                : t('workbench.kind.audio')}
          </span>
        </div>
        <button
          className="card-reference nodrag nopan"
          draggable
          aria-label={t('board.reference', { name })}
          onClick={() => data.onSelect(item)}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-framo-reference', item.refId);
            event.dataTransfer.effectAllowed = 'copy';
            event.stopPropagation();
          }}
        >
          <GripVertical size={16} />
        </button>
        {asset && (
          <button
            className="card-add nodrag nopan"
            aria-label={t('workbench.canvas.addName', { name })}
            disabled={data.busy}
            onClick={() => data.onAdd(asset)}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
const nodeTypes = { card: Card };
interface Props {
  snapshot: ProjectSnapshot;
  selection: string | null;
  timelineOpen: boolean;
  busy: boolean;
  onSelect: (item: CanvasItem) => void;
  onSave: (items: CanvasItem[]) => Promise<void>;
  onHide: (id: string) => void;
  onAdd: (asset: Asset, sequenceId?: string) => void;
  onGenerate: () => void;
  onImport: () => void;
  onInspect: (asset: Asset) => void;
  onBack: () => void;
  onEdit: (id: string) => void;
  onFiles: (files: File[]) => Promise<void>;
}
export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
function CanvasInner({
  snapshot,
  selection,
  timelineOpen,
  onSelect,
  onSave,
  onHide,
  onAdd,
  onImport,
  onInspect,
  onEdit,
  onFiles,
  busy,
}: Props) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [fileDrag, setFileDrag] = useState(false);
  const [dragging, setDragging] = useState(false);
  const container = useRef<HTMLElement>(null);
  const hadEditor = useRef(false);
  const fittedProject = useRef<string | null>(null);
  const flow = useReactFlow<CardNode>();
  function fitCanvas() {
    void flow.fitView({
      padding: 0.32,
      maxZoom: 1,
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
    });
  }
  const fitRef = useRef(fitCanvas);
  fitRef.current = fitCanvas;
  useEffect(() => {
    const returning = hadEditor.current && !timelineOpen;
    hadEditor.current = timelineOpen;
    if (returning) {
      const opener = selection
        ? container.current?.querySelector<HTMLElement>(
            `[data-ref-id="${CSS.escape(selection)}"] .card-preview`,
          )
        : null;
      (opener ?? container.current)?.focus();
    }
  }, [timelineOpen, selection]);
  useEffect(() => {
    setNodes((previous) => {
      const existing = new Map(previous.map((node) => [node.id, node]));
      return snapshot.canvas.items.map((item) => {
        const current = existing.get(item.id);
        const asset = snapshot.assets.find((a) => a.id === item.refId);
        const sequence = snapshot.sequences.find((s) => s.id === item.refId);
        const cover = sequence
          ? snapshot.assets.find((a) => a.id === sequence.clips[0]?.assetVersionId)
          : asset;
        return {
          id: item.id,
          type: 'card',
          position: dragging && current ? current.position : { x: item.x, y: item.y },
          // Keep measured dimensions so selecting a card never hides it between clicks.
          measured: current?.measured,
          selected: item.refId === selection,
          style: { width: 260 },
          data: {
            item,
            asset,
            sequence,
            thumbnail: cover?.thumbnailUrl || (cover?.kind === 'image' ? cover.url : undefined),
            selected: item.refId === selection,
            busy,
            dropTarget: dragging ? (current?.data.dropTarget ?? false) : false,
            onSelect,
            onHide,
            onAdd,
            onInspect,
            onEdit,
          },
        };
      });
    });
  }, [snapshot, selection, onSelect, onHide, onAdd, onInspect, onEdit, busy, dragging]);
  useEffect(() => {
    if (
      !flow.viewportInitialized ||
      !snapshot.canvas.items.length ||
      fittedProject.current === snapshot.project.id
    )
      return;
    const timer = setTimeout(() => {
      fitRef.current();
      fittedProject.current = snapshot.project.id;
    }, 80);
    return () => clearTimeout(timer);
  }, [flow.viewportInitialized, snapshot.project.id, snapshot.canvas.items.length]);
  function targetFor(node: CardNode) {
    if (!node.data.asset) return undefined;
    const x = node.position.x + 130,
      y = node.position.y + 85;
    return flow
      .getNodes()
      .find(
        (target) =>
          target.data.sequence &&
          x >= target.position.x &&
          x <= target.position.x + 260 &&
          y >= target.position.y &&
          y <= target.position.y + 215,
      );
  }
  return (
    <section
      ref={container}
      inert={timelineOpen}
      tabIndex={-1}
      className={`canvas-shell board ${fileDrag ? 'file-drag' : ''}`}
      data-testid="canvas"
      aria-label={t('workbench.canvas.title')}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setFileDrag(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null))
          setFileDrag(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setFileDrag(false);
        if (!busy)
          void onFiles(Array.from(event.dataTransfer.files)).then(() =>
            setTimeout(() => void flow.fitView({ padding: 0.32, maxZoom: 1, duration: 0 }), 80),
          );
      }}
    >
      <div className="board-heading">
        <span>{t('board.title')}</span>
        <span>{snapshot.canvas.items.length}</span>
      </div>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((previous) => applyNodeChanges(changes, previous))}
        onNodeClick={(_, node) => onSelect(node.data.item)}
        zoomOnDoubleClick={false}
        onNodeDoubleClick={(_, node) => {
          if (node.data.sequence) onEdit(node.data.sequence.id);
          else if (node.data.asset) onInspect(node.data.asset);
        }}
        onNodeDragStart={() => {
          setDragging(true);
        }}
        onNodeDrag={(_, node) => {
          const target = targetFor(node);
          setNodes((previous) =>
            previous.map((item) => ({
              ...item,
              data: { ...item.data, dropTarget: item.id === target?.id },
            })),
          );
        }}
        onNodeDragStop={(_, node) => {
          const target = targetFor(node);
          if (target && node.data.asset) {
            setDragging(false);
            onAdd(node.data.asset, target.data.sequence!.id);
          } else {
            void onSave(
              snapshot.canvas.items.map((item) =>
                item.id === node.id ? { ...item, x: node.position.x, y: node.position.y } : item,
              ),
            ).finally(() => setDragging(false));
          }
        }}
        minZoom={0.25}
        maxZoom={1.6}
        autoPanOnNodeDrag={false}
        panOnScroll
        nodesDraggable={!busy}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#d6d7da" gap={28} size={1} />
      </ReactFlow>
      {!snapshot.canvas.items.length && (
        <div className="canvas-empty">
          <h3>{t('board.empty')}</h3>
          <p>{t('board.emptyHint')}</p>
        </div>
      )}
      {fileDrag && (
        <div className="board-drop-overlay">
          <Plus size={30} />
          <strong>{t('board.dropFiles')}</strong>
        </div>
      )}
      <div className="board-dock">
        <Button kind="ghost" onClick={onImport} disabled={busy}>
          <Plus size={16} />
          {t('board.import')}
        </Button>
        <span className="dock-separator" />
        <IconButton label={t('workbench.canvas.zoomOut')} onClick={() => void flow.zoomOut()}>
          <Minus size={15} />
        </IconButton>
        <IconButton label={t('workbench.canvas.zoomIn')} onClick={() => void flow.zoomIn()}>
          <Plus size={15} />
        </IconButton>
        <IconButton label={t('workbench.canvas.fit')} onClick={fitCanvas}>
          <Maximize size={16} />
        </IconButton>
      </div>
      <p className="board-hint">{t('board.dragHint')}</p>
    </section>
  );
}
