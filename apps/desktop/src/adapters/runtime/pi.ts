import {fork} from 'node:child_process';
import type {HostToWorker,WorkerToHost,WorkerRun,WorkerResult,HostToolRequest,RuntimeEvent,HistoryUpdate} from '../../agent-worker/protocol.js';
export type {WorkerRun,WorkerResult,HostToolRequest,RuntimeEvent,HistoryUpdate,RunBudget,WorkerRole,HostToolName} from '../../agent-worker/protocol.js';

export interface WorkerProcess {
  on(event:'message'|'error'|'exit',listener:(...args:any[])=>void):unknown;
  send?(message:HostToWorker):unknown;postMessage?(message:HostToWorker):unknown;kill():unknown;
}
export interface PiRuntimeOptions {
  workerPath:string;spawn?:(path:string)=>WorkerProcess;
  onEvent:(event:RuntimeEvent)=>void;
  onTool:(request:HostToolRequest,signal:AbortSignal)=>Promise<unknown>;
  onHistory?:(update:HistoryUpdate)=>void|Promise<void>;
}
const emptyBudget={modelCalls:0,toolCalls:0,elapsedMs:0,maxModelCalls:12,maxToolCalls:24,maxDurationMs:120000};
/** Host bridge. stop() closes the host tool gate before asking the worker to abort. */
export class PiRuntime {
  private worker?:WorkerProcess;
  private active?:{run:WorkerRun;controller:AbortController;resolve:(result:WorkerResult)=>void;promise:Promise<WorkerResult>;history:Promise<void>;historyError?:string};
  constructor(private options:PiRuntimeOptions){}
  get isRunning():boolean{return !!this.active;}
  run(run:WorkerRun):Promise<WorkerResult> {
    if(this.active)throw new Error('An agent request is already running');
    if(!run.settings.apiKey.trim())throw new Error('Configure an Ark API key before starting an agent');
    if(!run.settings.agentModel.trim())throw new Error('Set an Ark chat model or endpoint ID in Settings');
    if(!run.text.trim()||run.text.length>24000)throw new Error('Agent prompt must be 1–24000 characters');
    this.ensureWorker();
    let resolve!:(result:WorkerResult)=>void;
    const promise=new Promise<WorkerResult>(r=>{resolve=r;});
    this.active={run,controller:new AbortController(),resolve,promise,history:Promise.resolve()};
    this.send({type:'run',run});return promise;
  }
  async stop():Promise<void> {
    const active=this.active;if(!active)return;
    active.controller.abort();this.send({type:'stop',runId:active.run.runId});
    let timer:ReturnType<typeof setTimeout>|undefined;
    await Promise.race([active.promise,new Promise<void>(resolve=>{timer=setTimeout(()=>{this.worker?.kill();this.worker=undefined;this.finishFailure('Agent stopped','stopped');resolve();},5000);})]);
    if(timer)clearTimeout(timer);
  }
  async dispose():Promise<void>{await this.stop();this.worker?.kill();this.worker=undefined;}
  private send(message:HostToWorker):void {
    try {if(this.worker?.postMessage)this.worker.postMessage(message);else this.worker?.send?.(message);}
    catch {this.finishFailure('Agent worker communication failed');}
  }
  private ensureWorker():void {
    if(this.worker)return;
    const worker=this.options.spawn?.(this.options.workerPath)??fork(this.options.workerPath,[],{
      stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced',
      env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},execArgv:[],
    });
    this.worker=worker;
    worker.on('message',(message:WorkerToHost)=>{void this.receive(message);});
    worker.on('error',()=>{if(this.worker!==worker)return;this.worker=undefined;this.finishFailure('Agent worker failed');});
    worker.on('exit',()=>{if(this.worker!==worker)return;this.worker=undefined;this.finishFailure('Agent worker exited unexpectedly');});
  }
  private async receive(message:WorkerToHost):Promise<void> {
    const active=this.active;if(!active||!message||typeof message!=='object')return;
    if(message.type==='event' && message.event.runId===active.run.runId) {
      if(!active.controller.signal.aborted)this.options.onEvent(message.event);return;
    }
    if(message.type==='history'&&message.update.runId===active.run.runId) {
      active.history=active.history.then(()=>this.options.onHistory?.(message.update)).catch(()=>{active.historyError='Could not persist agent history';});return;
    }
    if(message.type==='tool'&&message.request.runId===active.run.runId) {
      if(active.controller.signal.aborted){this.send({type:'tool.result',callId:message.callId,error:'Agent stopped; no new tool actions allowed'});return;}
      try {
        const result=await this.options.onTool(message.request,active.controller.signal);
        if(this.active!==active)return;
        this.send({type:'tool.result',callId:message.callId,...(active.controller.signal.aborted?{error:'Agent stopped'}:{result})});
      } catch(error){if(this.active===active)this.send({type:'tool.result',callId:message.callId,error:this.redact(error instanceof Error?error.message:'Host tool failed',active.run.settings.apiKey)});}
      return;
    }
    if(message.type==='settled'&&message.runId===active.run.runId) {
      await active.history;if(this.active!==active)return;
      this.active=undefined;
      const result=message.result;
      if(active.controller.signal.aborted){result.status='stopped';result.error='Stopped by user';}
      if(active.historyError){result.status='failed';result.error=active.historyError;}
      active.resolve(result);
    }
  }
  private redact(text:string,key:string):string{return key?text.split(key).join('[redacted]'):text;}
  private finishFailure(error:string,status:'failed'|'stopped'='failed'):void {
    const active=this.active;if(!active)return;active.controller.abort();this.active=undefined;
    void active.history.finally(()=>active.resolve({status,text:'',error,budget:emptyBudget,history:[]}));
  }
}
