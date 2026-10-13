import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  completeRun,
  completeStep,
  decideInput,
  decideResult,
  failStep,
  hashRecipeValue,
  nextStep,
  prepareStep,
  readRecipePointer,
  RecipeError,
  redoStep,
  resolveWaiting,
  runStep,
  startRun,
  validateRecipeDefinition,
  type RecipeArtifact,
  type RecipeDefinition,
  type RecipeJson,
  type RecipeResult,
  type RecipeRun,
} from '../packages/core/src/recipe';
import { productAdRecipe } from '../kits/builtin';

const definition = (): RecipeDefinition => ({
  descriptor: { id: 'custom.film', name: 'Authored film', kind: 'recipe' },
  steps: [
    {
      id: 'plan',
      title: 'Plan the film',
      capabilityId: 'custom.story',
      role: 'writer',
      dependsOn: [],
      input: { brief: { from: 'input', pointer: '/brief' }, literal: { count: 2 } },
      reviewAfter: true,
    },
    {
      id: 'shots',
      title: 'Create shots',
      capabilityId: 'custom.shots',
      role: 'producer',
      dependsOn: ['plan'],
      input: { scene: { from: 'step', stepId: 'plan', pointer: '/value/scenes/0' } },
      reviewBefore: true,
      reviewAfter: true,
    },
    {
      id: 'assemble',
      title: 'Assemble film',
      capabilityId: 'custom.timeline',
      dependsOn: ['plan', 'shots'],
      input: {
        assets: { from: 'step', stepId: 'shots', pointer: '/artifacts' },
        plan: { from: 'step', stepId: 'plan', pointer: '/value' },
      },
      reviewAfter: false,
    },
  ],
  outputs: {
    film: { from: 'step', stepId: 'assemble', pointer: '/value/film' },
    brief: { from: 'input', pointer: '/brief' },
  },
});
const start = (d = definition()) =>
  startRun(
    d,
    { brief: '一部产品短片' },
    { 'custom.kit': '1.2.3' },
    { projectId: 'project', sequenceId: 'sequence', expectedRevision: 7 },
    { id: 'run' },
  );
const step = (run: RecipeRun, id: string) => run.steps.find((item) => item.id === id)!;
const error = (code: RecipeError['code']) => (value: unknown) =>
  value instanceof RecipeError && value.code === code;
function execute(run: RecipeRun, id: string): RecipeRun {
  if (run.definition.steps.find((item) => item.id === id)?.reviewBefore) {
    run = prepareStep(run, { expectedRevision: run.revision, stepId: id });
    run = decideInput(run, {
      expectedRevision: run.revision,
      stepId: id,
      inputHash: step(run, id).inputHash!,
      decision: 'accept',
    });
  }
  return runStep(run, { expectedRevision: run.revision, stepId: id });
}
function result(
  run: RecipeRun,
  id: string,
  value: RecipeJson,
  artifacts: RecipeArtifact[] = [],
): RecipeRun {
  return completeStep(run, {
    expectedRevision: run.revision,
    stepId: id,
    attempt: step(run, id).attempt,
    result: { value, artifacts },
    summary: `Summary of ${id}`,
  });
}
function accept(run: RecipeRun, id: string): RecipeRun {
  return decideResult(run, {
    expectedRevision: run.revision,
    stepId: id,
    attempt: step(run, id).attempt,
    resultHash: step(run, id).resultHash!,
    decision: 'accept',
  });
}
function finishSteps(): RecipeRun {
  let run = start();
  run = accept(
    result(execute(run, 'plan'), 'plan', { scenes: [{ prompt: 'A cinematic product shot' }] }),
    'plan',
  );
  run = accept(
    result(execute(run, 'shots'), 'shots', { ready: true }, [{ id: 'video', kind: 'asset' }]),
    'shots',
  );
  return result(execute(run, 'assemble'), 'assemble', { film: 'sequence' }, [
    { id: 'sequence', kind: 'sequence' },
  ]);
}

