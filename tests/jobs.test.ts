import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobRunner} from '../apps/desktop/src/adapters/runtime/jobs';
import {ProjectDatabase} from '../apps/desktop/src/adapters/storage/database';
import type {CredentialVault} from '../apps/desktop/src/adapters/storage/credentials';
import type {Job,Settings} from '../apps/desktop/src/adapters/contracts/api';
import {SeedanceError,SeedanceProvider} from '../apps/desktop/src/adapters/runtime/seedance';
import {hashFile} from '../apps/desktop/src/adapters/runtime/media';
const vault={currentId:()=> 'account-original',get:()=> 'test-fixture-secret'} as unknown as CredentialVault;
const settings:Settings={hasApiKey:true,arkBaseUrl:'https://ark.cn-beijing.volces.com/api/v3',agentModel:'test-agent',seedanceModel:'doubao-seedance-2-5-260628',generationCostLimit:2,maxModelCalls:12};
const input=(requestId:string)=>({requestId,prompt:'A controlled test',duration:5,ratio:'16:9' as const,estimatedCost:1});
async function wait(check:()=>boolean){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw new Error('State did not settle');await new Promise(r=>setTimeout(r,5));}}
async function fixture(run:(db:ProjectDatabase,root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'reelbeam-jobs-'));const db=ProjectDatabase.create(join(root,'p'),'Test',640,360,30);try{await run(db,root);}finally{db.close();await rm(root,{recursive:true,force:true});}}
const downloaded=Buffer.from('Controlled provider video bytes; media decoding is covered by native media tests.');
const downloadedHash=createHash('sha256').update(downloaded).digest('hex');
const stagePorts={download:async(_url:string,path:string)=>{await writeFile(path,downloaded);},probe:async()=>({format:{duration:'5'},streams:[{codec_type:'video',width:640,height:360}]})};
async function archiveFixture(directory:string,source:string,name?:string,originJobId?:string,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const hash=await hashFile(source),path='media/'+hash+'.mp4';await writeFile(join(directory,path),await readFile(source));
  return {id:'asset-'+originJobId,name:name!,kind:'video' as const,path,hash,url:'',duration:5,originJobId,createdAt:new Date().toISOString()};
}
test('lost paid receipt persists unknown before any restart and cannot silently resubmit',async()=>fixture(async(db)=>{
  let submissions=0;const provider={submit:async()=>{submissions++;assert.equal(db.read().jobs.at(-1)?.status,'submitting');throw new SeedanceError('lost response','unknown');},status:async()=>({status:'running' as const}),cancel:async()=>({acknowledged:false,status:'running' as const})};
  const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>provider});const job=runner.createGeneration(db,input('lost'),settings);await wait(()=>db.read().jobs[0]?.status==='unknown');
  assert.equal(runner.createGeneration(db,input('lost'),settings).id,job.id);runner.recover(db);assert.throws(()=>runner.reconcile(db,job.id),/没有远端/);assert.equal(submissions,1);assert.equal(db.read().sequences[0].clips.length,0);await runner.stop();
}));
test('provider rejections and asynchronous account-limit failures persist without fabricating output or replaying submits',async t=>{
  for(const scenario of [
    {http:401,code:'Unauthorized',message:'Invalid API key test-fixture-secret',remoteId:undefined},
    {http:404,code:'ModelNotOpen',message:'The selected model has not been activated',remoteId:undefined},
    {http:200,code:'SetLimitExceeded',message:'The model usage limit has been reached; service is paused',remoteId:'cgt-terminal-failure'},
  ])await t.test(scenario.code,async()=>fixture(async(db)=>{
    const requests:{method:string;url:string}[]=[];let downloads=0;
    const fetcher:typeof fetch=async(url,options)=>{
      const method=options?.method??'GET';requests.push({method,url:String(url)});
      if(scenario.http!==200)return Response.json({error:{code:scenario.code,message:scenario.message}},{status:scenario.http});
      if(method==='POST')return Response.json({id:scenario.remoteId});
      assert.ok(String(url).endsWith('/'+scenario.remoteId));return Response.json({id:scenario.remoteId,status:'failed',error:{code:scenario.code,message:scenario.message}});
    };
    const provider=new SeedanceProvider({baseUrl:settings.arkBaseUrl,apiKey:'test-fixture-secret',fetch:fetcher});
    const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>provider,download:async()=>{downloads++;throw new Error('Failure must not download media');}});
    let reopened:ProjectDatabase|undefined,recovery:JobRunner|undefined;
    try{
      const request=input('failure-'+scenario.code),created=runner.createGeneration(db,request,settings);await wait(()=>db.read().jobs[0].status==='failed');await runner.stop();
      const failed=db.read().jobs[0];assert.equal(failed.remoteId,scenario.remoteId);assert.ok(failed.error);assert.ok(!failed.error.includes('test-fixture-secret'));assert.equal(failed.outputAssetId,undefined);assert.equal(downloads,0);assert.equal(db.read().assets.length,0);assert.equal(db.read().canvas.items.filter(item=>item.kind==='asset').length,0);assert.equal(db.read().sequences[0].clips.length,0);
      reopened=new ProjectDatabase(db.directory);recovery=new JobRunner(vault,()=>{},()=>true,{provider:()=>provider});const count=requests.length;recovery.recover(reopened);recovery.drain();assert.equal(recovery.createGeneration(reopened,request,settings).id,created.id);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(requests.length,count);assert.equal(reopened.read().jobs[0].status,'failed');assert.equal(reopened.read().jobs[0].remoteId,scenario.remoteId);assert.equal(requests.filter(request=>request.method==='POST').length,1);
      if(scenario.remoteId){recovery.reconcile(reopened,created.id);await wait(()=>requests.length===count+1&&reopened!.read().jobs[0].status==='failed');assert.equal(requests.at(-1)?.method,'GET');assert.equal(requests.filter(request=>request.method==='POST').length,1);}else assert.throws(()=>recovery!.reconcile(reopened!,created.id),/没有远端/);
    }finally{await runner.stop();await recovery?.stop();reopened?.close();}
  }));
});
test('recover only polls the pinned remote task and finalization registers one candidate without edits',async()=>fixture(async(db)=>{
  let submissions=0,queries=0,archives=0;const runner=new JobRunner(vault,()=>{},()=>true,{...stagePorts,provider:job=>({submit:async()=>{submissions++;return {remoteId:'original-remote'};},status:async remoteId=>{queries++;assert.equal(remoteId,'original-remote');assert.equal(job.input.accountRef,'account-original');return {status:'succeeded',outputUrl:'https://example.com/test.mp4'};},cancel:async()=>({acknowledged:false,status:'succeeded'})}),archive:async(...args)=>{archives++;return archiveFixture(...args);}});
  const job:Job={id:'recover',requestId:'recover-request',kind:'seedance',status:'submitting',title:'Original',progress:0,createdAt:'x',updatedAt:'x',cancelRequested:false,input:{baseUrl:settings.arkBaseUrl,model:settings.seedanceModel,accountRef:'account-original'},remoteId:'original-remote'};db.transaction(s=>s.jobs.push(job));runner.recover(db);await wait(()=>db.read().jobs[0].status==='succeeded');runner.recover(db);assert.equal(submissions,0);assert.equal(queries,1);assert.equal(archives,1);assert.equal(db.read().assets.length,1);assert.equal(db.read().sequences[0].clips.length,0);assert.equal(db.read().canvas.items.filter(i=>i.kind==='asset').length,1);await runner.stop();
}));
test('a disabled provider gates queued submission and concurrency is capped across projects',async()=>fixture(async(db,root)=>{
  let enabled=false,submissions=0;const releases:Array<()=>void>=[];const other=ProjectDatabase.create(join(root,'other'),'Other',640,360,30);
  const runner=new JobRunner(vault,()=>{},()=>enabled,{provider:()=>({submit:async()=>{submissions++;await new Promise<void>(resolve=>releases.push(resolve));return {remoteId:'remote-'+submissions};},status:async()=>({status:'failed',error:'controlled fixture end'}),cancel:async()=>({acknowledged:false,status:'running'})})});
  try{runner.createGeneration(db,input('one'),settings);assert.equal(submissions,0);enabled=true;runner.drain();runner.createGeneration(other,input('two'),settings);const third=runner.createGeneration(db,input('three'),settings);assert.equal(submissions,2);assert.equal(db.read().jobs.find(j=>j.id===third.id)?.status,'queued');releases.shift()!();await wait(()=>submissions===3);while(releases.length)releases.shift()!();await wait(()=>[...db.read().jobs,...other.read().jobs].every(j=>j.status==='failed'));assert.equal(submissions,3);}finally{await runner.stop();other.close();}
}));
test('queued cancellation never submits, rejects exceeded budget and changed receipt input',async()=>fixture(async(db)=>{
  let submissions=0;const runner=new JobRunner(vault,()=>{},()=>false,{provider:()=>({submit:async()=>{submissions++;return {remoteId:'unused'};},status:async()=>({status:'running'}),cancel:async()=>({acknowledged:false,status:'running'})})});
  assert.throws(()=>runner.createGeneration(db,{...input('budget'),estimatedCost:3},settings),/上限/);assert.equal(db.read().jobs.length,0);
  const job=runner.createGeneration(db,input('cancel'),settings);await runner.cancel(db,job.id);runner.drain();assert.equal(db.read().jobs[0].status,'cancelled');assert.equal(submissions,0);assert.throws(()=>runner.createGeneration(db,{...input('cancel'),prompt:'Changed'},settings),/输入发生变化/);await runner.stop();
}));

