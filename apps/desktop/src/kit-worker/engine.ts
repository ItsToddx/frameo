import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {KitRegistry,manifestSchema,compileSchema,assertJsonValue,validateRecipe} from '../../../../packages/kit-sdk/src/index.js';
import type {KitManifest,KitRegistration,ReadTool,EditTool,JobTool,AgentDefinition,RecipeDefinition,JsonValue,CapabilityDescriptor,ToolContext} from '../../../../packages/kit-sdk/src/index.js';
import {codeKitDigest,resolveKitEntry} from './files.js';
import type {KitLoadResult,CodeKitResult,CodeKitContext} from './protocol.js';

const readResult=z.object({value:z.unknown(),artifacts:z.array(z.object({id:z.string().min(1),kind:z.string().min(1)}).strict()).max(1000)}).strict();
const editResult=z.object({sequenceId:z.string().min(1),expectedRevision:z.number().int().nonnegative(),commands:z.array(z.unknown()).min(1).max(100),title:z.string().min(1).max(160)}).strict();
const jobResult=z.object({providerId:z.string().min(1),input:z.unknown(),estimatedCost:z.number().finite().nonnegative(),title:z.string().min(1).max(160)}).strict();
export class CodeKitEngine {
  private registry?:KitRegistry;private cleanup?:()=>void;
  private validators=new Map<string,{input:(value:unknown)=>JsonValue;output:(value:unknown)=>JsonValue}>();
  async load(directory:string,manifest:KitManifest,dependencies:KitManifest[]=[],expectedDigest?:string):Promise<KitLoadResult> {
    if(this.registry)throw new Error('This worker already loaded a Kit');
    const reviewed=manifestSchema.parse(manifest);
    if(!reviewed.entry)throw new Error('A native Code Kit must declare an entry module');
    const digest=await codeKitDigest(directory);
    if(expectedDigest&&expectedDigest!==digest)throw new Error('Code Kit changed since trust review');
    const disk=manifestSchema.parse(JSON.parse(await readFile(join(directory,'kit.manifest.json'),'utf8')));
    if(JSON.stringify(canonical(disk))!==JSON.stringify(canonical(reviewed)))throw new Error('Code Kit manifest differs from the reviewed manifest');
    const versions:Record<string,string>={};
    for(const dependency of dependencies){const valid=manifestSchema.parse(dependency);versions[valid.id]=valid.version;}
    for(const [id,version]of Object.entries(reviewed.dependencies))if(id===reviewed.id||versions[id]!==version)throw new Error(`Kit dependency unavailable: ${id}@${version}`);
    const entry=await resolveKitEntry(directory,reviewed.entry);
    // Loading native code is permitted only after explicit host trust. This process is not an OS sandbox.
    const module=await import(pathToFileURL(entry).href);
    if(typeof module.register!=='function')throw new Error('Code Kit entry must export register(registration)');
    const registry=new KitRegistry(versions);
    const dispose=await registry.register(reviewed,(api:KitRegistration)=>module.register(api));
    try {
      const capabilities=registry.list();
      for(const capability of capabilities) {
        const d=capability.descriptor;
        this.validators.set(d.id,{input:compileSchema(d.inputSchema),output:compileSchema(d.outputSchema)});
        if(d.kind==='agent')validateAgent(capability as AgentDefinition);
        if(d.kind==='recipe')validateRecipe(capability as RecipeDefinition);
      }
      const descriptors=capabilities.map(c=>structuredClone(c.descriptor));
      const agents=capabilities.filter(c=>c.descriptor.kind==='agent').map(c=>structuredClone(c as AgentDefinition));
      const recipes=capabilities.filter(c=>c.descriptor.kind==='recipe').map(c=>structuredClone(c as RecipeDefinition));
      assertJsonValue({descriptors,agents,recipes});
      this.registry=registry;this.cleanup=dispose;return {descriptors,agents,recipes};
    } catch(error){dispose();this.validators.clear();throw error;}
  }
  async invoke(capabilityId:string,input:JsonValue,context:CodeKitContext,signal:AbortSignal):Promise<CodeKitResult> {
    signal.throwIfAborted();assertJsonValue(context,1024*1024);
    const capability=this.registry?.get(capabilityId);const validator=this.validators.get(capabilityId);
    if(!capability||!validator)throw new Error('Kit capability is unavailable');
    const parsed=validator.input(input),ctx:ToolContext={projectId:context.projectId,
      ...(context.sequenceId!==undefined?{sequenceId:context.sequenceId}:{}),...(context.revision!==undefined?{revision:context.revision}:{}),snapshot:structuredClone(context.snapshot),signal};
    let result:CodeKitResult;
    if(capability.descriptor.kind==='read')result=readResult.parse(await (capability as ReadTool).execute(parsed,ctx)) as CodeKitResult;
    else if(capability.descriptor.kind==='edit') {
      result=editResult.parse(await (capability as EditTool).propose(parsed,ctx)) as CodeKitResult;
      const proposal=result as import('../../../../packages/kit-sdk/src/index.js').EditProposal;
      if(proposal.sequenceId!==context.sequenceId||proposal.expectedRevision!==context.revision)throw new Error('Kit edit changed its target or expected revision');
    }
    else if(capability.descriptor.kind==='job')result=jobResult.parse(await (capability as JobTool).plan(parsed,ctx)) as CodeKitResult;
    else throw new Error('Only read, edit and job Kit tools can be invoked; model generation is managed by the host');
    signal.throwIfAborted();validator.output(result);assertJsonValue(result);return structuredClone(result);
  }
  dispose():void{this.cleanup?.();this.cleanup=undefined;this.registry=undefined;this.validators.clear();}
}
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)]));
  return value;
}
function validateAgent(agent:AgentDefinition):void {
  if(!['creative','visual','editor'].includes(agent.role)||typeof agent.systemPrompt!=='string'||!agent.systemPrompt.trim()||agent.systemPrompt.length>16000||!Array.isArray(agent.tools)||agent.tools.length>40||!agent.tools.every(t=>typeof t==='string'&&/^[a-z][a-z0-9._-]{1,100}$/.test(t)))throw new Error('Native Kit agent definition is invalid');
}
