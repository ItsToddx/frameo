import type { Id } from './model.js';
export type JobStatus =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'unknown'
  | 'reconciling'
  | 'finalizing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export interface Job {
  id: Id;
  requestId: Id;
  kind: 'seedance' | 'export' | 'preview' | 'motion';
  status: JobStatus;
  title: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  remoteId?: string;
  outputAssetId?: Id;
  outputPath?: string;
  error?: string;
  cancelRequested: boolean;
  input: Record<string, unknown>;
  estimatedCost?: number;
  stagedOutput?: {
    path: string;
    hash: string;
  };
}
export interface GenerationInput {
  requestId: Id;
  prompt: string;
  duration: number;
  ratio: '16:9' | '9:16' | '1:1';
  referenceAssetId?: Id;
  estimatedCost: number;
  model?: string;
}
interface GenerationConfiguration {
  hasApiKey: boolean;
  agentModel: string;
  seedanceModel: string;
  arkBaseUrl: string;
  generationCostLimit: number;
}
/** An authorized order fixes the account, provider configuration and immutable reference version. */
export class GenerationOrder {
  private constructor(private readonly pinned: Record<string, unknown>) {}
  static authorize(
    input: GenerationInput,
    settings: GenerationConfiguration,
    accountRef: string | undefined,
    assets: readonly {
      id: string;
      kind: string;
      hash: string;
    }[],
  ): GenerationOrder {
    if (!settings.hasApiKey || !settings.agentModel || !settings.seedanceModel)
      throw new Error('请先配置方舟账户与模型。');
    if (
      !Number.isFinite(input.estimatedCost) ||
      input.estimatedCost <= 0 ||
      input.estimatedCost > settings.generationCostLimit
    ) {
      throw new Error('请填写有效的费用估计，且不得超过单次任务上限。');
    }
    if (!accountRef) throw new Error('账户不可用。');
    const reference = input.referenceAssetId
      ? assets.find((asset) => asset.id === input.referenceAssetId)
      : undefined;
    if (input.referenceAssetId && reference?.kind !== 'image')
      throw new Error('参考素材必须为当前项目的图片。');
    return new GenerationOrder({
      ...input,
      model: settings.seedanceModel,
      baseUrl: settings.arkBaseUrl,
      accountRef,
      referenceHash: reference?.hash,
      kitId: 'reelbeam.seedance-kit',
      kitVersion: '1.0.0',
    });
  }
  parameters(): Record<string, unknown> {
    return structuredClone(this.pinned);
  }
}
/** The task root guards paid submission and terminal/output identity transitions. Storage uses snapshots. */
export class GenerationTask {
  private constructor(private readonly state: Job) {}
  static restore(record: Job): GenerationTask {
    return new GenerationTask(structuredClone(record));
  }
  snapshot(): Job {
    return structuredClone(this.state);
  }
  beginSubmission(): void {
    if (
      this.state.kind !== 'seedance' ||
      this.state.status !== 'queued' ||
      this.state.cancelRequested ||
      this.state.remoteId
    ) {
      throw new Error('此任务不能再次付费提交。');
    }
    this.state.status = 'submitting';
    this.state.progress = 0.03;
  }
  pinRemote(remoteId: string): void {
    if (['succeeded', 'failed', 'cancelled'].includes(this.state.status))
      throw new Error('已结束的任务不能更换远端状态。');
    if (this.state.remoteId && this.state.remoteId !== remoteId)
      throw new Error('远端任务 ID 已固定，不能改为其他任务。');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(remoteId)) throw new Error('缺少有效的远端任务 ID。');
    if (this.state.status !== 'submitting' && this.state.remoteId !== remoteId)
      throw new Error('此任务尚未提交，不能登记远端结果。');
    this.state.remoteId = remoteId;
    this.state.status = 'running';
    this.state.progress = 0.1;
  }
  recoverInterrupted(): void {
    if (this.state.status !== 'submitting') return;
    this.state.status = this.state.remoteId ? 'reconciling' : 'unknown';
    this.state.error = '应用曾在提交中退出；只核对原任务，不重新提交。';
  }
  requestCancellation(): void {
    if (['succeeded', 'failed', 'cancelled'].includes(this.state.status)) return;
    this.state.cancelRequested = true;
    if (this.state.status === 'queued') {
      this.state.status = 'cancelled';
      this.state.error = undefined;
    } else if (this.state.status === 'submitting' && !this.state.remoteId) {
      this.state.error = '取消请求已记录，取得远端任务 ID 后会尝试取消；仍需核对供应商状态。';
    }
  }
  acknowledgeCancellation(): void {
    if (this.state.status === 'succeeded') return;
    this.state.status = 'cancelled';
    this.state.error = undefined;
  }
  stage(output: { path: string; hash: string }): void {
    if (
      output.path !== `cache/${this.state.id}-download.mp4` ||
      !/^cache\/[A-Za-z0-9_-]{1,200}-download\.mp4$/.test(output.path) ||
      !/^[a-f0-9]{64}$/.test(output.hash)
    ) {
      throw new Error('生成下载暂存记录无效，保留原任务以供核对。');
    }
    if (this.state.status === 'cancelled') throw new Error('此任务已取消。');
    if (this.state.status !== 'finalizing') throw new Error('此任务尚未进入下载暂存阶段。');
    if (this.state.stagedOutput && this.state.stagedOutput.hash !== output.hash)
      throw new Error('已经提交的暂存输出不能更换内容。');
    this.state.stagedOutput = { ...output };
  }
  completeCandidate(assetId: string): void {
    if (this.state.status === 'cancelled') throw new Error('此任务已取消。');
    if (this.state.outputAssetId && this.state.outputAssetId !== assetId)
      throw new Error('同一任务输出发生内容冲突，旧素材已保留。');
    if (this.state.status === 'succeeded' && this.state.outputAssetId === assetId) return;
    if (this.state.status !== 'finalizing' || !this.state.stagedOutput)
      throw new Error('必须验证并暂存生成内容后才能登记候选素材。');
    this.state.status = 'succeeded';
    this.state.progress = 1;
    this.state.outputAssetId = assetId;
    this.state.error = undefined;
    this.state.stagedOutput = undefined;
  }
}
