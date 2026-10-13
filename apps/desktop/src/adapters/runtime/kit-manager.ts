import {randomUUID} from 'node:crypto';
import {lstat,mkdir,readdir,readFile,writeFile,copyFile,realpath,rm,rename,open} from 'node:fs/promises';
import {join,relative,sep,dirname} from 'node:path';
import AdmZip from 'adm-zip';
import {z} from 'zod';
import {manifestSchema,assertJsonValue} from '../../../../../packages/kit-sdk/src/index.js';
import type {KitManifest,CapabilityDescriptor,AgentDefinition,RecipeDefinition,JsonValue,ToolContext} from '../../../../../packages/kit-sdk/src/index.js';
import type {KitInfo} from '../contracts/api.js';
import {CodeKitRuntime,codeKitDigest,type CodeKitResult,type KitLoadResult} from './code-kits.js';
import {builtinManifests} from './kits.js';

export interface InstallPlan {manifest:KitManifest;digest:string;stagingDirectory:string;source:string}
export interface NativeKitManagerOptions {directory:string;workerPath:string;onChange?:()=>void}
export type OwnedCapability=CapabilityDescriptor & {kitId:string};
interface StoredInstall {manifest:KitManifest;digest:string;source:string;enabled:boolean;installedAt:string}
interface LoadedKit {runtime:CodeKitRuntime;value:KitLoadResult}
const digestSchema=z.string().regex(/^[0-9a-f]{64}$/);
const storedSchema=z.object({manifest:manifestSchema,digest:digestSchema,source:z.string().min(1).max(4096),enabled:z.boolean(),installedAt:z.string()}).strict();
const indexSchema=z.object({schemaVersion:z.literal(1),installs:z.array(storedSchema).max(200)}).strict();
const MAX_FILES=500,MAX_EXPANDED=50*1024*1024,MAX_ARCHIVE=20*1024*1024;