test('a run freezes its actual authored definition, source input, versions and original target', () => {
  const d = definition(),
    input = { brief: 'Original' },
    dependencies = { 'custom.kit': '1.2.3' },
    target = { projectId: 'project', sequenceId: 'sequence', expectedRevision: 3 };
  const run = startRun(d, input, dependencies, target, { id: 'specific-run', title: 'My film' });
  input.brief = 'Changed';
  d.steps[0].capabilityId = 'different';
  dependencies['custom.kit'] = '9.0.0';
  target.expectedRevision = 9;
  assert.equal(run.definition.steps[0].capabilityId, 'custom.story');
  assert.deepEqual(run.input, { brief: 'Original' });
  assert.equal(run.frozenDependencies['custom.kit'], '1.2.3');
  assert.equal(run.target.expectedRevision, 3);
  assert.equal(run.steps[0].role, 'writer');
  assert.equal(run.steps[2].role, undefined);
  assert.equal(run.title, 'My film');
  assert.equal(run.revision, 0);
  assert.deepEqual(
    run.steps.map((item) => item.attempt),
    [0, 0, 0],
  );
  assert.ok(Object.isFrozen(run));
  assert.ok(Object.isFrozen(run.definition.steps));
  assert.ok(Object.isFrozen(run.input));
  assert.throws(() => {
    run.steps[0].attempt = 7;
  }, TypeError);
  assert.doesNotThrow(() => start(productAdRecipe));
});

test('JSON Pointer bindings support escaped keys and strict array indices while rejecting missing or unsafe paths', () => {
  const value = { 'style/name': { '~label': ['中文', 'second'] }, '': 0 };
  assert.equal(readRecipePointer(value, '/style~1name/~0label/0'), '中文');
  assert.equal(readRecipePointer(value, '/'), 0);
  assert.deepEqual(readRecipePointer(value, ''), value);
  assert.throws(() => readRecipePointer(value, '/missing'), error('BINDING_MISSING'));
  assert.throws(
    () => readRecipePointer(value, '/style~1name/~0label/01'),
    error('BINDING_MISSING'),
  );
  assert.throws(() => readRecipePointer(value, '/__proto__'), error('INVALID_DEFINITION'));
  assert.throws(() => readRecipePointer(value, '/bad~2escape'), error('INVALID_DEFINITION'));
  const d = definition();
  d.steps[0].input.brief = { from: 'input', pointer: '/missing' };
  assert.throws(() => start(d), error('BINDING_MISSING'));
});

test('definition validation rejects duplicate steps, cycles, missing edges and undeclared source dependencies', () => {
  const duplicate = definition();
  duplicate.steps.push({ ...duplicate.steps[0] });
  assert.throws(() => validateRecipeDefinition(duplicate), error('INVALID_DEFINITION'));
  const cycle = definition();
  cycle.steps[0].dependsOn = ['assemble'];
  assert.throws(() => validateRecipeDefinition(cycle), error('INVALID_DEFINITION'));
  const missing = definition();
  missing.steps[0].dependsOn = ['missing'];
  assert.throws(() => validateRecipeDefinition(missing), error('INVALID_DEFINITION'));
  const undeclared = definition();
  undeclared.steps[1].dependsOn = [];
  assert.throws(() => validateRecipeDefinition(undeclared), error('INVALID_DEFINITION'));
  const output = definition();
  output.outputs.film = { from: 'step', stepId: 'missing', pointer: '/value' };
  assert.throws(() => validateRecipeDefinition(output), error('INVALID_DEFINITION'));
});

test('SHA-256 result hashes are stable across object property order and agree with the standard digest', () => {
  const values = [null, '中文内容', 0, ['a', 1], { a: 1, z: { b: 'two' } }, 'x'.repeat(200)];
  for (const value of values)
    assert.equal(
      hashRecipeValue(value),
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    );
  assert.equal(hashRecipeValue({ z: 1, a: 2 }), hashRecipeValue({ a: 2, z: 1 }));
  assert.notEqual(
    hashRecipeValue({ value: 'old', artifacts: [] }),
    hashRecipeValue({ value: 'new', artifacts: [] }),
  );
  for (const value of [undefined, NaN, () => 1, new Date(), new Array(3)])
    assert.throws(() => hashRecipeValue(value), error('INVALID_INPUT'));
  assert.throws(() => hashRecipeValue('x'.repeat(1024 * 1024)), error('INVALID_INPUT'));
});

test('scheduling respects authored edges and resolves actual results without substituting fixed roles', () => {
  let run = start();
  const next = nextStep(run)!;
  assert.equal(next.capabilityId, 'custom.story');
  assert.equal(next.role, 'writer');
  assert.deepEqual(next.input, { brief: '一部产品短片', literal: { count: 2 } });
  assert.equal(run.revision, 0);
  run = execute(run, 'plan');
  assert.equal(step(run, 'plan').attempt, 1);
  assert.equal(nextStep(run), null);
  run = result(run, 'plan', { scenes: [{ prompt: 'Scene 01' }] });
  assert.equal(run.status, 'paused');
  assert.equal(nextStep(run), null);
  run = accept(run, 'plan');
  const shots = nextStep(run)!;
  assert.equal(shots.stepId, 'shots');
  assert.deepEqual(shots.input, { scene: { prompt: 'Scene 01' } });
  assert.equal(shots.reviewBefore, true);
  assert.equal(step(run, 'plan').result, 'Summary of plan');
  assert.throws(
    () => runStep(run, { expectedRevision: run.revision, stepId: 'assemble' }),
    error('INVALID_STATE'),
  );
});

