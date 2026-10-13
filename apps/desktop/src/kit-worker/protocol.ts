import type {CapabilityDescriptor,AgentDefinition,RecipeDefinition,KitManifest,JsonValue,ToolResult,EditProposal,JobDraft} from '../../../../packages/kit-sdk/src/index.js';
export interface KitLoadResult {descriptors:CapabilityDescriptor[];agents:AgentDefinition[];recipes:RecipeDefinition[]}
export interface CodeKitContext {projectId:string;sequenceId?:string;revision?:number;snapshot:JsonValue}
export type CodeKitResult=ToolResult|EditProposal|JobDraft;
export type HostToKitWorker={type:'load';callId:string;directory:string;manifest:KitManifest;dependencies:KitManifest[];expectedDigest?:string}
  |{type:'invoke';callId:string;capabilityId:string;input:JsonValue;context:CodeKitContext}|{type:'abort';callId:string}|{type:'dispose'};
export type KitWorkerToHost={type:'ready'}|{type:'result';callId:string;result:KitLoadResult|CodeKitResult}|{type:'error';callId:string;error:string};
