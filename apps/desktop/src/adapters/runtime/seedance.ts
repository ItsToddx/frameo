import {z} from 'zod';
import {GenerationGatewayError} from '../../../../../packages/application/src/generation-ports.js';
import type {CapabilityDescriptor,JsonValue,MediaProvider,ProviderStatus} from '../../../../../packages/kit-sdk/src/index.js';
import {seedanceDescriptor} from '../../../../../kits/builtin.js';

export interface SeedanceInput {
  model:string; prompt:string; duration:number; ratio:'16:9'|'9:16'|'1:1'; referenceImageDataUrl?:string;
}
export interface SeedanceOptions {baseUrl:string;apiKey:string;fetch?:typeof fetch;timeoutMs?:number}
export class SeedanceError extends GenerationGatewayError {
  constructor(message:string,readonly kind:'unknown'|'rejected'|'failed',readonly code?:string,readonly status?:number){super(message,kind,code,status);this.name='SeedanceError';}
}
const inputSchema=z.object({model:z.string().trim().min(1).max(200),prompt:z.string().trim().min(1).max(20000),
  duration:z.number().int().min(2).max(30),ratio:z.enum(['16:9','9:16','1:1']),
  referenceImageDataUrl:z.string().max(40*1024*1024).regex(/^data:image\/(png|jpeg|jpg|webp|bmp|tiff|gif);base64,[A-Za-z0-9+/]+=*$/).optional()}).strict();
const remoteIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const taskSchema=z.object({id:remoteIdSchema.optional(),status:z.string(),content:z.object({video_url:z.string().optional()}).optional(),
  error:z.object({code:z.string().optional(),message:z.string().optional()}).nullable().optional()});
export function normalizeArkBaseUrl(baseUrl:string):string {
  const url=new URL(baseUrl.trim());
  if(url.username||url.password||url.search||url.hash)throw new Error('Ark Base URL cannot contain credentials or query parameters');
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Ark Base URL must use HTTPS');
  return url.href.replace(/\/+$/,'');
}
export function seedancePayload(input:SeedanceInput):Record<string,unknown> {
  const args=inputSchema.parse(input);
  const is25=/seedance-2[-.]5/.test(args.model), is2=/seedance-2/.test(args.model), is1=/seedance-1/.test(args.model);
  const min=is1 && !/1[-.]5/.test(args.model)?2:4;
  const max=is25?30:is2||/1[-.]5/.test(args.model)?15:12;
  if(args.duration<min||args.duration>max)throw new Error(`This Seedance model requires ${min}–${max} seconds`);
  const content:Record<string,unknown>[]=[{type:'text',text:args.prompt}];
  if(args.referenceImageDataUrl)content.push({type:'image_url',image_url:{url:args.referenceImageDataUrl},role:is2?'reference_image':'first_frame'});
  return {model:args.model,content,duration:args.duration,ratio:args.ratio,watermark:true,
    ...(is25||is2||/1[-.]5/.test(args.model)?{generate_audio:true}:{})};
}