test('review-before approval is tied to the exact bound input and cannot bypass dependencies', () => {
  let run = accept(
    result(execute(start(), 'plan'), 'plan', { scenes: [{ prompt: 'Scene 01' }] }),
    'plan',
  );
  assert.throws(
    () => runStep(run, { expectedRevision: run.revision, stepId: 'shots' }),
    error('STALE_REVIEW'),
  );
  run = prepareStep(run, { expectedRevision: run.revision, stepId: 'shots' });
  const hash = step(run, 'shots').inputHash!;
  assert.equal(step(run, 'shots').reviewPhase, 'input');
  assert.throws(
    () =>
      decideInput(run, {
        expectedRevision: run.revision,
        stepId: 'shots',
        inputHash: 'wrong',
        decision: 'accept',
      }),
    error('STALE_REVIEW'),
  );
  run = decideInput(run, {
    expectedRevision: run.revision,
    stepId: 'shots',
    inputHash: hash,
    decision: 'accept',
  });
  run = runStep(run, { expectedRevision: run.revision, stepId: 'shots' });
  assert.equal(step(run, 'shots').status, 'running');
  assert.equal(step(run, 'shots').inputDecision?.inputHash, hash);
});

test('result review checks current revision, attempt, hash and actual content before accepting', () => {
  const run = result(execute(start(), 'plan'), 'plan', { scenes: [{ prompt: 'Original' }] });
  const review = {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt: 1,
    resultHash: step(run, 'plan').resultHash!,
    decision: 'accept' as const,
  };
  assert.throws(
    () => decideResult(run, { ...review, expectedRevision: 0 }),
    error('REVISION_CONFLICT'),
  );
  assert.throws(() => decideResult(run, { ...review, attempt: 0 }), error('STALE_REVIEW'));
  assert.throws(() => decideResult(run, { ...review, resultHash: 'wrong' }), error('STALE_REVIEW'));
  const tampered = structuredClone(run);
  step(tampered, 'plan').output!.value = {
    scenes: [{ prompt: 'Changed after rendering the review' }],
  };
  assert.throws(() => decideResult(tampered, review), error('STALE_REVIEW'));
  const accepted = decideResult(run, review);
  assert.equal(step(accepted, 'plan').status, 'completed');
  assert.throws(
    () => decideResult(accepted, { ...review, expectedRevision: accepted.revision }),
    error('STALE_REVIEW'),
  );
});

test('rejected results remain preserved and require an explicit redo before another attempt', () => {
  let run = result(execute(start(), 'plan'), 'plan', { scenes: [{ prompt: 'Rejected draft' }] });
  run = decideResult(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt: 1,
    resultHash: step(run, 'plan').resultHash!,
    decision: 'reject',
  });
  assert.equal(run.status, 'failed');
  assert.equal(step(run, 'plan').output?.value && typeof step(run, 'plan').output?.value, 'object');
  assert.throws(
    () => runStep(run, { expectedRevision: run.revision, stepId: 'plan' }),
    error('INVALID_STATE'),
  );
  run = redoStep(run, { expectedRevision: run.revision, stepId: 'plan' });
  assert.equal(step(run, 'plan').history[0].decision?.decision, 'reject');
  run = execute(run, 'plan');
  assert.equal(step(run, 'plan').attempt, 2);
});

