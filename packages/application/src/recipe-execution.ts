import {
  completeRun,
  completeStep,
  decideInput as approveInput,
  decideResult as approveResult,
  failStep,
  hashRecipeValue,
  nextStep,
  prepareStep,
  redoStep,
  resolveWaiting,
  runStep,
  startRun,
  type RecipeRun,
  type RecipeStep,
  type RecipeTarget,
  type RecipeJson,
  type RecipeArtifact,
  type RecipeResult,
  type RecipeWaiting,
  type DecideRecipeInputRequest,
  type DecideRecipeResultRequest,
} from '../../core/src/recipe.js';
import type {
  AgentDefinition,
  CapabilityDescriptor,
  DeclarativeKit,
  KitManifest,
  RecipeDefinition,
} from '../../kit-sdk/src/types.js';
import type { ProjectStore, ProjectState as PersistedState } from './project-store.js';
import type { Review, KitInfo } from './model.js';
export interface RecipePorts {
  id(): string;
  assetAvailable(directory: string, relativePath: string): boolean;
}
export interface RecipeCatalog {
  list(): KitInfo[];
  manifests(): KitManifest[];
  recipe(kitId: string): RecipeDefinition;
  capabilities(): (CapabilityDescriptor & {
    kitId: string;
  })[];
  agents(): AgentDefinition[];
  fingerprint?(kitId: string):
    | {
        manifest: KitManifest;
        digest: string;
      }
    | undefined;
}
interface FrozenKit {
  version: string;
  digest: string;
  manifest: KitManifest;
  descriptors: CapabilityDescriptor[];
  agents: AgentDefinition[];
}
export interface PersistentRecipe extends RecipeRun {
  kitId: string;
  sessionId: string;
  recipeManifest: KitManifest;
  frozenAgents: Record<string, AgentDefinition>;
}
export interface RecipeExecution {
  recipe: PersistentRecipe;
  step: RecipeStep;
  task: string;
  target: RecipeTarget;
  agentDefinition?: AgentDefinition;
}
export interface RecipeReviewBinding {
  recipeId?: string;
  stepId?: string;
  recipeAttempt?: number;
  jobId?: string;
}
type BoundReview = Review & RecipeReviewBinding;
const data = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const reviewsFor = (
  state: PersistedState,
  run: PersistentRecipe,
  step: RecipeStep,
): BoundReview[] =>
  state.reviews.filter(
    (review: BoundReview) =>
      review.recipeId === run.id &&
      review.stepId === step.id &&
      review.recipeAttempt === step.attempt,
  );
