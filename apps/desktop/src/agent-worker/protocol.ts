import type {AgentMessage} from '@mariozechner/pi-agent-core';
import type {AgentDefinition,AgentRole} from '../../../../packages/kit-sdk/src/index.js';
import type {ProjectSnapshot} from '../adapters/contracts/api.js';

export type WorkerRole='coordinator'|AgentRole;
export type HostToolName='read_project'|'propose_edit'|'propose_generation'|'save_memory'|'capabilities_search'|'capabilities_describe'|'invoke_kit';
export interface WorkerRun {
  runId:string;sessionId:string;rootRequestId:string;text:string;role?:WorkerRole;
  context:{snapshot:ProjectSnapshot;sequenceId?:string;clipId?:string;memories?:string[];
    capabilities?:string[];agentDefinitions?:AgentDefinition[];enabledRoles?:AgentRole[]};
  history?:AgentMessage[];agentDefinition?:AgentDefinition;previousBudget?:RunBudget;
  settings:{arkBaseUrl:string;agentModel:string;apiKey:string;maxModelCalls?:number};
}
export interface HostToolRequest {
  runId:string;sessionId:string;rootRequestId:string;role:WorkerRole;toolCallId:string;name:HostToolName;args:Record<string,unknown>;
}
export interface RunBudget {modelCalls:number;toolCalls:number;elapsedMs:number;maxModelCalls:number;maxToolCalls:number;maxDurationMs:number}
export interface WorkerResult {status:'completed'|'stopped'|'failed';text:string;error?:string;budget:RunBudget;history:AgentMessage[]}
export interface RuntimeEvent {type:'chat.delta'|'agent.status';runId:string;sessionId:string;agent:WorkerRole;text?:string;status?:string}
export interface HistoryUpdate {runId:string;sessionId:string;role:WorkerRole;messages:AgentMessage[];append:boolean}
export type HostToWorker={type:'run';run:WorkerRun}|{type:'stop';runId:string}|{type:'tool.result';callId:string;result?:unknown;error?:string};
export type WorkerToHost={type:'ready'}|{type:'event';event:RuntimeEvent}|{type:'tool';callId:string;request:HostToolRequest}
  |{type:'history';update:HistoryUpdate}|{type:'settled';runId:string;result:WorkerResult};
