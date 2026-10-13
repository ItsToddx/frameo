import { useEffect, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, applyNodeChanges, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { Aperture, Film, Image, Music2, Maximize, Plus, Minus, X, ArrowDownToLine, LayoutGrid, MousePointer2 } from 'lucide-react';
import type { Asset, CanvasItem, ProjectSnapshot, Sequence } from '../adapters/contracts/api';
import { Button, IconButton, timecode } from './ui';

type CardData = {item: CanvasItem; asset?: Asset; sequence?: Sequence; selected: boolean; onOpen: (item: CanvasItem) => void; onHide: (id: string) => void; onAdd: (asset: Asset) => void};
type CardNode = Node<CardData, 'card'>;
function Card({data}: NodeProps<CardNode>) {
  const {item,asset,sequence} = data;
  const duration = sequence ? Math.max(0,...sequence.clips.map(c => (c.start+c.duration)/sequence.fps)) : asset?.duration || 0;
  return <article className={`canvas-card ${data.selected?'selected':''} ${sequence?'sequence-card':''}`} data-testid={sequence?'sequence-card':'asset-card'} onDoubleClick={() => data.onOpen(item)}>
    <div className="card-media" onClick={() => data.onOpen(item)}>
      {asset?.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={asset.name} draggable={false}/> : asset?.kind === 'image' ? <img src={asset.url} alt={asset.name} draggable={false}/> : <div className="card-placeholder">{sequence?<Aperture size={40}/>:asset?.kind==='audio'?<Music2 size={36}/>:<Film size={36}/>}</div>}
      <span className="card-kind">{sequence?'作品':asset?.kind==='video'?'视频':asset?.kind==='audio'?'音频':'图片'}</span>
      {!!duration&&<span className="card-duration">{timecode(duration)}</span>}
      <button className="card-hide nodrag" title="从画布隐藏，保留素材" aria-label="从画布隐藏" onClick={e => {e.stopPropagation();data.onHide(item.id);}}><X size={14}/></button>
    </div>
    <div className="card-info"><div><strong>{sequence?.name||asset?.name||'素材不可用'}</strong><span>{sequence?`${sequence.width} × ${sequence.height} · ${sequence.fps} fps`:asset?.width?`${asset.width} × ${asset.height}`:'声音素材'}</span></div>{asset&&<button className="card-add nodrag" title="加入作品" aria-label={`将 ${asset.name} 加入作品`} onClick={() => data.onAdd(asset)}><Plus size={16}/></button>}{sequence&&<span className="sequence-revision">v{sequence.revision}</span>}</div>
    {sequence&&<div className="sequence-footer"><span>{sequence.clips.length} 个片段</span><span>点击展开时间线 <ArrowDownToLine size={12}/></span></div>}
  </article>;
}
const nodeTypes = {card: Card};
export function Canvas(props: {snapshot: ProjectSnapshot; selection: string|null; timelineOpen: boolean; onSelect: (item: CanvasItem) => void; onSave: (items: CanvasItem[]) => Promise<void>; onHide: (id: string) => void; onAdd: (asset: Asset) => void; onGenerate: () => void; onImport: () => void; busy: boolean}) {return <ReactFlowProvider><CanvasInner {...props}/></ReactFlowProvider>;}
function CanvasInner({snapshot,selection,timelineOpen,onSelect,onSave,onHide,onAdd,onGenerate,onImport,busy}: Parameters<typeof Canvas>[0]) {
  const [nodes,setNodes] = useState<CardNode[]>([]);
  const dragging = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const fitCanvas = () => {
    const bounds = container.current;
    if(!bounds||!snapshot.canvas.items.length)return;
    const items = snapshot.canvas.items;
    const left = Math.min(...items.map(item=>item.x));
    const top = Math.min(...items.map(item=>item.y));
    const width = Math.max(...items.map(item=>item.x+260))-left;
    const height = Math.max(...items.map(item=>item.y+(item.kind==='sequence'?235:210)))-top;
    const availableHeight=Math.max(120,bounds.clientHeight-160);
    const zoom=Math.min(1,Math.max(0.25,Math.min((bounds.clientWidth-90)/width,availableHeight/height)));
    void flow.setViewport({x:(bounds.clientWidth-width*zoom)/2-left*zoom,y:100+(availableHeight-height*zoom)/2-top*zoom,zoom},{duration:150});
  };
  const fitRef = useRef(fitCanvas);fitRef.current=fitCanvas;
  useEffect(() => {
    if(dragging.current) return;
    setNodes(snapshot.canvas.items.map(item => ({id:item.id,type:'card',position:{x:item.x,y:item.y},selected:item.refId===selection,style:{width:260},data:{item,asset:snapshot.assets.find(a => a.id===item.refId),sequence:snapshot.sequences.find(s=>s.id===item.refId),selected:item.refId===selection,onOpen:onSelect,onHide,onAdd}})));
  },[snapshot,selection,onSelect,onHide,onAdd]);
  useEffect(() => {
    if(!flow.viewportInitialized)return;
    const timer = setTimeout(() => fitRef.current(),80);
    return () => clearTimeout(timer);
  },[flow.viewportInitialized,snapshot.project.id,snapshot.canvas.items.length,timelineOpen]);
  return <div ref={container} className="canvas-shell" data-testid="canvas">
    <div className="canvas-topline"><div><span className="eyebrow">创作画布</span><h2>{snapshot.project.name}</h2><p>整理素材，让每一个镜头各就其位。</p></div><div className="canvas-actions"><Button onClick={onImport} disabled={busy}><Plus size={14}/>导入素材</Button><Button kind="accent" onClick={onGenerate} disabled={busy}><Aperture size={14}/>生成视频</Button></div></div>
    <ReactFlow nodes={nodes} nodeTypes={nodeTypes} onNodesChange={changes=>setNodes(prev=>applyNodeChanges(changes,prev))} onNodeClick={(_,node)=>onSelect(node.data.item)} onNodeDragStart={()=>{dragging.current=true;}} onNodeDragStop={(_,node)=>{dragging.current=false;void onSave(snapshot.canvas.items.map(item=>item.id===node.id?{...item,x:node.position.x,y:node.position.y}:item));}} fitView fitViewOptions={{padding:0.4,maxZoom:1}} minZoom={0.25} maxZoom={1.6} panOnScroll nodesDraggable={!busy} selectionOnDrag={false} nodesConnectable={false} deleteKeyCode={null} proOptions={{hideAttribution:true}}>
      <Background variant={BackgroundVariant.Dots} color="#373731" gap={24} size={1}/>
    </ReactFlow>
    {!snapshot.canvas.items.length&&<div className="canvas-empty"><div className="canvas-empty-art"><LayoutGrid size={35}/><span><Image size={17}/></span><span><Film size={17}/></span></div><h3>你的故事，从这里开始</h3><p>导入参考素材，或用 Seedance 生成第一个镜头。<br/>选中作品，即可展开时间线。</p><Button onClick={onImport} disabled={busy}><Plus size={15}/>导入素材</Button></div>}
    <div className="canvas-controls"><span><MousePointer2 size={13}/>拖动卡片 · 滚动平移</span><div><IconButton label="缩小画布" onClick={()=>void flow.zoomOut()}><Minus size={15}/></IconButton><IconButton label="放大画布" onClick={()=>void flow.zoomIn()}><Plus size={15}/></IconButton><IconButton label="适应画布" onClick={fitCanvas}><Maximize size={15}/></IconButton></div>{busy&&<span className="saving-dot">保存中</span>}</div>
  </div>;
}