test('a persisted verified download finalizes after interruption without consulting an unavailable provider',async()=>fixture(async(db)=>{
  let firstArchives=0;
  const first=new JobRunner(vault,()=>{},()=>true,{...stagePorts,provider:()=>({submit:async()=>({remoteId:'pinned'}),status:async()=>({status:'succeeded',outputUrl:'https://example.com/video.mp4'}),cancel:async()=>({acknowledged:false,status:'succeeded'})}),archive:async(...args)=>{
    firstArchives++;assert.ok(db.read().jobs[0].stagedOutput);assert.equal(db.read().assets.length,0);
    await archiveFixture(...args);throw new Error('Interruption after copying media and before registering it');
  }});
  const job=first.createGeneration(db,input('staged'),settings);
  await wait(()=>!!db.read().jobs[0].stagedOutput&&!!db.read().jobs[0].error);await first.stop();
  const saved=db.read().jobs[0];assert.equal(saved.status,'finalizing');assert.equal(saved.stagedOutput?.hash,downloadedHash);
  const stage=join(db.directory,saved.stagedOutput!.path);assert.equal(existsSync(stage),true);assert.equal(firstArchives,1);
  const reopened=new ProjectDatabase(db.directory);let providerReads=0,recoveryArchives=0;
  const recovered=new JobRunner(vault,()=>{},()=>true,{provider:()=>{providerReads++;throw new Error('Provider account or remote task is unavailable');},download:async()=>{throw new Error('No new download is allowed');},archive:async(...args)=>{recoveryArchives++;assert.equal(existsSync(stage),true);return archiveFixture(...args);}});
  try {
    recovered.recover(reopened);await wait(()=>reopened.read().jobs[0].status==='succeeded'&&!existsSync(stage));
    recovered.recover(reopened);assert.equal(providerReads,0);assert.equal(recoveryArchives,1);
    assert.equal(reopened.read().assets.length,1);assert.equal(reopened.read().assets[0].originJobId,job.id);
    assert.equal(reopened.read().assets[0].hash,downloadedHash);assert.equal(reopened.read().jobs[0].stagedOutput,undefined);
    assert.equal(reopened.read().canvas.items.filter(item=>item.kind==='asset').length,1);assert.equal(reopened.read().sequences[0].clips.length,0);
  } finally {await recovered.stop();reopened.close();}
}));

