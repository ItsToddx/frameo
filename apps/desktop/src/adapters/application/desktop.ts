import { join, dirname } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import type { AppEvent, KitInfo, ProjectSnapshot, Review, Settings } from '../contracts/api';
import { commandSchema, generationSchema } from '../contracts/validation';
import { AppDatabase, ProjectDatabase, id, now, digest } from '../storage/database';
import { CredentialVault } from '../storage/credentials';
import { ProjectService } from '../storage/project-service';
import { importSharedProject, shareProject } from '../storage/share';
import { archiveMedia } from '../runtime/media';
import { inspectMedia } from '../runtime/inspect-media';
import { EditCoordinator } from './edit-coordinator';
import { RecipeService } from './recipe-service';
import { JobRunner } from '../runtime/jobs';
import { PiRuntime } from '../runtime/pi';
import { importDeclaration, exportDeclaration } from '../runtime/kits';
import { KitCatalog } from '../runtime/catalog';
import { NativeKitManager } from '../runtime/kit-manager';
import { captionStyleTool } from '../runtime/kits';
import {
  compileSchema,
  assertJsonValue,
  type JsonValue,
} from '../../../../../packages/kit-sdk/src/index';
import { validateCommands } from '../../../../../packages/core/src/index';
import { z } from 'zod';
import { ReviewDecisions } from '../../../../../packages/application/src/review-decisions.js';
import {
  AgentExecution,
  publicContext,
} from '../../../../../packages/application/src/agent-execution.js';
import type { DesktopApi } from '../contracts/api.js';
type DesktopMethods = {
  [K in Exclude<keyof DesktopApi, 'onEvent'>]: (
    ...input: Parameters<DesktopApi[K]>
  ) => ReturnType<DesktopApi[K]> | Awaited<ReturnType<DesktopApi[K]>>;
};
export interface DesktopApplicationPorts {
  userData: string;
  documents: string;
  version: string;
  vault: CredentialVault;
  workerPaths: {
    agent: string;
    kit: string;
  };
  emit: (event: AppEvent) => void;
  revealFile: (path: string) => void;
  dialog: {
    save: (options: {
      title?: string;
      defaultPath?: string;
      buttonLabel?: string;
      filters?: {
        name: string;
        extensions: string[];
      }[];
    }) => Promise<{
      canceled: boolean;
      filePath?: string;
    }>;
    open: (options: {
      title?: string;
      properties: ('openFile' | 'openDirectory' | 'multiSelections')[];
      filters?: {
        name: string;
        extensions: string[];
      }[];
    }) => Promise<{
      canceled: boolean;
      filePaths: string[];
    }>;
    confirm: (options: {
      type: 'warning' | 'question';
      title: string;
      message: string;
      detail: string;
      buttons: string[];
      defaultId?: number;
      cancelId: number;
    }) => Promise<{
      response: number;
    }>;
  };
  runtimeFactory?: (
    options: import('../runtime/pi').PiRuntimeOptions,
  ) => Pick<PiRuntime, 'run' | 'stop' | 'dispose' | 'isRunning'>;
  loadHistory?: (database: ProjectDatabase, sessionId: string, role: string) => Promise<unknown[]>;
}
export async function createDesktopApplication(ports: DesktopApplicationPorts) {
  let application: AppDatabase;
  const vault = ports.vault;
  let jobs: JobRunner;
  let runtime: Pick<PiRuntime, 'run' | 'stop' | 'dispose' | 'isRunning'>;
  let current: ProjectDatabase | undefined;
  const projects = new Map<string, ProjectDatabase>();
  let catalog: KitCatalog;
  let nativeKits: NativeKitManager;
  let agents: AgentExecution;
  let reviews: ReviewDecisions;
  const edits = new EditCoordinator();
  function settings(): Settings {
    return application.settings(vault.hasKey());
  }
  function requireModels(): Settings {
    const s = settings();
    if (!s.hasApiKey || !s.agentModel || !s.seedanceModel)
      throw new Error('请先在设置中配置方舟 API Key、Agent 模型和 Seedance 模型。');
    return s;
  }
  function database(): ProjectDatabase {
    if (!current) throw new Error('请先创建或打开工程。');
    return current;
  }
  function service(db = database()): ProjectService {
    return new ProjectService(db, application);
  }
  function emit(event: AppEvent): void {
    ports.emit(event);
  }
  function changed(db: ProjectDatabase): void {
    if (current?.directory === db.directory)
      emit({ type: 'state', projectId: db.read().project.id, snapshot: service(db).snapshot() });
  }
  function kitList(): KitInfo[] {
    return catalog.list();
  }
  function enabledKit(id: string): boolean {
    return catalog.enabled(id);
  }
  function adopt(db: ProjectDatabase): ProjectSnapshot {
    const existing = projects.get(db.directory);
    if (existing && existing !== db) {
      db.close();
      db = existing;
    }
    const duplicate = [...projects.values()].find(
      (open) => open.directory !== db.directory && open.read().project.id === db.read().project.id,
    );
    if (duplicate) {
      db.close();
      throw new Error('同一工程副本已经打开；请通过共享工程导入创建独立副本。');
    }
    agents.recover(db);
    edits.reset();
    projects.set(db.directory, db);
    current = db;
    application.remember(db.read().project);
    jobs.recover(db);
    changed(db);
    return service(db).snapshot();
  }
  async function openPath(path: string): Promise<ProjectSnapshot> {
    if (!existsSync(join(path, 'project.sqlite'))) throw new Error('所选目录不是 Reelbeam 工程。');
    await stopAgent();
    const normalized = realpathSync(path);
    return adopt(projects.get(normalized) ?? new ProjectDatabase(normalized));
  }
  function sequence(
    db: ProjectDatabase,
    input: {
      sequenceId: string;
      expectedRevision: number;
    },
  ) {
    const s = db.read().sequences.find((s) => s.id === input.sequenceId);
    if (!s) throw new Error('作品不存在。');
    if (s.revision !== input.expectedRevision)
      throw new Error('作品已修改，请重新读取后再预览或导出。');
    return s;
  }
  async function stopAgent(): Promise<void> {
    await agents.stop();
  }
  const historyWrites = new Map<string, Promise<void>>();
  function sessionPath(db: ProjectDatabase, sessionId: string, role: string): string {
    return join(db.directory, 'sessions', `${digest({ sessionId, role })}.jsonl`);
  }
  async function persistHistory(
    data: {
      sessionId: string;
      role: string;
      messages: unknown[];
      append?: boolean;
    },
    db: ProjectDatabase,
  ): Promise<void> {
    const path = sessionPath(db, data.sessionId, data.role);
    const prior = historyWrites.get(path) ?? Promise.resolve();
    const write = prior
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const text = data.messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
        if (data.append) await appendFile(path, text);
        else {
          await writeFile(path + '.tmp', text);
          await rename(path + '.tmp', path);
        }
      });
    historyWrites.set(path, write);
    try {
      await write;
    } finally {
      if (historyWrites.get(path) === write) historyWrites.delete(path);
    }
  }
  async function loadHistory(
    db: ProjectDatabase,
    sessionId: string,
    role: string,
  ): Promise<unknown[]> {
    if (ports.loadHistory) return ports.loadHistory(db, sessionId, role);
    const path = sessionPath(db, sessionId, role);
    if (!existsSync(path)) return [];
    try {
      return (await readFile(path, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error('会话记录损坏，请创建新对话；工程与任务不受影响。');
    }
  }
  const methods = {
    bootstrap: () => ({
      settings: settings(),
      recentProjects: application.get('recent', []),
      project: current ? service().snapshot() : null,
      kits: kitList(),
      version: ports.version,
    }),
    snapshot: () => service().snapshot(),
    async createProject(input) {
      requireModels();
      const result = await ports.dialog.save({
        title: '创建 Reelbeam 工程',
        defaultPath: join(ports.documents, input.name + '.reelbeam'),
        buttonLabel: '创建工程',
      });
      if (result.canceled || !result.filePath) return null;
      if (existsSync(result.filePath)) throw new Error('此位置已经存在，请选择新工程目录。');
      await stopAgent();
      return adopt(
        ProjectDatabase.create(result.filePath, input.name, input.width, input.height, input.fps),
      );
    },
    async openProject() {
      const result = await ports.dialog.open({
        title: '打开 Reelbeam 工程',
        properties: ['openDirectory'],
      });
      return result.canceled ? null : openPath(result.filePaths[0]);
    },
    openRecent: (path) => openPath(path),
    async closeProject() {
      edits.assertAvailable(database().read().project.id);
      await stopAgent();
      edits.reset();
      current = undefined;
      return;
    },
    createSequence(input) {
      requireModels();
      const snapshot = service().createSequence(input);
      changed(database());
      return snapshot;
    },
    async importMedia() {
      requireModels();
      const db = database();
      const result = await ports.dialog.open({
        title: '导入素材',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: '媒体',
            extensions: [
              'mp4',
              'mov',
              'mkv',
              'webm',
              'avi',
              'm4v',
              'jpg',
              'jpeg',
              'png',
              'webp',
              'mp3',
              'wav',
              'm4a',
              'aac',
              'flac',
            ],
          },
        ],
      });
      if (result.canceled) return service(db).snapshot();
      for (const path of result.filePaths) {
        const asset = await archiveMedia(db.directory, path);
        db.addAsset(asset);
      }
      changed(db);
      return service(db).snapshot();
    },
    beginEdit(input) {
      const db = database();
      if (!db.read().sequences.some((s) => s.id === input.sequenceId))
        throw new Error('作品不存在。');
      edits.begin(db.read().project.id, input.sequenceId, input.interactionId);
    },
    endEdit(input) {
      edits.end(database().read().project.id, input.sequenceId, input.interactionId);
    },
    apply(input) {
      requireModels();
      edits.assertAvailable(database().read().project.id, input.sequenceId, input.interactionId);
      const { interactionId, ...command } = input;
      const result = service().apply(command);
      changed(database());
      return result;
    },
    undo(input) {
      edits.assertAvailable(database().read().project.id, input.sequenceId);
      const result = service().history(input, 'undo');
      changed(database());
      return result;
    },
    redo(input) {
      edits.assertAvailable(database().read().project.id, input.sequenceId);
      const result = service().history(input, 'redo');
      changed(database());
      return result;
    },
    saveCanvas(input) {
      const result = service().saveCanvas(input);
      changed(database());
      return result;
    },
    undoCanvas() {
      const result = service().undoCanvas();
      changed(database());
      return result;
    },
    generate(input) {
      requireModels();
      if (!enabledKit('reelbeam.seedance-kit')) throw new Error('Seedance Kit 已停用。');
      return jobs.createGeneration(database(), input, settings());
    },
    async cancelJob(jobId) {
      await jobs.cancel(database(), jobId);
    },
    reconcileJob(jobId) {
      jobs.reconcile(database(), jobId);
    },
    async exportVideo(input) {
      requireModels();
      const db = database();
      const s = sequence(db, input);
      const result = await ports.dialog.save({
        title: '导出 MP4',
        defaultPath: s.name + '.mp4',
        filters: [{ name: 'MP4', extensions: ['mp4'] }],
      });
      return result.canceled || !result.filePath
        ? null
        : jobs.createRender(db, s, result.filePath, false);
    },
    preview(input) {
      requireModels();
      const db = database();
      const s = sequence(db, input);
      const key = digest({ s, assets: db.read().assets.map((a) => ({ id: a.id, hash: a.hash })) });
      const existing = db
        .read()
        .jobs.find(
          (j) =>
            j.kind === 'preview' &&
            j.input.sequenceId === s.id &&
            j.input.revision === s.revision &&
            j.status === 'succeeded' &&
            j.outputPath &&
            existsSync(j.outputPath),
        );
      if (existing) return existing;
      return jobs.createRender(db, s, join(db.directory, 'cache', `preview-${key}.mp4`), true);
    },
    revealFile(path) {
      const asset = current?.read().assets.find((a) => a.path === path);
      if (asset) path = join(current!.directory, asset.path);
      const allowed = [...projects.values()].some(
        (db) =>
          path === db.directory ||
          db.read().assets.some((a) => join(db.directory, a.path) === path) ||
          db.read().jobs.some((j) => j.outputPath === path),
      );
      if (!allowed) throw new Error('文件不属于已打开工程的媒体或导出结果。');
      ports.revealFile(path);
    },
    createSession(title) {
      const db = database();
      db.transaction((s) => s.sessions.push({ id: id(), title, messages: [] }), 'session.created');
      changed(db);
      return service(db).snapshot();
    },
    prompt: (input) => agents.prompt(database(), input),
    stopAgent,
    decideReview: (input) => reviews.decide(database(), input),
    saveMemory(input) {
      const snapshot = service().saveMemory(input);
      changed(database());
      return snapshot;
    },
    deleteMemory(input) {
      const snapshot = service().deleteMemory(input);
      changed(database());
      return snapshot;
    },
    saveSettings(input) {
      const parsed = new URL(input.arkBaseUrl);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        !/(^|\.)volces\.com$/.test(parsed.hostname)
      )
        throw new Error('方舟接口必须为 HTTPS 的 volces.com 地址。');
      if (
        !input.seedanceModel.toLowerCase().includes('seedance') &&
        !/^ep-[a-z0-9-]+$/i.test(input.seedanceModel)
      )
        throw new Error('第一版视频生成只支持 Seedance，请填写 Seedance 模型或对应接入点 ID。');
      const { apiKey, ...configuration } = input;
      if (apiKey) vault.save(apiKey);
      if (!vault.hasKey()) throw new Error('首次使用必须填写 API Key。');
      application.set('settings', configuration);
      return settings();
    },
    listKits: () => kitList(),
    async setKitEnabled(input) {
      if (agents.active) throw new Error('请等待或停止 Agent 后再改变 Kit。');
      const result = await catalog.setEnabled(input.id, input.enabled);
      jobs.drain();
      return result;
    },
    async installKit(kitId) {
      if (agents.active) throw new Error('请等待或停止 Agent 后再安装 Kit。');
      return catalog.install(kitId);
    },
    async uninstallKit(kitId) {
      if (agents.active) throw new Error('请等待或停止 Agent 后再卸载 Kit。');
      if (
        [...projects.values()].some((db) =>
          db
            .read()
            .jobs.some(
              (j) =>
                j.kind === 'seedance' && !['succeeded', 'failed', 'cancelled'].includes(j.status),
            ),
        ) &&
        kitId === 'reelbeam.seedance-kit'
      )
        throw new Error('存在未结束的 Seedance 任务，请先核对后再卸载。');
      return catalog.uninstall(kitId);
    },
    async importKit() {
      if (agents.active) throw new Error('请等待或停止 Agent 后再安装 Kit。');
      const result = await ports.dialog.open({
        title: '导入创作 Kit',
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Reelbeam Kit', extensions: ['json', 'reelbeamkit', 'zip'] }],
      });
      if (result.canceled) return kitList();
      const file = result.filePaths[0];
      const info = await stat(file);
      if (info.isDirectory() || file.toLowerCase().endsWith('.zip')) {
        const plan = await nativeKits.prepareImport(file);
        catalog.validateNativeImport(plan.manifest);
        const confirmation = await ports.dialog.confirm({
          type: 'warning',
          title: '信任并安装代码 Kit',
          message: plan.manifest.name,
          detail: `来源：${file}\n作者：${plan.manifest.author}\n版本：${plan.manifest.version}\n许可：${plan.manifest.license}\n权限：${plan.manifest.permissions.join('、')}\nSHA256：${plan.digest}\n\n代码将在后台执行，拥有你的系统账户权限。只安装你信任的作者和文件。`,
          buttons: ['信任并安装', '取消'],
          defaultId: 1,
          cancelId: 1,
        });
        if (confirmation.response === 0) await nativeKits.install(plan, catalog.enabledManifests());
        return kitList();
      }
      if (info.size > 1024 * 1024) throw new Error('Kit 文件超过 1 MB。');
      const text = await readFile(file, 'utf8');
      const kit = importDeclaration(text);
      const confirmation = await ports.dialog.confirm({
        type: 'question',
        title: '安装创作配方',
        message: kit.manifest.name,
        detail: `作者：${kit.manifest.author}\n版本：${kit.manifest.version}\n许可：${kit.manifest.license}\n权限：${kit.manifest.permissions.join('、')}\n仅包含 Agent 与配方声明。`,
        buttons: ['安装', '取消'],
        cancelId: 1,
      });
      return confirmation.response === 0
        ? catalog.importDeclaration(text, { reviewedPermissions: kit.manifest.permissions })
        : kitList();
    },
    async exportRecipe(input) {
      const db = database();
      const recipe = db.read().recipes.find((r) => r.id === input.recipeId);
      if (!recipe) throw new Error('制作计划不存在。');
      const data = new RecipeService(db, catalog).exportRecipeDefinition(input.recipeId);
      const result = await ports.dialog.save({
        title: '分享配方 Kit',
        defaultPath: recipe.definition.descriptor.name + '.reelbeamkit',
        filters: [{ name: 'Reelbeam Kit', extensions: ['reelbeamkit'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, exportDeclaration(data));
      return result.filePath;
    },
    startRecipe(input) {
      requireModels();
      const db = database();
      edits.assertAvailable(db.read().project.id, input.sequenceId);
      const recipeInput = input.input;
      if (recipeInput !== undefined) assertJsonValue(recipeInput);
      new RecipeService(db, catalog).create({ ...input, input: recipeInput });
      changed(db);
      return service(db).snapshot();
    },
    decideRecipeInput(input) {
      const db = database();
      if (input.decision === 'accept') edits.assertAvailable(db.read().project.id);
      new RecipeService(db, catalog).decideInput(input);
      changed(db);
      return service(db).snapshot();
    },
    decideRecipeResult(input) {
      const db = database();
      if (input.decision === 'accept') edits.assertAvailable(db.read().project.id);
      new RecipeService(db, catalog).decideResult(input);
      changed(db);
      return service(db).snapshot();
    },
    async resumeRecipe(input) {
      requireModels();
      if (agents.active) throw new Error('Agent 正在运行。');
      const db = database();
      edits.assertAvailable(db.read().project.id);
      const execution = new RecipeService(db, catalog).resume(input.recipeId, input.redoStepId);
      changed(db);
      if (!execution) return;
      agents.resume(db, execution);
    },
    async exportProject() {
      const db = database();
      const answer = await ports.dialog.confirm({
        type: 'question',
        title: '共享工程',
        message: '共享已保存作品和工程中的媒体',
        detail:
          '仅包含作品、画布和全部已导入媒体。请确认这些素材允许分享。账户、聊天、记忆、任务和授权记录不会包含在文件中。',
        buttons: ['继续导出', '取消'],
        cancelId: 1,
      });
      if (answer.response !== 0) return null;
      const result = await ports.dialog.save({
        defaultPath: db.read().project.name + '.reelbeamproject',
        filters: [{ name: 'Reelbeam shared project', extensions: ['reelbeamproject'] }],
      });
      if (result.canceled || !result.filePath) return null;
      await shareProject(db, result.filePath);
      return result.filePath;
    },
    async importProject() {
      const source = await ports.dialog.open({
        title: '导入共享工程',
        properties: ['openFile'],
        filters: [{ name: 'Reelbeam shared project', extensions: ['reelbeamproject'] }],
      });
      if (source.canceled) return null;
      const target = await ports.dialog.save({
        title: '保存为新工程',
        defaultPath: '导入工程.reelbeam',
      });
      if (target.canceled || !target.filePath) return null;
      await stopAgent();
      return adopt(await importSharedProject(source.filePaths[0], target.filePath));
    },
  } satisfies DesktopMethods;
  async function hostTool(
    request: import('../runtime/pi').HostToolRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const context = agents.active;
    if (!context || context.runId !== request.runId || signal.aborted)
      throw new Error('Agent 已停止或连接失效。');
    const db = context.database as ProjectDatabase;
    if (request.name === 'read_project') return publicContext(service(db).snapshot());
    if (request.name === 'inspect_media') {
      const args = z
        .object({
          assetVersionId: z.string().min(1).max(120),
          timeSeconds: z.number().finite().nonnegative().optional(),
        })
        .strict()
        .parse(request.args);
      const asset = db.read().assets.find((a) => a.id === args.assetVersionId);
      if (!asset) throw new Error('素材版本不存在。');
      if (context.input.clipId) {
        const clip = db
          .read()
          .sequences.find((s) => s.id === context.input.sequenceId)
          ?.clips.find((c) => c.id === context.input.clipId);
        if (!clip || clip.assetVersionId !== asset.id)
          throw new Error('检查目标与固定片段不一致。');
        const fps = db.read().sequences.find((s) => s.id === context.input.sequenceId)!.fps;
        const time = args.timeSeconds ?? clip.sourceStart;
        if (
          asset.kind !== 'image' &&
          (time < clip.sourceStart || time > clip.sourceStart + clip.duration / fps)
        )
          throw new Error('检查时间超出当前片段的源区间。');
        args.timeSeconds = asset.kind === 'image' ? 0 : time;
      }
      return inspectMedia({
        directory: db.directory,
        asset,
        timeSeconds: args.timeSeconds,
        signal,
      });
    }
    if (request.name === 'capabilities_search') {
      const args = z
        .object({ query: z.string().max(1000).optional() })
        .strict()
        .parse(request.args);
      const query = (args.query ?? '').toLowerCase();
      return catalog
        .capabilities()
        .filter((c) => `${c.id} ${c.name} ${c.description}`.toLowerCase().includes(query))
        .map(({ inputSchema, outputSchema, ...metadata }) => metadata);
    }
    if (request.name === 'capabilities_describe') {
      const args = z.object({ capabilityId: z.string() }).strict().parse(request.args);
      const capability = catalog.capabilities().find((c) => c.id === args.capabilityId);
      if (!capability) throw new Error('能力未启用、依赖缺失或不受信任。');
      return capability;
    }
    if (request.name === 'invoke_kit') {
      const args = z
        .object({ capabilityId: z.string(), input: z.record(z.string(), z.unknown()) })
        .strict()
        .parse(request.args);
      const capability = catalog.capabilities().find((c) => c.id === args.capabilityId);
      if (!capability || !['read', 'edit', 'job'].includes(capability.kind))
        throw new Error('此 Kit 工具当前不可执行。');
      const definition =
        context.agentDefinition?.role === request.role
          ? context.agentDefinition
          : catalog.agents().find((a) => a.role === request.role);
      if (
        request.role !== 'coordinator' &&
        !definition?.tools.includes('invoke_kit') &&
        !definition?.tools.includes(capability.id)
      )
        throw new Error('当前专业 Agent 没有此工具权限。');
      const input = compileSchema(capability.inputSchema)(args.input);
      const target = context.input.sequenceId
        ? db.read().sequences.find((s) => s.id === context.input.sequenceId)
        : undefined;
      const toolContext = {
        projectId: db.read().project.id,
        sequenceId: target?.id,
        revision: target?.revision,
        snapshot: JSON.parse(JSON.stringify(publicContext(service(db).snapshot()))) as JsonValue,
        signal,
      };
      const result =
        capability.id === 'reelbeam.caption-style'
          ? await captionStyleTool.propose(input, toolContext)
          : await nativeKits.invoke(capability.id, input, toolContext);
      if (signal.aborted || !enabledKit(capability.kitId))
        throw new Error('操作已停止或 Kit 已停用。');
      assertJsonValue(result);
      if (capability.kind === 'read') return compileSchema(capability.outputSchema)(result);
      const binding = {
        recipeId: context.recipeId,
        stepId: context.stepId,
        recipeAttempt: context.recipeAttempt,
        kitId: capability.kitId,
        kitDigest: catalog.fingerprint(capability.kitId)?.digest,
      };
      let review: Review & {
        configHash?: string;
      };
      if (capability.kind === 'edit') {
        const proposal = z
          .object({
            sequenceId: z.string(),
            expectedRevision: z.number().int(),
            commands: z.array(commandSchema).min(1).max(100),
            title: z.string().max(200),
          })
          .strict()
          .parse(result);
        if (context.input.sequenceId && proposal.sequenceId !== context.input.sequenceId)
          throw new Error('Kit 提案与固定作品目标不一致。');
        const current = sequence(db, proposal);
        validateCommands(current, db.read().assets, proposal.commands);
        review = {
          id: id(),
          kind: 'edit',
          title: proposal.title,
          description: `由 ${capability.name} 提出；采纳后保存，可撤销。`,
          status: 'pending',
          sequenceId: proposal.sequenceId,
          expectedRevision: proposal.expectedRevision,
          commands: proposal.commands,
          createdAt: now(),
          ...binding,
        };
      } else {
        const draft = z
          .object({
            providerId: z.literal('reelbeam.seedance'),
            input: z.record(z.string(), z.unknown()),
            estimatedCost: z.number().positive(),
            title: z.string().max(200),
          })
          .strict()
          .parse(result);
        const generation = generationSchema.parse({
          requestId: request.toolCallId,
          ...draft.input,
          estimatedCost: draft.estimatedCost,
        });
        review = {
          id: id(),
          kind: 'generation',
          title: draft.title,
          description: '此 Kit 将通过 Seedance 生成候选，采纳前请检查参数与预算。',
          status: 'pending',
          generation,
          configHash: digest({ ...settings(), accountRef: vault.currentId() }),
          createdAt: now(),
          ...binding,
        };
      }
      db.transaction((state) => state.reviews.push(review), 'review.created');
      changed(db);
      return { reviewId: review.id, status: 'awaiting_user_review' };
    }
    if (request.name === 'save_memory') {
      const args = z
        .object({ scope: z.enum(['project', 'user']), content: z.string().min(1).max(4000) })
        .strict()
        .parse(request.args);
      const review: Review = {
        id: id(),
        kind: 'memory',
        title: '保存创作偏好',
        description: '确认后才会写入长期记忆。你可以在创作记忆中修改或删除。',
        status: 'pending',
        memory: args,
        createdAt: now(),
      };
      db.transaction((state) => state.reviews.push(review), 'review.created');
      changed(db);
      return { reviewId: review.id, status: 'awaiting_user_review' };
    }
    const binding = {
      recipeId: context.recipeId,
      stepId: context.stepId,
      recipeAttempt: context.recipeAttempt,
    };
    let review: Review & {
      configHash?: string;
    };
    if (request.name === 'propose_edit') {
      const args = z
        .object({
          sequenceId: z.string(),
          expectedRevision: z.number().int(),
          commands: z.array(commandSchema).min(1).max(100),
          title: z.string().max(200).optional(),
          description: z.string().max(4000).optional(),
        })
        .strict()
        .parse(request.args);
      if (context.input.sequenceId && args.sequenceId !== context.input.sequenceId)
        throw new Error('提案与本次请求固定的作品目标不一致。');
      const target = sequence(db, args);
      validateCommands(target, db.read().assets, args.commands);
      review = {
        id: id(),
        kind: 'edit',
        title: args.title ?? 'Agent 编辑提案',
        description: args.description ?? '采纳后修改当前作品，可撤销。',
        status: 'pending',
        sequenceId: args.sequenceId,
        expectedRevision: args.expectedRevision,
        commands: args.commands,
        createdAt: now(),
        ...binding,
      };
    } else if (request.name === 'propose_generation') {
      if (!enabledKit('reelbeam.seedance-kit')) throw new Error('Seedance Kit 已停用。');
      const args = z
        .object({
          prompt: z.string(),
          duration: z.number(),
          ratio: z.enum(['16:9', '9:16', '1:1']),
          referenceAssetId: z.string().optional(),
          estimatedCost: z.number(),
          title: z.string().optional(),
          description: z.string().max(4000).optional(),
        })
        .strict()
        .parse(request.args);
      const { title, description, ...generationArgs } = args;
      const generation = generationSchema.parse({
        requestId: request.toolCallId,
        ...generationArgs,
      });
      review = {
        id: id(),
        kind: 'generation',
        title: args.title ?? 'Seedance 生成确认',
        description:
          description ??
          '将提示词和选定参考图片发送到方舟，可能产生费用。结果先保存为候选，不自动进入时间线。',
        status: 'pending',
        generation,
        configHash: digest({ ...settings(), accountRef: vault.currentId() }),
        createdAt: now(),
        ...binding,
      };
    } else throw new Error('不支持此工具。');
    db.transaction((state) => state.reviews.push(review), 'review.created');
    changed(db);
    return { reviewId: review.id, status: 'awaiting_user_review' };
  }
  application = new AppDatabase(ports.userData);
  nativeKits = new NativeKitManager({
    directory: join(ports.userData, 'kits'),
    workerPath: ports.workerPaths.kit,
  });
  catalog = new KitCatalog(application, nativeKits);
  try {
    await nativeKits.loadInstalled(catalog.enabledManifests());
  } catch (error) {
    application.set('kit-load-error', error instanceof Error ? error.message : 'Kit 加载失败。');
  }
  jobs = new JobRunner(vault, changed, () => enabledKit('reelbeam.seedance-kit'));
  reviews = new ReviewDecisions({
    workspace: (db) => service(db as ProjectDatabase),
    assertRecipeCurrent: (db, review) =>
      new RecipeService(db as ProjectDatabase, catalog).assertReviewCurrent(review),
    kitEnabled: enabledKit,
    kitDigest: (kitId) => catalog.fingerprint(kitId)?.digest,
    configuration: settings,
    configurationDigest: () => digest({ ...settings(), accountRef: vault.currentId() }),
    assertEditAvailable: (projectId, sequenceId) => edits.assertAvailable(projectId, sequenceId),
    generate: (db, input, configuration) => jobs.createGeneration(db, input, configuration),
    changed: (db) => changed(db as ProjectDatabase),
  });
  agents = new AgentExecution({
    id,
    now,
    configuration: settings,
    executionSettings: () => ({ ...requireModels(), apiKey: vault.get() }),
    runtime: () => runtime,
    snapshot: (db) => service(db as ProjectDatabase).snapshot(),
    loadHistory: (db, sessionId, role) => loadHistory(db as ProjectDatabase, sessionId, role),
    assertEditAvailable: (projectId, sequenceId) => edits.assertAvailable(projectId, sequenceId),
    agents: () => catalog.agents(),
    capabilities: () =>
      kitList()
        .filter((kit) => kit.enabled)
        .map((kit) => kit.id),
    capabilityKind: (capabilityId) =>
      catalog.capabilities().find((capability) => capability.id === capabilityId)?.kind,
    hostTool,
    settleRecipe: (db, recipeId, stepId, attempt, result) => {
      new RecipeService(db as ProjectDatabase, catalog).settle(recipeId, stepId, attempt, result);
    },
    changed: (db) => changed(db as ProjectDatabase),
    emit,
  });
  runtime = (ports.runtimeFactory ?? ((options) => new PiRuntime(options)))({
    workerPath: ports.workerPaths.agent,
    onEvent: (event) => {
      if (agents.active) emit({ ...event, projectId: agents.active.database.read().project.id });
    },
    onHistory: (data) =>
      agents.active ? persistHistory(data, agents.active.database as ProjectDatabase) : undefined,
    onTool: hostTool,
  });
  return {
    methods: methods as unknown as DesktopMethods &
      Record<string, (input?: unknown) => unknown | Promise<unknown>>,
    openPath,
    mediaAllowed(path: string) {
      return [...projects.values()].some((db) => {
        const state = db.read();
        return (
          state.assets.some(
            (asset) =>
              (/^media\/[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.path) &&
                join(db.directory, asset.path) === path) ||
              (asset.thumbnailUrl &&
                /^cache\/[a-f0-9]{64}\.jpg$/.test(asset.thumbnailUrl) &&
                join(db.directory, asset.thumbnailUrl) === path),
          ) || state.jobs.some((job) => job.status === 'succeeded' && job.outputPath === path)
        );
      });
    },
    resetRenderer() {
      edits.reset();
      void stopAgent();
    },
    async dispose() {
      await stopAgent();
      await jobs.stop();
      await runtime.dispose();
      nativeKits.dispose();
      await agents.drain();
      await Promise.allSettled(historyWrites.values());
      for (const db of projects.values()) db.close();
      application.close();
    },
  };
}
