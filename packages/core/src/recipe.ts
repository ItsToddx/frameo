/** Pure recipe execution state. The host persists snapshots and executes capabilities. */
export type RecipeJson = null | boolean | number | string | RecipeJson[] | {[key: string]: RecipeJson};
export type RecipeInputRef = {from: 'input'; pointer: string} | {from: 'step'; stepId: string; pointer: string};
export interface RecipeStepDefinition {
  id: string; title: string; capabilityId: string; role?: string; dependsOn: string[];
  input: Record<string, RecipeInputRef | RecipeJson>; reviewBefore?: boolean; reviewAfter: boolean; required?: boolean;
}
export interface RecipeDefinition {
  descriptor: {id: string; name: string; kind?: string}; steps: RecipeStepDefinition[]; outputs: Record<string, RecipeInputRef>;
}
export interface RecipeArtifact {id: string; kind: string}
export interface RecipeResult {value: RecipeJson; artifacts: RecipeArtifact[]}
export interface RecipeWaiting {id: string; kind: 'job' | 'proposal' | 'artifact'}
export interface RecipeTarget {projectId: string; sequenceId?: string; clipId?: string; expectedRevision?: number}
export interface RecipeDecision {decision: 'accept' | 'reject'; attempt: number; resultHash: string}
export interface RecipeInputDecision {decision: 'accept' | 'reject'; inputHash: string}
export type RecipeStepStatus = 'pending' | 'running' | 'review' | 'waiting' | 'completed' | 'failed' | 'stale';
export interface RecipeAttempt {
  attempt: number; status: RecipeStepStatus; input?: Record<string, RecipeJson>; inputHash?: string;
  output?: RecipeResult; result?: string; resultHash?: string; decision?: RecipeDecision;
  inputDecision?: RecipeInputDecision; waiting?: RecipeWaiting[]; error?: string;
}
export interface RecipeStep extends RecipeAttempt {
  id: string; title: string; capabilityId: string; role?: string; history: RecipeAttempt[]; reviewPhase?: 'input' | 'result';
}
export interface RecipeRun {
  id: string; title: string; revision: number; status: 'running' | 'paused' | 'completed' | 'failed';
  definition: RecipeDefinition; input: RecipeJson; frozenDependencies: Record<string, RecipeJson>; target: RecipeTarget;
  steps: RecipeStep[]; outputs?: Record<string, RecipeJson>;
}
export interface RecipeRevision {expectedRevision: number}
export interface RecipeStepRequest extends RecipeRevision {stepId: string}
export interface RecipeExecution {
  stepId: string; capabilityId: string; role?: string; input: Record<string, RecipeJson>; inputHash: string; reviewBefore: boolean;
}
export interface CompleteStepRequest extends RecipeStepRequest {
  attempt: number; result: RecipeResult; summary?: string; waiting?: RecipeWaiting[];
}
export interface DecideRecipeResultRequest extends RecipeStepRequest {
  attempt: number; resultHash: string; decision: 'accept' | 'reject';
}
export interface DecideRecipeInputRequest extends RecipeStepRequest {inputHash: string; decision: 'accept' | 'reject'}
export interface ResolveRecipeWaitingRequest extends RecipeStepRequest {
  attempt: number; resultHash: string; resolvedIds: string[]; result?: RecipeResult; summary?: string; waiting?: RecipeWaiting[];
}
export type AvailableRecipeArtifacts = readonly (string | RecipeArtifact)[];
export type RecipeErrorCode = 'INVALID_DEFINITION' | 'INVALID_INPUT' | 'REVISION_CONFLICT' | 'INVALID_STATE' | 'NOT_FOUND' | 'BINDING_MISSING' | 'ARTIFACT_MISSING' | 'STALE_REVIEW';
export class RecipeError extends Error {
  constructor(public readonly code: RecipeErrorCode, message: string, public readonly details: Record<string, unknown> = {}) {super(message); this.name = 'RecipeError';}
}
function fail(code: RecipeErrorCode, message: string, details?: Record<string, unknown>): never {throw new RecipeError(code, message, details);}
function identifier(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_INPUT', `${label} must be a nonempty ID of at most 256 characters`);
}
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', `${label} must be an object`);
}
function assertJson(value: unknown, active = new Set<object>(), depth = 0): asserts value is RecipeJson {
  if (depth > 64) fail('INVALID_INPUT', 'Recipe JSON exceeds the maximum nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object') fail('INVALID_INPUT', 'Recipe values must be finite JSON data');
  if (active.has(value)) fail('INVALID_INPUT', 'Recipe JSON must not contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('INVALID_INPUT', 'Recipe values must contain plain JSON objects');
  active.add(value);
  if (Array.isArray(value)) for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail('INVALID_INPUT', 'Recipe JSON arrays must not contain holes');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_INPUT', 'Unsafe JSON property');
    assertJson(child, active, depth + 1);
  }
  active.delete(value);
}
function canonical(value: RecipeJson): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function json(value: unknown): RecipeJson {
  assertJson(value);
  if (new TextEncoder().encode(canonical(value)).length > 1024 * 1024) fail('INVALID_INPUT', 'Recipe JSON exceeds 1 MiB');
  return value;
}
function frozen<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {if (item && typeof item === 'object') {Object.values(item).forEach(freeze); Object.freeze(item);}}
  freeze(copy); return copy;
}

