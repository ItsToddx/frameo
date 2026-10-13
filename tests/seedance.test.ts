import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SeedanceProvider,SeedanceError,seedancePayload} from '../apps/desktop/src/adapters/runtime/seedance.js';

const input={model:'doubao-seedance-2-5-260628',prompt:'A glass bottle rotates in warm light',duration:5,ratio:'16:9' as const};
function fixture(responses:Array<unknown|Error|{httpStatus:number;body:unknown}>) {
  const calls:Array<{url:string;method:string;body:unknown}>=[];
  const fetcher=(async(url:unknown,options:RequestInit)=>{
    calls.push({url:String(url),method:options.method!,body:options.body?JSON.parse(String(options.body)):null});
    const next=responses.shift();if(next instanceof Error)throw next;
    if(next && typeof next==='object' && 'httpStatus' in next){const response=next as {httpStatus:number;body:unknown};return Response.json(response.body,{status:response.httpStatus});}
    return Response.json(next);
  }) as typeof fetch;
  return {provider:new SeedanceProvider({baseUrl:'https://ark.cn-beijing.volces.com/api/v3',apiKey:'test-secret',fetch:fetcher}),calls};
}
test('Seedance submits the reviewed input once, maps data URL references and returns only task ID',async()=>{
  const {provider,calls}=fixture([{id:'cgt-fixture-1'}]);
  assert.deepEqual(await provider.submit({...input,referenceImageDataUrl:'data:image/png;base64,YQ=='}),{remoteId:'cgt-fixture-1'});
  assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].url,'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
  assert.deepEqual(calls[0].body,{model:input.model,content:[{type:'text',text:input.prompt},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='},role:'reference_image'}],duration:5,ratio:'16:9',watermark:true,generate_audio:true});
});
test('lost submit response, server errors and malformed receipts are unknown and never retried',async()=>{
  for(const response of [new Error('network'),{httpStatus:503,body:{error:{message:'server'}}},{accepted:true}]) {
    const {provider,calls}=fixture([response]);
    await assert.rejects(provider.submit(input),(error:unknown)=>error instanceof SeedanceError&&error.kind==='unknown');
    assert.equal(calls.length,1);
  }
});
test('validation and an already-aborted signal do not send a paid request',async()=>{
  const {provider,calls}=fixture([]);
  await assert.rejects(provider.submit({...input,duration:31}));
  await assert.rejects(provider.submit(input,AbortSignal.abort()));assert.equal(calls.length,0);
  assert.throws(()=>seedancePayload({...input,referenceImageDataUrl:'file:///private.png'}));
});
test('authentication rejection stays rejected and hides the API key',async()=>{
  const {provider}=fixture([{httpStatus:401,body:{error:{code:'Unauthorized',message:'Invalid key test-secret'}}}]);
  await assert.rejects(provider.submit(input),(error:unknown)=>error instanceof SeedanceError&&error.kind==='rejected'&&!error.message.includes('test-secret'));
});
test('status resolves the video URL, maps expiry, and rejects mismatched task IDs',async()=>{
  const {provider}=fixture([{id:'cgt-ok',status:'succeeded',content:{video_url:'https://example.com/output.mp4'}},{status:'expired'},{id:'cgt-other',status:'running'}]);
  assert.deepEqual(await provider.status('cgt-ok'),{status:'succeeded',outputUrl:'https://example.com/output.mp4'});
  assert.equal((await provider.status('cgt-expired')).status,'failed');
  await assert.rejects(provider.status('cgt-mismatch'),/wrong task/);
});
test('cancel never DELETEs a running or terminal task; queued cancellation requires status confirmation',async()=>{
  for(const status of ['running','succeeded','failed']) {
    const {provider,calls}=fixture([{status,...(status==='succeeded'?{content:{video_url:'https://example.com/v.mp4'}}:{})}]);
    assert.deepEqual(await provider.cancel('cgt-keep'),{acknowledged:false,status});assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
  }
  const {provider,calls}=fixture([{status:'queued'},{},{status:'cancelled'}]);
  assert.deepEqual(await provider.cancel('cgt-cancel'),{acknowledged:true,status:'cancelled'});
  assert.deepEqual(calls.map(c=>c.method),['GET','DELETE','GET']);
});
