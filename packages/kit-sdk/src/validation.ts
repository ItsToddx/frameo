import { z } from 'zod';
import type { DeclarativeKit, JsonValue, RecipeDefinition } from './types.js';

const id = z.string().regex(/^[a-z][a-z0-9._-]{1,100}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const schema = z.record(z.string(), z.unknown());
const permission = z.enum([
  'project.read',
  'project.propose',
  'memory.propose',
  'model.infer',
  'seedance.generate',
]);
export const descriptorSchema = z
  .object({
    id,
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(4000),
    kind: z.enum(['read', 'edit', 'job', 'provider', 'agent', 'recipe']),
    inputSchema: schema,
    outputSchema: schema,
    permissions: z.array(permission).max(10),
  })
  .strict();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(160),
    version,
    description: z.string().min(1).max(4000),
    author: z.string().min(1).max(160),
    license: z.string().min(1).max(100),
    hostApi: z.literal('1'),
    source: z.string().min(1).max(2048),
    permissions: z.array(permission).max(10),
    dependencies: z.record(id, version),
    capabilities: z
      .array(
        z
          .object({ id, kind: z.enum(['read', 'edit', 'job', 'provider', 'agent', 'recipe']) })
          .strict(),
      )
      .min(1)
      .max(100),
    entry: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          !value.split('/').includes('..') &&
          /\.m?js$/.test(value),
        'Entry must be a relative JavaScript module without traversal',
      )
      .optional(),
  })
  .strict();
const role = z.enum(['creative', 'visual', 'editor']);
const agentSchema = z
  .object({
    descriptor: descriptorSchema,
    role,
    systemPrompt: z.string().min(1).max(16000),
    tools: z.array(id).max(40),
  })
  .strict();
const pointer = z
  .string()
  .regex(/^(?:\/(?:[^~]|~[01])*)*$/)
  .max(1000);
const ref = z.discriminatedUnion('from', [
  z.object({ from: z.literal('input'), pointer }).strict(),
  z.object({ from: z.literal('step'), stepId: id, pointer }).strict(),
]);
const recipeSchema = z
  .object({
    descriptor: descriptorSchema,
    steps: z
      .array(
        z
          .object({
            id,
            title: z.string().min(1).max(160),
            capabilityId: id,
            role,
            dependsOn: z.array(id).max(100),
            input: z.record(z.string(), z.unknown()),
            reviewBefore: z.boolean(),
            reviewAfter: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    outputs: z.record(z.string(), ref),
  })
  .strict();
export function validateRecipe(recipe: RecipeDefinition): void {
  recipeSchema.parse(recipe);
  if (recipe.descriptor.kind !== 'recipe')
    throw new Error('Recipe descriptor must have kind recipe');
  const steps = new Map(recipe.steps.map((s) => [s.id, s]));
  if (steps.size !== recipe.steps.length) throw new Error('Duplicate recipe step ID');
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(stepId: string) {
    if (active.has(stepId)) throw new Error('Recipe dependency cycle');
    if (visited.has(stepId)) return;
    const step = steps.get(stepId);
    if (!step) throw new Error(`Recipe dependency missing: ${stepId}`);
    active.add(stepId);
    for (const dependency of step.dependsOn) visit(dependency);
    for (const value of Object.values(step.input)) {
      if (value && typeof value === 'object' && 'from' in value) {
        const parsed = ref.parse(value);
        if (parsed.from === 'step' && !step.dependsOn.includes(parsed.stepId))
          throw new Error('Step input must reference a declared dependency');
      }
    }
    active.delete(stepId);
    visited.add(stepId);
  }
  for (const step of recipe.steps) visit(step.id);
  for (const output of Object.values(recipe.outputs)) {
    if (output.from === 'step' && !steps.has(output.stepId))
      throw new Error('Recipe output references a missing step');
  }
}
export function validateDeclarativeKit(input: unknown): DeclarativeKit {
  const parsed = z
    .object({
      manifest: manifestSchema,
      agents: z.array(agentSchema).max(30),
      recipes: z.array(recipeSchema).max(30),
    })
    .strict()
    .parse(input);
  const declaration = parsed as DeclarativeKit;
  if (declaration.manifest.entry)
    throw new Error('Declarative Kit import cannot execute a code entry');
  const declared = new Map(declaration.manifest.capabilities.map((c) => [c.id, c.kind]));
  if (declared.size !== declaration.manifest.capabilities.length)
    throw new Error('Duplicate declared capability');
  const supplied = [...declaration.agents, ...declaration.recipes];
  if (
    supplied.length !== declared.size ||
    new Set(supplied.map((c) => c.descriptor.id)).size !== supplied.length
  )
    throw new Error('Manifest must match all declarative capabilities exactly');
  for (const capability of supplied) {
    const d = capability.descriptor;
    if (declared.get(d.id) !== d.kind || !['agent', 'recipe'].includes(d.kind))
      throw new Error('Declarative kits can contain agents and recipes only');
    if (!d.permissions.every((p) => declaration.manifest.permissions.includes(p)))
      throw new Error('Capability permissions exceed manifest permissions');
  }
  for (const agent of declaration.agents)
    if (agent.descriptor.kind !== 'agent') throw new Error('Agent descriptor must have kind agent');
  for (const recipe of declaration.recipes) validateRecipe(recipe);
  // Keep packages portable: paths, secrets and execution state are never accepted in declarations.
  rejectPrivateData(declaration);
  return structuredClone(declaration);
}
function rejectPrivateData(value: unknown): void {
  if (
    typeof value === 'string' &&
    (/(?:file:\/\/|\/Users\/|[A-Z]:\\)/.test(value) || /\bBearer\s+[A-Za-z0-9]/i.test(value))
  )
    throw new Error('Kit contains private path or credentials');
  if (
    ['function', 'symbol', 'bigint', 'undefined'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    throw new Error('Kit declarations must contain JSON values only');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /^(api_?key|access_?token|secret|password|runId|sessionId|projectPath|__proto__|prototype|constructor)$/i.test(
        key,
      )
    )
      throw new Error('Kit contains private or runtime state');
    rejectPrivateData(child);
  }
}
export function importDeclaration(text: string): DeclarativeKit {
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024)
    throw new Error('Kit file exceeds 1 MiB');
  return validateDeclarativeKit(JSON.parse(text));
}
export function exportDeclaration(kit: DeclarativeKit): string {
  return JSON.stringify(validateDeclarativeKit(kit), null, 2) + '\n';
}
export function readPointer(value: JsonValue, pointerValue: string): JsonValue {
  pointer.parse(pointerValue);
  if (pointerValue === '') return value;
  let result: JsonValue = value;
  for (const token of pointerValue
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(token) ||
      !result ||
      typeof result !== 'object' ||
      !Object.hasOwn(result, token)
    )
      throw new Error(`Input binding missing: ${pointerValue}`);
    result = (result as Record<string, JsonValue>)[token];
  }
  return structuredClone(result);
}