/** A single-shot submitter. The host alone owns deduplication and paid authorization. */
export class SeedanceProvider implements MediaProvider {
  readonly descriptor:CapabilityDescriptor=seedanceDescriptor;
  private baseUrl:string; private fetcher:typeof fetch; private timeout:number;
  constructor(private options:SeedanceOptions) {
    if(!options.apiKey.trim())throw new Error('Configure an Ark API key to use Seedance');
    this.baseUrl=normalizeArkBaseUrl(options.baseUrl);this.fetcher=options.fetch??fetch;this.timeout=options.timeoutMs??30000;
  }
  async submit(input:SeedanceInput|JsonValue,signal?:AbortSignal):Promise<{remoteId:string}> {
    let payload:Record<string,unknown>;
    try{payload=seedancePayload(input as SeedanceInput);}catch(error){throw new SeedanceError(error instanceof Error?error.message:'Invalid Seedance parameters','rejected');}
    if(signal?.aborted)throw new SeedanceError('Generation stopped before submission','rejected');
    const data=await this.request('POST','',payload,signal);
    const id=z.object({id:remoteIdSchema}).safeParse(data);
    if(!id.success)throw new SeedanceError('Seedance accepted a request without a valid task ID. Check the Ark console before submitting again.','unknown');
    return {remoteId:id.data.id};
  }
  async status(remoteId:string,signal?:AbortSignal):Promise<ProviderStatus> {
    remoteIdSchema.parse(remoteId);
    const parsed=taskSchema.safeParse(await this.request('GET',`/${encodeURIComponent(remoteId)}`,undefined,signal));
    if(!parsed.success)throw new SeedanceError('Seedance returned an invalid task response','failed');
    const data=parsed.data;
    if(data.id && data.id!==remoteId)throw new SeedanceError('Seedance returned the wrong task ID','failed');
    if(data.status==='expired')return {status:'failed',error:'Seedance task expired'};
    if(!['queued','running','succeeded','failed','cancelled'].includes(data.status))return {status:'unknown',error:'Seedance task state is not recognized; reconcile this task before continuing'};
    const status=data.status as ProviderStatus['status'];
    if(status==='succeeded') {
      const url=data.content?.video_url;
      if(!url)throw new SeedanceError('Seedance task succeeded without a video URL','failed');
      const parsedUrl=new URL(url);
      if(parsedUrl.protocol!=='https:'||parsedUrl.username||parsedUrl.password)throw new SeedanceError('Seedance returned an unsupported output URL','failed');
      return {status,outputUrl:url};
    }
    return {status,...(data.error?.message?{error:this.redact(data.error.message)}:{})};
  }
  async cancel(remoteId:string,signal?:AbortSignal):Promise<{acknowledged:boolean;status?:ProviderStatus['status']}> {
    const before=await this.status(remoteId,signal);
    if(before.status==='cancelled')return {acknowledged:true,status:'cancelled'};
    // Ark DELETE deletes terminal task records; do not use it to cancel running/finished work.
    if(before.status!=='queued')return {acknowledged:false,status:before.status};
    await this.request('DELETE',`/${encodeURIComponent(remoteId)}`,undefined,signal);
    const after=await this.status(remoteId,signal);
    return {acknowledged:after.status==='cancelled',status:after.status};
  }
  private redact(value:string):string {
    return value.split(this.options.apiKey).join('[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,1000);
  }
  private async request(method:'GET'|'POST'|'DELETE',suffix:string,body:unknown,signal?:AbortSignal):Promise<unknown> {
    const timeoutSignal=AbortSignal.timeout(this.timeout);
    const combined=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;
    let response:Response;
    try {
      response=await this.fetcher(`${this.baseUrl}/contents/generations/tasks${suffix}`,{
        method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.options.apiKey}`},
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:combined,redirect:'error',
      });
    } catch {
      throw new SeedanceError(method==='POST'?'Submission outcome is unknown. Check the Ark console; do not resubmit this request.':'Seedance request did not complete. Reconcile the existing task.',method==='POST'?'unknown':'failed');
    }
    let data:unknown;
    try{data=await response.json();}catch{
      if(response.ok && method==='DELETE')return {};
      throw new SeedanceError('Seedance response could not be read',method==='POST'?'unknown':'failed',undefined,response.status);
    }
    if(!response.ok) {
      const error=z.object({error:z.object({code:z.string().optional(),message:z.string().optional()})}).safeParse(data);
      const code=error.success?error.data.error.code:undefined;
      const message=error.success?error.data.error.message:undefined;
      const unknown=method==='POST'&&(response.status>=500||response.status===408);
      throw new SeedanceError(unknown?'Submission outcome is unknown. Check the Ark console before trying again.':this.redact(message??`Seedance request failed (HTTP ${response.status})`),
        unknown?'unknown':method==='POST'?'rejected':'failed',code?this.redact(code):undefined,response.status);
    }
    return data;
  }
}
