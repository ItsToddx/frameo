import {WorkerEngine} from './engine.js';
import type {HostToWorker,WorkerToHost,HostToolRequest} from './protocol.js';

interface UtilityPort {on(event:'message',listener:(event:{data:HostToWorker})=>void):void;postMessage(message:WorkerToHost):void}
const port=(process as typeof process & {parentPort?:UtilityPort}).parentPort;
const send=(message:WorkerToHost)=>{if(port)port.postMessage(message);else process.send?.(message);};
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
let serial=0;
const engine=new WorkerEngine(send,(request:HostToolRequest,signal?:AbortSignal)=>new Promise((resolve,reject)=>{
  const callId=`${request.runId}:${++serial}`;
  const abort=()=>{pending.delete(callId);reject(new Error('Agent stopped'));};
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  pending.set(callId,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});
  send({type:'tool',callId,request});
}));
const receive=(message:HostToWorker)=>{
  if(message.type==='stop')engine.stop();
  if(message.type==='tool.result') {
    const call=pending.get(message.callId);if(!call)return;pending.delete(message.callId);call.cleanup();
    if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);
  }
  if(message.type==='run')void engine.run(message.run).then(result=>send({type:'settled',runId:message.run.runId,result}));
};
if(port)port.on('message',event=>receive(event.data));else process.on('message',message=>receive(message as HostToWorker));
process.on('disconnect',()=>{engine.stop();process.exit(0);});
send({type:'ready'});