const terminalJobs = new Set(['succeeded', 'failed', 'cancelled']);
function lookup(state: PersistedState, recipeId: string): PersistentRecipe {
  const recipe = state.recipes.find((run) => run.id === recipeId) as PersistentRecipe | undefined;
  if (!recipe?.definition || !recipe.frozenAgents)
    throw new Error('制作计划不存在或使用旧格式，请创建新的配方运行。');
  return recipe;
}
function save(state: PersistedState, run: PersistentRecipe): void {
  const index = state.recipes.findIndex((item) => item.id === run.id);
  if (index < 0) throw new Error('制作计划不存在。');
  state.recipes[index] = run as unknown as PersistedState['recipes'][number];
}
function stepFor(run: PersistentRecipe, stepId: string): RecipeStep {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) throw new Error('制作步骤不存在。');
  return step;
}
function core(run: PersistentRecipe, changed: RecipeRun): PersistentRecipe {
  return {
    ...changed,
    kitId: run.kitId,
    sessionId: run.sessionId,
    recipeManifest: run.recipeManifest,
    frozenAgents: run.frozenAgents,
  };
}
/** Recipe execution coordinates frozen definitions, exact approvals and available artifacts. */
export class RecipeExecutionService {
  constructor(
    readonly database: ProjectStore,
    private readonly catalog: RecipeCatalog,
    private readonly ports: RecipePorts,
  ) {}
  create(input: {
    kitId: string;
    title: string;
    sequenceId?: string;
    input?: RecipeJson;
  }): PersistentRecipe {
    const definition = this.catalog.recipe(input.kitId),
      pins = this.freezeDependencies(input.kitId, definition);
    const agents = Object.fromEntries(
      definition.steps.flatMap((step) => {
        const agent = this.catalog
          .agents()
          .find((item) => item.descriptor.id === step.capabilityId);
        return agent ? [[step.capabilityId, data(agent)]] : [];
      }),
    );
    return this.database.transaction((state) => {
      const targetSequence = input.sequenceId
        ? state.sequences.find((sequence) => sequence.id === input.sequenceId)
        : state.sequences[0];
      if (input.sequenceId && !targetSequence) throw new Error('选定的作品不存在。');
      const sessionId = this.ports.id(),
        run = startRun(
          data(definition),
          input.input ?? { brief: input.title },
          data(pins) as unknown as Record<string, RecipeJson>,
          {
            projectId: state.project.id,
            ...(targetSequence
              ? { sequenceId: targetSequence.id, expectedRevision: targetSequence.revision }
              : {}),
          },
          { id: this.ports.id(), title: input.title },
        );
      const recipe: PersistentRecipe = {
        ...run,
        kitId: input.kitId,
        sessionId,
        recipeManifest: data(pins[input.kitId].manifest),
        frozenAgents: agents,
      };
      state.sessions.push({
        id: sessionId,
        title: `配方 · ${definition.descriptor.name}`,
        messages: [],
      });
      state.recipes.push(recipe as unknown as PersistedState['recipes'][number]);
      return data(recipe);
    }, 'recipe.created');
  }
  /** Returns null for reviews/waits or after completing a run; it never submits jobs itself. */
  resume(recipeId: string, redoStepId?: string): RecipeExecution | null {
    return this.database.transaction((state) => {
      let run = lookup(state, recipeId);
      this.checkDependencies(run);
      this.checkTarget(state, run);
      if (redoStepId) {
        const affected = this.downstream(run, redoStepId);
        for (const step of run.steps.filter((item) => affected.has(item.id)))
          for (const review of reviewsFor(state, run, step)) {
            const job = review.jobId
              ? state.jobs.find((item) => item.id === review.jobId)
              : undefined;
            if (
              review.kind === 'generation' &&
              (review.status === 'pending' ||
                (review.status === 'accepted' && (!job || !terminalJobs.has(job.status))))
            ) {
              throw new Error(
                '存在未结束的生成确认或任务，请先核对原任务；重做不能重新提交这笔生成。',
              );
            }
          }
        for (const review of state.reviews as BoundReview[])
          if (
            review.recipeId === run.id &&
            affected.has(review.stepId ?? '') &&
            review.status === 'pending'
          )
            review.status = 'rejected';
        run = core(run, redoStep(run, { expectedRevision: run.revision, stepId: redoStepId }));
      }
      run = this.reconcile(state, run);
      save(state, run);
      if (
        run.steps.some(
          (step) =>
            ['running', 'review', 'waiting'].includes(step.status) ||
            (step.status === 'failed' &&
              run.definition.steps.find((definition) => definition.id === step.id)?.required !==
                false),
        )
      )
        return null;
      const execution = nextStep(run, this.available(state));
      if (!execution) {
        if (run.status !== 'completed') {
          run = core(
            run,
            completeRun(run, {
              expectedRevision: run.revision,
              availableArtifacts: this.available(state),
            }),
          );
          save(state, run);
        }
        return null;
      }
      if (
        execution.reviewBefore &&
        stepFor(run, execution.stepId).inputDecision?.inputHash !== execution.inputHash
      ) {
        run = core(
          run,
          prepareStep(run, { expectedRevision: run.revision, stepId: execution.stepId }),
        );
        save(state, run);
        return null;
      }
      run = core(run, runStep(run, { expectedRevision: run.revision, stepId: execution.stepId }));
      save(state, run);
      const step = stepFor(run, execution.stepId),
        agentDefinition = run.frozenAgents[step.capabilityId];
      const needed = [
        ...run.definition.steps.flatMap((candidate) =>
          Object.values(candidate.input)
            .filter(
              (binding) =>
                binding &&
                typeof binding === 'object' &&
                'from' in binding &&
                binding.from === 'step' &&
                binding.stepId === step.id,
            )
            .map(
              (binding) =>
                (
                  binding as {
                    pointer: string;
                  }
                ).pointer,
            ),
        ),
        ...Object.values(run.definition.outputs)
          .filter((ref) => ref.from === 'step' && ref.stepId === step.id)
          .map((ref) => ref.pointer),
      ];
      const priorAssets = step.history.flatMap(
        (attempt) =>
          attempt.output?.artifacts.filter(
            (artifact) =>
              artifact.kind === 'asset' &&
              this.available(state).some((available) => available.id === artifact.id),
          ) ?? [],
      );
      const task =
        `执行已冻结配方中的实际能力：${step.capabilityId}\n步骤：${step.title}\n绑定输入：${JSON.stringify(execution.input)}\n固定目标：${JSON.stringify(run.target)}\n所需结果路径：${JSON.stringify([...new Set(needed)])}\n可复用的先前候选：${JSON.stringify(priorAssets)}\n` +
        '按实际能力和绑定输入完成本步骤。引用素材必须使用工程中真实的 ID。生成与编辑必须提出审阅；未采纳的提案和未成功的任务不代表完成。先读取当前作品版本，再提出编辑。不要重放旧的编辑命令或重新提交旧的生成任务。若下游要求结构化结果，返回 JSON {"value":...,"artifacts":[{"id":"真实 ID","kind":"asset 或 sequence"}]}，满足上列 JSON Pointer；否则可以返回文字。';
      return data({
        recipe: run,
        step,
        task,
        target: run.target,
        ...(agentDefinition ? { agentDefinition } : {}),
      });
    }, 'recipe.changed');
  }
  settle(
    recipeId: string,
    stepId: string,
    attempt: number,
    result: {
      status: 'completed' | 'failed' | 'stopped';
      text: string;
      error?: string;
    },
  ): PersistentRecipe {
    return this.database.transaction((state) => {
      let run = lookup(state, recipeId);
      const step = stepFor(run, stepId);
      if (step.status !== 'running' || step.attempt !== attempt)
        throw new Error('此回调属于旧的制作步骤，不会覆盖新尝试。');
      if (result.status !== 'completed') {
        run = core(
          run,
          failStep(run, {
            expectedRevision: run.revision,
            stepId,
            attempt,
            error:
              result.error ??
              (result.status === 'stopped' ? '用户已停止此步骤。' : 'Agent 运行失败。'),
          }),
        );
        for (const review of reviewsFor(state, run, step))
          if (review.status === 'pending') review.status = 'rejected';
        if (result.status === 'stopped') run.status = 'paused';
      } else {
        try {
          const parsed = this.parseResult(result.text);
          const materialized = this.materialize(state, run, step, parsed);
          run = core(
            run,
            completeStep(run, {
              expectedRevision: run.revision,
              stepId,
              attempt,
              result: materialized.result,
              waiting: materialized.waiting,
              summary: result.text,
            }),
          );
        } catch (error) {
          run = core(
            run,
            failStep(run, {
              expectedRevision: run.revision,
              stepId,
              attempt,
              error: error instanceof Error ? error.message : '步骤结果不可用。',
            }),
          );
          for (const review of reviewsFor(state, run, step))
            if (review.status === 'pending') review.status = 'rejected';
        }
      }
      save(state, run);
      return data(run);
    }, 'recipe.changed');
  }
  decideInput(
    input: DecideRecipeInputRequest & {
      recipeId: string;
    },
  ): PersistentRecipe {
    return this.database.transaction((state) => {
      const run = lookup(state, input.recipeId);
      if (input.decision === 'accept') {
        this.checkDependencies(run);
        this.checkTarget(state, run);
      }
      const changed = core(run, approveInput(run, input));
      save(state, changed);
      return data(changed);
    }, 'recipe.reviewed');
  }
  decideResult(
    input: DecideRecipeResultRequest & {
      recipeId: string;
    },
  ): PersistentRecipe {
    return this.database.transaction((state) => {
      const run = lookup(state, input.recipeId);
      if (input.decision === 'accept') {
        this.checkDependencies(run);
        this.checkTarget(state, run);
        const current = stepFor(run, input.stepId);
        this.assertArtifacts(state, current.output?.artifacts ?? []);
      }
      const changed = core(run, approveResult(run, input));
      save(state, changed);
      return data(changed);
    }, 'recipe.reviewed');
  }
  /** Call before accepting an ActionReview; the service never reapplies its commands. */
  assertReviewCurrent(review: RecipeReviewBinding): void {
    if (!review.recipeId) return;
    const state = this.database.read(),
      run = lookup(state, review.recipeId);
    this.checkDependencies(run);
    this.checkTarget(state, run);
    const step = stepFor(run, review.stepId ?? '');
    if (step.attempt !== review.recipeAttempt || !['running', 'waiting'].includes(step.status))
      throw new Error('提案属于旧的配方尝试，请查看当前步骤。');
  }
  exportRecipeDefinition(recipeId: string): DeclarativeKit {
    const run = lookup(this.database.read(), recipeId),
      prefix = `shared.${hashRecipeValue(data(run.definition)).slice(0, 20)}`;
    const agents = Object.values(run.frozenAgents).map(data),
      mapping = new Map(
        agents.map((agent, index) => [agent.descriptor.id, `${prefix}.agent-${index + 1}`]),
      );
    const recipe = data(run.definition) as RecipeDefinition;
    recipe.descriptor.id = `${prefix}.recipe`;
    recipe.steps.forEach((step) => {
      step.capabilityId = mapping.get(step.capabilityId) ?? step.capabilityId;
    });
    agents.forEach((agent) => {
      agent.descriptor.id = mapping.get(agent.descriptor.id)!;
      agent.tools = agent.tools.map((tool) => mapping.get(tool) ?? tool);
    });
    const permissions = [
      ...new Set([
        ...recipe.descriptor.permissions,
        ...agents.flatMap((agent) => agent.descriptor.permissions),
      ]),
    ];
    const externalIds = new Set([
      ...recipe.steps.map((step) => step.capabilityId),
      ...agents.flatMap((agent) => agent.tools),
    ]);
    const dependencies = Object.fromEntries(
      Object.entries(run.frozenDependencies)
        .filter(
          ([kitId, pin]) =>
            kitId !== run.kitId ||
            (pin as unknown as FrozenKit).descriptors.some((descriptor) =>
              externalIds.has(descriptor.id),
            ),
        )
        .map(([kitId, pin]) => [kitId, (pin as unknown as FrozenKit).version]),
    );
    return {
      manifest: {
        schemaVersion: 1,
        id: prefix,
        name: run.definition.descriptor.name,
        version: '1.0.0',
        hostApi: '1',
        source: 'shared',
        author: run.recipeManifest.author,
        description: recipe.descriptor.description,
        license: run.recipeManifest.license,
        permissions,
        dependencies,
        capabilities: [
          ...agents.map((agent) => ({ id: agent.descriptor.id, kind: 'agent' as const })),
          { id: recipe.descriptor.id, kind: 'recipe' as const },
        ],
      },
      agents,
      recipes: [recipe],
    };
  }
  private freezeDependencies(
    kitId: string,
    definition: RecipeDefinition,
  ): Record<string, FrozenKit> {
    const pins: Record<string, FrozenKit> = {},
      capabilities = this.catalog.capabilities(),
      pending = [kitId];
    for (const step of definition.steps) {
      const owner = capabilities.find((capability) => capability.id === step.capabilityId);
      if (!owner) throw new Error(`步骤能力不可用：${step.capabilityId}`);
      pending.push(owner.kitId);
    }
    while (pending.length) {
      const currentId = pending.pop()!;
      if (pins[currentId]) continue;
      const info = this.catalog
        .list()
        .find((item) => item.id === currentId && item.installed && item.enabled);
      if (!info) throw new Error(`依赖 Kit 未启用：${currentId}`);
      const fingerprint = this.catalog.fingerprint?.(currentId),
        manifest =
          fingerprint?.manifest ?? this.catalog.manifests().find((item) => item.id === currentId);
      if (!manifest || manifest.version !== info.version)
        throw new Error(`无法固定 Kit 的实际版本：${currentId}`);
      const descriptors = capabilities
        .filter((capability) => capability.kitId === currentId)
        .map(({ kitId, ...descriptor }) => descriptor);
      const ownedIds = new Set(descriptors.map((descriptor) => descriptor.id)),
        agents = this.catalog.agents().filter((agent) => ownedIds.has(agent.descriptor.id));
      pins[currentId] = data({
        version: info.version,
        digest: fingerprint?.digest ?? hashRecipeValue(data(manifest)),
        manifest,
        descriptors,
        agents,
      });
      pending.push(...Object.keys(manifest.dependencies));
      for (const agent of agents)
        for (const tool of agent.tools) {
          const owner = capabilities.find((capability) => capability.id === tool);
          if (owner) pending.push(owner.kitId);
        }
    }
    return pins;
  }
  private checkDependencies(run: PersistentRecipe): void {
    const current = this.freezeDependencies(run.kitId, run.definition as RecipeDefinition);
    if (hashRecipeValue(data(current)) !== hashRecipeValue(run.frozenDependencies))
      throw new Error('配方依赖或能力定义已升级，请创建新运行；旧记录与结果仍保留。');
    const authored = this.catalog.recipe(run.kitId);
    if (hashRecipeValue(data(authored)) !== hashRecipeValue(data(run.definition)))
      throw new Error('实际配方已变化，请创建新运行。');
  }
  private checkTarget(state: PersistedState, run: PersistentRecipe): void {
    if (
      state.project.id !== run.target.projectId ||
      (run.target.sequenceId &&
        !state.sequences.some((sequence) => sequence.id === run.target.sequenceId))
    )
      throw new Error('配方固定的目标作品已不存在。');
  }
  private downstream(run: PersistentRecipe, stepId: string): Set<string> {
    stepFor(run, stepId);
    const affected = new Set([stepId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of run.definition.steps)
        if (!affected.has(step.id) && step.dependsOn.some((id) => affected.has(id))) {
          affected.add(step.id);
          changed = true;
        }
    }
    return affected;
  }
  private available(state: PersistedState): RecipeArtifact[] {
    const result: RecipeArtifact[] = state.sequences.map((sequence) => ({
      id: sequence.id,
      kind: 'sequence',
    }));
    for (const asset of state.assets) {
      if (this.ports.assetAvailable(this.database.directory, asset.path))
        result.push({ id: asset.id, kind: 'asset' }, { id: asset.id, kind: asset.kind });
    }
    for (const review of state.reviews)
      if (review.status === 'accepted') result.push({ id: review.id, kind: 'proposal' });
    for (const job of state.jobs)
      if (
        job.status === 'succeeded' &&
        (job.kind !== 'seedance' ||
          result.some((ref) => ref.id === job.outputAssetId && ref.kind === 'asset'))
      )
        result.push({ id: job.id, kind: 'job' });
    return result;
  }
  private assertArtifacts(state: PersistedState, artifacts: RecipeArtifact[]): void {
    const available = new Set(this.available(state).map((ref) => `${ref.kind}\0${ref.id}`));
    for (const artifact of artifacts)
      if (!available.has(`${artifact.kind}\0${artifact.id}`))
        throw new Error(`结果引用的素材、作品或任务尚不可用：${artifact.id}`);
  }
  private parseResult(text: string): RecipeResult {
    if (typeof text !== 'string' || text.length > 16000)
      throw new Error('步骤结果过长或无法读取。');
    const trimmed = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
    let value: unknown = text;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        throw new Error('步骤返回了无效 JSON，请重做并返回符合绑定路径的结果。');
      }
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'value' in value &&
      'artifacts' in value
    )
      return data(value) as RecipeResult;
    return { value: value as RecipeJson, artifacts: [] };
  }
  private materialize(
    state: PersistedState,
    run: PersistentRecipe,
    step: RecipeStep,
    base: RecipeResult,
  ): {
    result: RecipeResult;
    waiting: RecipeWaiting[];
  } {
    hashRecipeValue(base);
    if (!Array.isArray(base.artifacts)) throw new Error('结果缺少有效的 artifacts 列表。');
    const reviews = reviewsFor(state, run, step),
      artifactMap = new Map(base.artifacts.map((ref) => [`${ref.kind}\0${ref.id}`, ref])),
      waiting: RecipeWaiting[] = [];
    const add = (artifact: RecipeArtifact) =>
      artifactMap.set(`${artifact.kind}\0${artifact.id}`, artifact);
    for (const ref of base.artifacts) {
      const registered = this.available(state).some(
        (item) => item.id === ref.id && item.kind === ref.kind,
      );
      if (
        !registered &&
        !reviews.some(
          (review) =>
            (review.id === ref.id && ref.kind === 'proposal') ||
            (review.jobId === ref.id && ref.kind === 'job'),
        )
      )
        throw new Error(`Agent 引用了不存在的结果：${ref.id}`);
      if (ref.kind === 'sequence' && run.target.sequenceId && ref.id !== run.target.sequenceId)
        throw new Error('步骤结果引用了不同的作品目标。');
    }
    for (const review of reviews) {
      if (review.status === 'rejected') throw new Error('步骤提案已被拒绝，请重做此步骤。');
      add({ id: review.id, kind: 'proposal' });
      if (review.status === 'pending') {
        waiting.push({ id: review.id, kind: 'proposal' });
        continue;
      }
      if (review.kind === 'generation') {
        const job = state.jobs.find((job) => job.id === review.jobId);
        if (!job) {
          waiting.push({ id: review.id, kind: 'proposal' });
          continue;
        }
        add({ id: job.id, kind: 'job' });
        if (job.status === 'failed' || job.status === 'cancelled')
          throw new Error(job.error ?? '生成任务未成功，请核对后重做此步骤。');
        if (job.status !== 'succeeded') {
          waiting.push({ id: job.id, kind: 'job' });
          continue;
        }
        const asset = state.assets.find((asset) => asset.id === job.outputAssetId);
        if (
          !asset ||
          !this.available(state).some((ref) => ref.id === asset.id && ref.kind === 'asset')
        )
          throw new Error('生成任务没有可用的已归档素材。');
        add({ id: asset.id, kind: 'asset' });
      } else {
        const sequence = state.sequences.find((sequence) => sequence.id === review.sequenceId);
        if (!sequence || !review.commands || review.expectedRevision === undefined)
          throw new Error('已采纳编辑的作品或命令不存在。');
        const receipt = this.database.receipt(review.id, {
          sequenceId: review.sequenceId,
          expectedRevision: review.expectedRevision,
          commandId: review.id,
          commands: review.commands,
        });
        if (!receipt) throw new Error('编辑仍未保存，不能将提案当作已完成作品。');
        if (run.target.sequenceId && sequence.id !== run.target.sequenceId)
          throw new Error('编辑结果与固定作品目标不一致。');
        add({ id: sequence.id, kind: 'sequence' });
      }
    }
    return { result: { value: base.value, artifacts: [...artifactMap.values()] }, waiting };
  }
  private reconcile(state: PersistedState, original: PersistentRecipe): PersistentRecipe {
    let run = original;
    for (const candidate of original.steps.filter((step) => step.status === 'waiting')) {
      const step = stepFor(run, candidate.id);
      try {
        const materialized = this.materialize(state, run, step, step.output!);
        const pending = new Set(materialized.waiting.map((ref) => ref.id)),
          old = new Set((step.waiting ?? []).map((ref) => ref.id));
        const resolvedIds = [...old].filter((id) => !pending.has(id)),
          additions = materialized.waiting.filter((ref) => !old.has(ref.id));
        if (resolvedIds.length)
          run = core(
            run,
            resolveWaiting(run, {
              expectedRevision: run.revision,
              stepId: step.id,
              attempt: step.attempt,
              resultHash: step.resultHash!,
              resolvedIds,
              ...(additions.length ? { waiting: additions } : {}),
              ...(!materialized.waiting.length ? { result: materialized.result } : {}),
            }),
          );
      } catch (error) {
        run = core(
          run,
          failStep(run, {
            expectedRevision: run.revision,
            stepId: step.id,
            attempt: step.attempt,
            error: error instanceof Error ? error.message : '等待结果不可用。',
          }),
        );
      }
    }
    return run;
  }
}
