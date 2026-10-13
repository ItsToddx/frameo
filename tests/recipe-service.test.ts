import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {RecipeService, type PersistentRecipe, type RecipeCatalog} from '../apps/desktop/src/adapters/application/recipe-service';
import {AppDatabase, ProjectDatabase, id} from '../apps/desktop/src/adapters/storage/database';
import {ProjectService} from '../apps/desktop/src/adapters/storage/project-service';
import type {Asset, Job, KitInfo, Review} from '../apps/desktop/src/adapters/contracts/api';
import {agentDefinitions, builtinManifests, productAdRecipe} from '../kits/builtin';
import {hashRecipeValue} from '../packages/core/src/recipe';
import {validateDeclarativeKit, type AgentDefinition, type CapabilityDescriptor, type KitManifest, type RecipeDefinition} from '../packages/kit-sdk/src/index';

class Catalog implements RecipeCatalog {
  manifestValues = structuredClone(builtinManifests); agentValues = structuredClone(agentDefinitions);
  recipeValues = structuredClone([productAdRecipe]); disabled = new Set<string>(); codeHashes: Record<string, string> = {};
  list(): KitInfo[] {return this.manifestValues.map(manifest => ({id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author, license: manifest.license, source: manifest.source, permissions: manifest.permissions, category: 'recipe', enabled: !this.disabled.has(manifest.id), installed: true}));}
  manifests(): KitManifest[] {return this.manifestValues;}
  agents(): AgentDefinition[] {return this.agentValues;}
  recipe(kitId: string): RecipeDefinition {
    if (this.disabled.has(kitId)) throw new Error('Disabled recipe Kit');
    const manifest = this.manifestValues.find(item => item.id === kitId), recipe = this.recipeValues.find(recipe => manifest?.capabilities.some(capability => capability.id === recipe.descriptor.id));
    if (!recipe) throw new Error('No authored recipe'); return recipe;
  }
  fingerprint(kitId: string): {manifest: KitManifest; digest: string} | undefined {
    const manifest = this.manifestValues.find(item => item.id === kitId); return manifest && {manifest, digest: this.codeHashes[kitId] ?? hashRecipeValue(manifest)};
  }
  capabilities(): (CapabilityDescriptor & {kitId: string})[] {
    return this.manifestValues.flatMap(manifest => manifest.capabilities.map(capability => {
      const descriptor = [...this.agentValues.map(agent => agent.descriptor), ...this.recipeValues.map(recipe => recipe.descriptor)].find(item => item.id === capability.id) ?? {
        id: capability.id, name: manifest.name, kind: capability.kind, description: manifest.description, permissions: manifest.permissions, inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
      };
      return {...descriptor, kitId: manifest.id};
    }));
  }
  custom(): void {
    const recipe: RecipeDefinition = {descriptor: {...productAdRecipe.descriptor, id: 'custom.authored', name: 'Public authored recipe'}, steps: [
      {id: 'outline', title: 'Outline', capabilityId: 'reelbeam.creative', role: 'creative', dependsOn: [], input: {goal: {from: 'input', pointer: '/goal'}}, reviewBefore: false, reviewAfter: false},
      {id: 'followup', title: 'Use the first scene', capabilityId: 'reelbeam.creative', role: 'creative', dependsOn: ['outline'], input: {scene: {from: 'step', stepId: 'outline', pointer: '/value/scenes/0'}}, reviewBefore: false, reviewAfter: false},
      {id: 'finish', title: 'Finish', capabilityId: 'reelbeam.creative', role: 'creative', dependsOn: ['followup'], input: {answer: {from: 'step', stepId: 'followup', pointer: '/value'}}, reviewBefore: false, reviewAfter: false},
      {id: 'audit', title: 'Independent audit', capabilityId: 'reelbeam.creative', role: 'creative', dependsOn: [], input: {}, reviewBefore: false, reviewAfter: false},
    ], outputs: {answer: {from: 'step', stepId: 'finish', pointer: '/value'}}};
    this.recipeValues.push(recipe); this.manifestValues.push({...structuredClone(builtinManifests.find(manifest => manifest.id === 'reelbeam.product-ad-kit')!), id: 'custom.recipe-kit', name: 'Public custom Kit', capabilities: [{id: recipe.descriptor.id, kind: 'recipe'}], dependencies: {'reelbeam.creative-kit': '1.0.0'}});
  }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'reelbeam-recipe-service-')), app = new AppDatabase(join(directory, 'app')), catalog = new Catalog();
  let database = ProjectDatabase.create(join(directory, 'project'), 'Recipe test', 320, 180, 24);
  const project = () => new ProjectService(database, app); project().createSequence({name: 'Selected second sequence', width: 320, height: 180, fps: 24});
  const service = () => new RecipeService(database, catalog);
  t.after(async () => {database.close(); app.close(); await rm(directory, {recursive: true, force: true});});
  return {directory, catalog, app, get db() {return database;}, service, project, reopen() {const path = database.directory; database.close(); database = new ProjectDatabase(path);}};
}
const get = (f: Awaited<ReturnType<typeof fixture>>, recipeId: string) => f.db.read().recipes.find(run => run.id === recipeId) as PersistentRecipe;
function approve(f: Awaited<ReturnType<typeof fixture>>, recipeId: string, stepId: string) {
  const recipe = get(f, recipeId), step = recipe.steps.find(step => step.id === stepId)!;
  return f.service().decideResult({recipeId, expectedRevision: recipe.revision, stepId, attempt: step.attempt, resultHash: step.resultHash!, decision: 'accept'});
}
function approveBefore(f: Awaited<ReturnType<typeof fixture>>, recipeId: string, stepId: string) {
  const recipe = get(f, recipeId), step = recipe.steps.find(step => step.id === stepId)!;
  return f.service().decideInput({recipeId, expectedRevision: recipe.revision, stepId, inputHash: step.inputHash!, decision: 'accept'});
}
async function media(f: Awaited<ReturnType<typeof fixture>>, assetId = id()): Promise<Asset> {
  const asset: Asset = {id: assetId, name: 'Actual candidate', kind: 'video', path: 'media/' + assetId + '.mp4', url: '', hash: assetId, duration: 10, hasAudio: false, createdAt: new Date().toISOString()};
  await writeFile(join(f.db.directory, asset.path), 'Archived fixture media'); return f.db.addAsset(asset);
}
function review(f: Awaited<ReturnType<typeof fixture>>, run: PersistentRecipe, stepId: string, kind: Review['kind'], extra: Partial<Review> = {}): Review {
  const step = run.steps.find(step => step.id === stepId)!;
  const value: Review = {id: id(), kind, title: 'Actual host proposal', description: 'Review this action', status: 'pending', createdAt: new Date().toISOString(), recipeId: run.id, stepId, recipeAttempt: step.attempt, ...extra};
  f.db.transaction(state => state.reviews.push(value), 'review.created'); return value;
}
function queuedJob(f: Awaited<ReturnType<typeof fixture>>, proposal: Review): Job {
  const job: Job = {id: id(), requestId: proposal.id, kind: 'seedance', title: 'Actual host job', status: 'queued', progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelRequested: false, input: {prompt: 'Generate a shot'}};
  f.db.transaction(state => {state.jobs.push(job); Object.assign(state.reviews.find(review => review.id === proposal.id)!, {status: 'accepted', jobId: job.id});}); return job;
}

