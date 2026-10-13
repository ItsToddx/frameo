import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assertJsonValue,manifestSchema} from '../../../../../packages/kit-sdk/src/index.js';
import type {KitManifest,JsonValue,ToolContext} from '../../../../../packages/kit-sdk/src/index.js';
import type {CodeKitResult,KitLoadResult,HostToKitWorker,KitWorkerToHost} from '../../kit-worker/protocol.js';
export {codeKitDigest} from '../../kit-worker/files.js';
export type {CodeKitResult,KitLoadResult} from '../../kit-worker/protocol.js';
export interface CodeKitProcess {
  on(event:'message'|'error'|'exit',listener:(...args:any[])=>void):unknown;
  send?(message:HostToKitWorker):unknown;postMessage?(message:HostToKitWorker):unknown;kill():unknown;
}
export interface CodeKitRuntimeOptions {workerPath:string;spawn?:(path:string)=>CodeKitProcess;timeoutMs?:number}
/** An explicit trusted-code boundary, not an OS sandbox. Never call load before host trust review. */
export class CodeKitRuntime {
  private worker?:CodeKitProcess;private loaded=false;
  private pending=new Map<string,{resolve:(result:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
  constructor(private options:CodeKitRuntimeOptions){}
  async load(directory:string,manifest:KitManifest,options:{dependencies?:KitManifest[];expectedDigest?:string}={}):Promise<KitLoadResult> {
    if(this.loaded||this.worker)throw new Error('A native runtime loads one Kit only');
    manifestSchema.parse(manifest);if(!manifest.entry)throw new Error('Native Kit entry is missing');
    this.ensureWorker();
    try {const result=await this.request({type:'load',callId:randomUUID(),directory,manifest,dependencies:options.dependencies??[],expectedDigest:options.expectedDigest});this.loaded=true;return result as KitLoadResult;}
    catch(error){this.dispose();throw error;}
  }
  async invoke(capabilityId:string,input:JsonValue,context:ToolContext):Promise<CodeKitResult> {
    if(!this.loaded)throw new Error('Code Kit is not loaded');context.signal.throwIfAborted();assertJsonValue(input);
    const {signal}=context;const portable={projectId:context.projectId,snapshot:context.snapshot,
      ...(context.sequenceId!==undefined?{sequenceId:context.sequenceId}:{}),...(context.revision!==undefined?{revision:context.revision}:{})};assertJsonValue(portable,1024*1024);
    return await this.request({type:'invoke',callId:randomUUID(),capabilityId,input,context:portable},signal) as CodeKitResult;
  }
  dispose():void {
    const worker=this.worker;this.worker=undefined;this.loaded=false;
    this.rejectAll(new Error('Code Kit was disposed'));try{if(worker?.postMessage)worker.postMessage({type:'dispose'});else worker?.send?.({type:'dispose'});}catch{}
    worker?.kill();
  }
  private request(message:Extract<HostToKitWorker,{type:'load'|'invoke'}>,signal?:AbortSignal):Promise<unknown> {
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.send({type:'abort',callId:message.callId});finish(new Error('Code Kit operation stopped'));};
      const timer=setTimeout(()=>{finish(new Error('Code Kit operation timed out'));this.dispose();},this.options.timeoutMs??30000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const finish=(error:Error)=>{const call=this.pending.get(message.callId);if(!call)return;this.pending.delete(message.callId);call.cleanup();call.reject(error);};
      this.pending.set(message.callId,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}this.send(message);
    });
  }
  private send(message:HostToKitWorker):void {
    try{if(this.worker?.postMessage)this.worker.postMessage(message);else this.worker?.send?.(message);}
    catch{this.rejectAll(new Error('Code Kit communication failed'));}
  }
  private ensureWorker():void {
    const worker=this.options.spawn?.(this.options.workerPath)??fork(this.options.workerPath,[],{stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced',execArgv:[],
      env:{PATH:process.env.PATH,LANG:process.env.LANG,TMPDIR:process.env.TMPDIR,ELECTRON_RUN_AS_NODE:'1'}});
    this.worker=worker;
    worker.on('message',(message:KitWorkerToHost)=>{
      if(!message||message.type==='ready')return;const call=this.pending.get(message.callId);if(!call)return;
      this.pending.delete(message.callId);call.cleanup();
      if(message.type==='error')call.reject(new Error(message.error));else {try{assertJsonValue(message.result);call.resolve(message.result);}catch(error){call.reject(error as Error);}}
    });
    worker.on('exit',()=>{if(this.worker!==worker)return;this.worker=undefined;this.loaded=false;this.rejectAll(new Error('Code Kit worker exited'));});
    worker.on('error',()=>{if(this.worker!==worker)return;this.worker=undefined;this.loaded=false;this.rejectAll(new Error('Code Kit worker failed'));});
  }
  private rejectAll(error:Error):void {for(const call of this.pending.values()){call.cleanup();call.reject(error);}this.pending.clear();}
}