// SHA-256 is synchronous and runtime independent, so reviewing a result needs no SDK or external service.
const SHA_CONSTANTS = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
export function hashRecipeValue(value: unknown): string {
  const bytes = new TextEncoder().encode(canonical(json(value))); const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer); view.setUint32(size - 8, Math.floor(bytes.length * 8 / 2 ** 32)); view.setUint32(size - 4, bytes.length * 8);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  for (let offset = 0; offset < size; offset += 64) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = (rotate(x,7) ^ rotate(x,18) ^ (x >>> 3)) + words[i - 16] + (rotate(y,17) ^ rotate(y,19) ^ (y >>> 10)) + words[i - 7];
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + SHA_CONSTANTS[i] + words[i]) >>> 0;
      const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, i) => {hash[i] = (hash[i] + value) >>> 0;});
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

function pointerTokens(pointer: unknown): string[] {
  if (typeof pointer !== 'string' || pointer.length > 1000 || !/^(?:\/(?:[^~]|~[01])*)*$/.test(pointer)) fail('INVALID_DEFINITION', 'Invalid JSON Pointer');
  const tokens = pointer === '' ? [] : pointer.slice(1).split('/').map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (tokens.some(token => ['__proto__', 'prototype', 'constructor'].includes(token))) fail('INVALID_DEFINITION', 'Unsafe JSON Pointer');
  return tokens;
}
export function readRecipePointer(value: RecipeJson, pointer: string): RecipeJson {
  let current = value;
  for (const token of pointerTokens(pointer)) {
    if (!current || typeof current !== 'object' || (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(token)) || !Object.hasOwn(current, token)) {
      fail('BINDING_MISSING', `Recipe binding is unavailable: ${pointer}`, {pointer});
    }
    current = (current as Record<string, RecipeJson>)[token];
  }
  return structuredClone(current);
}
function inputRef(value: unknown): value is RecipeInputRef {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'from' in value;
}
function validateRef(ref: RecipeInputRef): void {
  if (ref.from !== 'input' && ref.from !== 'step') fail('INVALID_DEFINITION', 'Binding source must be input or step');
  pointerTokens(ref.pointer); if (ref.from === 'step') identifier(ref.stepId, 'Binding stepId');
}
export function validateRecipeDefinition(definition: RecipeDefinition): void {
  record(definition, 'Recipe definition'); record(definition.descriptor, 'Recipe descriptor');
  identifier(definition.descriptor.id, 'Recipe ID'); identifier(definition.descriptor.name, 'Recipe name');
  if (definition.descriptor.kind && definition.descriptor.kind !== 'recipe') fail('INVALID_DEFINITION', 'Descriptor must define a recipe');
  if (!Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length > 100) fail('INVALID_DEFINITION', 'A recipe requires 1–100 authored steps');
  record(definition.outputs, 'Recipe outputs'); const definitions = new Map<string, RecipeStepDefinition>();
  for (const step of definition.steps) {
    record(step, 'Recipe step'); identifier(step.id, 'Step ID'); identifier(step.title, 'Step title'); identifier(step.capabilityId, 'Capability ID');
    if (definitions.has(step.id)) fail('INVALID_DEFINITION', 'Duplicate recipe step ID'); definitions.set(step.id, step);
    if (!Array.isArray(step.dependsOn) || new Set(step.dependsOn).size !== step.dependsOn.length) fail('INVALID_DEFINITION', 'Step dependencies must be unique');
    if (typeof step.reviewAfter !== 'boolean' || (step.reviewBefore !== undefined && typeof step.reviewBefore !== 'boolean') || (step.required !== undefined && typeof step.required !== 'boolean')) fail('INVALID_DEFINITION', 'Step review and required flags must be boolean');
    if (step.role !== undefined) identifier(step.role, 'Step role'); record(step.input, 'Step bindings');
    for (const binding of Object.values(step.input)) {
      if (inputRef(binding)) {validateRef(binding); if (binding.from === 'step' && !step.dependsOn.includes(binding.stepId)) fail('INVALID_DEFINITION', 'Step bindings must refer to a declared dependency');}
      else json(binding);
    }
  }
  const active = new Set<string>(), visited = new Set<string>();
  function visit(stepId: string): void {
    if (active.has(stepId)) fail('INVALID_DEFINITION', 'Recipe dependency cycle'); if (visited.has(stepId)) return;
    const step = definitions.get(stepId); if (!step) fail('INVALID_DEFINITION', `Missing recipe dependency ${stepId}`);
    active.add(stepId); for (const dependency of step.dependsOn) visit(dependency); active.delete(stepId); visited.add(stepId);
  }
  for (const step of definition.steps) visit(step.id);
  for (const output of Object.values(definition.outputs)) {
    if (!inputRef(output)) fail('INVALID_DEFINITION', 'Recipe outputs require declared bindings'); validateRef(output);
    if (output.from === 'step' && !definitions.has(output.stepId)) fail('INVALID_DEFINITION', 'Recipe output refers to a missing step');
  }
}
function definitionFor(run: RecipeRun, id: string): RecipeStepDefinition {
  const definition = run.definition.steps.find(step => step.id === id); if (!definition) fail('NOT_FOUND', `Recipe step ${id} does not exist`); return definition;
}
function stepFor(run: RecipeRun, id: string): RecipeStep {
  const step = run.steps.find(item => item.id === id); if (!step) fail('NOT_FOUND', `Recipe step ${id} does not exist`); return step;
}
function requireRevision(run: RecipeRun, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(run.revision)) fail('INVALID_INPUT', 'Recipe revisions must be safe integers');
  if (run.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Recipe changed; read its latest revision', {expectedRevision, actualRevision: run.revision});
  if (run.revision >= Number.MAX_SAFE_INTEGER) fail('INVALID_INPUT', 'Recipe revision exhausted');
}
function resolveRef(run: RecipeRun, ref: RecipeInputRef): RecipeJson {
  if (ref.from === 'input') return readRecipePointer(run.input, ref.pointer);
  const source = stepFor(run, ref.stepId);
  if (source.status !== 'completed' || !source.output) fail('BINDING_MISSING', `Dependency ${ref.stepId} has no accepted result`);
  if (hashRecipeValue(source.output) !== source.resultHash) fail('STALE_REVIEW', 'Dependency result content no longer matches its hash');
  if (definitionFor(run, source.id).reviewAfter && (source.decision?.decision !== 'accept' || source.decision.resultHash !== source.resultHash || source.decision.attempt !== source.attempt)) fail('STALE_REVIEW', 'Dependency result approval is missing or stale');
  return readRecipePointer(source.output as unknown as RecipeJson, ref.pointer);
}
function resolveInput(run: RecipeRun, definition: RecipeStepDefinition): Record<string, RecipeJson> {
  const bound: Record<string, RecipeJson> = Object.create(null);
  for (const [key, binding] of Object.entries(definition.input)) bound[key] = inputRef(binding) ? resolveRef(run, binding) : structuredClone(json(binding));
  return bound;
}
function requireAvailable(artifacts: readonly RecipeArtifact[], available?: AvailableRecipeArtifacts): void {
  if (available === undefined) return;
  if (!Array.isArray(available)) fail('INVALID_INPUT', 'Available artifacts must be an explicit array');
  for (const item of available) {
    if (typeof item === 'string') identifier(item, 'Available artifact ID');
    else {record(item, 'Available artifact'); identifier(item.id, 'Available artifact ID'); identifier(item.kind, 'Available artifact kind');}
  }
  const ids = new Set(available.filter((item): item is string => typeof item === 'string'));
  const keys = new Set(available.filter((item): item is RecipeArtifact => typeof item !== 'string').map(item => `${item.kind}\0${item.id}`));
  for (const artifact of artifacts) if (!ids.has(artifact.id) && !keys.has(`${artifact.kind}\0${artifact.id}`)) fail('ARTIFACT_MISSING', `Recipe artifact ${artifact.id} is unavailable`, {artifact});
}
function executionFor(run: RecipeRun, step: RecipeStep, available?: AvailableRecipeArtifacts): RecipeExecution {
  const definition = definitionFor(run, step.id);
  for (const id of definition.dependsOn) {
    const dependency = stepFor(run, id); if (dependency.status !== 'completed') fail('INVALID_STATE', `Step ${id} must complete before ${step.id}`);
    requireAvailable(dependency.output?.artifacts ?? [], available);
  }
  const input = resolveInput(run, definition);
  return {stepId: step.id, capabilityId: definition.capabilityId, role: definition.role, input, inputHash: hashRecipeValue(input), reviewBefore: !!definition.reviewBefore};
}
function publish(run: RecipeRun): RecipeRun {
  run.revision++;
  if (run.steps.some(step => step.status === 'failed')) run.status = 'failed';
  else if (run.steps.some(step => step.status === 'review' || step.status === 'waiting')) run.status = 'paused';
  else run.status = 'running';
  delete run.outputs; return frozen(run);
}

