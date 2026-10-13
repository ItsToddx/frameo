import AdmZip from 'adm-zip';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { mkdir, writeFile, stat, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ProjectDatabase, id, now, type PersistedState } from './database';
import { validateSequence } from '../../../../../packages/core/src/index';
import {archiveMedia, hashFile} from '../runtime/media';
import type { ProjectSnapshot } from '../contracts/api';

export async function shareProject(database:ProjectDatabase,path:string):Promise<void> {
  const state=database.read();const zip=new AdmZip();
  const manifest={format:'reelbeam-project',version:1,name:state.project.name,sequences:state.sequences,assets:state.assets.map(({url,thumbnailUrl,originJobId,...asset})=>asset),canvas:state.canvas};
  zip.addFile('project.json',Buffer.from(JSON.stringify(manifest,null,2)));
  zip.addFile('README.txt',Buffer.from('Reelbeam shared project. Contains media and edit data. No account keys, chats, personal memories, reviews, jobs or installed code. Import does not execute Kits.\n'));
  const added=new Set<string>();let size=0;for(const asset of state.assets){const source=resolve(database.directory,asset.path);if(!/^media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.path)||!source.startsWith(database.directory+'/media/')||!existsSync(source))throw new Error(`素材缺失：${asset.name}`);if(added.has(asset.path))continue;added.add(asset.path);size+=(await stat(source)).size;if(size>512*1024*1024)throw new Error('共享工程当前最多包含 512 MB 媒体。');if(await hashFile(source)!==asset.hash)throw new Error(`素材版本被外部修改：${asset.name}`);zip.addLocalFile(source,'media',asset.path.split('/').pop());}
  await writeFile(path,zip.toBuffer());
}
export async function importSharedProject(archive:string,directory:string):Promise<ProjectDatabase> {
  if(existsSync(directory))throw new Error('目标位置已经存在，请选择新工程目录。');
  if((await stat(archive)).size>512*1024*1024)throw new Error('共享工程压缩包超过 512 MB。');
  const zip=new AdmZip(archive);const entries=zip.getEntries();if(entries.length>3000)throw new Error('共享工程包含过多文件。');
  const names=new Set<string>();let total=0;for(const entry of entries){total+=entry.header.size;if(total>512*1024*1024)throw new Error('共享工程展开后超过 512 MB。');const name=entry.entryName;if(names.has(name))throw new Error('共享工程包含重复路径。');names.add(name);if(name.includes('\\')||name.split('/').includes('..')||isAbsolute(name)||(entry.header.attr>>>16&0o170000)===0o120000)throw new Error('共享工程含不安全的文件路径。');if(!entry.isDirectory&&!['project.json','README.txt'].includes(name)&&!/^media\/[a-f0-9]{64}\.[a-zA-Z0-9]+$/.test(name))throw new Error('共享工程包含不允许的文件。');}
  const manifestEntry=zip.getEntry('project.json');if(!manifestEntry||manifestEntry.header.size>10*1024*1024)throw new Error('共享工程缺少有效清单。');
  const manifest=JSON.parse(manifestEntry.getData().toString('utf8')) as {format:string;version:number;name:string;sequences:ProjectSnapshot['sequences'];assets:ProjectSnapshot['assets'];canvas:ProjectSnapshot['canvas']};
  if(manifest.format!=='reelbeam-project'||manifest.version!==1||!Array.isArray(manifest.sequences)||!Array.isArray(manifest.assets)||!Array.isArray(manifest.canvas?.items))throw new Error('不支持此共享工程格式。');
  if(typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>100||manifest.sequences.length>100||manifest.assets.length>1000)throw new Error('共享工程清单参数无效。');
  if(new Set(manifest.sequences.map(s=>s.id)).size!==manifest.sequences.length||new Set(manifest.assets.map(a=>a.id)).size!==manifest.assets.length)throw new Error('共享工程包含重复对象 ID。');
  for(const sequence of manifest.sequences)validateSequence(sequence,manifest.assets);
  for(const item of manifest.canvas.items)if(!Number.isFinite(item.x)||!Number.isFinite(item.y)||!Number.isFinite(item.width)||!Number.isFinite(item.height)||item.width<80||item.height<60||!(['asset','sequence'].includes(item.kind))||!(item.kind==='asset'?manifest.assets:manifest.sequences).some(value=>value.id===item.refId))throw new Error('共享工程画布引用无效。');
  await mkdir(dirname(directory),{recursive:true});const staging=await mkdtemp(join(dirname(directory),'.reelbeam-import-'));let database:ProjectDatabase|undefined;
  try{for(const folder of ['media','cache','sessions','snapshots'])await mkdir(join(staging,folder),{recursive:true});
  for(const asset of manifest.assets){if(!/^media\/[a-f0-9]{64}\.[a-zA-Z0-9]+$/.test(asset.path))throw new Error('素材路径不合法。');const entry=zip.getEntry(asset.path);if(!entry)throw new Error(`共享工程缺少素材：${asset.name}`);const content=entry.getData();const {createHash}=await import('node:crypto');if(createHash('sha256').update(content).digest('hex')!==asset.hash)throw new Error('共享素材摘要不匹配。');await writeFile(join(staging,asset.path),content);const decoded=await archiveMedia(staging,join(staging,asset.path),asset.name);if(decoded.hash!==asset.hash||asset.path!==decoded.path||decoded.kind!==asset.kind||Math.abs(decoded.duration-asset.duration)>0.05)throw new Error('共享媒体内容与清单不一致。');Object.assign(asset,decoded,{id:asset.id,createdAt:asset.createdAt});delete asset.originJobId;}
  for(const sequence of manifest.sequences)validateSequence(sequence,manifest.assets);const timestamp=now();database=new ProjectDatabase(staging);
  database.write({formatVersion:1,project:{id:id(),name:manifest.name,path:database.directory,createdAt:timestamp,updatedAt:timestamp},sequences:manifest.sequences,assets:manifest.assets,canvas:manifest.canvas,jobs:[],sessions:[{id:id(),title:'创作对话',messages:[]}],memories:[],reviews:[],recipes:[],canUndo:{},canRedo:{},eventSeq:0,undo:{},redo:{},canvasUndo:[],canvasRedo:[]});database.close();database=undefined;await rename(staging,directory);return new ProjectDatabase(directory);
  }catch(error){database?.close();await rm(staging,{recursive:true,force:true});throw error;}
}
