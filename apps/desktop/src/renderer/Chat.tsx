import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import {
  Aperture,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Film,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import type { Job, ProjectSnapshot, Review, Session, Settings } from '../adapters/contracts/api';
import { Button, Empty, IconButton, jobLabels } from './ui';
import { RecipeList, type RecipeResultInput, type RecipeInputReview } from './Panels';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { ChatDrafts, createChatAdapter, isChatSubmitKey } from './chat-adapter';
import { ChatMarkdown } from './ChatMarkdown';

type ChatTab = 'chat' | 'reviews' | 'recipes';

export interface ChatProps {
  snapshot: ProjectSnapshot | null;
  settings: Settings;
  sessionId: string | null;
  streamSessionId?: string | null;
  onSession: (id: string) => void;
  onNewSession: () => void;
  onPrompt: (text: string) => Promise<boolean>;
  onStop: () => void;
  running: boolean;
  status: string;
  delta: string;
  selectedSequence?: string;
  selectedClip?: string;
  selectedAsset?: string;
  dirty: boolean;
  busy: boolean;
  onSetup: () => void;
  onReview: (id: string, decision: 'accept' | 'reject') => void;
  onResume: (id: string) => void;
  onRedo: (id: string, stepId: string) => void;
  onExportRecipe: (id: string) => void;
  onRecipeResult: (input: RecipeResultInput) => void;
  onRecipeInput: (input: RecipeInputReview) => void;
}

export function Chat(props: ChatProps) {
  const { snapshot, sessionId, running } = props;
  const [tab, setTab] = useState<ChatTab>('chat');
  const [drafts] = useState(() => new ChatDrafts());
  const recipeCount = useRef(snapshot?.recipes.length ?? 0);
  const previousScope = useRef<{ projectId?: string; sessionId?: string; draftKey: string } | null>(
    null,
  );
  const session = snapshot?.sessions.find((item) => item.id === sessionId) ?? snapshot?.sessions[0];
  const draftKey = `${snapshot?.project.id ?? 'closed'}/${session?.id ?? 'new'}`;
  const previous = previousScope.current;
  if (previous && previous.projectId === snapshot?.project.id && !previous.sessionId && session) {
    drafts.adopt(previous.draftKey, draftKey);
  }
  previousScope.current = { projectId: snapshot?.project.id, sessionId: session?.id, draftKey };
  const pendingCount =
    snapshot?.reviews.filter((review) => review.status === 'pending').length ?? 0;

  useEffect(() => {
    const count = snapshot?.recipes.length ?? 0;
    if (count > recipeCount.current) setTab('recipes');
    recipeCount.current = count;
  }, [snapshot?.recipes.length]);

  return (
    <aside className="agent-panel" data-testid="agent-panel" aria-label="创作 Agent">
      <header className="agent-header">
        <div className="agent-title">
          <span className="agent-mark">
            <Aperture size={18} />
          </span>
          <div>
            <strong>创作 Agent</strong>
            <span>规划、生成与剪辑</span>
          </div>
        </div>
        <span className={`agent-header-state ${running ? 'running' : ''}`}>
          <span className="status-dot" />
          {running
            ? '执行中'
            : !props.settings.hasApiKey
              ? '待连接'
              : !snapshot
                ? '待打开工程'
                : '就绪'}
        </span>
      </header>
      <ChatSession
        key={draftKey}
        {...props}
        session={session}
        draftKey={draftKey}
        drafts={drafts}
        tab={tab}
        onTabChange={setTab}
        pendingCount={pendingCount}
      />
    </aside>
  );
}

interface ChatSessionProps extends ChatProps {
  session?: Session;
  draftKey: string;
  drafts: ChatDrafts;
  tab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  pendingCount: number;
}

function ChatSession(props: ChatSessionProps) {
  const {
    snapshot,
    settings,
    session,
    draftKey,
    drafts,
    tab,
    onTabChange,
    pendingCount,
    onSession,
    onNewSession,
    onPrompt,
    onStop,
    running,
    status,
    delta,
    streamSessionId,
    dirty,
    busy,
    onReview,
    onResume,
    onRedo,
    onExportRecipe,
    onRecipeResult,
    onRecipeInput,
  } = props;
  const [submission, setSubmission] = useState<{ pending: boolean; error?: string }>({
    pending: false,
  });
  const adapter = useMemo(
    () =>
      createChatAdapter({
        session,
        delta,
        running,
        streamSessionId,
        drafts,
        draftKey,
        disabled: !snapshot,
        sendDisabled: !settings.hasApiKey || busy || dirty || submission.pending,
        onPrompt,
        onStop,
        onSubmission: (state) => {
          setSubmission(state);
          if (!state.pending && !state.error) onTabChange('chat');
        },
      }),
    [
      session,
      delta,
      running,
      streamSessionId,
      drafts,
      draftKey,
      snapshot,
      settings.hasApiKey,
      busy,
      dirty,
      submission.pending,
      onPrompt,
      onStop,
      onTabChange,
    ],
  );
  const runtime = useExternalStoreRuntime(adapter);
  const ownsRun = running && (!streamSessionId || streamSessionId === session?.id);

  useEffect(() => {
    runtime.thread.composer.setText(drafts.get(draftKey));
  }, [runtime, drafts, draftKey]);

  function setDraft(text: string) {
    drafts.set(draftKey, text);
    runtime.thread.composer.setText(text);
    setSubmission((previous) => ({ ...previous, error: undefined }));
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Tabs
        className="agent-tabs-root"
        value={tab}
        onValueChange={(value) => onTabChange(value as ChatTab)}
      >
        <TabsList className="agent-tabs" aria-label="Agent 工作区">
          <TabsTrigger value="chat">对话</TabsTrigger>
          <TabsTrigger value="reviews">
            审阅{pendingCount > 0 && <b className="agent-tab-count">{pendingCount}</b>}
          </TabsTrigger>
          <TabsTrigger value="recipes">工作流</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="agent-tab-content" forceMount hidden={tab !== 'chat'}>
          <ThreadPrimitive.Root className="chat-thread">
            <div className="session-bar">
              <select
                aria-label="选择对话"
                value={session?.id ?? ''}
                onChange={(event) => onSession(event.target.value)}
                disabled={!snapshot || running || submission.pending}
              >
                {!snapshot?.sessions.length && <option value="">新对话</option>}
                {snapshot?.sessions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <IconButton
                label="新建对话"
                disabled={!snapshot || running || busy || submission.pending}
                onClick={onNewSession}
              >
                <MessageSquarePlus size={17} />
              </IconButton>
            </div>
            {pendingCount > 0 && (
              <button className="agent-approval-cue" onClick={() => onTabChange('reviews')}>
                <CheckCircle2 size={16} />
                <span>
                  <strong>{pendingCount} 个方案待你审阅</strong>
                  <small>确认后继续生成或编辑</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            )}
            <div className="chat-feed-wrapper">
              <ThreadPrimitive.Viewport
                className="chat-feed"
                autoScroll
                scrollToBottomOnRunStart={false}
                scrollToBottomOnThreadSwitch={false}
                aria-label="对话记录"
                aria-busy={ownsRun}
                data-testid="agent-feed"
              >
                <ThreadPrimitive.Empty>
                  <ChatWelcome
                    disabled={!snapshot || running}
                    hasSequence={!!props.selectedSequence}
                    onSuggestion={setDraft}
                  />
                </ThreadPrimitive.Empty>
                <ThreadPrimitive.Messages components={{ Message: ChatMessage }} />
                {ownsRun && (
                  <div className="agent-run-card" role="status">
                    <LoaderCircle size={16} className="spin" />
                    <div>
                      <strong>Agent 正在执行</strong>
                      <span>{status || '正在理解你的需求…'}</span>
                    </div>
                  </div>
                )}
                <ProjectJobs snapshot={snapshot} />
              </ThreadPrimitive.Viewport>
              <ThreadPrimitive.ScrollToBottom
                className="chat-scroll-bottom"
                aria-label="回到最新消息"
                behavior="instant"
              >
                <ArrowDown size={15} />
                <span>最新消息</span>
              </ThreadPrimitive.ScrollToBottom>
            </div>
          </ThreadPrimitive.Root>
        </TabsContent>
        <TabsContent value="reviews" className="agent-tab-content">
          <div className="review-list">
            {!snapshot?.reviews.length && (
              <Empty icon={<Check size={24} />} title="这里等待你的决定">
                生成预算、剪辑方案与记忆建议会在这里审阅。
              </Empty>
            )}
            {[...(snapshot?.reviews ?? [])].reverse().map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                disabled={busy}
                acceptDisabled={dirty}
                onDecide={(decision) => onReview(review.id, decision)}
              />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="recipes" className="agent-tab-content">
          <div className="recipe-scroll">
            <RecipeList
              recipes={snapshot?.recipes ?? []}
              jobs={snapshot?.jobs ?? []}
              dirty={dirty}
              busy={busy || running}
              onResume={onResume}
              onRedo={onRedo}
              onExport={onExportRecipe}
              onResult={onRecipeResult}
              onInput={onRecipeInput}
            />
          </div>
        </TabsContent>
      </Tabs>
      <ChatComposer {...props} submission={submission} onDraft={setDraft} />
    </AssistantRuntimeProvider>
  );
}

function ChatWelcome({
  disabled,
  hasSequence,
  onSuggestion,
}: {
  disabled: boolean;
  hasSequence: boolean;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="chat-empty">
      <div className="agent-orbit">
        <Aperture size={28} />
      </div>
      <h3>从一个想法开始</h3>
      <p>一起规划镜头、整理素材，或让当前作品更完整。生成与剪辑方案由你确认。</p>
      <div className="chat-suggestions">
        <button
          disabled={disabled}
          onClick={() =>
            onSuggestion('请帮我设计一个 15 秒的视频创作方案，先给出镜头脚本，等待我确认后再生成。')
          }
        >
          <span>规划一个短片</span>
          <ArrowUpRight size={15} />
        </button>
        <button
          disabled={disabled}
          onClick={() => onSuggestion('请分析当前工程的素材，并提出剪辑建议。先不要修改作品。')}
        >
          <span>整理素材与故事线</span>
          <ArrowUpRight size={15} />
        </button>
        <button
          disabled={disabled || !hasSequence}
          onClick={() => onSuggestion('请检查当前选中作品的节奏和字幕，提出可审阅的编辑方案。')}
        >
          <span>优化选中作品</span>
          <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  );
}

function ChatMessage() {
  const message = useAuiState((state) => state.message);
  const metadata = message.metadata.custom;
  const role = metadata.hostRole === 'tool' ? 'tool' : message.role;
  const author =
    typeof metadata.author === 'string'
      ? metadata.author
      : role === 'user'
        ? '你'
        : role === 'tool'
          ? '工具'
          : 'Reelbeam';
  const streaming = message.status?.type === 'running';
  return (
    <MessagePrimitive.Root className={`chat-message ${role}`} data-message-id={message.id}>
      <div className="message-meta message-author">
        <span className="message-author-name">
          {role === 'tool' && <Wrench size={13} />}
          {author}
        </span>
        {streaming ? (
          <LoaderCircle size={13} className="spin" aria-label="正在回复" />
        ) : (
          <time dateTime={message.createdAt.toISOString()}>
            {message.createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
      </div>
      <MessagePrimitive.Parts components={{ Text: MarkdownPart }} />
    </MessagePrimitive.Root>
  );
}

function MarkdownPart({ text }: TextMessagePartProps) {
  return <ChatMarkdown text={text} />;
}

function ChatComposer({
  snapshot,
  settings,
  selectedAsset,
  selectedSequence,
  selectedClip,
  dirty,
  running,
  onSetup,
  onStop,
  submission,
  onDraft,
}: ChatSessionProps & {
  submission: { pending: boolean; error?: string };
  onDraft: (text: string) => void;
}) {
  const composing = useRef(false);
  const canSend = useAuiState((state) => state.composer.canSend);
  const sequence = snapshot?.sequences.find((item) => item.id === selectedSequence);
  return (
    <div className="chat-compose-area">
      {(selectedAsset || sequence) && (
        <div className="agent-contexts" aria-label="Agent 当前上下文">
          {selectedAsset && (
            <span className="chat-context" title={selectedAsset}>
              <Film size={14} />
              <span>素材 · {selectedAsset}</span>
            </span>
          )}
          {sequence && (
            <span className="chat-context" title={sequence.name}>
              <Layers3 size={14} />
              <span>
                {sequence.name}
                {selectedClip ? ' · 已选片段' : ''}
              </span>
            </span>
          )}
        </div>
      )}
      {dirty && <p className="chat-draft-notice">先保存或放弃时间线草稿，再发送指令或采纳方案。</p>}
      {!settings.hasApiKey && (
        <button className="setup-reminder" onClick={onSetup}>
          <CircleHelp size={16} />
          <span>连接模型后开始创作</span>
          <span>
            配置 <ArrowUpRight size={13} />
          </span>
        </button>
      )}
      {submission.error && (
        <p className="chat-submit-error" role="alert">
          {submission.error}
        </p>
      )}
      <ComposerPrimitive.Root className={`chat-compose ${running ? 'running' : ''}`}>
        <ComposerPrimitive.Input
          aria-label="给 Agent 的创作指令"
          placeholder={!snapshot ? '先创建或打开一个工程…' : '描述想法，或对选中的内容提出要求…'}
          minRows={2}
          maxRows={6}
          maxLength={15000}
          submitMode="none"
          cancelOnEscape={false}
          unstable_focusOnRunStart={false}
          unstable_focusOnThreadSwitched={false}
          unstable_focusOnScrollToBottom={false}
          addAttachmentOnPaste={false}
          onChange={(event) => onDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (!isChatSubmitKey(event.nativeEvent, composing.current)) return;
            event.preventDefault();
            if (canSend) event.currentTarget.closest('form')?.requestSubmit();
          }}
          data-testid="agent-prompt"
        />
        <div className="compose-footer">
          <span title={settings.agentModel}>{settings.agentModel || '尚未连接模型'}</span>
          {running ? (
            <IconButton label="停止 Agent" onClick={onStop}>
              <Square size={15} />
            </IconButton>
          ) : (
            <ComposerPrimitive.Send
              className="send-button"
              aria-label="发送创作指令"
              data-testid="agent-send"
            >
              {submission.pending ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ArrowUp size={18} />
              )}
            </ComposerPrimitive.Send>
          )}
        </div>
      </ComposerPrimitive.Root>
      <p className="chat-footnote">Enter 发送 · Shift + Enter 换行</p>
      {running && <p className="chat-footnote">停止 Agent 不会取消已提交的生成任务。</p>}
    </div>
  );
}

function ProjectJobs({ snapshot }: { snapshot: ProjectSnapshot | null }) {
  const jobs =
    snapshot?.jobs
      .filter((job) => job.kind === 'seedance' || job.kind === 'export')
      .slice(-2)
      .reverse() ?? [];
  if (!jobs.length) return null;
  return (
    <section className="agent-project-jobs" aria-label="最近工程任务">
      <div className="agent-job-section-heading">
        <Clock3 size={14} />
        <span>最近工程任务</span>
      </div>
      {jobs.map((job) => (
        <ProjectJob key={job.id} job={job} snapshot={snapshot!} />
      ))}
    </section>
  );
}

function ProjectJob({ job, snapshot }: { job: Job; snapshot: ProjectSnapshot }) {
  const progressing = ['queued', 'submitting', 'running', 'reconciling', 'finalizing'].includes(
    job.status,
  );
  const progress = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
  const output = snapshot.assets.find((asset) => asset.id === job.outputAssetId);
  return (
    <article className={`agent-job-card ${job.status}`}>
      <div className="agent-job-heading">
        <strong>{job.title}</strong>
        <span className={`agent-job-status ${job.status}`}>{jobLabels[job.status]}</span>
      </div>
      <p>
        {job.kind === 'seedance' ? 'Seedance 生成' : '视频导出'}
        {job.estimatedCost !== undefined && ` · 确认预算 ¥${job.estimatedCost.toFixed(2)}`}
      </p>
      {progressing && (
        <progress
          className="agent-job-progress"
          aria-label={`${job.title}进度`}
          max={100}
          value={job.kind === 'seedance' && job.status === 'running' ? undefined : progress}
        />
      )}
      {job.status === 'unknown' && <p>云端状态待确认，可在任务记录中查询。</p>}
      {job.cancelRequested && job.status !== 'cancelled' && <p>已请求取消，等待最终状态确认。</p>}
      {job.error && <p className="error-message">{job.error}</p>}
      {job.status === 'succeeded' && (
        <p className="agent-job-result">
          <CheckCircle2 size={14} />
          {output
            ? `已保存素材 · ${output.name}`
            : job.outputPath
              ? '输出已保存，可在任务记录中查看'
              : '任务已完成'}
        </p>
      )}
    </article>
  );
}

const commandNames: Record<string, string> = {
  addTrack: '添加轨道',
  updateTrack: '更新轨道',
  removeTrack: '删除轨道',
  addClip: '添加片段',
  updateClip: '调整片段',
  removeClip: '删除片段',
  splitClip: '分割片段',
  replaceClip: '替换素材',
  upsertCaption: '保存字幕',
  removeCaption: '删除字幕',
  sequenceSettings: '更新作品设置',
};

function ReviewCard({
  review,
  disabled,
  acceptDisabled,
  onDecide,
}: {
  review: Review;
  disabled: boolean;
  acceptDisabled: boolean;
  onDecide: (decision: 'accept' | 'reject') => void;
}) {
  return (
    <article className={`review-card ${review.status}`}>
      <div className="row-heading">
        <span className="badge">
          {review.kind === 'generation'
            ? 'Seedance 生成'
            : review.kind === 'memory'
              ? '记忆建议'
              : '剪辑方案'}
        </span>
        <span className="review-status">
          {{ pending: '待审阅', accepted: '已采纳', rejected: '已拒绝' }[review.status]}
        </span>
      </div>
      <h3>{review.title}</h3>
      <p>{review.description}</p>
      {review.generation && (
        <div className="review-generation">
          <p>{review.generation.prompt}</p>
          <span>
            {review.generation.duration} 秒 · {review.generation.ratio} · 确认预算 ¥
            {review.generation.estimatedCost.toFixed(2)}
          </span>
        </div>
      )}
      {review.memory && (
        <div className="review-generation">
          <p>{review.memory.content}</p>
          <span>{review.memory.scope === 'project' ? '只用于当前工程' : '用于你的所有工程'}</span>
        </div>
      )}
      {review.commands && (
        <ul className="command-summary">
          {review.commands.map((command, index) => (
            <li key={index}>
              <span>{commandNames[command.type]}</span>
              {command.type === 'upsertCaption' && <em>{command.caption.text}</em>}
              {command.type === 'sequenceSettings' && command.patch.name && (
                <em>{command.patch.name}</em>
              )}
            </li>
          ))}
        </ul>
      )}
      {review.expectedRevision !== undefined && (
        <p className="field-hint">针对作品修订 {review.expectedRevision}，采纳时再次校验版本。</p>
      )}
      {review.status === 'pending' && (
        <div className="review-actions">
          <Button disabled={disabled} onClick={() => onDecide('reject')}>
            <X size={14} />
            拒绝
          </Button>
          <Button
            kind="accent"
            disabled={disabled || acceptDisabled}
            title={acceptDisabled ? '先保存或放弃时间线草稿' : undefined}
            onClick={() => onDecide('accept')}
          >
            <Check size={14} />
            {review.kind === 'generation'
              ? '确认预算并生成'
              : review.kind === 'memory'
                ? '确认保存记忆'
                : '采纳方案'}
          </Button>
        </div>
      )}
    </article>
  );
}