/** Only install() may execute code, after the host has displayed and accepted a trust review. */
export class NativeKitManager {
  private installs=new Map<string,StoredInstall>();private loaded=new Map<string,LoadedKit>();
  private activating=new Set<CodeKitRuntime>();
  private ready?:Promise<void>;private mutation:Promise<unknown>=Promise.resolve();
  private externalDependencies:KitManifest[]=[];private disposed=false;
  constructor(private options:NativeKitManagerOptions){}
  async prepareImport(source:string):Promise<InstallPlan> {
    await this.initialize();this.assertActive();
    const stat=await lstat(source);if(stat.isSymbolicLink())throw new Error('Native Kit source cannot be a symlink');
    const stage=join(this.options.directory,'staging',randomUUID());await mkdir(stage,{recursive:true});
    try {
      if(stat.isDirectory())await copyPackage(source,stage);
      else if(stat.isFile()&&/\.zip$/i.test(source))await extractPackage(source,stage);
      else throw new Error('Choose a native Kit directory or ZIP archive');
      const packageDirectory=await packageRoot(stage);
      const manifest=manifestSchema.parse(JSON.parse(await readFile(join(packageDirectory,'kit.manifest.json'),'utf8')));
      validateNativeManifest(manifest);
      const digest=await codeKitDigest(packageDirectory);
      return {manifest,digest,stagingDirectory:packageDirectory,source};
    } catch(error){await rm(stage,{recursive:true,force:true});throw error;}
  }
  async install(plan:InstallPlan,dependencies:KitManifest[]=[]):Promise<KitInfo> {
    return this.serial(async()=>{
      await this.initialize();this.assertActive();validateNativeManifest(plan.manifest);digestSchema.parse(plan.digest);
      const stagedRoot=await realpath(join(this.options.directory,'staging')),staged=await realpath(plan.stagingDirectory);
      if(!inside(stagedRoot,staged)||stagedRoot===staged)throw new Error('Install plan must use the prepared staging directory');
      const onDisk=manifestSchema.parse(JSON.parse(await readFile(join(staged,'kit.manifest.json'),'utf8')));
      if(canonical(onDisk)!==canonical(plan.manifest)||await codeKitDigest(staged)!==plan.digest)throw new Error('Native Kit changed since the trust review; prepare and review it again');
      const environment=this.environment(dependencies,plan.manifest.id);
      validateDependencies(plan.manifest,environment,this.installs);
      const destination=this.versionDirectory(plan.manifest,plan.digest);
      await mkdir(dirname(destination),{recursive:true});
      try {await lstat(destination);if(await codeKitDigest(destination)!==plan.digest)throw new Error('Stored native Kit content was changed');}
      catch(error){if(!isMissing(error))throw error;await copyPackage(staged,destination);}
      const candidate=await this.activate(destination,plan.manifest,plan.digest,environment);
      const previous=this.installs.get(plan.manifest.id),old=this.loaded.get(plan.manifest.id);
      const disabledDependents=previous&&previous.manifest.version!==plan.manifest.version?this.dependents(plan.manifest.id):new Set<string>();
      const dependentState=new Map<string,boolean>();
      for(const id of disabledDependents){const dependent=this.installs.get(id)!;dependentState.set(id,dependent.enabled);dependent.enabled=false;}
      const record:StoredInstall={manifest:structuredClone(plan.manifest),digest:plan.digest,source:plan.source,enabled:true,installedAt:new Date().toISOString()};
      this.installs.set(plan.manifest.id,record);
      try{await this.persist();}catch(error){if(previous)this.installs.set(plan.manifest.id,previous);else this.installs.delete(plan.manifest.id);for(const [id,enabled]of dependentState)this.installs.get(id)!.enabled=enabled;candidate.runtime.dispose();throw error;}
      this.loaded.set(plan.manifest.id,candidate);old?.runtime.dispose();this.externalDependencies=structuredClone(dependencies);
      for(const id of disabledDependents){this.loaded.get(id)?.runtime.dispose();this.loaded.delete(id);}
      await rm(staged,{recursive:true,force:true});this.changed();return this.info(record);
    });
  }
  async loadInstalled(dependencies:KitManifest[]=[]):Promise<void> {
    return this.serial(async()=>{
      await this.initialize();this.assertActive();this.externalDependencies=structuredClone(dependencies);
      // Rebuild in dependency order. Only exact previously trusted content can be loaded on restart.
      for(const loaded of this.loaded.values())loaded.runtime.dispose();this.loaded.clear();
      const remaining=new Map([...this.installs].filter(([,r])=>r.enabled));const errors:string[]=[];
      while(remaining.size) {
        let progressed=false;
        for(const [id,record]of [...remaining]) {
          if(Object.keys(record.manifest.dependencies).some(dep=>remaining.has(dep)))continue;
          remaining.delete(id);progressed=true;
          try {
            const environment=this.environment(dependencies,id);validateDependencies(record.manifest,environment,this.installs);
            const loaded=await this.activate(this.versionDirectory(record.manifest,record.digest),record.manifest,record.digest,environment);
            this.loaded.set(id,loaded);
          } catch(error){errors.push(`${record.manifest.name}: ${error instanceof Error?error.message:'activation failed'}`);}
        }
        if(!progressed){errors.push('Native Kit dependency cycle detected');break;}
      }
      this.changed();if(errors.length)throw new Error(errors.join('\n'));
    });
  }
  list():KitInfo[]{return [...this.installs.values()].map(record=>this.info(record));}
  manifests():KitManifest[]{return [...this.installs.values()].map(record=>structuredClone(record.manifest));}
  fingerprint(id:string):{manifest:KitManifest;digest:string}|undefined {const record=this.installs.get(id);return record?{manifest:structuredClone(record.manifest),digest:record.digest}:undefined;}
  async setEnabled(id:string,enabled:boolean,dependencies:KitManifest[]=[]):Promise<void> {
    return this.serial(async()=>{
      await this.initialize();this.assertActive();const record=this.installs.get(id);if(!record)throw new Error('Native Kit is not installed');
      if(enabled) {
        const environment=this.environment(dependencies,id);validateDependencies(record.manifest,environment,this.installs);
        const candidate=await this.activate(this.versionDirectory(record.manifest,record.digest),record.manifest,record.digest,environment);
        const previousEnabled=record.enabled;record.enabled=true;
        try{await this.persist();}catch(error){record.enabled=previousEnabled;candidate.runtime.dispose();throw error;}
        const old=this.loaded.get(id);this.loaded.set(id,candidate);old?.runtime.dispose();this.externalDependencies=structuredClone(dependencies);
      } else {
        const disabled=this.dependents(id);disabled.add(id);const previous=new Map<string,boolean>();
        for(const disabledId of disabled){const target=this.installs.get(disabledId)!;previous.set(disabledId,target.enabled);target.enabled=false;}
        try{await this.persist();}catch(error){for(const [key,value]of previous)this.installs.get(key)!.enabled=value;throw error;}
        for(const disabledId of disabled){this.loaded.get(disabledId)?.runtime.dispose();this.loaded.delete(disabledId);}
      }
      this.changed();
    });
  }
  async uninstall(id:string):Promise<void> {
    return this.serial(async()=>{
      await this.initialize();this.assertActive();const record=this.installs.get(id);if(!record)throw new Error('Native Kit is not installed');
      if(this.dependents(id).size)throw new Error('Uninstall dependent native Kits first');
      this.installs.delete(id);try{await this.persist();}catch(error){this.installs.set(id,record);throw error;}
      this.loaded.get(id)?.runtime.dispose();this.loaded.delete(id);this.changed();
      // Retain pinned source versions for recovery and already recorded task provenance.
    });
  }
  capabilities():OwnedCapability[]{return [...this.loaded].filter(([,loaded])=>runtimeReady(loaded.runtime)).flatMap(([kitId,loaded])=>loaded.value.descriptors.map(d=>({...structuredClone(d),kitId})));}
  agents():AgentDefinition[]{return [...this.loaded.values()].filter(l=>runtimeReady(l.runtime)).flatMap(l=>structuredClone(l.value.agents));}
  recipes():RecipeDefinition[]{return [...this.loaded.values()].filter(l=>runtimeReady(l.runtime)).flatMap(l=>structuredClone(l.value.recipes));}
  async invoke(capabilityId:string,input:JsonValue,context:ToolContext):Promise<CodeKitResult> {
    await this.initialize();this.assertActive();context.signal.throwIfAborted();
    const owned=this.capabilities().find(c=>c.id===capabilityId);if(!owned||!['read','edit','job'].includes(owned.kind))throw new Error('Native Kit tool is unavailable');
    const record=this.installs.get(owned.kitId),loaded=this.loaded.get(owned.kitId);
    if(!record?.enabled||!loaded)throw new Error('Native Kit is disabled');
    validateDependencies(record.manifest,this.environment(this.externalDependencies,owned.kitId),this.installs);
    try{return await loaded.runtime.invoke(capabilityId,input,context);}
    catch(error){if(/worker exited|worker failed|not loaded|disposed|communication failed/.test(error instanceof Error?error.message:'')){loaded.runtime.dispose();this.loaded.delete(owned.kitId);this.changed();}throw error;}
  }
  dispose():void{this.disposed=true;for(const loaded of this.loaded.values())loaded.runtime.dispose();for(const runtime of this.activating)runtime.dispose();this.activating.clear();this.loaded.clear();}
  private assertActive():void{if(this.disposed)throw new Error('Native Kit manager is disposed');}
  private serial<T>(operation:()=>Promise<T>):Promise<T> {const next=this.mutation.then(operation,operation);this.mutation=next.catch(()=>{});return next;}
  private async initialize():Promise<void> {
    if(this.ready)return this.ready;
    this.ready=(async()=>{
      await mkdir(join(this.options.directory,'staging'),{recursive:true});await mkdir(join(this.options.directory,'versions'),{recursive:true});
      let text:string;try{text=await readFile(join(this.options.directory,'native-installed.json'),'utf8');}catch(error){if(isMissing(error))return;throw error;}
      if(new TextEncoder().encode(text).byteLength>2*1024*1024)throw new Error('Native Kit install index is too large');
      const parsed=indexSchema.parse(JSON.parse(text));const ids=new Set<string>();
      for(const record of parsed.installs){validateNativeManifest(record.manifest);if(ids.has(record.manifest.id))throw new Error('Native Kit index has duplicate IDs');ids.add(record.manifest.id);this.installs.set(record.manifest.id,record);}
    })();return this.ready;
  }
  private environment(external:KitManifest[],excludeId:string):KitManifest[] {
    const map=new Map<string,KitManifest>();for(const m of external){manifestSchema.parse(m);map.set(m.id,m);}
    for(const [id,loaded]of this.loaded){const r=this.installs.get(id);if(id!==excludeId&&r?.enabled&&loaded)map.set(id,r.manifest);}
    return [...map.values()];
  }
  private async activate(directory:string,manifest:KitManifest,digest:string,dependencies:KitManifest[]):Promise<LoadedKit> {
    if(await codeKitDigest(directory)!==digest)throw new Error('Native Kit content changed; a new trust review is required');
    const runtime=new CodeKitRuntime({workerPath:this.options.workerPath});
    this.activating.add(runtime);
    try {
      const value=await runtime.load(directory,manifest,{dependencies,expectedDigest:digest});
      this.assertActive();
      const occupied=new Set(this.capabilities().filter(c=>c.kitId!==manifest.id).map(c=>c.id));
      for(const d of value.descriptors)if(occupied.has(d.id))throw new Error(`Native capability is already registered: ${d.id}`);
      return {runtime,value};
    }catch(error){runtime.dispose();throw error;}finally{this.activating.delete(runtime);}
  }
  private versionDirectory(manifest:KitManifest,digest:string):string{return join(this.options.directory,'versions',manifest.id,manifest.version,digest);}
  private async persist():Promise<void> {
    const content=JSON.stringify({schemaVersion:1,installs:[...this.installs.values()]},null,2)+'\n';
    const temp=join(this.options.directory,`native-installed.${randomUUID()}.tmp`),file=await open(temp,'wx',0o600);
    try{await file.writeFile(content);await file.sync();}finally{await file.close();}
    try{await rename(temp,join(this.options.directory,'native-installed.json'));}catch(error){await rm(temp,{force:true});throw error;}
  }
  private dependents(id:string):Set<string> {
    const result=new Set<string>();let added=true;
    while(added){added=false;for(const [key,r]of this.installs)if(key!==id&&!result.has(key)&&Object.keys(r.manifest.dependencies).some(d=>d===id||result.has(d))){result.add(key);added=true;}}
    return result;
  }
  private info(record:StoredInstall):KitInfo {
    const kind=record.manifest.capabilities[0].kind;return {id:record.manifest.id,name:record.manifest.name,version:record.manifest.version,
      description:record.manifest.description,author:record.manifest.author,license:record.manifest.license,source:record.source,
      permissions:[...record.manifest.permissions],installed:true,enabled:record.enabled&&!!this.loaded.get(record.manifest.id)&&runtimeReady(this.loaded.get(record.manifest.id)!.runtime),
      category:['read','edit','job'].includes(kind)?'tool':kind as KitInfo['category']};
  }
  private changed():void{try{this.options.onChange?.();}catch{/* UI listeners cannot roll back a committed installation. */}}
}
function runtimeReady(runtime:CodeKitRuntime):boolean{return (runtime as CodeKitRuntime&{isLoaded?:boolean}).isLoaded!==false;}
function validateNativeManifest(manifest:KitManifest):void {
  manifestSchema.parse(manifest);assertJsonValue(manifest);
  if(!manifest.entry)throw new Error('Native Kit manifest must declare a relative JavaScript entry');
  const reservedIds=new Set(builtinManifests.flatMap(m=>[m.id,...m.capabilities.map(c=>c.id)]));
  if(reservedIds.has(manifest.id)||manifest.capabilities.some(c=>reservedIds.has(c.id)))throw new Error('A native Kit cannot replace a curated built-in capability');
  if(Object.hasOwn(manifest.dependencies,manifest.id))throw new Error('Native Kit cannot depend on itself');
  if(new Set(manifest.capabilities.map(c=>c.id)).size!==manifest.capabilities.length)throw new Error('Native Kit declares duplicate capabilities');
}
function validateDependencies(manifest:KitManifest,environment:KitManifest[],installed:Map<string,StoredInstall>):void {
  const available=new Map(environment.map(m=>[m.id,m.version]));
  for(const [id,version]of Object.entries(manifest.dependencies))if(available.get(id)!==version)throw new Error(`Enabled Kit dependency required: ${id}@${version}`);
  const active=new Set<string>(),visited=new Set<string>();
  function visit(id:string){if(active.has(id))throw new Error('Native Kit dependency cycle detected');if(visited.has(id))return;active.add(id);
    const m=id===manifest.id?manifest:installed.get(id)?.manifest;for(const dependency of Object.keys(m?.dependencies??{}))visit(dependency);active.delete(id);visited.add(id);}
  visit(manifest.id);
}
function canonical(value:unknown):string {
  function order(v:unknown):unknown{if(Array.isArray(v))return v.map(order);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,child])=>[k,order(child)]));return v;}
  return JSON.stringify(order(value));
}
function isMissing(error:unknown):boolean{return !!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';}
function inside(root:string,path:string):boolean{const r=relative(root,path);return r!== '..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep);}
function safeArchivePath(name:string):string {
  const normalized=name.replace(/\/$/,'');
  if(!normalized||normalized.startsWith('/')||normalized.includes('\\')||/^[A-Za-z]:/.test(normalized)||normalized.split('/').some(p=>!p||p==='.'||p==='..'||p==='node_modules'||p==='.git')||normalized.includes('\0'))throw new Error('Native Kit archive contains an unsafe path');
  return normalized;
}
async function copyPackage(source:string,destination:string):Promise<void> {
  const root=await realpath(source);let files=0,bytes=0;await mkdir(destination,{recursive:true});
  if(inside(root,await realpath(destination)))throw new Error('Native Kit source cannot contain its install staging directory');
  async function visit(from:string,to:string,depth:number):Promise<void> {
    if(depth>20)throw new Error('Native Kit directory is too deeply nested');
    for(const entry of await readdir(from,{withFileTypes:true})) {
      safeArchivePath(entry.name);const input=join(from,entry.name),output=join(to,entry.name),stat=await lstat(input);
      if(stat.isSymbolicLink())throw new Error('Native Kit symlinks are not accepted');
      if(stat.isDirectory()){await mkdir(output,{recursive:true});await visit(input,output,depth+1);}
      else if(stat.isFile()){if(++files>MAX_FILES||(bytes+=stat.size)>MAX_EXPANDED)throw new Error('Native Kit exceeds expanded size or file count');await copyFile(input,output);}
      else throw new Error('Native Kit contains an unsupported filesystem entry');
    }
  }
  await visit(root,destination,0);
}
async function extractPackage(source:string,destination:string):Promise<void> {
  if((await lstat(source)).size>MAX_ARCHIVE)throw new Error('Native Kit ZIP exceeds 20 MiB');
  const zip=new AdmZip(await readFile(source));let files=0,expanded=0;const names=new Set<string>();
  const entries=zip.getEntries();if(entries.length>MAX_FILES*2)throw new Error('Native Kit ZIP has too many entries');
  for(const entry of entries) {
    const name=safeArchivePath(entry.entryName),mode=(entry.attr>>>16)&0xf000;
    if(mode===0xa000)throw new Error('Native Kit ZIP symlinks are not accepted');
    if(mode&&mode!==0x8000&&mode!==0x4000)throw new Error('Native Kit ZIP has an unsupported entry');
    if(names.has(name))throw new Error('Native Kit ZIP contains duplicate paths');names.add(name);
    if(!entry.isDirectory&&(++files>MAX_FILES||(expanded+=entry.header.size)>MAX_EXPANDED))throw new Error('Native Kit ZIP exceeds expanded size or file count');
  }
  for(const entry of entries) {
    const name=safeArchivePath(entry.entryName),output=join(destination,...name.split('/'));
    if(entry.isDirectory){await mkdir(output,{recursive:true});continue;}
    const data=entry.getData();if(data.byteLength!==entry.header.size)throw new Error('Native Kit ZIP has inconsistent entry size');
    await mkdir(dirname(output),{recursive:true});await writeFile(output,data,{flag:'wx',mode:0o600});
  }
}
async function packageRoot(stage:string):Promise<string> {
  try{await lstat(join(stage,'kit.manifest.json'));return stage;}catch(error){if(!isMissing(error))throw error;}
  const entries=await readdir(stage,{withFileTypes:true});if(entries.length===1&&entries[0].isDirectory()){const nested=join(stage,entries[0].name);await lstat(join(nested,'kit.manifest.json'));return nested;}
  throw new Error('Native Kit package must contain kit.manifest.json at its root');
}
