import type {RunBudget} from './protocol.js';
/** Every child session reserves from the same request budget before doing work. */
export class RequestBudget {
  private start=Date.now();private modelCalls=0;private toolCalls=0;private elapsedBefore=0;private reason?:string;
  readonly maxModelCalls:number; readonly maxToolCalls:number; readonly maxDurationMs:number;
  constructor(limits:{maxModelCalls?:number;maxToolCalls?:number;maxDurationMs?:number;previousBudget?:RunBudget}={}) {
    const bound=(value:number|undefined,max:number)=>Math.min(max,Math.max(1,Math.floor(Number.isFinite(value)?value!:max)));
    const previous=limits.previousBudget;
    this.maxModelCalls=Math.min(bound(limits.maxModelCalls,12),bound(previous?.maxModelCalls,12));
    this.maxToolCalls=Math.min(bound(limits.maxToolCalls,24),bound(previous?.maxToolCalls,24));
    this.maxDurationMs=Math.min(bound(limits.maxDurationMs,120000),bound(previous?.maxDurationMs,120000));
    const used=(value:number|undefined)=>Math.max(0,Math.ceil(Number.isFinite(value)?value!:0));
    this.modelCalls=used(previous?.modelCalls);this.toolCalls=used(previous?.toolCalls);this.elapsedBefore=used(previous?.elapsedMs);
  }
  get stopped():boolean{return this.reason!==undefined;}
  get stopReason():string|undefined{return this.reason;}
  stop(reason='Stopped by user'):void{this.reason??=reason;}
  check():void {
    if(this.elapsedBefore+Date.now()-this.start>=this.maxDurationMs)this.stop('Foreground reasoning time limit reached');
    if(this.reason)throw new Error(this.reason);
  }
  reserveModel():void{this.check();if(this.modelCalls>=this.maxModelCalls){this.stop('Model request budget reached');this.check();}this.modelCalls++;}
  reserveTool():void{this.check();if(this.toolCalls>=this.maxToolCalls){this.stop('Tool call budget reached');this.check();}this.toolCalls++;}
  snapshot():RunBudget{return {modelCalls:this.modelCalls,toolCalls:this.toolCalls,elapsedMs:this.elapsedBefore+Date.now()-this.start,maxModelCalls:this.maxModelCalls,maxToolCalls:this.maxToolCalls,maxDurationMs:this.maxDurationMs};}
}
