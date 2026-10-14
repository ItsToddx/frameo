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
  RecipeRun,
  Settings,
} from '../adapters/contracts/api';
import { Button, Empty, IconButton, Modal, jobLabels, roleLabels, uid } from './ui';
import { useI18n } from './i18n';
import type { MessageKey } from '../localization';
import { presentJobTitle, presentKit } from '../localization/panels';

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
  const { t } = useI18n();
  const [error, setError] = useState<MessageKey | ''>('');
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
    if (!saved) setError('settings.saveFailed');
  }
  return (
    <Modal
      title={t('settings.title')}
      description={t('settings.description')}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(e) => void submit(e)} className="modal-form">
        <div className="connection-notice">
          <KeyRound size={20} />
          <div>
            <strong>{settings.hasApiKey ? t('settings.keySaved') : t('settings.setup')}</strong>
            <p>{t('settings.keyNotice')}</p>
          </div>
          {settings.hasApiKey && <ShieldCheck size={20} />}
        </div>
        <fieldset className="form-section">
          <legend>{t('settings.account')}</legend>
          <label>
            {t('settings.agentModel')}
            <input
              name="agentModel"
              defaultValue={settings.agentModel}
              required
              placeholder={t('settings.agentPlaceholder')}
              data-testid="agent-model-input"
            />
          </label>
          <label>
            {t('settings.seedanceModel')}
            <input
              name="seedanceModel"
              defaultValue={settings.seedanceModel}
              required
              placeholder={t('settings.seedancePlaceholder')}
              data-testid="seedance-model-input"
            />
          </label>
          {replacing ? (
            <label>
              {t('settings.apiKey')}
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                required
                placeholder={t('settings.apiKeyPlaceholder')}
                data-testid="api-key-input"
              />
            </label>
          ) : (
            <div className="saved-key">
              <span>••••••••••••••••</span>
              <Button onClick={() => setReplacing(true)}>{t('settings.replaceKey')}</Button>
            </div>
          )}
          <details className="model-data-notice">
            <summary>{t('settings.dataSummary')}</summary>
            <p>{t('settings.dataNotice')}</p>
          </details>
        </fieldset>
        <fieldset className="form-section">
          <legend>{t('settings.costControl')}</legend>
          <div className="field-row">
            <label>
              {t('settings.generationBudget')}
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
              {t('settings.callLimit')}
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
          <p className="field-hint">{t('settings.costHint')}</p>
        </fieldset>
        <details className="advanced-settings">
          <summary>{t('settings.advanced')}</summary>
          <label>
            {t('settings.baseUrl')}
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
            {t(error)}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            {t('panel.cancel')}
          </Button>
          <Button type="submit" kind="accent" disabled={busy} testId="save-settings">
            {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
            {t('settings.save')}
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
  const { t } = useI18n();
  const [error, setError] = useState<MessageKey | ''>('');
  return (
    <Modal
      title={kind === 'project' ? t('create.projectTitle') : t('create.workTitle')}
      description={
        kind === 'project' ? t('create.projectDescription') : t('create.workDescription')
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
            if (!saved) setError('create.failed');
          });
        }}
      >
        <label>
          {kind === 'project' ? t('create.projectName') : t('create.workName')}
          <input
            name="name"
            placeholder={
              kind === 'project' ? t('create.projectPlaceholder') : t('create.workPlaceholder')
            }
            autoFocus
            required
            maxLength={100}
            data-testid="project-name-input"
          />
        </label>
        <div className="field-row">
          <label>
            {t('create.aspect')}
            <select name="size">
              <option value="1920x1080">{t('create.landscape')}</option>
              <option value="1080x1920">{t('create.portrait')}</option>
              <option value="1080x1080">{t('create.square')}</option>
            </select>
          </label>
          <label>
            {t('create.fps')}
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
            {t(error)}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            {t('panel.cancel')}
          </Button>
          <Button type="submit" kind="accent" disabled={busy} testId="confirm-create-project">
            <Plus size={14} />
            {kind === 'project' ? t('create.projectSubmit') : t('create.workSubmit')}
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
  const { t } = useI18n();
  const [error, setError] = useState<MessageKey | ''>('');
  return (
    <Modal
      title={t('generate.title')}
      description={t('generate.description')}
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
            if (!saved) setError('generate.failed');
          });
        }}
      >
        <label>
          {t('generate.prompt')}
          <textarea
            name="prompt"
            rows={5}
            required
            maxLength={4000}
            placeholder={t('generate.promptPlaceholder')}
            data-testid="generation-prompt"
          />
        </label>
        <div className="field-row">
          <label>
            {t('generate.duration')}
            <select name="duration">
              <option value="5">{t('generate.fiveSeconds')}</option>
              <option value="10">{t('generate.tenSeconds')}</option>
            </select>
          </label>
          <label>
            {t('create.aspect')}
            <select name="ratio">
              <option value="16:9">{t('create.landscape')}</option>
              <option value="9:16">{t('create.portrait')}</option>
              <option value="1:1">{t('create.square')}</option>
            </select>
          </label>
        </div>
        <label>
          {t('generate.reference')}
          <select name="reference">
            <option value="">{t('generate.noReference')}</option>
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
            {t('generate.budget')}
            <input
              name="estimatedCost"
              type="number"
              min="0.01"
              max={settings.generationCostLimit}
              step="0.01"
              required
              placeholder={t('generate.budgetPlaceholder')}
              data-testid="generation-budget"
            />
          </label>
          <p>{t('generate.budgetNotice', { budget: settings.generationCostLimit.toFixed(2) })}</p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            {t('panel.cancel')}
          </Button>
          <Button type="submit" kind="accent" disabled={busy} testId="confirm-generation">
            <Aperture size={14} />
            {t('generate.submit')}
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
  const { locale, t, date, hostText } = useI18n();
  return (
    <Modal
      title={t('jobs.title')}
      description={t('jobs.description')}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="panel-list">
        {!jobs.length && (
          <Empty icon={<Aperture size={28} />} title={t('jobs.empty.title')}>
            {t('jobs.empty.description')}
          </Empty>
        )}
        {[...jobs].reverse().map((job) => {
          const title = presentJobTitle(locale, job);
          return (
            <article className="job-row" key={job.id}>
              <div className="job-icon">
                {job.kind === 'seedance' ? <Aperture size={20} /> : <Download size={20} />}
              </div>
              <div className="job-body">
                <div className="row-heading">
                  <strong>{title}</strong>
                  <span className={`badge ${job.status}`}>{t(jobLabels[job.status])}</span>
                </div>
                <p>
                  {job.kind === 'seedance'
                    ? t('jobs.kind.seedance')
                    : job.kind === 'preview'
                      ? t('jobs.kind.preview')
                      : job.kind === 'motion'
                        ? t('jobs.kind.motion')
                        : t('jobs.kind.export')}{' '}
                  · {date(job.createdAt, { dateStyle: 'medium', timeStyle: 'medium' })}
                  {job.estimatedCost !== undefined &&
                    ` · ${t('jobs.budget', { budget: job.estimatedCost.toFixed(2) })}`}
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
                {job.error && <p className="error-message">{hostText(job.error)}</p>}
                {job.kind === 'seedance' && (
                  <details className="job-details">
                    <summary>{t('jobs.details')}</summary>
                    <dl>
                      <dt>{t('jobs.model')}</dt>
                      <dd>{String(job.input.model || 'Seedance')}</dd>
                      <dt>{t('jobs.id')}</dt>
                      <dd>{job.remoteId || t('jobs.noRemoteId')}</dd>
                    </dl>
                  </details>
                )}
                {job.cancelRequested && job.status !== 'cancelled' && (
                  <p className="field-hint">
                    {job.kind !== 'seedance'
                      ? t('jobs.cancelLocal')
                      : job.remoteId
                        ? t('jobs.cancelRemote')
                        : t('jobs.cancelUnknown')}
                  </p>
                )}
              </div>
              <div className="job-actions">
                {!['succeeded', 'failed', 'cancelled'].includes(job.status) && (
                  <IconButton
                    label={t('jobs.cancel', { title })}
                    disabled={busy || job.cancelRequested}
                    onClick={() => onCancel(job.id)}
                  >
                    <Square size={14} />
                  </IconButton>
                )}
                {job.kind === 'seedance' && job.remoteId && (
                  <IconButton
                    label={t('jobs.reconcile', { title })}
                    disabled={busy}
                    onClick={() => onReconcile(job.id)}
                  >
                    <RefreshCw size={14} />
                  </IconButton>
                )}
                {job.outputPath && (
                  <IconButton
                    label={t('jobs.reveal', { title })}
                    onClick={() => onReveal(job.outputPath!)}
                  >
                    <FolderOpen size={16} />
                  </IconButton>
                )}
              </div>
            </article>
          );
        })}
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
  const { locale, t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const filtered = kits.filter((kit) => {
    const translated = presentKit('zh-CN', kit);
    return (
      (category === 'all' || kit.category === category) &&
      `${translated.name} ${translated.description} ${kit.name} ${kit.description} ${kit.author}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  return (
    <Modal
      title={t('kits.title')}
      description={t('kits.description')}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="store-toolbar">
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label={t('kits.search')}
            placeholder={t('kits.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label={t('kits.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">{t('kits.category.all')}</option>
          <option value="provider">{t('kits.category.provider')}</option>
          <option value="tool">{t('kits.category.tool')}</option>
          <option value="agent">{t('kits.category.agent')}</option>
          <option value="recipe">{t('kits.category.recipe')}</option>
        </select>
        <Button disabled={busy} onClick={onImport} title={t('kits.importHint')}>
          <Upload size={14} />
          {t('kits.import')}
        </Button>
        <IconButton label={t('kits.refresh')} disabled={busy} onClick={onRefresh}>
          <RefreshCw size={15} />
        </IconButton>
      </div>
      <p className="kit-import-hint">{t('kits.importNotice')}</p>
      <div className="kit-grid">
        {filtered.map((kit) => {
          const display = presentKit(locale, kit);
          return (
            <article key={kit.id} className="kit-card">
              <div className="kit-card-heading">
                <div className="kit-icon">
                  <Package size={21} />
                </div>
                <span className={`badge ${kit.enabled ? 'succeeded' : ''}`}>
                  {kit.installed
                    ? kit.enabled
                      ? t('kits.enabled')
                      : t('kits.installed')
                    : t(`kits.category.${kit.category}`)}
                </span>
              </div>
              <h3>
                {display.name}
                <small>v{kit.version}</small>
              </h3>
              <p>{display.description}</p>
              <div className="kit-meta">
                {kit.author} · {kit.license}
              </div>
              <details>
                <summary>{t('kits.permissions', { count: kit.permissions.length })}</summary>
                <p>
                  {kit.permissions.length
                    ? kit.permissions.join(locale === 'zh-CN' ? '、' : ', ')
                    : t('kits.noPermissions')}
                </p>
                <p className="field-hint">{t('kits.source', { source: kit.source })}</p>
              </details>
              <div className="kit-card-actions">
                {kit.installed && kit.enabled && kit.category === 'recipe' && (
                  <Button
                    kind="accent"
                    disabled={busy || !canStart}
                    title={canStart ? t('kits.startHint') : t('kits.openProjectHint')}
                    onClick={() => onStart(kit)}
                  >
                    {t('kits.start')}
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
                      {kit.enabled ? t('kits.disable') : t('kits.enable')}
                    </Button>
                    <IconButton
                      label={t('kits.uninstall', { name: display.name })}
                      disabled={busy}
                      onClick={() => onUninstall(kit.id)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </>
                ) : (
                  <Button disabled={busy} kind="accent" onClick={() => onInstall(kit.id)}>
                    <Download size={14} />
                    {t('kits.install')}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <Empty title={t('kits.empty.title')}>{t('kits.empty.description')}</Empty>
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
  const { t } = useI18n();
  const [editing, setEditing] = useState<Memory | null>(null);
  const [scope, setScope] = useState<'project' | 'user'>('project');
  return (
    <Modal
      title={t('memories.title')}
      description={t('memories.description')}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="memory-layout">
        <div className="memory-list">
          {memories.map((m) => (
            <article className={`memory-row ${editing?.id === m.id ? 'selected' : ''}`} key={m.id}>
              <span className="badge">
                {m.scope === 'project' ? t('memories.project') : t('memories.user')}
              </span>
              <p>{m.content}</p>
              <div>
                <IconButton
                  label={t('memories.edit')}
                  onClick={() => {
                    setEditing(m);
                    setScope(m.scope);
                  }}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label={t('memories.delete')}
                  disabled={busy}
                  onClick={() => onDelete(m)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </article>
          ))}
          {!memories.length && (
            <Empty icon={<Brain size={25} />} title={t('memories.empty.title')}>
              {t('memories.empty.description')}
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
          <h3>{editing ? t('memories.edit') : t('memories.add')}</h3>
          <label>
            {t('memories.scope')}
            <select
              value={scope}
              disabled={!!editing}
              onChange={(e) => setScope(e.target.value as 'project' | 'user')}
            >
              <option value="project">{t('memories.project')}</option>
              <option value="user">{t('memories.allProjects')}</option>
            </select>
          </label>
          <label>
            {t('memories.content')}
            <textarea
              name="content"
              defaultValue={editing?.content || ''}
              required
              maxLength={4000}
              rows={7}
              placeholder={t('memories.placeholder')}
            />
          </label>
          <Button type="submit" kind="accent" disabled={busy}>
            <Check size={14} />
            {t('memories.save')}
          </Button>
          {editing && <Button onClick={() => setEditing(null)}>{t('memories.addAnother')}</Button>}
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
  const { t, hostText } = useI18n();
  const unresolvedJobs = jobs.some(
    (job) => !['succeeded', 'failed', 'cancelled'].includes(job.status),
  );
  return (
    <div className="recipes-list">
      {!recipes.length && (
        <Empty title={t('recipes.empty.title')}>{t('recipes.empty.description')}</Empty>
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
              <span className="badge">{t(`recipes.status.${run.status}`)}</span>
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
                      {roleLabels[step.role || '']
                        ? t(roleLabels[step.role || ''])
                        : step.role || t('recipes.step')}{' '}
                      · {t('recipes.attempt', { count: step.attempt })} ·{' '}
                      {t(`recipes.step.${step.status}`)}
                    </span>
                    {step.result && <p>{step.result}</p>}
                    {step.inputDecision?.decision === 'reject' && (
                      <p className="recipe-declined">{t('recipes.inputRejected')}</p>
                    )}
                    {step.error && <p className="recipe-declined">{hostText(step.error)}</p>}
                    {step.input && (
                      <details
                        className="recipe-bound-data"
                        open={step.status === 'review' && step.reviewPhase === 'input'}
                      >
                        <summary>{t('recipes.fullInput')}</summary>
                        <pre>{JSON.stringify(step.input, null, 2)}</pre>
                      </details>
                    )}
                    {step.output && (
                      <details
                        className="recipe-bound-data"
                        open={step.status === 'review' && step.reviewPhase === 'result'}
                      >
                        <summary>{t('recipes.fullResult')}</summary>
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
                          {t('recipes.rejectInput')}
                        </Button>
                        <Button
                          kind="accent"
                          disabled={busy || dirty || run.status === 'running'}
                          title={t(dirty ? 'recipes.saveDraftHint' : 'recipes.confirmInputHint')}
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
                          {t('recipes.confirmInput')}
                        </Button>
                      </div>
                    )}
                    {step.decision?.decision === 'reject' && (
                      <p className="recipe-declined">{t('recipes.resultRejected')}</p>
                    )}
                    {step.decision?.decision === 'accept' && step.status !== 'stale' && (
                      <span className="recipe-result-accepted">{t('recipes.resultAccepted')}</span>
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
                            {t('recipes.rejectResult')}
                          </Button>
                          <Button
                            kind="accent"
                            disabled={busy || dirty || run.status === 'running'}
                            title={t(dirty ? 'recipes.saveDraftHint' : 'recipes.acceptResultHint')}
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
                            {t('recipes.acceptResult')}
                          </Button>
                        </div>
                      )}
                  </div>
                  <IconButton
                    label={t('recipes.redo', { title: step.title })}
                    disabled={busy || dirty || run.status === 'running' || unresolvedJobs}
                    onClick={() => onRedo(run.id, step.id)}
                  >
                    <RefreshCw size={12} />
                  </IconButton>
                </li>
              ))}
            </ol>
            {unresolvedJobs && <p className="recipe-job-notice">{t('recipes.unresolvedJobs')}</p>}
            {needsResultDecision && (
              <p className="field-hint">{t('recipes.reviewBeforeContinue')}</p>
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
                {t('recipes.resume')}
                <ArrowUpRight size={13} />
              </Button>
              <Button disabled={busy} onClick={() => onExport(run.id)}>
                <Download size={13} />
                {t('recipes.export')}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