test('service persists the actual authored four-step graph, exact agent and chosen target across reopening', async t => {
  const f = await fixture(t); f.catalog.custom(); const target = f.db.read().sequences[1];
  const recipe = f.service().create({kitId: 'custom.recipe-kit', title: 'Private client brief', sequenceId: target.id, input: {goal: 'Specific authored input'}});
  assert.deepEqual(recipe.steps.map(step => step.id), ['outline', 'followup', 'finish', 'audit']); assert.equal(recipe.target.sequenceId, target.id);
  assert.equal(recipe.frozenAgents['reelbeam.creative'].systemPrompt, agentDefinitions[0].systemPrompt);
  f.reopen(); const execution = f.service().resume(recipe.id)!;
  assert.equal(execution.step.id, 'outline'); assert.equal(execution.agentDefinition?.descriptor.id, 'reelbeam.creative'); assert.equal(execution.target.sequenceId, target.id);
  assert.ok(execution.task.includes('Specific authored input')); assert.equal(execution.step.attempt, 1);
  f.service().settle(recipe.id, 'outline', 1, {status: 'completed', text: JSON.stringify({value: {scenes: [{prompt: 'Bound scene'}]}, artifacts: []})});
  const next = f.service().resume(recipe.id)!; assert.equal(next.step.id, 'followup'); assert.deepEqual(next.step.input?.scene, {prompt: 'Bound scene'});
  assert.equal(next.agentDefinition?.descriptor.id, 'reelbeam.creative');
});

