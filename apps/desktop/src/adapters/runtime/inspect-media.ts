import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {join,relative,sep,extname} from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {z} from 'zod';
import type {Asset} from '../contracts/api.js';
import {ffmpegPath,runProcess,probe} from './media.js';

export interface AudioSummary {
  sampleStartSeconds:number;sampleDurationSeconds:number;sampleRate:number;channels:1;
  rms:number;peak:number;rmsDbfs:number|null;peakDbfs:number|null;clippedSamples:number;
}
export interface MediaInspection {
  image?:{data:string;mimeType:'image/jpeg'};
  value:{assetVersionId:string;hash:string;timeSeconds:number;duration:number;kind:Asset['kind'];
    width?:number;height?:number;previewWidth?:number;previewHeight?:number;frameTimeSeconds?:number;audioSummary?:AudioSummary};
}
export interface InspectMediaInput {directory:string;asset:Asset;timeSeconds?:number;signal?:AbortSignal}
const maxImageBytes=128*1024;
const assetSchema=z.object({id:z.string().min(1).max(200),hash:z.string().regex(/^[0-9a-f]{64}$/),
  kind:z.enum(['image','video','audio']),path:z.string().regex(/^media\/[0-9a-f]{64}\.[a-z0-9]+$/),duration:z.number().finite().nonnegative(),
  width:z.number().int().positive().optional(),height:z.number().int().positive().optional(),hasAudio:z.boolean().optional()});

