import type { GenerationInput, Job, Settings, Sequence } from './model.js';
import type { ProjectStore } from './project-store.js';
import { GenerationOrder, GenerationTask } from '../../core/src/generation.js';
import {
  GenerationGatewayError,
  type GenerationGateway,
  type GenerationPorts,
} from './generation-ports.js';
function sequenceDuration(sequence: Sequence): number {
  return Math.max(
    0,
    ...sequence.clips.map((clip) => clip.start + clip.duration),
    ...sequence.captions.map((caption) => caption.start + caption.duration),
  );
}
const cancelUnconfirmed = '供应商尚未确认取消；任务可能继续计费，应用会继续核对最终结果。';
export class GenerationJobs {
  private readonly active = new Map<string, AbortController>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopping = false;
  private readonly databases = new Set<ProjectStore>();
  private readonly readFailures = new Map<string, number>();
  private renderQueue: Promise<void> = Promise.resolve();
  private readonly pendingGeneration = new Set<Promise<void>>();
  private readonly cancellations = new Map<string, Promise<boolean>>();
  private readonly cancellationControllers = new Map<string, AbortController>();
  constructor(private readonly ports: GenerationPorts) {}
  private changed(database: ProjectStore): void {
    this.ports.changed(database);
  }
  private mutate(
    database: ProjectStore,
    jobId: string,
    action: (task: GenerationTask) => void,
  ): void {
    database.transaction((state) => {
      const record = state.jobs.find((job) => job.id === jobId);
      if (!record) throw new Error('任务不存在。');
      const task = GenerationTask.restore(record);
      action(task);
      Object.assign(record, task.snapshot(), { updatedAt: this.ports.now() });
    }, 'job.changed');
  }
  createGeneration(database: ProjectStore, input: GenerationInput, settings: Settings): Job {
    if (this.stopping) throw new Error('应用正在关闭，不能提交新任务。');
    this.databases.add(database);
    if (!settings.hasApiKey || !settings.agentModel || !settings.seedanceModel)
      throw new Error('请先配置方舟账户与模型。');
    const existing = database.receipt<{
      jobId: string;
    }>(input.requestId, input);
    if (existing) {
      const job = database.read().jobs.find((j) => j.id === existing.jobId);
      if (!job) throw new Error('任务回执损坏。');
      return job;
    }
    const order = GenerationOrder.authorize(
      input,
      settings,
      this.ports.accountRef(),
      database.read().assets,
    );
    const timestamp = this.ports.now();
    const job: Job = {
      id: this.ports.id(),
      requestId: input.requestId,
      kind: 'seedance',
      title: input.prompt.slice(0, 80),
      status: 'queued',
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelRequested: false,
      estimatedCost: input.estimatedCost,
      input: order.parameters(),
    };
    database.transaction((s) => {
      s.jobs.push(job);
      database.saveReceipt(input.requestId, input, { jobId: job.id });
    }, 'job.created');
    this.changed(database);
    this.dispatch(database, job.id);
    return job;
  }
  private dispatch(database: ProjectStore, jobId: string): void {
    if (this.stopping || this.active.has(jobId)) return;
    const job = database.read().jobs.find((j) => j.id === jobId);
    if (
      !job ||
      ['succeeded', 'failed', 'cancelled'].includes(job.status) ||
      (job.cancelRequested && job.status === 'queued')
    )
      return;
    if (job.status === 'queued') {
      if (!this.ports.canStart()) return;
      const occupied = [...this.databases]
        .flatMap((db) => db.read().jobs)
        .filter(
          (j) =>
            j.kind === 'seedance' &&
            ['submitting', 'running', 'unknown', 'reconciling', 'finalizing'].includes(j.status),
        ).length;
      if (occupied >= 2) return;
    }
    const controller = new AbortController();
    this.active.set(jobId, controller);
    const execution = this.runGeneration(database, jobId, controller.signal).finally(() => {
      this.active.delete(jobId);
      this.pendingGeneration.delete(execution);
      this.drain();
    });
    this.pendingGeneration.add(execution);
    void execution.catch(() => {});
  }
  drain(): void {
    if (this.stopping) return;
    for (const database of this.databases)
      for (const job of database.read().jobs)
        if (job.kind === 'seedance' && job.status === 'queued' && !job.cancelRequested)
          this.dispatch(database, job.id);
  }
  private provider(job: Job): GenerationGateway {
    return this.ports.provider(job);
  }
  private async runGeneration(
    database: ProjectStore,
    jobId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let job = database.read().jobs.find((j) => j.id === jobId)!;
    let submissionStarted = false;
    try {
      // A committed stage is independent of the provider account, task record and expiring URL.
      if (job.status === 'finalizing' && job.stagedOutput) {
        await this.finalizeStage(database, jobId, signal);
        return;
      }
      const provider = this.provider(job);
      if (job.status === 'queued') {
        this.mutate(database, jobId, (task) => task.beginSubmission());
        this.changed(database);
        let referenceImageDataUrl: string | undefined;
        if (job.input.referenceAssetId) {
          const asset = database.read().assets.find((a) => a.id === job.input.referenceAssetId);
          if (!asset || asset.hash !== job.input.referenceHash)
            throw new Error('参考图片版本已失效。');
          referenceImageDataUrl = await this.ports.media.reference(
            database.directory,
            asset,
            String(job.input.referenceHash),
          );
        }
        submissionStarted = true;
        const result = await provider.submit(
          {
            model: String(job.input.model),
            prompt: String(job.input.prompt),
            duration: Number(job.input.duration),
            ratio: job.input.ratio as GenerationInput['ratio'],
            referenceImageDataUrl,
          },
          signal,
        );
        this.mutate(database, jobId, (task) => task.pinRemote(result.remoteId));
        this.changed(database);
        job = database.read().jobs.find((j) => j.id === jobId)!;
        if (job.cancelRequested) {
          if (await this.attemptCancellation(database, job, provider, signal)) return;
          job = database.read().jobs.find((j) => j.id === jobId)!;
        }
      }
      if (!job.remoteId) {
        if (job.status !== 'unknown')
          database.updateJob(jobId, {
            status: 'unknown',
            error: '提交状态不明且没有远端任务 ID。请在方舟控制台核对，应用不会重新付费提交。',
          });
        this.changed(database);
        return;
      }
      const remote = await provider.status(job.remoteId, signal);
      if (database.read().jobs.find((j) => j.id === jobId)?.status === 'cancelled') return;
      this.readFailures.delete(jobId);
      if (remote.status === 'succeeded') {
        if (job.outputAssetId) {
          database.updateJob(jobId, { status: 'succeeded', progress: 1 });
          this.changed(database);
          return;
        }
        const outputUrl = remote.outputUrl;
        if (!outputUrl) throw new Error('供应商任务成功但缺少必需视频输出。');
        database.updateJob(jobId, {
          status: 'finalizing',
          progress: 0.85,
          error: job.cancelRequested ? cancelUnconfirmed : undefined,
        });
        this.changed(database);
        const temporary = await this.ports.media.prepareDownload(database.directory, jobId);
        await this.ports.media.download(outputUrl, temporary, signal);
        const hash = await this.ports.media.validateDownload(temporary, signal);
        signal.throwIfAborted();
        this.mutate(database, jobId, (task) =>
          task.stage({ path: `cache/${jobId}-download.mp4`, hash }),
        );
        this.changed(database);
        await this.finalizeStage(database, jobId, signal);
        return;
      }
      if (remote.status === 'failed' || remote.status === 'cancelled') {
        database.updateJob(jobId, { status: remote.status, error: remote.error, progress: 0 });
        this.changed(database);
        return;
      }
      const current = database.read().jobs.find((job) => job.id === jobId)!;
      database.updateJob(jobId, {
        status: remote.status === 'unknown' ? 'reconciling' : 'running',
        progress: Math.max(job.progress, 0.15),
        error: current.cancelRequested ? cancelUnconfirmed : remote.error,
      });
      this.changed(database);
      this.schedule(database, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '任务失败。';
      const current = database.read().jobs.find((j) => j.id === jobId)!;
      if (current.status === 'cancelled' || current.status === 'succeeded') return;
      if (current.status === 'submitting')
        database.updateJob(jobId, {
          status:
            !submissionStarted ||
            (error instanceof GenerationGatewayError && error.kind === 'rejected')
              ? 'failed'
              : 'unknown',
          error: message,
        });
      else if (current.remoteId) {
        database.updateJob(jobId, {
          status: current.status === 'finalizing' ? 'finalizing' : 'reconciling',
          error: message,
        });
        const failures = (this.readFailures.get(jobId) ?? 0) + 1;
        this.readFailures.set(jobId, failures);
        if (
          !signal.aborted &&
          failures < 6 &&
          !(error instanceof GenerationGatewayError && error.kind === 'rejected')
        )
          this.schedule(database, jobId, Math.min(60000, 5000 * 2 ** failures));
      } else database.updateJob(jobId, { status: 'failed', error: message });
      this.changed(database);
    }
  }
  private async finalizeStage(
    database: ProjectStore,
    jobId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const job = database.read().jobs.find((job) => job.id === jobId)!;
    const stage = job.stagedOutput;
    if (!stage) throw new Error('生成下载暂存记录无效，保留原任务以供核对。');
    const task = GenerationTask.restore(job);
    task.stage(stage);
    const path = await this.ports.media.verifyStage(database.directory, stage);
    signal.throwIfAborted();
    const asset = await this.ports.media.archive(
      database.directory,
      path,
      `${job.title}.mp4`,
      jobId,
      signal,
    );
    if (asset.kind !== 'video' || asset.hash !== stage.hash)
      throw new Error('生成归档与已验证的下载内容不一致。');
    signal.throwIfAborted();
    database.transaction((state) => {
      const current = state.jobs.find((job) => job.id === jobId)!;
      if (current.status === 'cancelled') throw new Error('此任务已取消。');
      const existing = state.assets.find((asset) => asset.originJobId === jobId);
      if (existing && existing.hash !== asset.hash)
        throw new Error('同一任务输出发生内容冲突，旧素材已保留。');
      const finalAsset = existing ?? asset;
      if (!existing) {
        state.assets.push(asset);
        state.canvas.items.push({
          id: this.ports.id(),
          kind: 'asset',
          refId: asset.id,
          x: 680,
          y: 100 + state.assets.length * 60,
          width: 280,
          height: 200,
        });
        state.canvas.revision++;
      }
      const task = GenerationTask.restore(current);
      task.completeCandidate(finalAsset.id);
      Object.assign(current, task.snapshot(), { updatedAt: this.ports.now() });
    }, 'job.succeeded');
    // Failure to clean a cache file must never roll back already committed media.
    await this.ports.media.remove(path).catch(() => {});
    this.changed(database);
  }
  private attemptCancellation(
    database: ProjectStore,
    job: Job,
    provider = this.provider(job),
    signal?: AbortSignal,
  ): Promise<boolean> {
    const prior = this.cancellations.get(job.id);
    if (prior) return prior;
    const controller = new AbortController();
    this.cancellationControllers.set(job.id, controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const request = (async () => {
      try {
        const result = await provider.cancel(job.remoteId!, combined);
        const current = database.read().jobs.find((item) => item.id === job.id)!;
        if (current.status === 'succeeded' || current.status === 'cancelled')
          return current.status === 'cancelled';
        if (result.acknowledged) {
          this.mutate(database, job.id, (task) => task.acknowledgeCancellation());
          this.active.get(job.id)?.abort();
          const timer = this.timers.get(job.id);
          if (timer) clearTimeout(timer);
          this.timers.delete(job.id);
          this.changed(database);
          return true;
        }
        database.updateJob(job.id, { error: cancelUnconfirmed });
        this.changed(database);
        return false;
      } catch (error) {
        const current = database.read().jobs.find((item) => item.id === job.id)!;
        if (!['succeeded', 'cancelled'].includes(current.status)) {
          database.updateJob(job.id, {
            error: cancelUnconfirmed + (error instanceof Error ? ' ' + error.message : ''),
          });
          this.changed(database);
        }
        return false;
      }
    })().finally(() => {
      this.cancellations.delete(job.id);
      this.cancellationControllers.delete(job.id);
    });
    this.cancellations.set(job.id, request);
    return request;
  }
  private schedule(database: ProjectStore, jobId: string, delay = 5000): void {
    if (this.stopping) return;
    const old = this.timers.get(jobId);
    if (old) clearTimeout(old);
    this.timers.set(
      jobId,
      setTimeout(() => {
        this.timers.delete(jobId);
        this.dispatch(database, jobId);
      }, delay),
    );
  }
  recover(database: ProjectStore): void {
    this.databases.add(database);
    for (const job of database.read().jobs) {
      if (this.active.has(job.id)) continue;
      if (job.kind === 'seedance') {
        if (job.status === 'queued' && !job.cancelRequested) this.dispatch(database, job.id);
        else if (job.status === 'submitting') {
          this.mutate(database, job.id, (task) => task.recoverInterrupted());
          if (job.remoteId) this.dispatch(database, job.id);
        } else if (
          (job.status === 'finalizing' && job.stagedOutput) ||
          (['running', 'reconciling', 'finalizing'].includes(job.status) && job.remoteId)
        )
          this.dispatch(database, job.id);
      } else if (['queued', 'running', 'submitting', 'finalizing'].includes(job.status))
        database.updateJob(job.id, {
          status: 'failed',
          error: '本地处理在应用关闭时中断，请重新发起。',
        });
    }
  }
  reconcile(database: ProjectStore, jobId: string): void {
    const job = database.read().jobs.find((j) => j.id === jobId);
    if (!job) throw new Error('任务不存在。');
    if (!job.remoteId) throw new Error('没有远端 ID，请在方舟控制台核对原任务。不会自动重新提交。');
    if (job.status === 'succeeded' || job.status === 'cancelled') return;
    this.readFailures.delete(jobId);
    if (job.status === 'failed') database.updateJob(jobId, { status: 'reconciling' });
    this.dispatch(database, jobId);
  }
  async cancel(database: ProjectStore, jobId: string): Promise<void> {
    const job = database.read().jobs.find((j) => j.id === jobId);
    if (!job) throw new Error('任务不存在。');
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return;
    if (job.kind === 'seedance') this.mutate(database, jobId, (task) => task.requestCancellation());
    else database.updateJob(jobId, { cancelRequested: true });
    this.changed(database);
    if (job.kind !== 'seedance') {
      this.active.get(jobId)?.abort();
      if (job.status === 'queued') database.updateJob(jobId, { status: 'cancelled' });
      return;
    }
    if (job.status === 'queued') {
      this.mutate(database, jobId, (task) => task.acknowledgeCancellation());
      this.changed(database);
      return;
    }
    if (job.remoteId) await this.attemptCancellation(database, job);
  }
  createRender(database: ProjectStore, sequence: Sequence, output: string, preview: boolean): Job {
    if (this.stopping) throw new Error('应用正在关闭，不能创建新处理任务。');
    if (sequenceDuration(sequence) <= 0) throw new Error('作品为空，请先添加素材。');
    const timestamp = this.ports.now();
    const job: Job = {
      id: this.ports.id(),
      requestId: this.ports.id(),
      kind: preview ? 'preview' : 'export',
      title:
        this.ports.renderTitle?.(sequence, preview) ??
        (preview ? '合成预览' : `导出 ${sequence.name}`),
      status: 'queued',
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      cancelRequested: false,
      input: { sequenceId: sequence.id, revision: sequence.revision },
    };
    database.transaction((state) => state.jobs.push(job), 'job.created');
    this.changed(database);
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const assets = database.read().assets;
    const execute = async () => {
      try {
        controller.signal.throwIfAborted();
        database.updateJob(job.id, { status: 'running' });
        this.changed(database);
        let last = 0;
        const result = await this.ports.media.render({
          directory: database.directory,
          sequence,
          assets,
          output,
          preview,
          signal: controller.signal,
          onProgress: (progress) => {
            if (Date.now() - last > 250 || progress === 1) {
              last = Date.now();
              database.updateJob(job.id, { progress });
              this.changed(database);
            }
          },
        });
        controller.signal.throwIfAborted();
        if (database.read().jobs.find((j) => j.id === job.id)?.cancelRequested) {
          await this.ports.media.remove(result.path);
          database.updateJob(job.id, { status: 'cancelled' });
        } else
          database.updateJob(job.id, { status: 'succeeded', progress: 1, outputPath: result.path });
      } catch (error) {
        database.updateJob(job.id, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: error instanceof Error ? error.message : '导出失败。',
        });
      } finally {
        this.active.delete(job.id);
        this.changed(database);
      }
    };
    this.renderQueue = this.renderQueue.then(execute, execute);
    return job;
  }
  async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.active.values()) controller.abort();
    for (const controller of this.cancellationControllers.values()) controller.abort();
    await Promise.allSettled([
      ...this.pendingGeneration,
      ...this.cancellations.values(),
      this.renderQueue,
    ]);
  }
}
