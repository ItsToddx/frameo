import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type ServerResponse} from 'node:http';
import {once,EventEmitter} from 'node:events';
import {WorkerEngine,boundContext} from '../apps/desktop/src/agent-worker/engine.js';
import {RequestBudget} from '../apps/desktop/src/agent-worker/budget.js';
import {PiRuntime,type WorkerProcess} from '../apps/desktop/src/adapters/runtime/pi.js';
import type {WorkerRun,WorkerToHost,HostToWorker,HostToolRequest} from '../apps/desktop/src/agent-worker/protocol.js';
import type {AgentMessage} from '@mariozechner/pi-agent-core';

function runInput(baseUrl:string):WorkerRun {
  return {runId:'run-fixture',sessionId:'session-fixture',rootRequestId:'root-fixture',text:'Create a product shot',
    settings:{arkBaseUrl:baseUrl,agentModel:'fixture-model',apiKey:'fixture-key'},
    context:{snapshot:{project:{id:'p1',name:'Fixture',path:'/ignored',createdAt:'',updatedAt:''},sequences:[],assets:[],canvas:{revision:0,items:[]},jobs:[],sessions:[],memories:[],reviews:[],recipes:[],canUndo:{},canRedo:{},eventSeq:0}}};
}
function sse(res:ServerResponse,content:string|{name:string;args:unknown},id:string) {
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=typeof content==='string'?{content}:{tool_calls:[{index:0,id,type:'function',function:{name:content.name,arguments:JSON.stringify(content.args)}}]};
  res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
  res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta:{},finish_reason:typeof content==='string'?'stop':'tool_calls'}]})}\n\n`);
  res.end('data: [DONE]\n\n');
}
test('real Pi uses independent specialist sessions and one shared model/tool budget',async t=>{
  const requests:Array<Record<string,unknown>>=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push(JSON.parse(body));assert.equal(req.url,'/api/v3/chat/completions');
    const n=requests.length;
    if(n===1)sse(res,{name:'delegate',args:{role:'visual',task:'Prepare one reviewed Seedance shot'}},'delegate-1');
    else if(n===2)sse(res,{name:'propose_generation',args:{prompt:'A product rotates',duration:5,ratio:'16:9',estimatedCost:1,title:'Product shot',description:'One shot'}},'generate-1');
    else sse(res,n===3?'A generation review is pending.':'Please accept the shot review to start generation.',`response-${n}`);
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const tools:HostToolRequest[]=[],events:WorkerToHost[]=[];
  const engine=new WorkerEngine(message=>events.push(message),async request=>{tools.push(request);return {reviewId:'review-1',status:'pending'};});
  const result=await engine.run(runInput(`http://127.0.0.1:${address.port}/api/v3`));
  assert.equal(result.status,'completed',result.error);assert.equal(result.budget.modelCalls,4);assert.equal(result.budget.toolCalls,2);
  assert.equal(tools.length,1);assert.equal(tools[0].name,'propose_generation');assert.equal(tools[0].rootRequestId,'root-fixture');
  assert.match(tools[0].sessionId,/session-fixture:visual:/);assert.equal(tools[0].role,'visual');
  assert.ok(events.some(e=>e.type==='history'&&e.update.role==='visual'));
  assert.ok(events.some(e=>e.type==='event'&&e.event.type==='chat.delta'));
  assert.ok(requests[1].tools && !(requests[1].tools as Array<{function:{name:string}}>).some(t=>t.function.name==='delegate'));
});
test('a restored request budget does not grant more model calls on recipe resume',()=>{
  const previous=new RequestBudget({maxModelCalls:2});previous.reserveModel();previous.reserveTool();previous.reserveModel();
  const restored=new RequestBudget({maxModelCalls:12,previousBudget:previous.snapshot()});
  assert.throws(()=>restored.reserveModel(),/budget reached/);assert.equal(restored.snapshot().modelCalls,2);assert.equal(restored.snapshot().toolCalls,1);
  const nan=new RequestBudget({maxModelCalls:NaN});assert.equal(nan.maxModelCalls,12);
});
test('Pi authentication failure sends one request and reports failure without provider retry',async t=>{
  let count=0;
  const server=createServer((_req,res)=>{count++;res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Invalid account',type:'authentication_error'}}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const result=await new WorkerEngine(()=>{},async()=>({})).run(runInput(`http://127.0.0.1:${address.port}/api/v3`));
  assert.equal(result.status,'failed');assert.equal(count,1);assert.equal(result.budget.modelCalls,1);assert.ok(result.error);
});
test('host stop closes tool execution immediately and settles the worker response as stopped',async()=>{
  class FakeWorker extends EventEmitter implements WorkerProcess {
    sent:HostToWorker[]=[];send(m:HostToWorker){this.sent.push(m);}kill(){this.emit('exit',0);}
  }
  const worker=new FakeWorker();let toolCount=0;
  const runtime=new PiRuntime({workerPath:'fixture',spawn:()=>worker,onEvent:()=>{},onTool:async()=>{toolCount++;return {};}});
  const run=runInput('https://ark.cn-beijing.volces.com/api/v3');const result=runtime.run(run);const stop=runtime.stop();
  worker.emit('message',{type:'tool',callId:'late',request:{runId:run.runId,sessionId:run.sessionId,rootRequestId:run.rootRequestId,role:'coordinator',toolCallId:'late',name:'read_project',args:{}}});
  assert.equal(toolCount,0);assert.equal(worker.sent.at(-1)?.type,'tool.result');
  worker.emit('message',{type:'settled',runId:run.runId,result:{status:'completed',text:'',history:[],budget:new RequestBudget().snapshot()}});
  assert.equal((await result).status,'stopped');await stop;await runtime.dispose();
});
test('bounded model context preserves assistant/tool pairs and leaves persisted history intact',()=>{
  const history:AgentMessage[]=[{role:'user',content:'x'.repeat(80000),timestamp:1},{role:'user',content:'Current task',timestamp:2}];
  const before=structuredClone(history);const bounded=boundContext(history);
  assert.deepEqual(history,before);assert.ok(JSON.stringify(bounded).length<60000);assert.equal(bounded.at(-1),history.at(-1));
});
