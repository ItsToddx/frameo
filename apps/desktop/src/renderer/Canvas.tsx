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
import {
  Aperture,
  Film,
  Music2,
  Maximize,
  Plus,
  Minus,
  X,
  ArrowDownToLine,
  LayoutGrid,
  MousePointer2,
  ArrowLeft,
  Play,
} from 'lucide-react';
import type { Asset, CanvasItem, ProjectSnapshot, Sequence } from '../adapters/contracts/api';
import { Button, IconButton, timecode } from './ui';

type CardData = {
  item: CanvasItem;
  asset?: Asset;
  sequence?: Sequence;
  selected: boolean;
  busy: boolean;
  onOpen: (item: CanvasItem) => void;
  onHide: (id: string) => void;
  onAdd: (asset: Asset) => void;
  onInspect: (asset: Asset) => void;
};
type CardNode = Node<CardData, 'card'>;
function Card({ data }: NodeProps<CardNode>) {
  const { item, asset, sequence } = data;
  const name = sequence?.name || asset?.name || '素材不可用';
  const duration = sequence
    ? Math.max(0, ...sequence.clips.map((c) => (c.start + c.duration) / sequence.fps))
    : asset?.duration || 0;
  return (
    <article
      className={`canvas-card ${data.selected ? 'selected' : ''} ${sequence ? 'sequence-card' : ''}`}
      data-testid={sequence ? 'sequence-card' : 'asset-card'}
    >
      <div className="card-media">
        <button
          className="card-open nodrag"
          aria-label={sequence ? `编辑作品 ${name}` : `预览素材 ${name}`}
          onClick={() => {
            data.onOpen(item);
            if (asset) data.onInspect(asset);
          }}
        >
          {asset?.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" draggable={false} />
          ) : asset?.kind === 'image' ? (
            <img src={asset.url} alt="" draggable={false} />
          ) : (
            <div className="card-placeholder">
              {sequence ? (
                <Film size={32} />
              ) : asset?.kind === 'audio' ? (
                <Music2 size={32} />
              ) : (
                <Film size={32} />
              )}
              <span>
                {sequence ? '打开编辑器' : asset?.kind === 'audio' ? '预览音频' : '预览视频'}
              </span>
            </div>
          )}
          <span className="card-play">
            <Play size={20} />
          </span>
        </button>
        <span className="card-kind">
          {sequence
            ? '作品'
            : asset?.kind === 'video'
              ? '视频'
              : asset?.kind === 'audio'
                ? '音频'
                : '图片'}
        </span>
        {!!duration && <span className="card-duration">{timecode(duration)}</span>}
        <button
          className="card-hide nodrag"
          aria-label={`从画布隐藏 ${name}`}
          disabled={data.busy}
          onClick={() => data.onHide(item.id)}
        >
          <X size={14} />
        </button>
      </div>
      <div className="card-info">
        <div>
          <strong>{name}</strong>
          <span>
            {sequence
              ? `${sequence.width} × ${sequence.height} · ${sequence.fps} fps`
              : asset?.width
                ? `${asset.width} × ${asset.height}`
                : '声音素材'}
          </span>
        </div>
        {asset && (
          <button
            className="card-add nodrag"
            aria-label={`将 ${name} 加入作品`}
            disabled={data.busy}
            onClick={() => data.onAdd(asset)}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {sequence && (
        <button className="sequence-footer nodrag" onClick={() => data.onOpen(item)}>
          <span>{sequence.clips.length} 个片段</span>
          <span>
            编辑作品 <ArrowDownToLine size={13} />
          </span>
        </button>
      )}
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
  onAdd: (asset: Asset) => void;
  onGenerate: () => void;
  onImport: () => void;
  onInspect: (asset: Asset) => void;
  onBack: () => void;
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
  onGenerate,
  onImport,
  onInspect,
  onBack,
  busy,
}: Props) {
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const dragging = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const fittedProject = useRef<string | null>(null);
  const flow = useReactFlow();
  const fitCanvas = () => {
    const bounds = container.current;
    if (!bounds || !snapshot.canvas.items.length) return;
    const items = snapshot.canvas.items;
    const left = Math.min(...items.map((item) => item.x));
    const top = Math.min(...items.map((item) => item.y));
    const width = Math.max(...items.map((item) => item.x + 260)) - left;
    const height =
      Math.max(...items.map((item) => item.y + (item.kind === 'sequence' ? 245 : 210))) - top;
    const availableHeight = Math.max(120, bounds.clientHeight - 140);
    const zoom = Math.min(
      1,
      Math.max(0.25, Math.min((bounds.clientWidth - 64) / width, availableHeight / height)),
    );
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    void flow.setViewport(
      {
        x: (bounds.clientWidth - width * zoom) / 2 - left * zoom,
        y: 80 + (availableHeight - height * zoom) / 2 - top * zoom,
        zoom,
      },
      { duration: reduceMotion ? 0 : 140 },
    );
  };
  const fitRef = useRef(fitCanvas);
  fitRef.current = fitCanvas;
  useEffect(() => {
    if (dragging.current) return;
    setNodes(
      snapshot.canvas.items.map((item) => ({
        id: item.id,
        type: 'card',
        position: { x: item.x, y: item.y },
        selected: item.refId === selection,
        style: { width: 260 },
        data: {
          item,
          asset: snapshot.assets.find((a) => a.id === item.refId),
          sequence: snapshot.sequences.find((s) => s.id === item.refId),
          selected: item.refId === selection,
          busy,
          onOpen: onSelect,
          onHide,
          onAdd,
          onInspect,
        },
      })),
    );
  }, [snapshot, selection, onSelect, onHide, onAdd, onInspect, busy]);
  useEffect(() => {
    if (
      timelineOpen ||
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
  }, [flow.viewportInitialized, snapshot.project.id, snapshot.canvas.items.length, timelineOpen]);
  return (
    <section
      ref={container}
      className={`canvas-shell ${timelineOpen ? 'compact' : ''}`}
      data-testid="canvas"
      aria-label="创作画布"
    >
      <div className="canvas-topline">
        <div className="canvas-heading">
          {timelineOpen ? (
            <Button kind="ghost" onClick={onBack}>
              <ArrowLeft size={15} />
              返回画布
            </Button>
          ) : (
            <>
              <LayoutGrid size={18} />
              <h2>创作画布</h2>
              <span className="canvas-count">{snapshot.canvas.items.length} 项</span>
            </>
          )}
        </div>
        <div className="canvas-actions">
          <Button onClick={onImport} disabled={busy}>
            <Plus size={15} />
            导入素材
          </Button>
          <Button kind="accent" onClick={onGenerate} disabled={busy}>
            <Aperture size={15} />
            生成镜头
          </Button>
        </div>
      </div>
      <div className="canvas-flow">
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) => setNodes((previous) => applyNodeChanges(changes, previous))}
          onNodeClick={(_, node) => onSelect(node.data.item)}
          onNodeDragStart={() => {
            dragging.current = true;
          }}
          onNodeDragStop={(_, node) => {
            dragging.current = false;
            void onSave(
              snapshot.canvas.items.map((item) =>
                item.id === node.id ? { ...item, x: node.position.x, y: node.position.y } : item,
              ),
            );
          }}
          minZoom={0.25}
          maxZoom={1.6}
          panOnScroll
          nodesDraggable={!busy}
          selectionOnDrag={false}
          nodesConnectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="#d4d4d8" gap={24} size={1} />
        </ReactFlow>
      </div>
      {!snapshot.canvas.items.length && !timelineOpen && (
        <div className="canvas-empty">
          <LayoutGrid size={32} />
          <h3>把镜头放在一起</h3>
          <p>
            导入参考素材，或生成一个镜头。
            <br />
            在左侧选择作品，开始剪辑。
          </p>
        </div>
      )}
      <div className="canvas-controls">
        <span>
          <MousePointer2 size={14} />
          拖动整理 · 滚动平移
        </span>
        <div>
          <IconButton label="缩小画布" onClick={() => void flow.zoomOut()}>
            <Minus size={16} />
          </IconButton>
          <IconButton label="放大画布" onClick={() => void flow.zoomIn()}>
            <Plus size={16} />
          </IconButton>
          <IconButton label="适应画布" onClick={fitCanvas}>
            <Maximize size={16} />
          </IconButton>
        </div>
      </div>
    </section>
  );
}
