import type { AgentDefinition } from '../../kit-sdk/src/types.js';
import type { RecipeJson } from '../../core/src/recipe.js';
import type { AgentInput, AppEvent, ChatMessage, ProjectSnapshot, Settings } from './model.js';
import type { IdentityClock, ProjectStore } from './project-store.js';
import type { HostToolRequest, WorkerResult, WorkerRole, WorkerRun } from './agent-contracts.js';
import type { RecipeExecution } from './recipe-execution.js';
export interface AgentRuntime {
  run(input: WorkerRun): Promise<WorkerResult>;
  stop(): Promise<void>;
}
export interface AgentRunContext {
  database: ProjectStore;
  input: AgentInput;
  runId: string;
  controller: AbortController;
  recipeId?: string;
  stepId?: string;
  recipeAttempt?: number;
  agentDefinition?: AgentDefinition;
}
export interface AgentExecutionPorts extends IdentityClock {
  configuration(): Settings;
  executionSettings(): WorkerRun['settings'];
  runtime(): AgentRuntime;
  snapshot(database: ProjectStore): ProjectSnapshot;
  loadHistory(database: ProjectStore, sessionId: string, role: string): Promise<unknown[]>;
  assertEditAvailable(projectId: string, sequenceId?: string): void;
  agents(): AgentDefinition[];
  capabilities(): string[];
  capabilityKind(id: string): string | undefined;
  hostTool(request: HostToolRequest, signal: AbortSignal): Promise<unknown>;
  settleRecipe(
    database: ProjectStore,
    recipeId: string,
    stepId: string,
    attempt: number,
    result: {
      status: 'completed' | 'failed' | 'stopped';
      text: string;
      error?: string;
    },
  ): void;
  changed(database: ProjectStore): void;
  emit(event: AppEvent): void;
}
export function publicContext(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    ...snapshot,
    project: { ...snapshot.project, path: '' },
    sessions: snapshot.sessions.map((session) => ({ ...session, messages: [] })),
    reviews: snapshot.reviews.slice(-20),
    recipes: snapshot.recipes.slice(-3),
    assets: snapshot.assets.map((a) => ({ ...a, url: '', thumbnailUrl: undefined })),
    jobs: snapshot.jobs.map((j) => ({
      ...j,
      input: { prompt: j.input.prompt, duration: j.input.duration, ratio: j.input.ratio },
    })),
  };
}
/** Owns the active request, durable budget reservations and stale-run/stop gates. */
export class AgentExecution {
  private activeRun?: AgentRunContext;
  private readonly executions = new Set<Promise<void>>();
  constructor(private readonly ports: AgentExecutionPorts) {}
  get active(): AgentRunContext | undefined {
    return this.activeRun;
  }
  private userMessage(
    text: string,
    role: ChatMessage['role'] = 'assistant',
    agent?: string,
  ): ChatMessage {
    return { id: this.ports.id(), role, text, agent, createdAt: this.ports.now() };
  }
  private requireModels(): Settings {
    const settings = this.ports.configuration();
    if (!settings.hasApiKey || !settings.agentModel || !settings.seedanceModel)
      throw new Error('请先在设置中配置方舟 API Key、Agent 模型和 Seedance 模型。');
    return settings;
  }
  private launch(work: Promise<void>): void {
    this.executions.add(work);
    void work.finally(() => this.executions.delete(work)).catch(() => {});
  }
  async stop(): Promise<void> {
    const stopped = this.activeRun;
    stopped?.controller.abort();
    await this.ports.runtime().stop();
    if (this.activeRun === stopped) this.activeRun = undefined;
  }
  async drain(): Promise<void> {
    await Promise.allSettled(this.executions);
  }
  resume(database: ProjectStore, execution: RecipeExecution): void {
    if (this.activeRun) throw new Error('Agent 正在运行。');
    const context: AgentRunContext = {
      database,
      input: {
        requestId: execution.recipe.id,
        sessionId: execution.recipe.sessionId,
        text: execution.task,
        sequenceId: execution.target.sequenceId,
        clipId: execution.target.clipId,
      },
      runId: this.ports.id(),
      recipeId: execution.recipe.id,
      stepId: execution.step.id,
      recipeAttempt: execution.step.attempt,
      agentDefinition: execution.agentDefinition,
      controller: new AbortController(),
    };
    this.activeRun = context;
    database.transaction((state) => {
      state.agentRuns ??= {};
      state.agentRuns[context.runId] = {
        rootRequestId: context.input.requestId,
        sessionId: context.input.sessionId,
        status: 'preparing',
        sequenceId: context.input.sequenceId,
      };
    }, 'agent.preparing');
    if (execution.agentDefinition)
      this.launch(this.runAgent(context, execution.agentDefinition.role, execution.task));
    else
      this.launch(this.runCapability(context, execution.step.capabilityId, execution.step.input!));
  }
  recover(db: ProjectStore): void {
    const state = db.read(),
      runs = Object.entries(state.agentRuns ?? {}).filter(([, run]) =>
        ['preparing', 'running'].includes(run.status),
      );
    const steps = state.recipes.flatMap((recipe) =>
      recipe.steps
        .filter((step) => step.status === 'running')
        .map((step) => ({ recipeId: recipe.id, stepId: step.id, attempt: step.attempt })),
    );
    if (!runs.length && !steps.length) return;
    db.transaction((current) => {
      current.budgets ??= {};
      for (const [runId, run] of runs) {
        current.agentRuns![runId].status = 'interrupted';
        const prior = current.budgets[run.rootRequestId] ?? {
          modelCalls: 0,
          toolCalls: 0,
          elapsedMs: 0,
          maxModelCalls: this.ports.configuration().maxModelCalls,
          maxToolCalls: 24,
          maxDurationMs: 120000,
        };
        current.budgets[run.rootRequestId] = {
          ...prior,
          modelCalls: prior.maxModelCalls,
          toolCalls: prior.maxToolCalls,
          elapsedMs: prior.maxDurationMs,
        };
      }
    }, 'agent.recovered');
    for (const step of steps)
      this.ports.settleRecipe(db, step.recipeId, step.stepId, step.attempt, {
        status: 'stopped',
        text: '',
        error:
          '应用在此步骤执行时退出。已保留任务与历史，不会重放工具；请核对已有任务后创建新运行。',
      });
  }
  private async runAgent(
    context: AgentRunContext,
    role: WorkerRole = 'coordinator',
    text = context.input.text,
  ): Promise<void> {
    const { database: db, input, runId } = context;
    try {
      const config = this.requireModels();
      const history = await this.ports.loadHistory(db, input.sessionId, role);
      if (context.controller.signal.aborted || this.activeRun !== context)
        throw new Error('用户已停止此请求。');
      const enabledAgents = this.ports.agents();
      const previousBudget = db.read().budgets?.[input.requestId];
      const reservation = previousBudget ?? {
        modelCalls: 0,
        toolCalls: 0,
        elapsedMs: 0,
        maxModelCalls: config.maxModelCalls,
        maxToolCalls: 24,
        maxDurationMs: 120000,
      };
      db.transaction((state) => {
        state.budgets ??= {};
        state.budgets[input.requestId] = {
          ...reservation,
          modelCalls: reservation.maxModelCalls,
          toolCalls: reservation.maxToolCalls,
          elapsedMs: reservation.maxDurationMs,
        };
      }, 'budget.reserved');
      const result = await this.ports.runtime().run({
        runId,
        sessionId: input.sessionId,
        rootRequestId: input.requestId,
        text,
        role,
        agentDefinition: context.agentDefinition,
        context: {
          snapshot: publicContext(this.ports.snapshot(db)),
          sequenceId: input.sequenceId,
          clipId: input.clipId,
          memories: this.ports
            .snapshot(db)
            .memories.slice(0, 8)
            .map((m) => m.content),
          capabilities: this.ports.capabilities(),
          enabledRoles: enabledAgents.map((a) => a.role),
          agentDefinitions: enabledAgents,
        },
        history,
        previousBudget,
        settings: this.ports.executionSettings(),
      });
      db.transaction((state) => {
        state.budgets ??= {};
        state.budgets[input.requestId] = result.budget;
        state.agentRuns ??= {};
        state.agentRuns[runId] = {
          rootRequestId: input.requestId,
          sessionId: input.sessionId,
          status: result.status,
          sequenceId: input.sequenceId,
          clipId: input.clipId,
        };
      }, 'agent.settled');
      if (result.text)
        db.appendMessage(input.sessionId, this.userMessage(result.text, 'assistant', role));
      if (result.error)
        db.appendMessage(input.sessionId, this.userMessage(result.error, 'tool', role));
      if (context.recipeId && context.stepId && context.recipeAttempt)
        this.ports.settleRecipe(
          db,
          context.recipeId,
          context.stepId,
          context.recipeAttempt,
          result,
        );
      this.ports.changed(db);
      this.ports.emit({
        type: 'agent.status',
        projectId: db.read().project.id,
        sessionId: input.sessionId,
        runId,
        status: result.status,
        agent: role,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent 运行失败。';
      const status = context.controller.signal.aborted ? 'stopped' : 'failed';
      db.transaction((state) => {
        state.agentRuns ??= {};
        state.agentRuns[runId] = {
          rootRequestId: input.requestId,
          sessionId: input.sessionId,
          status,
          sequenceId: input.sequenceId,
          clipId: input.clipId,
        };
      }, 'agent.settled');
      if (context.recipeId && context.stepId && context.recipeAttempt) {
        try {
          this.ports.settleRecipe(db, context.recipeId, context.stepId, context.recipeAttempt, {
            status,
            text: '',
            error: message,
          });
        } catch {
          /* An already settled attempt must stay unchanged. */
        }
      }
      db.appendMessage(input.sessionId, this.userMessage(message, 'tool', role));
      this.ports.changed(db);
      this.ports.emit({
        type: 'agent.status',
        projectId: db.read().project.id,
        sessionId: input.sessionId,
        runId,
        status,
        text: message,
      });
    } finally {
      if (this.activeRun?.runId === runId) this.activeRun = undefined;
    }
  }
  async prompt(
    db: ProjectStore,
    request: AgentInput,
  ): Promise<{
    runId: string;
  }> {
    const input = structuredClone(request);
    this.requireModels();
    if (this.activeRun) throw new Error('Agent 正在处理上一条请求，请等待或停止。');
    const state = db.read();
    if (!state.sessions.some((s) => s.id === input.sessionId)) throw new Error('会话不存在。');
    this.ports.assertEditAvailable(state.project.id, input.sequenceId);
    if (input.sequenceId && !state.sequences.some((s) => s.id === input.sequenceId))
      throw new Error('目标作品不存在。');
    if (
      input.clipId &&
      !state.sequences
        .find((s) => s.id === input.sequenceId)
        ?.clips.some((c) => c.id === input.clipId)
    )
      throw new Error('目标片段不存在。');
    const prior = db.receipt<{
      runId: string;
    }>(input.requestId, input);
    if (prior) return prior;
    const runId = this.ports.id();
    db.transaction((s) => {
      s.sessions
        .find((s) => s.id === input.sessionId)!
        .messages.push(this.userMessage(input.text, 'user'));
      s.agentRuns ??= {};
      s.agentRuns[runId] = {
        rootRequestId: input.requestId,
        sessionId: input.sessionId,
        status: 'preparing',
        sequenceId: input.sequenceId,
        clipId: input.clipId,
      };
      db.saveReceipt(input.requestId, input, { runId });
    }, 'session.changed');
    this.ports.changed(db);
    const context: AgentRunContext = {
      database: db,
      input,
      runId,
      controller: new AbortController(),
    };
    this.activeRun = context;
    this.launch(this.runAgent(context));
    return { runId };
  }
  private async runCapability(
    context: AgentRunContext,
    capabilityId: string,
    input: Record<string, RecipeJson>,
  ): Promise<void> {
    const db = context.database,
      started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const maxModelCalls = this.ports.configuration().maxModelCalls;
      const prior = db.read().budgets?.[context.input.requestId] ?? {
        modelCalls: 0,
        toolCalls: 0,
        elapsedMs: 0,
        maxModelCalls,
        maxToolCalls: 24,
        maxDurationMs: 120000,
      };
      if (prior.toolCalls >= prior.maxToolCalls || prior.elapsedMs >= prior.maxDurationMs)
        throw new Error('本次制作请求的工具或时间预算已用完，请创建新运行。');
      db.transaction((state) => {
        state.budgets ??= {};
        state.budgets[context.input.requestId] = { ...prior, toolCalls: prior.toolCalls + 1 };
      }, 'budget.reserved');
      timer = setTimeout(
        () => context.controller.abort(),
        Math.min(30000, prior.maxDurationMs - prior.elapsedMs),
      );
      const result = await this.ports.hostTool(
        {
          runId: context.runId,
          sessionId: context.input.sessionId,
          rootRequestId: context.input.requestId,
          role: 'coordinator',
          toolCallId: this.ports.id(),
          name: 'invoke_kit',
          args: { capabilityId, input },
        },
        context.controller.signal,
      );
      if (context.controller.signal.aborted) throw new Error('此步骤已停止或超过时间预算。');
      const kind = this.ports.capabilityKind(capabilityId);
      const output = kind === 'read' ? result : { value: result, artifacts: [] };
      this.ports.settleRecipe(db, context.recipeId!, context.stepId!, context.recipeAttempt!, {
        status: 'completed',
        text: JSON.stringify(output),
      });
      db.transaction((state) => {
        state.agentRuns![context.runId].status = 'completed';
      }, 'agent.settled');
      this.ports.changed(db);
      this.ports.emit({
        type: 'agent.status',
        projectId: db.read().project.id,
        sessionId: context.input.sessionId,
        runId: context.runId,
        status: 'completed',
      });
    } catch (error) {
      const status = context.controller.signal.aborted ? 'stopped' : 'failed',
        message = error instanceof Error ? error.message : 'Kit 执行失败。';
      try {
        this.ports.settleRecipe(db, context.recipeId!, context.stepId!, context.recipeAttempt!, {
          status,
          text: '',
          error: message,
        });
      } catch {
        /* An old attempt cannot overwrite current state. */
      }
      db.transaction((state) => {
        state.agentRuns![context.runId].status = status;
      }, 'agent.settled');
      this.ports.changed(db);
      this.ports.emit({
        type: 'agent.status',
        projectId: db.read().project.id,
        runId: context.runId,
        status,
        text: message,
      });
    } finally {
      if (timer) clearTimeout(timer);
      db.transaction((state) => {
        const budget = state.budgets?.[context.input.requestId];
        if (budget)
          budget.elapsedMs = Math.min(
            budget.maxDurationMs,
            budget.elapsedMs + Date.now() - started,
          );
      }, 'budget.settled');
      if (this.activeRun === context) this.activeRun = undefined;
    }
  }
}