/** Decode actual registered media locally. Only the bounded JPEG and measured facts leave this adapter. */
export async function inspectMedia(input:InspectMediaInput):Promise<MediaInspection> {
  const signal=input.signal?AbortSignal.any([input.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
  signal.throwIfAborted();const asset=assetSchema.parse(input.asset),requested=z.number().finite().nonnegative().parse(input.timeSeconds??0);
  const root=await realpath(input.directory),media=join(root,'media');
  if((await lstat(media)).isSymbolicLink())throw new Error('Media inspection refuses a symlinked media directory');
  const source=join(root,asset.path),before=await lstat(source);
  if(before.isSymbolicLink()||!before.isFile()||before.size===0)throw new Error('Media inspection requires an immutable regular media file');
  const resolved=await realpath(source),rel=relative(media,resolved);
  if(rel==='..'||rel.startsWith('..'+sep)||rel.startsWith(sep))throw new Error('Media inspection path is outside the project media directory');
  if(!source.includes(`/${asset.hash}.`)||await checksum(source,signal)!==asset.hash)throw new Error('Media asset hash does not match its registered version');
  const metadata=await probe(source,signal),video=metadata.streams.find(s=>s.codec_type==='video'),audio=metadata.streams.find(s=>s.codec_type==='audio');
  const imageExtension=['.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff'].includes(extname(asset.path));
  const imageContainer=/(^|,)(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe)(,|$)/.test((metadata.format as {format_name?:string}).format_name??'');
  const actualKind=imageExtension&&imageContainer&&video?'image':video?'video':audio?'audio':undefined;
  if(!actualKind||actualKind!==asset.kind)throw new Error('Registered media kind does not match the decoded source');
  const duration=actualKind==='image'?0:Number(metadata.format.duration??video?.duration??0);
  if(!Number.isFinite(duration)||(actualKind!=='image'&&duration<=0)||Math.abs(asset.duration-duration)>0.05)throw new Error('Registered duration does not match the decoded source');
  if((actualKind==='image'&&requested!==0)||requested>duration)throw new Error('Inspection source time is outside the media duration');
  if(video&&(!video.width||!video.height||video.width>32768||video.height>32768||(asset.width!==undefined&&asset.width!==video.width)||(asset.height!==undefined&&asset.height!==video.height)))throw new Error('Registered image dimensions do not match the decoded source');
  if(asset.hasAudio!==undefined&&asset.hasAudio!==!!audio)throw new Error('Registered audio metadata does not match the decoded source');
  const cache=join(root,'cache');await mkdir(cache,{recursive:true});
  if((await lstat(cache)).isSymbolicLink()||relative(root,await realpath(cache))!=='cache')throw new Error('Inspection cache must stay inside the project');
  const temp=await mkdtemp(join(cache,'inspect-'));
  try {
    const value:MediaInspection['value']={assetVersionId:asset.id,hash:asset.hash,timeSeconds:requested,duration,kind:actualKind};
    let image:MediaInspection['image'];
    if(video) {
      value.width=video.width;value.height=video.height;
      const factor=Math.min(1,640/video.width!,640/video.height!),width=Math.max(2,Math.floor(video.width!*factor/2)*2),height=Math.max(2,Math.floor(video.height!*factor/2)*2);
      const fps=frameRate(video.r_frame_rate),frameTime=actualKind==='image'?0:Math.min(requested,Math.max(0,duration-1/fps));
      // Input seeking discards pre-roll and decodes the frame at the requested source time.
      const jpeg=join(temp,'frame.jpg');
      await runProcess(ffmpegPath(),['-y','-v','error',...(actualKind==='video'?['-ss',decimal(frameTime)]:[]),'-i',source,'-map','0:v:0','-frames:v','1','-vf',`scale=${width}:${height}`,'-q:v','5',jpeg],{signal,maxOutput:16384});
      const result=await boundedJpeg(jpeg,width,height,signal);image={data:result.bytes.toString('base64'),mimeType:'image/jpeg'};
      value.previewWidth=result.width;value.previewHeight=result.height;value.frameTimeSeconds=frameTime;
    }
    if(audio) {
      const sampleStart=requested===duration?Math.max(0,duration-3):requested,sampleDuration=Math.min(3,duration-sampleStart);
      const wave=join(temp,'sample.wav');
      await runProcess(ffmpegPath(),['-y','-v','error','-ss',decimal(sampleStart),'-i',source,'-map','0:a:0','-vn','-t',decimal(sampleDuration),'-ac','1','-ar','16000','-c:a','pcm_s16le',wave],{signal,maxOutput:16384});
      if((await lstat(wave)).size>maxImageBytes)throw new Error('Decoded audio sample exceeds its size limit');
      value.audioSummary=measurePcmWave(await readFile(wave),sampleStart);
    }
    const after=await lstat(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw new Error('Media source changed during inspection');
    signal.throwIfAborted();return {value,...(image?{image}:{})};
  }finally{await rm(temp,{recursive:true,force:true});}
}
async function checksum(path:string,signal:AbortSignal):Promise<string> {
  const hash=createHash('sha256');for await(const bytes of createReadStream(path,{signal})){signal.throwIfAborted();hash.update(bytes);}return hash.digest('hex');
}
function decimal(value:number):string{return Number(value.toFixed(9)).toString();}
function frameRate(rate:string|undefined):number {const [n,d]=(rate??'24/1').split('/').map(Number),value=n/(d??1);return Number.isFinite(value)&&value>0&&value<=240?value:24;}
async function boundedJpeg(path:string,width:number,height:number,signal:AbortSignal):Promise<{bytes:Buffer;width:number;height:number}> {
  if((await lstat(path)).size>4*1024*1024)throw new Error('Extracted frame exceeds decode limits');
  let bytes:Buffer=await readFile(path);if(bytes.length<=maxImageBytes)return {bytes,width,height};
  const decoded=await loadImage(bytes);signal.throwIfAborted();
  for(const bound of [640,512,384,256,128]) {
    const factor=Math.min(1,bound/decoded.width,bound/decoded.height),w=Math.max(1,Math.floor(decoded.width*factor)),h=Math.max(1,Math.floor(decoded.height*factor));
    const canvas=createCanvas(w,h),context=canvas.getContext('2d');context.drawImage(decoded,0,0,w,h);bytes=canvas.toBuffer('image/jpeg',70);signal.throwIfAborted();
    if(bytes.length<=maxImageBytes)return {bytes,width:w,height:h};
  }
  throw new Error('Could not bound the inspection image');
}
function measurePcmWave(wave:Buffer,sampleStartSeconds:number):AudioSummary {
  if(wave.length<44||wave.subarray(0,4).toString()!=='RIFF'||wave.subarray(8,12).toString()!=='WAVE')throw new Error('Decoded audio is not a valid WAV sample');
  let pcm:Buffer|undefined,sampleRate=0,channels=0,bits=0,format=0;
  for(let offset=12;offset+8<=wave.length;) {
    const size=wave.readUInt32LE(offset+4),start=offset+8,end=start+size;if(end>wave.length)throw new Error('Decoded audio sample is incomplete');
    const type=wave.subarray(offset,offset+4).toString();
    if(type==='fmt '){if(size<16)throw new Error('Decoded audio format is incomplete');format=wave.readUInt16LE(start);channels=wave.readUInt16LE(start+2);sampleRate=wave.readUInt32LE(start+4);bits=wave.readUInt16LE(start+14);}
    if(type==='data')pcm=wave.subarray(start,end);offset=end+(size%2);
  }
  if(!pcm?.length||pcm.length%2||format!==1||channels!==1||sampleRate!==16000||bits!==16)throw new Error('Decoded audio must be mono 16 kHz PCM16');
  const count=pcm.length/2;if(count/sampleRate>3.001)throw new Error('Audio inspection sample exceeds three seconds');
  let squares=0,peak=0,clippedSamples=0;
  for(let n=0;n<count;n++){const raw=pcm.readInt16LE(n*2),value=raw/32768;squares+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(raw)>=32760)clippedSamples++;}
  const rms=Math.sqrt(squares/count),round=(value:number)=>Number(value.toFixed(6)),db=(value:number)=>value===0?null:round(20*Math.log10(value));
  return {sampleStartSeconds,sampleDurationSeconds:count/sampleRate,sampleRate,channels:1,rms:round(rms),peak:round(peak),rmsDbfs:db(rms),peakDbfs:db(peak),clippedSamples};
}