export function startRun(definition: RecipeDefinition, input: RecipeJson, frozenDependencies: Record<string, RecipeJson>, target: RecipeTarget, options: {id: string; title?: string}): RecipeRun {
  validateRecipeDefinition(definition); json(input); json(frozenDependencies); record(target, 'Recipe target'); identifier(target.projectId, 'Project ID'); identifier(options.id, 'Run ID');
  if (target.sequenceId !== undefined) identifier(target.sequenceId, 'Sequence ID'); if (target.clipId !== undefined) identifier(target.clipId, 'Clip ID');
  if (target.expectedRevision !== undefined && (!Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 0)) fail('INVALID_INPUT', 'Target revision must be a safe integer');
  const title = options.title ?? definition.descriptor.name; identifier(title, 'Run title');
  const run: RecipeRun = {id: options.id, title, revision: 0, status: 'running', definition, input, frozenDependencies, target,
    steps: definition.steps.map(step => ({id: step.id, title: step.title, capabilityId: step.capabilityId, role: step.role, status: 'pending', attempt: 0, history: []}))};
  // Root-input pointers can be checked before starting any execution.
  for (const step of definition.steps) for (const binding of Object.values(step.input)) if (inputRef(binding) && binding.from === 'input') readRecipePointer(input, binding.pointer);
  return frozen(run);
}
export function nextStep(run: RecipeRun, availableArtifacts?: AvailableRecipeArtifacts): RecipeExecution | null {
  if (run.status === 'completed') return null;
  for (const definition of run.definition.steps) {
    const step = stepFor(run, definition.id);
    if (['pending', 'stale'].includes(step.status) && definition.dependsOn.every(id => stepFor(run, id).status === 'completed')) return frozen(executionFor(run, step, availableArtifacts));
  }
  return null;
}
export function prepareStep(run: RecipeRun, request: RecipeStepRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (run.status === 'completed' || !['pending', 'stale'].includes(step.status)) fail('INVALID_STATE', 'Only a pending step may prepare its input');
  const execution = executionFor(copy, step); step.input = execution.input; step.inputHash = execution.inputHash;
  if (execution.reviewBefore) {step.status = 'review'; step.reviewPhase = 'input'; delete step.inputDecision;}
  return publish(copy);
}
export function decideInput(run: RecipeRun, request: DecideRecipeInputRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (step.status !== 'review' || step.reviewPhase !== 'input' || step.inputHash !== request.inputHash || executionFor(copy, step).inputHash !== request.inputHash) fail('STALE_REVIEW', 'Input review no longer matches the exact bound input');
  if (!['accept', 'reject'].includes(request.decision)) fail('INVALID_INPUT', 'Invalid review decision');
  step.inputDecision = {decision: request.decision, inputHash: request.inputHash}; step.status = request.decision === 'accept' ? 'pending' : 'failed'; delete step.reviewPhase;
  return publish(copy);
}
export function runStep(run: RecipeRun, request: RecipeStepRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (run.status === 'completed' || !['pending', 'stale'].includes(step.status)) fail('INVALID_STATE', 'Only a ready pending step may run');
  const execution = executionFor(copy, step);
  if (execution.reviewBefore && (step.inputDecision?.decision !== 'accept' || step.inputDecision.inputHash !== execution.inputHash)) fail('STALE_REVIEW', 'This step requires approval of its exact input before execution');
  if (!Number.isSafeInteger(step.attempt) || step.attempt >= Number.MAX_SAFE_INTEGER) fail('INVALID_INPUT', 'Step attempt exhausted');
  step.input = execution.input; step.inputHash = execution.inputHash; step.attempt++; step.status = 'running'; delete step.error; delete step.reviewPhase;
  return publish(copy);
}
function validateResult(result: RecipeResult): void {
  record(result, 'Step result'); json(result.value);
  if (!Array.isArray(result.artifacts) || result.artifacts.length > 1000) fail('INVALID_INPUT', 'Result artifacts must be an array of at most 1000 references');
  const seen = new Set<string>();
  for (const artifact of result.artifacts) {
    record(artifact, 'Result artifact'); identifier(artifact.id, 'Artifact ID'); identifier(artifact.kind, 'Artifact kind');
    const key = `${artifact.kind}\0${artifact.id}`; if (seen.has(key)) fail('INVALID_INPUT', 'Duplicate result artifact'); seen.add(key);
  }
  json(result);
}
function validateWaiting(waiting: RecipeWaiting[]): void {
  if (!Array.isArray(waiting) || waiting.length > 1000) fail('INVALID_INPUT', 'Waiting references must be an array of at most 1000 references');
  const seen = new Set<string>();
  for (const ref of waiting) {
    identifier(ref.id, 'Waiting ID'); if (!['job', 'proposal', 'artifact'].includes(ref.kind) || seen.has(ref.id)) fail('INVALID_INPUT', 'Invalid or duplicate waiting reference'); seen.add(ref.id);
  }
}
function resultReady(run: RecipeRun, step: RecipeStep): void {
  if (step.waiting?.length) {step.status = 'waiting'; delete step.reviewPhase;}
  else if (definitionFor(run, step.id).reviewAfter) {step.status = 'review'; step.reviewPhase = 'result';}
  else {step.status = 'completed'; delete step.reviewPhase;}
}
export function completeStep(run: RecipeRun, request: CompleteStepRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (step.status !== 'running' || step.attempt !== request.attempt) fail('INVALID_STATE', 'Completion must belong to the current running attempt');
  validateResult(request.result); validateWaiting(request.waiting ?? []);
  if (request.summary !== undefined && (typeof request.summary !== 'string' || request.summary.length > 16000)) fail('INVALID_INPUT', 'Step summary must be at most 16000 characters');
  step.output = structuredClone(request.result); step.resultHash = hashRecipeValue(step.output); step.result = request.summary;
  step.waiting = structuredClone(request.waiting ?? []); delete step.decision; resultReady(copy, step); return publish(copy);
}
export function decideResult(run: RecipeRun, request: DecideRecipeResultRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (step.status !== 'review' || step.reviewPhase !== 'result' || step.attempt !== request.attempt || !step.output || step.resultHash !== request.resultHash || hashRecipeValue(step.output) !== request.resultHash) fail('STALE_REVIEW', 'Approval must match the exact current attempt and reviewed result');
  if (!['accept', 'reject'].includes(request.decision)) fail('INVALID_INPUT', 'Invalid review decision');
  step.decision = {decision: request.decision, attempt: request.attempt, resultHash: request.resultHash}; step.status = request.decision === 'accept' ? 'completed' : 'failed'; delete step.reviewPhase;
  return publish(copy);
}
export function resolveWaiting(run: RecipeRun, request: ResolveRecipeWaitingRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (step.status !== 'waiting' || step.attempt !== request.attempt || step.resultHash !== request.resultHash || !step.output || hashRecipeValue(step.output) !== request.resultHash) fail('STALE_REVIEW', 'Waiting resolution must match the current attempt and result');
  if (!Array.isArray(request.resolvedIds) || !request.resolvedIds.length || new Set(request.resolvedIds).size !== request.resolvedIds.length || request.resolvedIds.some(id => !step.waiting?.some(ref => ref.id === id))) fail('INVALID_INPUT', 'Only declared waiting references may be resolved');
  step.waiting = (step.waiting ?? []).filter(ref => !request.resolvedIds.includes(ref.id));
  if (request.waiting) {validateWaiting(request.waiting); step.waiting.push(...structuredClone(request.waiting)); validateWaiting(step.waiting);}
  if (request.result) {
    if (step.waiting.length) fail('INVALID_STATE', 'Materialize the final result after all waiting references resolve');
    validateResult(request.result); step.output = structuredClone(request.result); step.resultHash = hashRecipeValue(step.output);
  }
  if (request.summary !== undefined) {if (typeof request.summary !== 'string' || request.summary.length > 16000) fail('INVALID_INPUT', 'Invalid step summary'); step.result = request.summary;}
  delete step.decision; resultReady(copy, step); return publish(copy);
}
export function failStep(run: RecipeRun, request: RecipeStepRequest & {attempt: number; error: string}): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run), step = stepFor(copy, request.stepId);
  if (!['running', 'waiting'].includes(step.status) || step.attempt !== request.attempt) fail('INVALID_STATE', 'Failure must belong to the current running or waiting attempt');
  if (typeof request.error !== 'string' || !request.error.trim() || request.error.length > 16000) fail('INVALID_INPUT', 'A bounded error message is required');
  step.status = 'failed'; step.error = request.error; delete step.reviewPhase; return publish(copy);
}
export function redoStep(run: RecipeRun, request: RecipeStepRequest): RecipeRun {
  requireRevision(run, request.expectedRevision); stepFor(run, request.stepId); const copy = structuredClone(run), affected = new Set([request.stepId]);
  let changed = true;
  while (changed) {changed = false; for (const definition of copy.definition.steps) if (!affected.has(definition.id) && definition.dependsOn.some(id => affected.has(id))) {affected.add(definition.id); changed = true;}}
  for (const step of copy.steps) if (affected.has(step.id)) {
    if (step.attempt > 0 || step.output) {const {id, title, capabilityId, role, history, reviewPhase, ...attempt} = step; step.history.push(structuredClone(attempt));}
    step.status = 'stale'; delete step.input; delete step.inputHash; delete step.output; delete step.result; delete step.resultHash; delete step.decision; delete step.inputDecision; delete step.waiting; delete step.error; delete step.reviewPhase;
  }
  return publish(copy);
}
export function completeRun(run: RecipeRun, request: RecipeRevision & {availableArtifacts: AvailableRecipeArtifacts}): RecipeRun {
  requireRevision(run, request.expectedRevision); const copy = structuredClone(run);
  if (run.status === 'completed' || run.steps.some(step => ['running', 'review', 'waiting'].includes(step.status))) fail('INVALID_STATE', 'Active steps and reviews must resolve before completing the run');
  if (!Array.isArray(request.availableArtifacts)) fail('INVALID_INPUT', 'Available artifacts must be checked before completing the run');
  for (const definition of copy.definition.steps) {
    const step = stepFor(copy, definition.id);
    if (definition.required !== false && (step.status !== 'completed' || !step.output || step.waiting?.length)) fail('INVALID_STATE', `Required step ${step.id} is not complete`);
    if (step.status === 'completed') {
      if (!step.output || hashRecipeValue(step.output) !== step.resultHash) fail('STALE_REVIEW', 'Completed result no longer matches its hash');
      if (definition.reviewAfter && (step.decision?.decision !== 'accept' || step.decision.resultHash !== step.resultHash || step.decision.attempt !== step.attempt)) fail('STALE_REVIEW', 'Required result approval is missing or stale');
      requireAvailable(step.output.artifacts, request.availableArtifacts);
    }
  }
  const outputs: Record<string, RecipeJson> = Object.create(null);
  for (const [key, ref] of Object.entries(copy.definition.outputs)) outputs[key] = resolveRef(copy, ref);
  copy.outputs = outputs; copy.status = 'completed'; copy.revision++; return frozen(copy);
}
