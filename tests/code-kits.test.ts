import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {CodeKitEngine} from '../apps/desktop/src/kit-worker/engine.js';
import {CodeKitRuntime,codeKitDigest} from '../apps/desktop/src/adapters/runtime/code-kits.js';
import {compileSchema} from '../packages/kit-sdk/src/index.js';
import type {KitManifest,ToolContext} from '../packages/kit-sdk/src/index.js';

const manifest:KitManifest={schemaVersion:1,id:'fixture.code-kit',name:'Fixture native Kit',version:'1.0.0',description:'Trusted contract fixture',
  author:'Reelbeam tests',license:'Apache-2.0',hostApi:'1',source:'fixture',permissions:['project.read','project.propose'],dependencies:{},entry:'entry.mjs',
  capabilities:[{id:'fixture.read',kind:'read'},{id:'fixture.edit',kind:'edit'},{id:'fixture.job',kind:'job'}]};
const source=`import { title } from './helper.mjs';
const descriptor=(id,kind)=>({id,name:title,kind,description:'fixture tool',permissions:['project.read','project.propose'],
  inputSchema:{type:'object',properties:{text:{type:'string',minLength:1},mode:{type:'string'}},required:['text'],additionalProperties:false},outputSchema:{type:'object'}});
export function register(api) {
  api.registerReadTool({descriptor:descriptor('fixture.read','read'),async execute(input,ctx){
    if(input.mode==='exit')process.exit(9);
    if(input.mode==='hang')await new Promise(()=>{});
    if(input.mode==='wait')await new Promise((resolve,reject)=>ctx.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));
    return {value:{text:input.text,projectId:ctx.projectId,hasSecret:!!process.env.REELBEAM_TEST_SECRET},artifacts:[]};
  }});
  api.registerEditTool({descriptor:descriptor('fixture.edit','edit'),async propose(input,ctx){return {sequenceId:input.mode==='wrong'?'wrong':ctx.sequenceId,expectedRevision:ctx.revision,
    title:input.text,commands:[{type:'upsertCaption',caption:{id:'c1',text:input.text,start:0,duration:1,fontSize:32,color:'#ffffff',position:'bottom'}}]};}});
  api.registerJobTool({descriptor:descriptor('fixture.job','job'),async plan(input){return {providerId:'reelbeam.seedance',input:{prompt:input.text,duration:5,ratio:'16:9'},estimatedCost:1,title:input.text};}});
}`;
async function fixture(t:{after:(fn:()=>unknown)=>void}) {
  const directory=await mkdtemp(join(tmpdir(),'reelbeam-code-kit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'kit.manifest.json'),JSON.stringify(manifest));await writeFile(join(directory,'entry.mjs'),source);await writeFile(join(directory,'helper.mjs'),"export const title='Fixture tool';\n");
  return directory;
}
function context(signal=new AbortController().signal):ToolContext{return {projectId:'p1',sequenceId:'s1',revision:3,snapshot:{sequences:[]},signal};}
test('native worker loads reviewed relative modules, validates tools, and returns proposals',async t=>{
  const directory=await fixture(t),scratch=await mkdtemp(join(tmpdir(),'reelbeam-worker-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const workerPath=join(scratch,'kit-worker.mjs');
  await build({entryPoints:[resolve('apps/desktop/src/kit-worker/worker.ts')],outfile:workerPath,bundle:true,platform:'node',format:'esm',target:'node22'});
  const runtime=new CodeKitRuntime({workerPath,timeoutMs:5000});t.after(()=>runtime.dispose());
  process.env.REELBEAM_TEST_SECRET='not-for-kits';t.after(()=>{delete process.env.REELBEAM_TEST_SECRET;});
  const loaded=await runtime.load(directory,manifest,{expectedDigest:await codeKitDigest(directory)});
  assert.equal(loaded.descriptors.length,3);assert.equal(loaded.agents.length,0);
  const read=await runtime.invoke('fixture.read',{text:'Product'},context());assert.ok('value' in read);
  assert.deepEqual(read.value,{text:'Product',projectId:'p1',hasSecret:false});
  const edit=await runtime.invoke('fixture.edit',{text:'Product'},context());assert.ok('commands' in edit);assert.equal(edit.expectedRevision,3);
  const job=await runtime.invoke('fixture.job',{text:'Product'},context());assert.ok('providerId' in job);assert.equal(job.providerId,'reelbeam.seedance');
  await assert.rejects(runtime.invoke('fixture.read',{text:'',extra:true},context()),/schema validation/);
  await assert.rejects(runtime.invoke('fixture.edit',{text:'Product',mode:'wrong'},context()),/target/);
  const controller=new AbortController();const waiting=runtime.invoke('fixture.read',{text:'Wait',mode:'wait'},context(controller.signal));controller.abort();await assert.rejects(waiting,/stopped/);
  const deadline=Date.now()+3000;while(runtime.isStopping&&Date.now()<deadline)await delay(10);
  assert.equal(runtime.isStopping,false);await assert.rejects(runtime.invoke('fixture.read',{text:'Crash',mode:'exit'},context()),/exited/);
  await assert.rejects(runtime.invoke('fixture.read',{text:'After crash'},context()),/not loaded/);
});
test('noncooperative native tool is terminated after cancellation grace period',async t=>{
  const directory=await fixture(t),scratch=await mkdtemp(join(tmpdir(),'reelbeam-worker-'));t.after(()=>rm(scratch,{recursive:true,force:true}));
  const workerPath=join(scratch,'kit-worker.mjs');await build({entryPoints:[resolve('apps/desktop/src/kit-worker/worker.ts')],outfile:workerPath,bundle:true,platform:'node',format:'esm',target:'node22'});
  const runtime=new CodeKitRuntime({workerPath,timeoutMs:5000,cancelGraceMs:30});t.after(()=>runtime.dispose());await runtime.load(directory,manifest);
  const controller=new AbortController(),pending=runtime.invoke('fixture.read',{text:'Never finishes',mode:'hang'},context(controller.signal));
  controller.abort();await assert.rejects(pending,/stopped/);
  const deadline=Date.now()+3000;while(runtime.isLoaded&&Date.now()<deadline)await delay(10);
  assert.equal(runtime.isLoaded,false);assert.equal(runtime.isStopping,false);
});
test('native code is not evaluated before digest, manifest and dependency verification',async t=>{
  const directory=await fixture(t),engine=new CodeKitEngine();
  await assert.rejects(engine.load(directory,manifest,[],'wrong-digest'),/changed since/);
  await assert.rejects(engine.load(directory,{...manifest,name:'tampered'}),/reviewed manifest/);
  const missing={...manifest,dependencies:{'missing.kit':'1.0.0'}};
  await writeFile(join(directory,'kit.manifest.json'),JSON.stringify(missing));
  await assert.rejects(engine.load(directory,missing),/dependency/);
});
test('native package traversal and symlinks fail validation',async t=>{
  const directory=await fixture(t);
  await assert.rejects(new CodeKitEngine().load(directory,{...manifest,entry:'../escape.mjs'}));
  await symlink(join(directory,'entry.mjs'),join(directory,'link.mjs'));
  await assert.rejects(codeKitDigest(directory),/symlinks/);
});
test('native schemas reject extra fields, nonfinite data, unsupported external refs and invalid outputs',async t=>{
  const validate=compileSchema({type:'object',properties:{cost:{type:'number',minimum:0}},required:['cost'],additionalProperties:false});
  assert.deepEqual(validate({cost:2}),{cost:2});assert.throws(()=>validate({cost:NaN}),/finite/);assert.throws(()=>validate({cost:1,secret:'x'}),/schema validation/);
  assert.throws(()=>compileSchema({$ref:'https://unreviewed.example/schema.json'}));
  const directory=await fixture(t);await writeFile(join(directory,'entry.mjs'),source.replace('estimatedCost:1','estimatedCost:Infinity'));
  const engine=new CodeKitEngine();await engine.load(directory,manifest);t.after(()=>engine.dispose());
  const {signal,...portable}=context();await assert.rejects(engine.invoke('fixture.job',{text:'Invalid'},portable,signal));
});
test('shipped caption-case code Kit works without private host APIs',async t=>{
  const directory=resolve('kits/examples/caption-case'),reviewed=JSON.parse(await readFile(join(directory,'kit.manifest.json'),'utf8')) as KitManifest;
  const engine=new CodeKitEngine();t.after(()=>engine.dispose());await engine.load(directory,reviewed,[],await codeKitDigest(directory));
  const snapshot={sequences:[{id:'s1',revision:3,captions:[{id:'c1',text:'Product',start:0,duration:1,fontSize:32,color:'#ffffff',position:'bottom'}]}]};
  const result=await engine.invoke('example.caption-case.apply',{captionIds:['c1'],textCase:'upper'}, {projectId:'p1',sequenceId:'s1',revision:3,snapshot},new AbortController().signal);
  assert.ok('commands' in result);assert.deepEqual((result.commands[0] as {caption:{text:string}}).caption.text,'PRODUCT');assert.equal(snapshot.sequences[0].captions[0].text,'Product');
});
