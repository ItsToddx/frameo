import { mkdir, rm, stat, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {createHash} from 'node:crypto';
import type { Asset, GenerationInput, Job, Settings, Sequence } from '../contracts/api';
import { ProjectDatabase, id, now } from '../storage/database';
import { CredentialVault } from '../storage/credentials';
import { archiveMedia, renderSequence, sequenceDuration, hashFile, probe } from './media';
import { SeedanceProvider, SeedanceError } from './seedance';

function privateAddress(address:string):boolean {return address==='::1'||address.startsWith('fc')||address.startsWith('fd')||address.startsWith('fe80:')||address.startsWith('::ffff:')||/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);}
export async function downloadMedia(url:string,path:string,signal?:AbortSignal):Promise<void> {
  let current=url;let response:Response|undefined;
  for(let redirects=0;redirects<6;redirects++) {
    const parsed=new URL(current);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('供应商返回了不安全的下载地址。');
    const addresses=isIP(parsed.hostname)?[{address:parsed.hostname}]:await lookup(parsed.hostname,{all:true});if(addresses.some(a=>privateAddress(a.address)))throw new Error('供应商下载地址指向私有网络。');
    response=await fetch(current,{signal:signal??AbortSignal.timeout(120000),redirect:'manual'});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('下载重定向缺少地址。');current=new URL(location,current).href;continue;}break;
  }
  if(!response?.ok||!response.body)throw new Error(`下载视频失败（HTTP ${response?.status??'未知'}），可核对原任务后重新下载。`);
  const limit=2*1024*1024*1024;const declared=Number(response.headers.get('content-length')??0);if(declared>limit)throw new Error('供应商输出超过 2 GB 限制。');
  let bytes=0;const source=Readable.fromWeb(response.body as never);source.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>limit)source.destroy(new Error('供应商输出超过 2 GB 限制。'));});
  try{await pipeline(source,createWriteStream(path,{flags:'wx'}),{signal});if(bytes===0)throw new Error('供应商返回空输出。');}catch(error){await rm(path,{force:true});throw error;}
}
export interface JobRunnerPorts {
  provider?:(job:Job)=>Pick<SeedanceProvider,'submit'|'status'|'cancel'>;
  download?:typeof downloadMedia;archive?:typeof archiveMedia;render?:typeof renderSequence;probe?:typeof probe;
}
const cancelUnconfirmed='供应商尚未确认取消；任务可能继续计费，应用会继续核对最终结果。';
export class JobRunner {
  private readonly active=new Map<string,AbortController>();
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  private stopping=false;
  private readonly databases=new Set<ProjectDatabase>();
  private readonly readFailures=new Map<string,number>();
  private renderQueue:Promise<void>=Promise.resolve();
  private readonly pendingGeneration=new Set<Promise<void>>();
  private readonly cancellations=new Map<string,Promise<boolean>>();
  private readonly cancellationControllers=new Map<string,AbortController>();
  constructor(private readonly vault:CredentialVault,private readonly changed:(database:ProjectDatabase)=>void,private readonly canStart:()=>boolean=()=>true,private readonly ports:JobRunnerPorts={}) {}
  createGeneration(database:ProjectDatabase,input:GenerationInput,settings:Settings):Job {
    if(this.stopping)throw new Error('应用正在关闭，不能提交新任务。');
    this.databases.add(database);
    if(!settings.hasApiKey||!settings.agentModel||!settings.seedanceModel)throw new Error('请先配置方舟账户与模型。');
    const existing=database.receipt<{jobId:string}>(input.requestId,input);if(existing){const job=database.read().jobs.find(j=>j.id===existing.jobId);if(!job)throw new Error('任务回执损坏。');return job;}
    if(input.estimatedCost<=0||input.estimatedCost>settings.generationCostLimit)throw new Error('请填写有效的费用估计，且不得超过单次任务上限。');
    const accountRef=this.vault.currentId();if(!accountRef)throw new Error('账户不可用。');
    const state=database.read();const reference=input.referenceAssetId?state.assets.find(a=>a.id===input.referenceAssetId):undefined;
    if(input.referenceAssetId&&reference?.kind!=='image')throw new Error('参考素材必须为当前项目的图片。');
    const timestamp=now();const job:Job={id:id(),requestId:input.requestId,kind:'seedance',title:input.prompt.slice(0,80),status:'queued',progress:0,createdAt:timestamp,updatedAt:timestamp,cancelRequested:false,estimatedCost:input.estimatedCost,input:{...input,model:settings.seedanceModel,baseUrl:settings.arkBaseUrl,accountRef,referenceHash:reference?.hash,kitId:'reelbeam.seedance-kit',kitVersion:'1.0.0'}};
    database.transaction(s=>{s.jobs.push(job);database.saveReceipt(input.requestId,input,{jobId:job.id});},'job.created');this.changed(database);
    this.dispatch(database,job.id);return job;
  }
  private dispatch(database:ProjectDatabase,jobId:string):void {
    if(this.stopping||this.active.has(jobId))return;
    const job=database.read().jobs.find(j=>j.id===jobId);if(!job||['succeeded','failed','cancelled'].includes(job.status)||job.cancelRequested&&job.status==='queued')return;
    if(job.status==='queued'){
      if(!this.canStart())return;
      const occupied=[...this.databases].flatMap(db=>db.read().jobs).filter(j=>j.kind==='seedance'&&['submitting','running','unknown','reconciling','finalizing'].includes(j.status)).length;
      if(occupied>=2)return;
    }
    const controller=new AbortController();this.active.set(jobId,controller);
    const execution=this.runGeneration(database,jobId,controller.signal).finally(()=>{this.active.delete(jobId);this.pendingGeneration.delete(execution);this.drain();});
    this.pendingGeneration.add(execution);void execution.catch(()=>{});
  }
  drain():void {if(this.stopping)return;for(const database of this.databases)for(const job of database.read().jobs)if(job.kind==='seedance'&&job.status==='queued'&&!job.cancelRequested)this.dispatch(database,job.id);}
  private provider(job:Job):Pick<SeedanceProvider,'submit'|'status'|'cancel'> {return this.ports.provider?.(job)??new SeedanceProvider({baseUrl:String(job.input.baseUrl),apiKey:this.vault.get(String(job.input.accountRef))});}
  private async runGeneration(database:ProjectDatabase,jobId:string,signal:AbortSignal):Promise<void> {
    let job=database.read().jobs.find(j=>j.id===jobId)!;
    let submissionStarted=false;
    try {
      // A committed stage is independent of the provider account, task record and expiring URL.
      if(job.status==='finalizing'&&job.stagedOutput){await this.finalizeStage(database,jobId,signal);return;}
      const provider=this.provider(job);
      if(job.status==='queued') {
        database.updateJob(jobId,{status:'submitting',progress:0.03});this.changed(database);
        let referenceImageDataUrl:string|undefined;
        if(job.input.referenceAssetId){const asset=database.read().assets.find(a=>a.id===job.input.referenceAssetId);if(!asset||asset.hash!==job.input.referenceHash)throw new Error('参考图片版本已失效。');const {readFile,stat}=await import('node:fs/promises');const source=join(database.directory,asset.path);if((await stat(source)).size>20*1024*1024)throw new Error('参考图片超过 20 MB。');const bytes=await readFile(source);if(createHash('sha256').update(bytes).digest('hex')!==job.input.referenceHash)throw new Error('参考图片文件与固定版本不一致。');const extension=asset.path.split('.').pop();const mime=extension==='jpg'||extension==='jpeg'?'image/jpeg':extension==='webp'?'image/webp':'image/png';referenceImageDataUrl=`data:${mime};base64,${bytes.toString('base64')}`;}
        submissionStarted=true;
        const result=await provider.submit({model:String(job.input.model),prompt:String(job.input.prompt),duration:Number(job.input.duration),ratio:job.input.ratio as GenerationInput['ratio'],referenceImageDataUrl},signal);
        database.updateJob(jobId,{remoteId:result.remoteId,status:'running',progress:0.1});this.changed(database);job=database.read().jobs.find(j=>j.id===jobId)!;
        if(job.cancelRequested){if(await this.attemptCancellation(database,job,provider,signal))return;job=database.read().jobs.find(j=>j.id===jobId)!;}
      }
      if(!job.remoteId){if(job.status!=='unknown')database.updateJob(jobId,{status:'unknown',error:'提交状态不明且没有远端任务 ID。请在方舟控制台核对，应用不会重新付费提交。'});this.changed(database);return;}
      const remote=await provider.status(job.remoteId,signal);
      if(database.read().jobs.find(j=>j.id===jobId)?.status==='cancelled')return;
      this.readFailures.delete(jobId);
      if(remote.status==='succeeded') {
        if(job.outputAssetId){database.updateJob(jobId,{status:'succeeded',progress:1});this.changed(database);return;}
        const outputUrl=remote.outputUrl;if(!outputUrl)throw new Error('供应商任务成功但缺少必需视频输出。');
        database.updateJob(jobId,{status:'finalizing',progress:0.85,error:job.cancelRequested?cancelUnconfirmed:undefined});this.changed(database);
        await mkdir(join(database.directory,'cache'),{recursive:true});const temporary=join(database.directory,'cache',`${jobId}-download.mp4`);await rm(temporary,{force:true});
        await (this.ports.download??downloadMedia)(outputUrl,temporary,signal);
        const metadata=await (this.ports.probe??probe)(temporary,signal);
        if(!metadata.streams.some(stream=>stream.codec_type==='video')||!Number.isFinite(Number(metadata.format.duration))||Number(metadata.format.duration)<=0)throw new Error('生成输出不是可用视频。');
        const hash=await hashFile(temporary);signal.throwIfAborted();
        database.updateJob(jobId,{stagedOutput:{path:`cache/${jobId}-download.mp4`,hash}});this.changed(database);
        await this.finalizeStage(database,jobId,signal);return;
      }
      if(remote.status==='failed'||remote.status==='cancelled'){database.updateJob(jobId,{status:remote.status,error:remote.error,progress:0});this.changed(database);return;}
      const current=database.read().jobs.find(job=>job.id===jobId)!;
      database.updateJob(jobId,{status:remote.status==='unknown'?'reconciling':'running',progress:Math.max(job.progress,0.15),error:current.cancelRequested?cancelUnconfirmed:remote.error});this.changed(database);
      this.schedule(database,jobId);
    }catch(error){
      const message=error instanceof Error?error.message:'任务失败。';const current=database.read().jobs.find(j=>j.id===jobId)!;
      if(current.status==='cancelled'||current.status==='succeeded')return;
      if(current.status==='submitting')database.updateJob(jobId,{status:!submissionStarted||error instanceof SeedanceError&&error.kind==='rejected'?'failed':'unknown',error:message});
      else if(current.remoteId){database.updateJob(jobId,{status:current.status==='finalizing'?'finalizing':'reconciling',error:message});const failures=(this.readFailures.get(jobId)??0)+1;this.readFailures.set(jobId,failures);if(!signal.aborted&&failures<6&&!(error instanceof SeedanceError&&error.kind==='rejected'))this.schedule(database,jobId,Math.min(60000,5000*2**failures));}
      else database.updateJob(jobId,{status:'failed',error:message});this.changed(database);
    }
  }
  private async finalizeStage(database:ProjectDatabase,jobId:string,signal:AbortSignal):Promise<void> {
    const job=database.read().jobs.find(job=>job.id===jobId)!;const stage=job.stagedOutput;
    if(!stage||stage.path!==`cache/${job.id}-download.mp4`||!/^cache\/[A-Za-z0-9_-]{1,200}-download\.mp4$/.test(stage.path)||!/^[a-f0-9]{64}$/.test(stage.hash))throw new Error('生成下载暂存记录无效，保留原任务以供核对。');
    const path=resolve(database.directory,stage.path);
    if(await realpath(path)!==path||!(await stat(path)).isFile()||await hashFile(path)!==stage.hash)throw new Error('已验证的生成暂存文件缺失或内容改变，请核对原任务。');
    signal.throwIfAborted();
    const asset=await (this.ports.archive??archiveMedia)(database.directory,path,`${job.title}.mp4`,jobId,signal);
    if(asset.kind!=='video'||asset.hash!==stage.hash)throw new Error('生成归档与已验证的下载内容不一致。');
    signal.throwIfAborted();
    database.transaction(state=>{
      const current=state.jobs.find(job=>job.id===jobId)!;if(current.status==='cancelled')throw new Error('此任务已取消。');
      const existing=state.assets.find(asset=>asset.originJobId===jobId);
      if(existing&&existing.hash!==asset.hash)throw new Error('同一任务输出发生内容冲突，旧素材已保留。');
      const finalAsset=existing??asset;if(!existing){state.assets.push(asset);state.canvas.items.push({id:id(),kind:'asset',refId:asset.id,x:680,y:100+state.assets.length*60,width:280,height:200});state.canvas.revision++;}
      Object.assign(current,{status:'succeeded',progress:1,outputAssetId:finalAsset.id,updatedAt:now(),error:undefined,stagedOutput:undefined});
    },'job.succeeded');
    // Failure to clean a cache file must never roll back already committed media.
    await rm(path,{force:true}).catch(()=>{});this.changed(database);
  }
  private attemptCancellation(database:ProjectDatabase,job:Job,provider=this.provider(job),signal?:AbortSignal):Promise<boolean> {
    const prior=this.cancellations.get(job.id);if(prior)return prior;
    const controller=new AbortController();this.cancellationControllers.set(job.id,controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const request=(async()=>{
      try {
        const result=await provider.cancel(job.remoteId!,combined);
        const current=database.read().jobs.find(item=>item.id===job.id)!;
        if(current.status==='succeeded'||current.status==='cancelled')return current.status==='cancelled';
        if(result.acknowledged){database.updateJob(job.id,{status:'cancelled',error:undefined});this.active.get(job.id)?.abort();const timer=this.timers.get(job.id);if(timer)clearTimeout(timer);this.timers.delete(job.id);this.changed(database);return true;}
        database.updateJob(job.id,{error:cancelUnconfirmed});this.changed(database);return false;
      } catch(error) {
        const current=database.read().jobs.find(item=>item.id===job.id)!;
        if(!['succeeded','cancelled'].includes(current.status)){database.updateJob(job.id,{error:cancelUnconfirmed+(error instanceof Error?' '+error.message:'')});this.changed(database);}
        return false;
      }
    })().finally(()=>{this.cancellations.delete(job.id);this.cancellationControllers.delete(job.id);});
    this.cancellations.set(job.id,request);return request;
  }
  private schedule(database:ProjectDatabase,jobId:string,delay=5000):void {if(this.stopping)return;const old=this.timers.get(jobId);if(old)clearTimeout(old);this.timers.set(jobId,setTimeout(()=>{this.timers.delete(jobId);this.dispatch(database,jobId);},delay));}
  recover(database:ProjectDatabase):void {
    this.databases.add(database);
    for(const job of database.read().jobs){
      if(this.active.has(job.id))continue;
      if(job.kind==='seedance'){
        if(job.status==='queued'&&!job.cancelRequested)this.dispatch(database,job.id);
        else if(job.status==='submitting'){database.updateJob(job.id,{status:job.remoteId?'reconciling':'unknown',error:'应用曾在提交中退出；只核对原任务，不重新提交。'});if(job.remoteId)this.dispatch(database,job.id);}
        else if(job.status==='finalizing'&&job.stagedOutput||['running','reconciling','finalizing'].includes(job.status)&&job.remoteId)this.dispatch(database,job.id);
      }else if(['queued','running','submitting','finalizing'].includes(job.status))database.updateJob(job.id,{status:'failed',error:'本地处理在应用关闭时中断，请重新发起。'});
    }
  }
  reconcile(database:ProjectDatabase,jobId:string):void {const job=database.read().jobs.find(j=>j.id===jobId);if(!job)throw new Error('任务不存在。');if(!job.remoteId)throw new Error('没有远端 ID，请在方舟控制台核对原任务。不会自动重新提交。');if(job.status==='succeeded'||job.status==='cancelled')return;this.readFailures.delete(jobId);if(job.status==='failed')database.updateJob(jobId,{status:'reconciling'});this.dispatch(database,jobId);}
  async cancel(database:ProjectDatabase,jobId:string):Promise<void> {
    const job=database.read().jobs.find(j=>j.id===jobId);if(!job)throw new Error('任务不存在。');if(['succeeded','failed','cancelled'].includes(job.status))return;
    database.updateJob(jobId,{cancelRequested:true,...(job.status==='submitting'&&!job.remoteId?{error:'取消请求已记录，取得远端任务 ID 后会尝试取消；仍需核对供应商状态。'}:{})});this.changed(database);
    if(job.kind!=='seedance'){this.active.get(jobId)?.abort();if(job.status==='queued')database.updateJob(jobId,{status:'cancelled'});return;}
    if(job.status==='queued'){database.updateJob(jobId,{status:'cancelled',error:undefined});this.changed(database);return;}
    if(job.remoteId)await this.attemptCancellation(database,job);
  }
  createRender(database:ProjectDatabase,sequence:Sequence,output:string,preview:boolean):Job {
    if(this.stopping)throw new Error('应用正在关闭，不能创建新处理任务。');
    if(sequenceDuration(sequence)<=0)throw new Error('作品为空，请先添加素材。');
    const timestamp=now();const job:Job={id:id(),requestId:id(),kind:preview?'preview':'export',title:preview?'合成预览':`导出 ${sequence.name}`,status:'queued',progress:0,createdAt:timestamp,updatedAt:timestamp,cancelRequested:false,input:{sequenceId:sequence.id,revision:sequence.revision}};
    database.transaction(state=>state.jobs.push(job),'job.created');this.changed(database);
    const controller=new AbortController();this.active.set(job.id,controller);const assets=database.read().assets;
    const execute=async()=>{
      try{controller.signal.throwIfAborted();database.updateJob(job.id,{status:'running'});this.changed(database);let last=0;
        const result=await (this.ports.render??renderSequence)({directory:database.directory,sequence,assets,output,preview,signal:controller.signal,onProgress:progress=>{if(Date.now()-last>250||progress===1){last=Date.now();database.updateJob(job.id,{progress});this.changed(database);}}});
        controller.signal.throwIfAborted();
        if(database.read().jobs.find(j=>j.id===job.id)?.cancelRequested){await rm(result.path,{force:true});database.updateJob(job.id,{status:'cancelled'});}else database.updateJob(job.id,{status:'succeeded',progress:1,outputPath:result.path});
      }catch(error){database.updateJob(job.id,{status:controller.signal.aborted?'cancelled':'failed',error:error instanceof Error?error.message:'导出失败。'});}finally{this.active.delete(job.id);this.changed(database);}
    };this.renderQueue=this.renderQueue.then(execute,execute);return job;
  }
  async stop():Promise<void> {
    this.stopping=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    for(const controller of this.active.values())controller.abort();for(const controller of this.cancellationControllers.values())controller.abort();
    await Promise.allSettled([...this.pendingGeneration,...this.cancellations.values(),this.renderQueue]);
  }
}