test('builtin execution waits for the exact proposal and successful job, then requires explicit input/result approval before assembly', async t => {
  const f = await fixture(t); const target = f.db.read().sequences[1];
  const recipe = f.service().create({kitId: 'reelbeam.product-ad-kit', title: 'Create a product film', sequenceId: target.id});
  const script = f.service().resume(recipe.id)!; assert.equal(script.step.id, 'script');
  f.service().settle(recipe.id, 'script', script.step.attempt, {status: 'completed', text: 'The actual script'});
  assert.equal(f.service().resume(recipe.id), null); approve(f, recipe.id, 'script');
  assert.equal(f.service().resume(recipe.id), null); assert.equal(get(f, recipe.id).steps[1].reviewPhase, 'input'); approveBefore(f, recipe.id, 'visuals');
  const visuals = f.service().resume(recipe.id)!; assert.equal(visuals.target.sequenceId, target.id); assert.equal(visuals.step.input?.plan, 'The actual script');
  const generation = review(f, visuals.recipe, 'visuals', 'generation', {generation: {requestId: 'cloud-request', prompt: 'A product shot', duration: 5, ratio: '16:9', estimatedCost: 1}});
  f.service().settle(recipe.id, 'visuals', visuals.step.attempt, {status: 'completed', text: 'I proposed a shot; it is not generated yet.'});
  assert.equal(get(f, recipe.id).steps[1].status, 'waiting'); assert.equal(f.service().resume(recipe.id), null);
  const job = queuedJob(f, generation); f.service().resume(recipe.id);
  const waiting = get(f, recipe.id); assert.deepEqual(waiting.steps[1].waiting, [{id: job.id, kind: 'job'}]);
  const beforeRedo = f.db.read(); assert.throws(() => f.service().resume(recipe.id, 'visuals'), /生成/); assert.deepEqual(f.db.read(), beforeRedo);
  const candidate = await media(f); f.db.updateJob(job.id, {status: 'succeeded', outputAssetId: candidate.id});
  assert.equal(f.service().resume(recipe.id), null); const materialized = get(f, recipe.id), step = materialized.steps[1];
  assert.equal(step.status, 'review'); assert.ok(step.output?.artifacts.some(ref => ref.id === candidate.id && ref.kind === 'asset'));
  assert.throws(() => f.service().decideResult({recipeId: recipe.id, expectedRevision: materialized.revision, stepId: 'visuals', attempt: step.attempt, resultHash: waiting.steps[1].resultHash!, decision: 'accept'}));
  approve(f, recipe.id, 'visuals'); assert.equal(f.service().resume(recipe.id), null); approveBefore(f, recipe.id, 'assembly');
  const assembly = f.service().resume(recipe.id)!;
  assert.ok((assembly.step.input?.visuals as {id: string}[]).some(ref => ref.id === candidate.id));
  const current = f.db.read().sequences.find(sequence => sequence.id === target.id)!;
  const edit = review(f, assembly.recipe, 'assembly', 'edit', {sequenceId: target.id, expectedRevision: current.revision, commands: [{type: 'addClip', clip: {id: 'assembled-clip', trackId: current.tracks[0].id, assetVersionId: candidate.id, start: 0, duration: 24, sourceStart: 0, audioGain: 1, muted: true}}]});
  f.service().assertReviewCurrent(edit);
  f.project().apply({sequenceId: target.id, expectedRevision: current.revision, commandId: edit.id, commands: edit.commands!});
  f.db.transaction(state => {state.reviews.find(review => review.id === edit.id)!.status = 'accepted';});
  f.service().settle(recipe.id, 'assembly', assembly.step.attempt, {status: 'completed', text: 'The actual target sequence is assembled.'}); approve(f, recipe.id, 'assembly');
  assert.equal(f.service().resume(recipe.id), null); assert.equal(get(f, recipe.id).status, 'completed');
  assert.equal(get(f, recipe.id).outputs?.film, 'The actual target sequence is assembled.');
  assert.equal(f.db.read().sequences.find(sequence => sequence.id === target.id)?.revision, 1);
  assert.equal(f.db.read().sequences[0].clips.length, 0); assert.equal(f.db.read().jobs.length, 1);
  f.service().resume(recipe.id); assert.equal(f.db.read().sequences.find(sequence => sequence.id === target.id)?.revision, 1);
});

