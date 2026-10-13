import { useState, type FormEvent } from 'react';
import {
  KeyRound,
  Aperture,
  LoaderCircle,
  Search,
  Download,
  Check,
  Upload,
  Trash2,
  RefreshCw,
  FolderOpen,
  Square,
  Brain,
  Pencil,
  Plus,
  ArrowUpRight,
  Package,
  ShieldCheck,
} from 'lucide-react';
import type {
  Asset,
  GenerationInput,
  Job,
  KitInfo,
  Memory,
  ProjectSnapshot,
  RecipeRun,
  Settings,
} from '../adapters/contracts/api';
import { Button, Empty, IconButton, Modal, jobLabels, roleLabels, uid } from './ui';

export function SettingsModal({
  settings,
  busy,
  onSave,
  onClose,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (value: Omit<Settings, 'hasApiKey'> & { apiKey?: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [replacing, setReplacing] = useState(!settings.hasApiKey);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError('');
    const saved = await onSave({
      arkBaseUrl: String(d.get('arkBaseUrl')).trim(),
      agentModel: String(d.get('agentModel')).trim(),
      seedanceModel: String(d.get('seedanceModel')).trim(),
      generationCostLimit: Number(d.get('generationCostLimit')),
      maxModelCalls: Number(d.get('maxModelCalls')),
      apiKey: replacing ? String(d.get('apiKey')).trim() : undefined,
    });
    if (!saved) setError('配置未保存，请检查错误提示。输入已保留。');
  }
  return (
    <Modal
      title="连接火山方舟"
      description="Frameo 通过模型理解创作需求，第一版使用 Seedance 生成视频。"
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(e) => void submit(e)} className="modal-form">
        <div className="connection-notice">
          <KeyRound size={20} />
          <div>
            <strong>{settings.hasApiKey ? 'API Key 已保存在本机' : '配置模型后开始创作'}</strong>
            <p>密钥由桌面端保存，通过火山方舟发送创作请求。</p>
          </div>
          {settings.hasApiKey && <ShieldCheck size={20} />}
        </div>
        <fieldset className="form-section">
          <legend>模型与账户</legend>
          <label>
            Agent 模型 / 接入点 ID
            <input
              name="agentModel"
              defaultValue={settings.agentModel}
              required
              placeholder="填写支持工具调用与图像理解的模型 ID"
              data-testid="agent-model-input"
            />
          </label>
          <label>
            Seedance 模型 / 接入点 ID
            <input
              name="seedanceModel"
              defaultValue={settings.seedanceModel}
              required
              placeholder="填写 Seedance 视频模型 ID"
              data-testid="seedance-model-input"
            />
          </label>
          {replacing ? (
            <label>
              API Key
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                required
                placeholder="输入火山方舟 API Key"
                data-testid="api-key-input"
              />
            </label>
          ) : (
            <div className="saved-key">
              <span>••••••••••••••••</span>
              <Button onClick={() => setReplacing(true)}>替换密钥</Button>
            </div>
          )}
          <details className="model-data-notice">
            <summary>Agent 会使用哪些素材？</summary>
            <p>
              请使用支持工具调用与图像理解的 Agent
              模型。选中素材的图片、视频关键帧及音频测量数据可能会发送至此模型。
            </p>
          </details>
        </fieldset>
        <fieldset className="form-section">
          <legend>费用控制</legend>
          <div className="field-row">
            <label>
              单次生成预算上限 / 元
              <input
                name="generationCostLimit"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={settings.generationCostLimit}
                required
              />
            </label>
            <label>
              单次 Agent 模型调用上限
              <input
                name="maxModelCalls"
                type="number"
                min="1"
                max="12"
                defaultValue={settings.maxModelCalls}
                required
              />
            </label>
          </div>
          <p className="field-hint">
            预算用于确认与拦截，实际费用由服务商按账户价格结算。模型 ID 和密钥须来自同一方舟账户。
          </p>
        </fieldset>
        <details className="advanced-settings">
          <summary>高级连接设置</summary>
          <label>
            方舟 API 地址
            <input
              name="arkBaseUrl"
              defaultValue={settings.arkBaseUrl}
              required
              type="url"
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
            />
          </label>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" kind="accent" disabled={busy} testId="save-settings">
            {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}保存配置
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CreateModal({
  kind,
  busy,
  onCreate,
  onClose,
}: {
  kind: 'project' | 'sequence';
  busy: boolean;
  onCreate: (value: {
    name: string;
    width: number;
    height: number;
    fps: number;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <Modal
      title={kind === 'project' ? '新建创作工程' : '新建作品'}
      description={
        kind === 'project'
          ? '为故事起一个名字，然后选择工程的保存位置。'
          : '一份工程可以包含多个作品，素材可以共同使用。'
      }
      onClose={onClose}
      busy={busy}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const [width, height] = String(d.get('size')).split('x').map(Number);
          setError('');
          void onCreate({
            name: String(d.get('name')).trim(),
            width,
            height,
            fps: Number(d.get('fps')),
          }).then((saved) => {
            if (!saved) setError('创建未完成，输入已保留。请检查提示后重试。');
          });
        }}
      >
        <label>
          {kind === 'project' ? '工程名称' : '作品名称'}
          <input
            name="name"
            placeholder={kind === 'project' ? '例如：城市的另一种节奏' : '例如：主影片'}
            autoFocus
            required
            maxLength={100}
            data-testid="project-name-input"
          />
        </label>
        <div className="field-row">
          <label>
            画幅
            <select name="size">
              <option value="1920x1080">16:9 · 横屏</option>
              <option value="1080x1920">9:16 · 竖屏</option>
              <option value="1080x1080">1:1 · 方形</option>
            </select>
          </label>
          <label>
            帧率
            <select name="fps">
              <option value="30">30 fps</option>
              <option value="24">24 fps</option>
              <option value="25">25 fps</option>
              <option value="60">60 fps</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" kind="accent" disabled={busy} testId="confirm-create-project">
            <Plus size={14} />
            {kind === 'project' ? '选择位置并创建' : '创建作品'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function GenerateModal({
  settings,
  assets,
  busy,
  onSubmit,
  onClose,
}: {
  settings: Settings;
  assets: Asset[];
  busy: boolean;
  onSubmit: (input: GenerationInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <Modal
      title="生成一个新镜头"
      description="Seedance · 结果保留在素材库，加入作品时由你确认。"
      onClose={onClose}
      busy={busy}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setError('');
          void onSubmit({
            requestId: uid(),
            prompt: String(d.get('prompt')).trim(),
            duration: Number(d.get('duration')),
            ratio: String(d.get('ratio')) as GenerationInput['ratio'],
            referenceAssetId: String(d.get('reference')) || undefined,
            estimatedCost: Number(d.get('estimatedCost')),
            model: settings.seedanceModel,
          }).then((saved) => {
            if (!saved) setError('任务未提交，输入已保留。请检查错误提示后再操作。');
          });
        }}
      >
        <label>
          描述画面
          <textarea
            name="prompt"
            rows={5}
            required
            maxLength={4000}
            placeholder="例如：清晨，薄雾中的海岸公路。镜头缓慢跟随一辆银色汽车，自然光，电影质感。"
            data-testid="generation-prompt"
          />
        </label>
        <div className="field-row">
          <label>
            视频时长
            <select name="duration">
              <option value="5">5 秒</option>
              <option value="10">10 秒</option>
            </select>
          </label>
          <label>
            画幅
            <select name="ratio">
              <option value="16:9">16:9 · 横屏</option>
              <option value="9:16">9:16 · 竖屏</option>
              <option value="1:1">1:1 · 方形</option>
            </select>
          </label>
        </div>
        <label>
          参考图片
          <select name="reference">
            <option value="">不使用参考素材</option>
            {assets
              .filter((a) => a.kind === 'image')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <div className="budget-box">
          <label>
            我确认此次生成预算 / 元
            <input
              name="estimatedCost"
              type="number"
              min="0.01"
              max={settings.generationCostLimit}
              step="0.01"
              required
              placeholder="输入已确认的预算"
              data-testid="generation-budget"
            />
          </label>
          <p>
            上限 ¥{settings.generationCostLimit.toFixed(2)}
            。点击下方按钮后，描述与参考素材会提交至方舟，产生模型费用。实际费用以服务商账单为准。
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" kind="accent" disabled={busy} testId="confirm-generation">
            <Aperture size={14} />
            确认预算并生成
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function JobsModal({
  jobs,
  onCancel,
  onReconcile,
  onReveal,
  onClose,
  busy,
}: {
  jobs: Job[];
  onCancel: (id: string) => void;
  onReconcile: (id: string) => void;
  onReveal: (path: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Modal
      title="任务记录"
      description="云端生成与本地合成任务在这里持续更新。"
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="panel-list">
        {!jobs.length && (
          <Empty icon={<Aperture size={28} />} title="还没有任务">
            提交生成、预览或导出后会显示真实执行状态。
          </Empty>
        )}
        {[...jobs].reverse().map((job) => (
          <article className="job-row" key={job.id}>
            <div className="job-icon">
              {job.kind === 'seedance' ? <Aperture size={20} /> : <Download size={20} />}
            </div>
            <div className="job-body">
              <div className="row-heading">
                <strong>{job.title}</strong>
                <span className={`badge ${job.status}`}>{jobLabels[job.status]}</span>
              </div>
              <p>
                {job.kind === 'seedance'
                  ? 'Seedance 云端生成'
                  : job.kind === 'preview'
                    ? '本地预览合成'
                    : job.kind === 'motion'
                      ? '动效渲染'
                      : '视频导出'}{' '}
                · {new Date(job.createdAt).toLocaleString('zh-CN')}
                {job.estimatedCost !== undefined && ` · 确认预算 ¥${job.estimatedCost.toFixed(2)}`}
              </p>
              {['queued', 'submitting', 'running', 'reconciling', 'finalizing'].includes(
                job.status,
              ) && (
                <div
                  className={`progress ${job.kind === 'seedance' && job.status === 'running' ? 'indeterminate' : ''}`}
                >
                  <span style={{ width: `${Math.max(2, Math.min(100, job.progress * 100))}%` }} />
                </div>
              )}
              {job.error && <p className="error-message">{job.error}</p>}
              {job.kind === 'seedance' && (
                <details className="job-details">
                  <summary>任务详情</summary>
                  <dl>
                    <dt>模型</dt>
                    <dd>{String(job.input.model || 'Seedance')}</dd>
                    <dt>任务 ID</dt>
                    <dd>{job.remoteId || '尚未获得云端 ID'}</dd>
                  </dl>
                </details>
              )}
              {job.cancelRequested && job.status !== 'cancelled' && (
                <p className="field-hint">
                  {job.kind !== 'seedance'
                    ? '已请求停止本地处理。'
                    : job.remoteId
                      ? '已请求取消；云端最终状态仍会查询确认。'
                      : '已记录取消意图；缺少云端任务 ID，请先在方舟控制台核对。应用不会重新付费提交。'}
                </p>
              )}
            </div>
            <div className="job-actions">
              {!['succeeded', 'failed', 'cancelled'].includes(job.status) && (
                <IconButton
                  label={`取消任务 ${job.title}`}
                  disabled={busy || job.cancelRequested}
                  onClick={() => onCancel(job.id)}
                >
                  <Square size={14} />
                </IconButton>
              )}
              {job.kind === 'seedance' && job.remoteId && (
                <IconButton
                  label={`查询任务 ${job.title}`}
                  disabled={busy}
                  onClick={() => onReconcile(job.id)}
                >
                  <RefreshCw size={14} />
                </IconButton>
              )}
              {job.outputPath && (
                <IconButton
                  label={`查看输出 ${job.title}`}
                  onClick={() => onReveal(job.outputPath!)}
                >
                  <FolderOpen size={16} />
                </IconButton>
              )}
            </div>
          </article>
        ))}
      </div>
    </Modal>
  );
}
export function KitsModal({
  kits,
  busy,
  onInstall,
  onEnable,
  onUninstall,
  onImport,
  onRefresh,
  onClose,
  onStart,
  canStart,
}: {
  kits: KitInfo[];
  busy: boolean;
  onInstall: (id: string) => void;
  onEnable: (id: string, enabled: boolean) => void;
  onUninstall: (id: string) => void;
  onImport: () => void;
  onRefresh: () => void;
  onClose: () => void;
  onStart: (kit: KitInfo) => void;
  canStart: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const filtered = kits.filter(
    (k) =>
      (category === 'all' || k.category === category) &&
      `${k.name} ${k.description} ${k.author}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="Kit 商店"
      description="管理 Provider、工具、Agent 与创作工作流。安装后需启用，才会加入创作环境。"
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="store-toolbar">
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="搜索 Kit"
            placeholder="搜索 Kit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Kit 分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">全部类别</option>
          <option value="provider">Provider</option>
          <option value="tool">工具</option>
          <option value="agent">Agent</option>
          <option value="recipe">工作流</option>
        </select>
        <Button disabled={busy} onClick={onImport} title="导入 Kit 目录、ZIP 或声明文件">
          <Upload size={14} />
          导入 Kit
        </Button>
        <IconButton label="刷新 Kit 列表" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={15} />
        </IconButton>
      </div>
      <p className="kit-import-hint">
        支持 Kit 目录、ZIP 与声明文件。含原生工具的 Kit 会由桌面端展示权限与信任确认。
      </p>
      <div className="kit-grid">
        {filtered.map((kit) => (
          <article key={kit.id} className="kit-card">
            <div className="kit-card-heading">
              <div className="kit-icon">
                <Package size={21} />
              </div>
              <span className={`badge ${kit.enabled ? 'succeeded' : ''}`}>
                {kit.installed ? (kit.enabled ? '已启用' : '已安装') : kit.category}
              </span>
            </div>
            <h3>
              {kit.name}
              <small>v{kit.version}</small>
            </h3>
            <p>{kit.description}</p>
            <div className="kit-meta">
              {kit.author} · {kit.license}
            </div>
            <details>
              <summary>所需权限 · {kit.permissions.length}</summary>
              <p>{kit.permissions.length ? kit.permissions.join('、') : '无额外权限'}</p>
              <p className="field-hint">来源：{kit.source}</p>
            </details>
            <div className="kit-card-actions">
              {kit.installed && kit.enabled && kit.category === 'recipe' && (
                <Button
                  kind="accent"
                  disabled={busy || !canStart}
                  title={canStart ? '启动创作工作流' : '请先打开一个工程'}
                  onClick={() => onStart(kit)}
                >
                  开始制作
                  <ArrowUpRight size={13} />
                </Button>
              )}
              {kit.installed ? (
                <>
                  <Button
                    kind={kit.enabled ? '' : 'accent'}
                    disabled={busy}
                    onClick={() => onEnable(kit.id, !kit.enabled)}
                  >
                    {kit.enabled ? '停用' : '启用'}
                  </Button>
                  <IconButton
                    label={`卸载 ${kit.name}`}
                    disabled={busy}
                    onClick={() => onUninstall(kit.id)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </>
              ) : (
                <Button disabled={busy} kind="accent" onClick={() => onInstall(kit.id)}>
                  <Download size={14} />
                  安装
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <Empty title="没有找到匹配的 Kit">尝试其他关键词，或导入本地 Kit。</Empty>
      )}
    </Modal>
  );
}
export function MemoriesModal({
  memories,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  memories: Memory[];
  busy: boolean;
  onSave: (input: {
    id?: string;
    scope: 'project' | 'user';
    content: string;
    expectedRevision?: number;
  }) => Promise<boolean>;
  onDelete: (memory: Memory) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Memory | null>(null);
  const [scope, setScope] = useState<'project' | 'user'>('project');
  return (
    <Modal
      title="创作记忆"
      description="明确记录品牌、角色和创作偏好，Agent 可在后续创作中读取。"
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="memory-layout">
        <div className="memory-list">
          {memories.map((m) => (
            <article className={`memory-row ${editing?.id === m.id ? 'selected' : ''}`} key={m.id}>
              <span className="badge">{m.scope === 'project' ? '当前工程' : '个人'}</span>
              <p>{m.content}</p>
              <div>
                <IconButton
                  label="编辑记忆"
                  onClick={() => {
                    setEditing(m);
                    setScope(m.scope);
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton label="删除记忆" disabled={busy} onClick={() => onDelete(m)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </article>
          ))}
          {!memories.length && (
            <Empty icon={<Brain size={25} />} title="记录值得记住的创作偏好">
              例如：品牌主色、镜头风格、字幕规范。
            </Empty>
          )}
        </div>
        <form
          className="modal-form memory-editor"
          key={editing?.id || 'new'}
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void onSave({
              id: editing?.id,
              scope,
              content: String(d.get('content')).trim(),
              expectedRevision: editing?.revision,
            }).then((saved) => {
              if (saved) setEditing(null);
            });
          }}
        >
          <h3>{editing ? '编辑记忆' : '新增记忆'}</h3>
          <label>
            作用范围
            <select
              value={scope}
              disabled={!!editing}
              onChange={(e) => setScope(e.target.value as 'project' | 'user')}
            >
              <option value="project">当前工程</option>
              <option value="user">个人 · 所有工程</option>
            </select>
          </label>
          <label>
            记忆内容
            <textarea
              name="content"
              defaultValue={editing?.content || ''}
              required
              maxLength={4000}
              rows={7}
              placeholder="简洁描述希望 Agent 持续遵守的偏好。"
            />
          </label>
          <Button type="submit" kind="accent" disabled={busy}>
            <Check size={14} />
            保存记忆
          </Button>
          {editing && <Button onClick={() => setEditing(null)}>新增另一条</Button>}
        </form>
      </div>
    </Modal>
  );
}
export interface RecipeResultInput {
  recipeId: string;
  expectedRevision: number;
  stepId: string;
  attempt: number;
  resultHash: string;
  decision: 'accept' | 'reject';
}
export interface RecipeInputReview {
  recipeId: string;
  expectedRevision: number;
  stepId: string;
  inputHash: string;
  decision: 'accept' | 'reject';
}
export function RecipeList({
  recipes,
  jobs,
  busy,
  dirty,
  onResume,
  onRedo,
  onExport,
  onResult,
  onInput,
}: {
  recipes: RecipeRun[];
  jobs: Job[];
  busy: boolean;
  dirty: boolean;
  onResume: (id: string) => void;
  onRedo: (id: string, stepId: string) => void;
  onExport: (id: string) => void;
  onResult: (input: RecipeResultInput) => void;
  onInput: (input: RecipeInputReview) => void;
}) {
  const unresolvedJobs = jobs.some(
    (job) => !['succeeded', 'failed', 'cancelled'].includes(job.status),
  );
  return (
    <div className="recipes-list">
      {!recipes.length && (
        <Empty title="还没有工作流记录">在对话中让 Agent 执行已启用的工作流。</Empty>
      )}
      {recipes.map((run) => {
        const needsResultDecision = run.steps.some(
          (step) => step.status === 'review' && step.decision?.decision !== 'accept',
        );
        const needsRedo = run.steps.some((step) => step.status === 'failed');
        return (
          <article className="recipe-run" key={run.id}>
            <div className="row-heading">
              <strong>{run.title}</strong>
              <span className="badge">
                {
                  { running: '执行中', paused: '待继续', completed: '已完成', failed: '失败' }[
                    run.status
                  ]
                }
              </span>
            </div>
            <ol>
              {run.steps.map((step) => (
                <li key={step.id} className={step.status}>
                  <span className="recipe-step-dot">
                    {step.status === 'completed' ? (
                      <Check size={12} />
                    ) : step.status === 'running' ? (
                      <LoaderCircle size={12} className="spin" />
                    ) : null}
                  </span>
                  <div>
                    <strong>{step.title}</strong>
                    <span>
                      {roleLabels[step.role || ''] || step.role || '步骤'} · 第 {step.attempt} 次 ·{' '}
                      {
                        {
                          pending: '待执行',
                          running: '执行中',
                          review: '待审阅',
                          waiting: '等待任务或提案',
                          completed: '完成',
                          failed: '失败',
                          stale: '需重做',
                        }[step.status]
                      }
                    </span>
                    {step.result && <p>{step.result}</p>}
                    {step.inputDecision?.decision === 'reject' && (
                      <p className="recipe-declined">
                        执行输入已拒绝。请调整目标或重做步骤后再确认。
                      </p>
                    )}
                    {step.error && <p className="recipe-declined">{step.error}</p>}
                    {step.input && (
                      <details
                        className="recipe-bound-data"
                        open={step.status === 'review' && step.reviewPhase === 'input'}
                      >
                        <summary>此步骤将使用的完整输入</summary>
                        <pre>{JSON.stringify(step.input, null, 2)}</pre>
                      </details>
                    )}
                    {step.output && (
                      <details
                        className="recipe-bound-data"
                        open={step.status === 'review' && step.reviewPhase === 'result'}
                      >
                        <summary>此次执行的完整结果</summary>
                        <pre>{JSON.stringify(step.output, null, 2)}</pre>
                      </details>
                    )}
                    {step.status === 'review' && step.reviewPhase === 'input' && step.inputHash && (
                      <div className="recipe-result-actions">
                        <Button
                          disabled={busy || run.status === 'running'}
                          onClick={() =>
                            onInput({
                              recipeId: run.id,
                              expectedRevision: run.revision,
                              stepId: step.id,
                              inputHash: step.inputHash!,
                              decision: 'reject',
                            })
                          }
                        >
                          拒绝输入
                        </Button>
                        <Button
                          kind="accent"
                          disabled={busy || dirty || run.status === 'running'}
                          title={dirty ? '先保存或放弃时间线草稿' : '确认此步骤的完整输入'}
                          onClick={() =>
                            onInput({
                              recipeId: run.id,
                              expectedRevision: run.revision,
                              stepId: step.id,
                              inputHash: step.inputHash!,
                              decision: 'accept',
                            })
                          }
                        >
                          确认输入
                        </Button>
                      </div>
                    )}
                    {step.decision?.decision === 'reject' && (
                      <p className="recipe-declined">结果已拒绝，请重做此步骤后再次审阅。</p>
                    )}
                    {step.decision?.decision === 'accept' && step.status !== 'stale' && (
                      <span className="recipe-result-accepted">结果已采纳</span>
                    )}
                    {step.status === 'review' &&
                      step.reviewPhase === 'result' &&
                      step.resultHash &&
                      !step.decision && (
                        <div className="recipe-result-actions">
                          <Button
                            disabled={busy || run.status === 'running'}
                            onClick={() =>
                              onResult({
                                recipeId: run.id,
                                expectedRevision: run.revision,
                                stepId: step.id,
                                attempt: step.attempt,
                                resultHash: step.resultHash!,
                                decision: 'reject',
                              })
                            }
                          >
                            拒绝结果
                          </Button>
                          <Button
                            kind="accent"
                            disabled={busy || dirty || run.status === 'running'}
                            title={dirty ? '先保存或放弃时间线草稿' : '采纳此步骤的当前结果'}
                            onClick={() =>
                              onResult({
                                recipeId: run.id,
                                expectedRevision: run.revision,
                                stepId: step.id,
                                attempt: step.attempt,
                                resultHash: step.resultHash!,
                                decision: 'accept',
                              })
                            }
                          >
                            采纳结果
                          </Button>
                        </div>
                      )}
                  </div>
                  <IconButton
                    label={`重做步骤 ${step.title}`}
                    disabled={busy || dirty || run.status === 'running' || unresolvedJobs}
                    onClick={() => onRedo(run.id, step.id)}
                  >
                    <RefreshCw size={12} />
                  </IconButton>
                </li>
              ))}
            </ol>
            {unresolvedJobs && (
              <p className="recipe-job-notice">
                有任务尚未结束或状态待确认。请在任务记录中查询或取消后，再重做步骤。
              </p>
            )}
            {needsResultDecision && (
              <p className="field-hint">先审阅当前步骤的结果，再继续工作流。</p>
            )}
            <div className="recipe-actions">
              <Button
                disabled={
                  busy ||
                  dirty ||
                  needsResultDecision ||
                  needsRedo ||
                  run.status === 'running' ||
                  run.status === 'completed'
                }
                onClick={() => onResume(run.id)}
              >
                继续工作流
                <ArrowUpRight size={13} />
              </Button>
              <Button disabled={busy} onClick={() => onExport(run.id)}>
                <Download size={13} />
                导出记录
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