test('staged recovery rejects changed content and unexpected paths before provider or archive access',async()=>fixture(async(db)=>{
  let providerReads=0,archiveReads=0;
  const job:Job={id:'stage-check',requestId:'stage-check',kind:'seedance',status:'finalizing',title:'Stage',progress:0.85,createdAt:'x',updatedAt:'x',cancelRequested:false,input:{},remoteId:'pinned',stagedOutput:{path:'cache/stage-check-download.mp4',hash:downloadedHash}};
  await writeFile(join(db.directory,job.stagedOutput!.path),'Changed content');db.transaction(state=>state.jobs.push(job));
  const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>{providerReads++;throw new Error('No provider access');},archive:async(...args)=>{archiveReads++;return archiveFixture(...args);}});
  runner.recover(db);await wait(()=>!!db.read().jobs[0].error);await runner.stop();
  assert.equal(providerReads,0);assert.equal(archiveReads,0);assert.equal(db.read().assets.length,0);assert.equal(existsSync(join(db.directory,job.stagedOutput!.path)),true);
  db.updateJob(job.id,{error:undefined,stagedOutput:{path:'cache/../private.mp4',hash:downloadedHash}});
  const second=new JobRunner(vault,()=>{},()=>true,{provider:()=>{providerReads++;throw new Error('No provider access');},archive:async(...args)=>{archiveReads++;return archiveFixture(...args);}});
  second.recover(db);await wait(()=>!!db.read().jobs[0].error);await second.stop();assert.equal(providerReads,0);assert.equal(archiveReads,0);
}));

