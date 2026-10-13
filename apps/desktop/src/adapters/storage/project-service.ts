import { EditSequence, validateSequence, type EditSequenceStore, type HistoryRequest, type StoredEditReceipt } from '../../../../../packages/core/src/index';
import type { CanvasItem, EditCommand, Memory, ProjectSnapshot, Sequence } from '../contracts/api';
import { AppDatabase, ProjectDatabase, id, now, digest } from './database';

export class ProjectService {
  constructor(readonly database:ProjectDatabase,private readonly app:AppDatabase) {}
  snapshot():ProjectSnapshot {return this.database.snapshot(this.app.memories());}
  createSequence(input:{name:string;width:number;height:number;fps:number}):ProjectSnapshot {
    this.database.transaction(state=>{const sequence:Sequence={id:id(),name:input.name,revision:0,width:input.width,height:input.height,fps:input.fps,tracks:[{id:id(),name:'画面',kind:'video',muted:false,locked:false},{id:id(),name:'声音',kind:'audio',muted:false,locked:false}],clips:[],captions:[]};validateSequence(sequence,state.assets);state.sequences.push(sequence);state.canvas.items.push({id:id(),kind:'sequence',refId:sequence.id,x:180,y:140+state.sequences.length*70,width:480,height:300});state.canvas.revision++;},'sequence.created');return this.snapshot();
  }
  private editor():EditSequence {
    const store:EditSequenceStore={transaction:work=>this.database.transaction(state=>work({
      getSequence:sequenceId=>state.sequences.find(sequence=>sequence.id===sequenceId),getAssets:()=>state.assets,
      getHistory:sequenceId=>({undo:(state.undo[sequenceId]??[]).map(entry=>({id:entry.commandId,before:entry.before,after:entry.after})),redo:(state.redo[sequenceId]??[]).map(entry=>({id:entry.commandId,before:entry.before,after:entry.after}))}),
      getReceipt:commandId=>this.database.storedReceipt<StoredEditReceipt>(commandId),
      commit:({sequence,history,receipt})=>{const index=state.sequences.findIndex(saved=>saved.id===sequence.id);state.sequences[index]=sequence;state.undo[sequence.id]=history.undo.map(entry=>({commandId:entry.id,before:entry.before,after:entry.after}));state.redo[sequence.id]=history.redo.map(entry=>({commandId:entry.id,before:entry.before,after:entry.after}));const {kind,...payload}=JSON.parse(receipt.requestKey);this.database.saveReceipt(receipt.commandId,kind==='apply'?payload:{kind,...payload},receipt);}
    }),'sequence.changed')};return new EditSequence(store);
  }
  apply(input:{sequenceId:string;expectedRevision:number;commandId:string;commands:EditCommand[]}):ProjectSnapshot {
    if(this.database.receipt(input.commandId,input))return this.snapshot();this.editor().apply(input);return this.snapshot();
  }
  history(input:HistoryRequest|string,kind:'undo'|'redo'):ProjectSnapshot {
    const request=typeof input==='string'?{sequenceId:input,expectedRevision:this.snapshot().sequences.find(sequence=>sequence.id===input)?.revision??0,commandId:id()}:input;
    if(this.database.receipt(request.commandId,{kind,...request}))return this.snapshot();this.editor()[kind](request);return this.snapshot();
  }
  saveCanvas(input:{expectedRevision:number;items:CanvasItem[]}):ProjectSnapshot {
    this.database.transaction(state=>{
      if(state.canvas.revision!==input.expectedRevision)throw new Error('画布已变化，请重新读取。');
      const seen=new Set<string>();for(const item of input.items){if(seen.has(item.id))throw new Error('画布卡片 ID 重复。');seen.add(item.id);if(item.kind==='asset'&&!state.assets.some(a=>a.id===item.refId)||item.kind==='sequence'&&!state.sequences.some(s=>s.id===item.refId))throw new Error('画布引用的内容不存在。');}
      state.canvasUndo.push({...structuredClone(state.canvas),afterIds:input.items.map(item=>item.id)});state.canvasRedo=[];state.canvas={revision:state.canvas.revision+1,items:input.items};
    },'canvas.changed');return this.snapshot();
  }
  undoCanvas():ProjectSnapshot {
    this.database.transaction(state=>{const last=state.canvasUndo.pop();if(!last)throw new Error('没有可撤销的画布修改。');
      // Preserve cards projected by jobs/assets after that layout edit.
      const ids=new Set(last.afterIds??last.items.map(item=>item.id));const late=state.canvas.items.filter(item=>!ids.has(item.id)&&item.kind==='asset');
      state.canvasRedo.push(structuredClone(state.canvas));state.canvas={revision:state.canvas.revision+1,items:[...last.items,...late]};
    },'canvas.changed');return this.snapshot();
  }
  saveMemory(input:{id?:string;scope:'project'|'user';content:string;expectedRevision?:number}):ProjectSnapshot {
    if(/\b(?:sk-[a-zA-Z0-9]{16,}|Bearer\s+[a-zA-Z0-9._-]{16,})\b/.test(input.content))throw new Error('记忆不能包含账户密钥。');
    const update=(memories:Memory[])=>{const found=input.id?memories.find(m=>m.id===input.id):undefined;if(input.id&&!found)throw new Error('记忆不存在。');if(found){if(found.revision!==input.expectedRevision)throw new Error('记忆已被修改，请重新读取。');found.content=input.content;found.revision++;}else memories.push({id:id(),scope:input.scope,content:input.content,revision:0,createdAt:now()});};
    if(input.scope==='user'){const memories=this.app.memories();update(memories);this.app.set('memories',memories);}else this.database.transaction(state=>update(state.memories),'memory.changed');return this.snapshot();
  }
  deleteMemory(input:{id:string;scope:'project'|'user';expectedRevision:number}):ProjectSnapshot {
    const remove=(memories:Memory[])=>{const index=memories.findIndex(m=>m.id===input.id);if(index<0)throw new Error('记忆不存在。');if(memories[index].revision!==input.expectedRevision)throw new Error('记忆已被修改，请重新读取。');memories.splice(index,1);};
    if(input.scope==='user'){const memories=this.app.memories();remove(memories);this.app.set('memories',memories);}else this.database.transaction(state=>remove(state.memories),'memory.changed');return this.snapshot();
  }
}
