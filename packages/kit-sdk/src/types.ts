/** Public host-independent contracts. Kits never receive a database or Electron IPC. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export type JsonSchema = Record<string, unknown>;
export type CapabilityKind = 'read' | 'edit' | 'job' | 'provider' | 'agent' | 'recipe';
export type AgentRole = 'creative' | 'visual' | 'editor';
export interface CapabilityDescriptor {
  id: string; name: string; description: string; kind: CapabilityKind;
  inputSchema: JsonSchema; outputSchema: JsonSchema; permissions: string[];
}
export interface KitManifest {
  schemaVersion: 1; id: string; name: string; version: string; description: string;
  author: string; license: string; hostApi: '1'; source: string;
  permissions: string[]; dependencies: Record<string, string>;
  capabilities: {id: string; kind: CapabilityKind}[];
  /** Native code only: a reviewed relative JavaScript module. Never auto-loaded. */
  entry?: string;
}
export interface ToolContext {
  projectId: string; sequenceId?: string; revision?: number;
  snapshot: JsonValue; signal: AbortSignal;
}
export interface ToolResult {value: JsonValue; artifacts: {id: string; kind: string}[]}
export interface EditProposal {sequenceId: string; expectedRevision: number; commands: JsonValue[]; title: string}
export interface JobDraft {providerId: string; input: JsonValue; estimatedCost: number; title: string}
export interface ReadTool {descriptor: CapabilityDescriptor; execute(input: JsonValue, ctx: ToolContext): Promise<ToolResult>}
export interface EditTool {descriptor: CapabilityDescriptor; propose(input: JsonValue, ctx: ToolContext): Promise<EditProposal>}
export interface JobTool {descriptor: CapabilityDescriptor; plan(input: JsonValue, ctx: ToolContext): Promise<JobDraft>}
export interface ProviderStatus {status: 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'unknown'; outputUrl?: string; error?: string}
export interface MediaProvider {
  descriptor: CapabilityDescriptor;
  submit(input: JsonValue, signal?: AbortSignal): Promise<{remoteId: string}>;
  status(remoteId: string, signal?: AbortSignal): Promise<ProviderStatus>;
  cancel?(remoteId: string, signal?: AbortSignal): Promise<{acknowledged: boolean; status?: ProviderStatus['status']}>;
}
export interface AgentDefinition {descriptor: CapabilityDescriptor; role: AgentRole; systemPrompt: string; tools: string[]}
export type InputRef = {from: 'input'; pointer: string} | {from: 'step'; stepId: string; pointer: string};
export interface RecipeStepDefinition {
  id: string; title: string; capabilityId: string; role: AgentRole; dependsOn: string[];
  input: Record<string, InputRef | JsonValue>; reviewBefore: boolean; reviewAfter: boolean;
}
export interface RecipeDefinition {descriptor: CapabilityDescriptor; steps: RecipeStepDefinition[]; outputs: Record<string, InputRef>}
export interface DeclarativeKit {manifest: KitManifest; agents: AgentDefinition[]; recipes: RecipeDefinition[]}
export interface KitRegistration {
  registerReadTool(tool: ReadTool): () => void;
  registerEditTool(tool: EditTool): () => void;
  registerJobTool(tool: JobTool): () => void;
  registerProvider(provider: MediaProvider): () => void;
  registerAgent(agent: AgentDefinition): () => void;
  registerRecipe(recipe: RecipeDefinition): () => void;
}
export type RegisteredCapability = ReadTool | EditTool | JobTool | MediaProvider | AgentDefinition | RecipeDefinition;