test('redo invalidates only the selected step and transitive downstream, preserving old results and unrelated work', () => {
  const d = definition();
  d.steps.push({
    id: 'independent',
    title: 'Independent check',
    capabilityId: 'custom.audit',
    role: 'auditor',
    dependsOn: [],
    input: {},
    reviewAfter: false,
  });
  let run = start(d);
  run = result(execute(run, 'independent'), 'independent', { checked: true });
  run = accept(result(execute(run, 'plan'), 'plan', { scenes: [{ prompt: 'Scene 01' }] }), 'plan');
  run = accept(
    result(execute(run, 'shots'), 'shots', { video: 'video' }, [{ id: 'video', kind: 'asset' }]),
    'shots',
  );
  run = result(execute(run, 'assemble'), 'assemble', { film: 'sequence' }, [
    { id: 'sequence', kind: 'sequence' },
  ]);
  const untouched = step(run, 'independent');
  const oldShots = step(run, 'shots').output;
  run = redoStep(run, { expectedRevision: run.revision, stepId: 'shots' });
  assert.deepEqual(step(run, 'independent'), untouched);
  assert.equal(step(run, 'plan').status, 'completed');
  assert.equal(step(run, 'shots').status, 'stale');
  assert.equal(step(run, 'assemble').status, 'stale');
  assert.equal(step(run, 'shots').decision, undefined);
  assert.equal(step(run, 'shots').inputDecision, undefined);
  assert.equal(step(run, 'shots').resultHash, undefined);
  assert.deepEqual(step(run, 'shots').history[0].output, oldShots);
  assert.equal(
    step(run, 'assemble').history[0].output?.value &&
      typeof step(run, 'assemble').history[0].output?.value,
    'object',
  );
  assert.equal(nextStep(run)?.stepId, 'shots');
  assert.throws(
    () => runStep(run, { expectedRevision: run.revision, stepId: 'shots' }),
    error('STALE_REVIEW'),
  );
  run = execute(run, 'shots');
  assert.equal(step(run, 'shots').attempt, 2);
  assert.equal(step(run, 'shots').history.length, 1);
});

test('a completion from an old attempt cannot overwrite a restarted step', () => {
  let run = execute(start(), 'plan');
  const staleRevision = run.revision;
  run = redoStep(run, { expectedRevision: run.revision, stepId: 'plan' });
  run = execute(run, 'plan');
  assert.throws(
    () =>
      completeStep(run, {
        expectedRevision: staleRevision,
        stepId: 'plan',
        attempt: 1,
        result: { value: 'old', artifacts: [] },
      }),
    error('REVISION_CONFLICT'),
  );
  assert.throws(
    () =>
      completeStep(run, {
        expectedRevision: run.revision,
        stepId: 'plan',
        attempt: 1,
        result: { value: 'old', artifacts: [] },
      }),
    error('INVALID_STATE'),
  );
  assert.equal(step(run, 'plan').attempt, 2);
  assert.equal(step(run, 'plan').output, undefined);
});

test('jobs and proposals keep a step waiting until the host materializes every declared dependency', () => {
  let run = execute(start(), 'plan');
  const attempt = step(run, 'plan').attempt;
  run = completeStep(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt,
    result: { value: { scenes: [{ jobId: 'job' }] }, artifacts: [] },
    waiting: [
      { id: 'job', kind: 'job' },
      { id: 'proposal', kind: 'proposal' },
    ],
  });
  assert.equal(step(run, 'plan').status, 'waiting');
  assert.equal(nextStep(run), null);
  const oldHash = step(run, 'plan').resultHash!;
  assert.throws(
    () =>
      decideResult(run, {
        expectedRevision: run.revision,
        stepId: 'plan',
        attempt,
        resultHash: oldHash,
        decision: 'accept',
      }),
    error('STALE_REVIEW'),
  );
  assert.throws(
    () =>
      resolveWaiting(run, {
        expectedRevision: run.revision,
        stepId: 'plan',
        attempt,
        resultHash: oldHash,
        resolvedIds: ['unknown'],
      }),
    error('INVALID_INPUT'),
  );
  run = resolveWaiting(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt,
    resultHash: oldHash,
    resolvedIds: ['proposal'],
  });
  assert.equal(step(run, 'plan').status, 'waiting');
  run = resolveWaiting(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt,
    resultHash: oldHash,
    resolvedIds: ['job'],
    result: {
      value: { scenes: [{ assetId: 'asset' }] },
      artifacts: [{ id: 'asset', kind: 'asset' }],
    },
  });
  assert.equal(step(run, 'plan').status, 'review');
  assert.notEqual(step(run, 'plan').resultHash, oldHash);
  assert.throws(
    () =>
      decideResult(run, {
        expectedRevision: run.revision,
        stepId: 'plan',
        attempt,
        resultHash: oldHash,
        decision: 'accept',
      }),
    error('STALE_REVIEW'),
  );
  run = accept(run, 'plan');
  assert.deepEqual(nextStep(run, ['asset'])?.input.scene, { assetId: 'asset' });
  assert.throws(() => nextStep(run, []), error('ARTIFACT_MISSING'));
});

