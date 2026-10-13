import type { GenerationInput, Job, ProjectSnapshot, Review, Settings } from './model.js';
import type { ProjectStore } from './project-store.js';
import type { ProjectWorkspace } from './project-workspace.js';
export interface ReviewDecisionPorts {
  workspace(database: ProjectStore): ProjectWorkspace;
  assertRecipeCurrent(database: ProjectStore, review: Review): void;
  kitEnabled(kitId: string): boolean;
  kitDigest(kitId: string): string | undefined;
  configuration(): Settings;
  configurationDigest(): string;
  assertEditAvailable(projectId: string, sequenceId?: string): void;
  generate(database: ProjectStore, input: GenerationInput, settings: Settings): Job;
  changed(database: ProjectStore): void;
}
/** An approval is permission for the exact proposal, configuration and frozen attempt. */
export class ReviewDecisions {
  constructor(private readonly ports: ReviewDecisionPorts) {}
  decide(
    database: ProjectStore,
    input: {
      reviewId: string;
      decision: 'accept' | 'reject';
    },
  ): ProjectSnapshot {
    const review = database.read().reviews.find((item) => item.id === input.reviewId);
    if (!review) throw new Error('审阅不存在。');
    const workspace = this.ports.workspace(database);
    if (review.status !== 'pending') return workspace.snapshot();
    let jobId = review.jobId;
    if (input.decision === 'accept') {
      this.ports.assertRecipeCurrent(database, review);
      if (
        review.kitId &&
        (!this.ports.kitEnabled(review.kitId) ||
          this.ports.kitDigest(review.kitId) !== review.kitDigest)
      ) {
        throw new Error('提案所属 Kit 已停用或升级，请重新提出方案。');
      }
      const settings = this.ports.configuration();
      if (!settings.hasApiKey || !settings.agentModel || !settings.seedanceModel)
        throw new Error('请先在设置中配置方舟 API Key、Agent 模型和 Seedance 模型。');
      if (review.configHash && review.configHash !== this.ports.configurationDigest())
        throw new Error('账户或参数配置已变化，请让 Agent 重新提出任务。');
      this.ports.assertEditAvailable(database.read().project.id, review.sequenceId);
      if (review.kind === 'edit') {
        if (!review.sequenceId || review.expectedRevision === undefined || !review.commands)
          throw new Error('编辑提案不完整。');
        workspace.apply({
          sequenceId: review.sequenceId,
          expectedRevision: review.expectedRevision,
          commandId: review.id,
          commands: review.commands,
        });
      } else if (review.kind === 'memory' && review.memory) {
        workspace.saveMemory(review.memory);
      } else if (review.generation) {
        if (!this.ports.kitEnabled('reelbeam.seedance-kit'))
          throw new Error('Seedance Kit 已停用。');
        jobId = this.ports.generate(database, review.generation, settings).id;
      }
    }
    database.transaction((state) => {
      const current = state.reviews.find((item) => item.id === review.id)!;
      Object.assign(current, {
        status: input.decision === 'accept' ? 'accepted' : 'rejected',
        jobId,
      });
    }, 'review.changed');
    this.ports.changed(database);
    return workspace.snapshot();
  }
}