test('redo rejects active generation and supersedes stale edit proposals without replaying accepted edits', async t => {
  const f = await fixture(t); f.catalog.custom(); const target = f.db.read().sequences[1];
  const run = f.service().create({kitId: 'custom.recipe-kit', title: 'Custom', sequenceId: target.id, input: {goal: 'Goal'}}), execution = f.service().resume(run.id)!;
  const pendingEdit = review(f, execution.recipe, execution.step.id, 'edit', {sequenceId: target.id, expectedRevision: 0, commands: [{type: 'sequenceSettings', patch: {name: 'Change'}}]});
  f.service().settle(run.id, execution.step.id, execution.step.attempt, {status: 'completed', text: '{"scenes":[{"prompt":"First"}]}'});
  const restarted = f.service().resume(run.id, execution.step.id)!;
  assert.equal(restarted.step.attempt, 2); assert.equal(f.db.read().reviews.find(review => review.id === pendingEdit.id)?.status, 'rejected');
  assert.throws(() => f.service().assertReviewCurrent(pendingEdit));
  assert.throws(() => f.service().settle(run.id, execution.step.id, 1, {status: 'completed', text: 'Old callback'}));
  assert.equal(f.db.read().sequences.find(sequence => sequence.id === target.id)?.revision, 0);
  assert.equal(restarted.step.history.length, 1); assert.equal(f.db.read().jobs.length, 0);
});

test('disabled Kits, upgraded code digest and changed agent definitions block resume without changing saved progress', async t => {
  const f = await fixture(t); const run = f.service().create({kitId: 'reelbeam.product-ad-kit', title: 'Film'}), before = f.db.read();
  f.catalog.disabled.add('reelbeam.creative-kit'); assert.throws(() => f.service().resume(run.id)); assert.deepEqual(f.db.read(), before); f.catalog.disabled.clear();
  f.catalog.codeHashes['reelbeam.creative-kit'] = 'changed-native-code'; assert.throws(() => f.service().resume(run.id)); assert.deepEqual(f.db.read(), before); delete f.catalog.codeHashes['reelbeam.creative-kit'];
  f.catalog.agentValues[0].systemPrompt += ' Unreviewed replacement'; assert.throws(() => f.service().resume(run.id)); assert.deepEqual(f.db.read(), before);
});

