import type { Catalog } from './types';
export const common = {
  'dialog.close': { en: 'Close dialog', zh: '关闭窗口' },
  'language.label': { en: 'Interface language', zh: '界面语言' },
  'job.queued': { en: 'Queued', zh: '等待执行' },
  'job.submitting': { en: 'Submitting', zh: '提交云端' },
  'job.running': { en: 'Running', zh: '执行中' },
  'job.unknown': { en: 'Awaiting confirmation', zh: '状态待确认' },
  'job.reconciling': { en: 'Checking cloud task', zh: '查询云端状态' },
  'job.finalizing': { en: 'Saving media', zh: '保存素材' },
  'job.succeeded': { en: 'Completed', zh: '已完成' },
  'job.failed': { en: 'Failed', zh: '失败' },
  'job.cancelled': { en: 'Cancelled', zh: '已取消' },
  'role.creative': { en: 'Creative', zh: '创意' },
  'role.visual': { en: 'Visual', zh: '视觉' },
  'role.editor': { en: 'Editor', zh: '剪辑' },
} as const satisfies Catalog;