test('a cancellation requested during submission is attempted once the remote ID arrives and stops only after acknowledgement',async()=>fixture(async(db)=>{
  let release!:(result:{remoteId:string})=>void;let cancels=0,queries=0;
  const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>({submit:async()=>new Promise(resolve=>{release=resolve;}),status:async()=>{queries++;return {status:'running'};},cancel:async remoteId=>{cancels++;assert.equal(remoteId,'remote-cancel');return {acknowledged:true,status:'cancelled'};}})});
  const job=runner.createGeneration(db,input('submit-cancel'),settings);assert.equal(db.read().jobs[0].status,'submitting');
  await runner.cancel(db,job.id);assert.equal(cancels,0);assert.equal(db.read().jobs[0].cancelRequested,true);
  release({remoteId:'remote-cancel'});await wait(()=>db.read().jobs[0].status==='cancelled');await runner.stop();
  assert.equal(cancels,1);assert.equal(queries,0);assert.equal(db.read().jobs[0].remoteId,'remote-cancel');assert.equal(db.read().jobs[0].error,undefined);
}));

test('an unacknowledged mid-submit cancellation keeps polling its original ID and keeps a clear cancellation state',async()=>fixture(async(db)=>{
  let release!:(result:{remoteId:string})=>void;let cancels=0,queries=0;
  const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>({submit:async()=>new Promise(resolve=>{release=resolve;}),status:async remoteId=>{queries++;assert.equal(remoteId,'still-running');return {status:'running'};},cancel:async()=>{cancels++;return {acknowledged:false,status:'running'};}})});
  const job=runner.createGeneration(db,input('unconfirmed-cancel'),settings);await runner.cancel(db,job.id);release({remoteId:'still-running'});
  await wait(()=>queries===1&&db.read().jobs[0].progress>=0.15);assert.equal(db.read().jobs[0].status,'running');assert.match(db.read().jobs[0].error!,/尚未确认取消/);
  runner.reconcile(db,job.id);await wait(()=>queries===2);assert.equal(db.read().jobs[0].cancelRequested,true);assert.match(db.read().jobs[0].error!,/尚未确认取消/);assert.equal(cancels,1);await runner.stop();
}));

test('stop waits for every generation callback before the project database may be closed',async()=>fixture(async(db)=>{
  let release!:(result:{remoteId:string})=>void;let stopped=false;
  const runner=new JobRunner(vault,()=>{},()=>true,{provider:()=>({submit:async()=>new Promise(resolve=>{release=resolve;}),status:async(_remoteId,signal)=>{assert.equal(signal?.aborted,true);throw new Error('Stopped after the task ID became known');},cancel:async()=>({acknowledged:false,status:'running'})})});
  runner.createGeneration(db,input('stop-drain'),settings);const closing=runner.stop().then(()=>{stopped=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
  release({remoteId:'known-after-stop'});await closing;assert.equal(stopped,true);assert.equal(db.read().jobs[0].remoteId,'known-after-stop');assert.equal(db.read().jobs[0].status,'reconciling');
  assert.throws(()=>runner.createGeneration(db,input('too-late'),settings),/关闭/);
}));

test('stop drains the render queue including aborted queued jobs and prevents late successful callbacks',async()=>fixture(async(db,root)=>{
  let finish!:(result:{path:string;duration:number;frames:number})=>void;let renders=0,stopped=false;
  const runner=new JobRunner(vault,()=>{},()=>true,{render:async()=>{renders++;return new Promise(resolve=>{finish=resolve;});}});
  const sequence=db.read().sequences[0];sequence.clips.push({id:'clip',trackId:sequence.tracks[0].id,assetVersionId:'fixture',start:0,duration:30,sourceStart:0,audioGain:1,muted:true});
  runner.createRender(db,sequence,join(root,'one.mp4'),false);runner.createRender(db,sequence,join(root,'two.mp4'),false);await wait(()=>renders===1);
  const closing=runner.stop().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
  finish({path:join(root,'one.mp4'),duration:1,frames:30});await closing;
  assert.equal(renders,1);assert.equal(stopped,true);assert.ok(db.read().jobs.every(job=>job.status==='cancelled'));assert.ok(db.read().jobs.every(job=>job.outputPath===undefined));
}));