test('definition export is a valid reusable declarative Kit and omits prompt, run result, project path and session state', async t => {
  const f = await fixture(t); f.catalog.custom();
  const run = f.service().create({kitId: 'custom.recipe-kit', title: 'SECRET_CLIENT_TITLE', input: {goal: 'SECRET_USER_INPUT /Users/private'}, sequenceId: f.db.read().sequences[1].id});
  const execution = f.service().resume(run.id)!; f.service().settle(run.id, execution.step.id, execution.step.attempt, {status: 'completed', text: 'SECRET_RUN_RESULT'});
  const declaration = f.service().exportRecipeDefinition(run.id); assert.doesNotThrow(() => validateDeclarativeKit(declaration));
  const serialized = JSON.stringify(declaration);
  for (const secret of ['SECRET_CLIENT_TITLE', 'SECRET_USER_INPUT', 'SECRET_RUN_RESULT', f.db.directory, run.id, run.sessionId]) assert.equal(serialized.includes(secret), false);
  assert.equal(declaration.recipes[0].steps.length, 4); assert.equal(declaration.agents.length, 1);
  assert.ok(declaration.recipes[0].steps.every(step => step.capabilityId === declaration.agents[0].descriptor.id));
  assert.equal(declaration.recipes[0].steps[1].input.scene && typeof declaration.recipes[0].steps[1].input.scene, 'object');
});

test('claimed nonexistent artifacts and a succeeded job without archived media fail the step instead of inventing completion', async t => {
  const f = await fixture(t); f.catalog.custom(); const run = f.service().create({kitId: 'custom.recipe-kit', title: 'Goal', input: {goal: 'Goal'}});
  const execution = f.service().resume(run.id)!;
  const failed = f.service().settle(run.id, execution.step.id, 1, {status: 'completed', text: JSON.stringify({value: {scenes: []}, artifacts: [{id: 'invented-asset', kind: 'asset'}]})});
  assert.equal(failed.steps[0].status, 'failed'); assert.match(failed.steps[0].error!, /不存在/);
  const retry = f.service().resume(run.id, 'outline')!; const proposal = review(f, retry.recipe, 'outline', 'generation'); const job = queuedJob(f, proposal);
  f.db.updateJob(job.id, {status: 'succeeded', outputAssetId: 'missing'});
  const missing = f.service().settle(run.id, 'outline', 2, {status: 'completed', text: '{"scenes":[]}'});
  assert.equal(missing.steps[0].status, 'failed'); assert.match(missing.steps[0].error!, /归档/); assert.equal(missing.status, 'failed');
});

test('result acceptance checks physical media availability and actual edit receipts', async t => {
  const f = await fixture(t), run = f.service().create({kitId: 'reelbeam.product-ad-kit', title: 'Goal'}), execution = f.service().resume(run.id)!;
  const asset = await media(f); f.service().settle(run.id, 'script', 1, {status: 'completed', text: JSON.stringify({value: 'Plan', artifacts: [{id: asset.id, kind: 'asset'}]})});
  await rm(join(f.db.directory, asset.path)); assert.throws(() => approve(f, run.id, 'script'), /不可用/);
  assert.equal(get(f, run.id).steps[0].status, 'review');
  const other = f.service().create({kitId: 'reelbeam.product-ad-kit', title: 'Other'}), otherExecution = f.service().resume(other.id)!;
  const target = f.db.read().sequences[0], proposal = review(f, otherExecution.recipe, 'script', 'edit', {sequenceId: target.id, expectedRevision: 0, commands: [{type: 'sequenceSettings', patch: {name: 'Claimed edit'}}]});
  f.db.transaction(state => {state.reviews.find(review => review.id === proposal.id)!.status = 'accepted';});
  const failed = f.service().settle(other.id, 'script', 1, {status: 'completed', text: 'I edited the film'});
  assert.equal(failed.steps[0].status, 'failed'); assert.match(failed.steps[0].error!, /保存/);
  assert.equal(f.db.read().sequences[0].revision, 0); assert.equal(execution.step.attempt, 1);
});