test('completion verifies required steps, exact accepted results, output pointers and available declared artifacts', () => {
  const incomplete = start();
  assert.throws(
    () => completeRun(incomplete, { expectedRevision: 0, availableArtifacts: [] }),
    error('INVALID_STATE'),
  );
  const run = finishSteps();
  assert.throws(
    () => completeRun(run, { expectedRevision: run.revision, availableArtifacts: ['sequence'] }),
    error('ARTIFACT_MISSING'),
  );
  assert.throws(
    () =>
      completeRun(run, {
        expectedRevision: run.revision,
        availableArtifacts: [
          { id: 'video', kind: 'job' },
          { id: 'sequence', kind: 'sequence' },
        ],
      }),
    error('ARTIFACT_MISSING'),
  );
  const completed = completeRun(run, {
    expectedRevision: run.revision,
    availableArtifacts: [
      { id: 'video', kind: 'asset' },
      { id: 'sequence', kind: 'sequence' },
    ],
  });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.outputs, { film: 'sequence', brief: '一部产品短片' });
  assert.equal(nextStep(completed), null);
  assert.equal(completed.revision, run.revision + 1);
  assert.throws(
    () =>
      completeRun(completed, {
        expectedRevision: completed.revision,
        availableArtifacts: ['video', 'sequence'],
      }),
    error('INVALID_STATE'),
  );
  const missingPointer = structuredClone(run);
  missingPointer.definition.outputs.film.pointer = '/value/missing';
  assert.throws(
    () =>
      completeRun(missingPointer, {
        expectedRevision: run.revision,
        availableArtifacts: ['video', 'sequence'],
      }),
    error('BINDING_MISSING'),
  );
});

test('worker failures are revision-aware and retain the attempted input for explicit recovery', () => {
  let run = execute(start(), 'plan');
  run = failStep(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt: 1,
    error: 'Remote model failed',
  });
  assert.equal(run.status, 'failed');
  assert.equal(step(run, 'plan').error, 'Remote model failed');
  assert.equal(step(run, 'plan').input?.brief, '一部产品短片');
  run = redoStep(run, { expectedRevision: run.revision, stepId: 'plan' });
  assert.equal(step(run, 'plan').history[0].error, 'Remote model failed');
  assert.equal(step(run, 'plan').error, undefined);
  assert.equal(execute(run, 'plan').steps[0].attempt, 2);
});

test('downstream bindings cannot consume an upstream result whose content changed after approval', () => {
  const run = structuredClone(
    accept(result(execute(start(), 'plan'), 'plan', { scenes: [{ prompt: 'Accepted' }] }), 'plan'),
  );
  step(run, 'plan').output!.value = { scenes: [{ prompt: 'Unreviewed replacement' }] };
  step(run, 'plan').resultHash = hashRecipeValue(step(run, 'plan').output);
  assert.throws(() => nextStep(run), error('STALE_REVIEW'));
});

test('the host can fail a waiting remote dependency without losing its result and wait provenance', () => {
  let run = execute(start(), 'plan');
  run = completeStep(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt: 1,
    result: { value: { scenes: [] }, artifacts: [] },
    waiting: [{ id: 'job', kind: 'job' }],
  });
  run = failStep(run, {
    expectedRevision: run.revision,
    stepId: 'plan',
    attempt: 1,
    error: 'Seedance task failed',
  });
  assert.equal(run.status, 'failed');
  assert.equal(step(run, 'plan').waiting?.[0].id, 'job');
  run = redoStep(run, { expectedRevision: run.revision, stepId: 'plan' });
  assert.equal(step(run, 'plan').history[0].error, 'Seedance task failed');
  assert.equal(step(run, 'plan').history[0].waiting?.[0].id, 'job');
});

test('unstarted optional steps do not block final output, but active optional work cannot be abandoned as complete', () => {
  const run = structuredClone(finishSteps());
  run.definition.steps.push({
    id: 'optional',
    title: 'Optional audit',
    capabilityId: 'custom.audit',
    dependsOn: [],
    input: {},
    reviewAfter: false,
    required: false,
  });
  run.steps.push({
    id: 'optional',
    title: 'Optional audit',
    capabilityId: 'custom.audit',
    status: 'pending',
    attempt: 0,
    history: [],
  });
  assert.equal(
    completeRun(run, { expectedRevision: run.revision, availableArtifacts: ['video', 'sequence'] })
      .status,
    'completed',
  );
  const running = execute(run, 'optional');
  assert.throws(
    () =>
      completeRun(running, {
        expectedRevision: running.revision,
        availableArtifacts: ['video', 'sequence'],
      }),
    error('INVALID_STATE'),
  );
});
