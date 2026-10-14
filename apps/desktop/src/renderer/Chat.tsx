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
import type {
  EditCommand,
  Job,
  ProjectSnapshot,
  Review,
  Session,
  Settings,
} from '../adapters/contracts/api';
import { Button, Empty, IconButton } from './ui';
import { useI18n } from './i18n';
import type { MessageKey } from '../localization';
import { RecipeList, type RecipeResultInput, type RecipeInputReview } from './Panels';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import {
  CHAT_SUBMISSION_FAILURE,
  ChatDrafts,
  createChatAdapter,
  isChatSubmitKey,
} from './chat-adapter';
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
  const { t } = useI18n();
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
    <aside className="agent-panel" data-testid="agent-panel" aria-label={t('chat.title')}>
      <header className="agent-header">
        <div className="agent-title">
          <span className="agent-mark">
            <Aperture size={18} />
          </span>
          <div>
            <strong>{t('chat.title')}</strong>
            <span>{t('chat.subtitle')}</span>
          </div>
        </div>
        <span className={`agent-header-state ${running ? 'running' : ''}`}>
          <span className="status-dot" />
          {running
            ? t('chat.running')
            : !props.settings.hasApiKey
              ? t('chat.disconnected')
              : !snapshot
                ? t('chat.noProject')
                : t('chat.ready')}
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
  const { t, hostText } = useI18n();
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
        <TabsList className="agent-tabs" aria-label={t('chat.workspace')}>
          <TabsTrigger value="chat">{t('chat.tab')}</TabsTrigger>
          <TabsTrigger value="reviews">
            {t('chat.reviews')}
            {pendingCount > 0 && <b className="agent-tab-count">{pendingCount}</b>}
          </TabsTrigger>
          <TabsTrigger value="recipes">{t('chat.recipes')}</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="agent-tab-content" forceMount hidden={tab !== 'chat'}>
          <ThreadPrimitive.Root className="chat-thread">
            <div className="session-bar">
              <select
                aria-label={t('chat.chooseSession')}
                value={session?.id ?? ''}
                onChange={(event) => onSession(event.target.value)}
                disabled={!snapshot || running || submission.pending}
              >
                {!snapshot?.sessions.length && <option value="">{t('chat.newSession')}</option>}
                {snapshot?.sessions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <IconButton
                label={t('chat.createSession')}
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
                  <strong>{t('chat.reviewCount', { count: pendingCount })}</strong>
                  <small>{t('chat.reviewContinue')}</small>
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
                aria-label={t('chat.history')}
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
                      <strong>{t('chat.executing')}</strong>
                      <span>{status ? hostText(status) : t('chat.understanding')}</span>
                    </div>
                  </div>
                )}
                <ProjectJobs snapshot={snapshot} />
              </ThreadPrimitive.Viewport>
              <ThreadPrimitive.ScrollToBottom
                className="chat-scroll-bottom"
                aria-label={t('chat.scrollLatest')}
                behavior="instant"
              >
                <ArrowDown size={15} />
                <span>{t('chat.latest')}</span>
              </ThreadPrimitive.ScrollToBottom>
            </div>
          </ThreadPrimitive.Root>
        </TabsContent>
        <TabsContent value="reviews" className="agent-tab-content">
          <div className="review-list">
            {!snapshot?.reviews.length && (
              <Empty icon={<Check size={24} />} title={t('chat.reviewEmpty')}>
                {t('chat.reviewEmptyBody')}
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
  const { t } = useI18n();
  return (
    <div className="chat-empty">
      <div className="agent-orbit">
        <Aperture size={28} />
      </div>
      <h3>{t('chat.welcome')}</h3>
      <p>{t('chat.welcomeBody')}</p>
      <div className="chat-suggestions">
        <button disabled={disabled} onClick={() => onSuggestion(t('chat.planPrompt'))}>
          <span>{t('chat.planSuggestion')}</span>
          <ArrowUpRight size={15} />
        </button>
        <button disabled={disabled} onClick={() => onSuggestion(t('chat.organizePrompt'))}>
          <span>{t('chat.organizeSuggestion')}</span>
          <ArrowUpRight size={15} />
        </button>
        <button
          disabled={disabled || !hasSequence}
          onClick={() => onSuggestion(t('chat.refinePrompt'))}
        >
          <span>{t('chat.refineSuggestion')}</span>
          <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  );
}

function ChatMessage() {
  const { t, date } = useI18n();
  const message = useAuiState((state) => state.message);
  const metadata = message.metadata.custom;
  const role = metadata.hostRole === 'tool' ? 'tool' : message.role;
  const author =
    typeof metadata.author === 'string'
      ? metadata.author
      : role === 'user'
        ? t('chat.you')
        : role === 'tool'
          ? t('chat.tool')
          : 'Frameo';
  const streaming = message.status?.type === 'running';
  return (
    <MessagePrimitive.Root className={`chat-message ${role}`} data-message-id={message.id}>
      <div className="message-meta message-author">
        <span className="message-author-name">
          {role === 'tool' && <Wrench size={13} />}
          {author}
        </span>
        {streaming ? (
          <LoaderCircle size={13} className="spin" aria-label={t('chat.replying')} />
        ) : (
          <time dateTime={message.createdAt.toISOString()}>
            {date(message.createdAt, { hour: '2-digit', minute: '2-digit' })}
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
  const { t, hostText } = useI18n();
  const composing = useRef(false);
  const canSend = useAuiState((state) => state.composer.canSend);
  const sequence = snapshot?.sequences.find((item) => item.id === selectedSequence);
  return (
    <div className="chat-compose-area">
      {(selectedAsset || sequence) && (
        <div className="agent-contexts" aria-label={t('chat.context')}>
          {selectedAsset && (
            <span className="chat-context" title={selectedAsset}>
              <Film size={14} />
              <span>{t('chat.assetContext', { asset: selectedAsset })}</span>
            </span>
          )}
          {sequence && (
            <span className="chat-context" title={sequence.name}>
              <Layers3 size={14} />
              <span>
                {sequence.name}
                {selectedClip ? t('chat.selectedClip') : ''}
              </span>
            </span>
          )}
        </div>
      )}
      {dirty && <p className="chat-draft-notice">{t('chat.draftNotice')}</p>}
      {!settings.hasApiKey && (
        <button className="setup-reminder" onClick={onSetup}>
          <CircleHelp size={16} />
          <span>{t('chat.connect')}</span>
          <span>
            {t('chat.setup')} <ArrowUpRight size={13} />
          </span>
        </button>
      )}
      {submission.error && (
        <p className="chat-submit-error" role="alert">
          {submission.error === CHAT_SUBMISSION_FAILURE
            ? t('chat.submitFailed')
            : hostText(submission.error)}
        </p>
      )}
      <ComposerPrimitive.Root className={`chat-compose ${running ? 'running' : ''}`}>
        <ComposerPrimitive.Input
          aria-label={t('chat.promptLabel')}
          placeholder={!snapshot ? t('chat.promptNoProject') : t('chat.promptPlaceholder')}
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
          <span title={settings.agentModel}>{settings.agentModel || t('chat.noModel')}</span>
          {running ? (
            <IconButton label={t('chat.stop')} onClick={onStop}>
              <Square size={15} />
            </IconButton>
          ) : (
            <ComposerPrimitive.Send
              className="send-button"
              aria-label={t('chat.send')}
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
      <p className="chat-footnote">{t('chat.keyboardHelp')}</p>
      {running && <p className="chat-footnote">{t('chat.stopHelp')}</p>}
    </div>
  );
}

function ProjectJobs({ snapshot }: { snapshot: ProjectSnapshot | null }) {
  const { t } = useI18n();
  const jobs =
    snapshot?.jobs
      .filter((job) => job.kind === 'seedance' || job.kind === 'export')
      .slice(-2)
      .reverse() ?? [];
  if (!jobs.length) return null;
  return (
    <section className="agent-project-jobs" aria-label={t('chat.recentJobs')}>
      <div className="agent-job-section-heading">
        <Clock3 size={14} />
        <span>{t('chat.recentJobs')}</span>
      </div>
      {jobs.map((job) => (
        <ProjectJob key={job.id} job={job} snapshot={snapshot!} />
      ))}
    </section>
  );
}

function ProjectJob({ job, snapshot }: { job: Job; snapshot: ProjectSnapshot }) {
  const { t, hostText } = useI18n();
  const progressing = ['queued', 'submitting', 'running', 'reconciling', 'finalizing'].includes(
    job.status,
  );
  const progress = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
  const output = snapshot.assets.find((asset) => asset.id === job.outputAssetId);
  const title = job.kind === 'export' ? hostText(job.title) : job.title;
  return (
    <article className={`agent-job-card ${job.status}`}>
      <div className="agent-job-heading">
        <strong>{title}</strong>
        <span className={`agent-job-status ${job.status}`}>{t(`job.${job.status}`)}</span>
      </div>
      <p>
        {job.kind === 'seedance' ? t('chat.seedance') : t('chat.export')}
        {job.estimatedCost !== undefined &&
          t('chat.budget', { cost: job.estimatedCost.toFixed(2) })}
      </p>
      {progressing && (
        <progress
          className="agent-job-progress"
          aria-label={t('chat.jobProgress', { title })}
          max={100}
          value={job.kind === 'seedance' && job.status === 'running' ? undefined : progress}
        />
      )}
      {job.status === 'unknown' && <p>{t('chat.jobUnknown')}</p>}
      {job.cancelRequested && job.status !== 'cancelled' && <p>{t('chat.jobCancelRequested')}</p>}
      {job.error && <p className="error-message">{hostText(job.error)}</p>}
      {job.status === 'succeeded' && (
        <p className="agent-job-result">
          <CheckCircle2 size={14} />
          {output
            ? t('chat.assetSaved', { name: output.name })
            : job.outputPath
              ? t('chat.outputSaved')
              : t('chat.jobCompleted')}
        </p>
      )}
    </article>
  );
}

const commandNames = {
  addTrack: 'command.addTrack',
  updateTrack: 'command.updateTrack',
  removeTrack: 'command.removeTrack',
  addClip: 'command.addClip',
  updateClip: 'command.updateClip',
  removeClip: 'command.removeClip',
  splitClip: 'command.splitClip',
  replaceClip: 'command.replaceClip',
  upsertCaption: 'command.upsertCaption',
  removeCaption: 'command.removeCaption',
  sequenceSettings: 'command.sequenceSettings',
} as const satisfies Record<EditCommand['type'], MessageKey>;

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
  const { t } = useI18n();
  return (
    <article className={`review-card ${review.status}`}>
      <div className="row-heading">
        <span className="badge">
          {review.kind === 'generation'
            ? t('chat.seedance')
            : review.kind === 'memory'
              ? t('review.memory')
              : t('review.edit')}
        </span>
        <span className="review-status">{t(`review.${review.status}`)}</span>
      </div>
      <h3>{review.title}</h3>
      <p>{review.description}</p>
      {review.generation && (
        <div className="review-generation">
          <p>{review.generation.prompt}</p>
          <span>
            {t('review.generationSummary', {
              duration: review.generation.duration,
              ratio: review.generation.ratio,
              cost: review.generation.estimatedCost.toFixed(2),
            })}
          </span>
        </div>
      )}
      {review.memory && (
        <div className="review-generation">
          <p>{review.memory.content}</p>
          <span>
            {review.memory.scope === 'project' ? t('review.projectMemory') : t('review.userMemory')}
          </span>
        </div>
      )}
      {review.commands && (
        <ul className="command-summary">
          {review.commands.map((command, index) => (
            <li key={index}>
              <span>{t(commandNames[command.type])}</span>
              {command.type === 'upsertCaption' && <em>{command.caption.text}</em>}
              {command.type === 'sequenceSettings' && command.patch.name && (
                <em>{command.patch.name}</em>
              )}
            </li>
          ))}
        </ul>
      )}
      {review.expectedRevision !== undefined && (
        <p className="field-hint">{t('review.revision', { revision: review.expectedRevision })}</p>
      )}
      {review.status === 'pending' && (
        <div className="review-actions">
          <Button disabled={disabled} onClick={() => onDecide('reject')}>
            <X size={14} />
            {t('review.reject')}
          </Button>
          <Button
            kind="accent"
            disabled={disabled || acceptDisabled}
            title={acceptDisabled ? t('review.saveDraftFirst') : undefined}
            onClick={() => onDecide('accept')}
          >
            <Check size={14} />
            {review.kind === 'generation'
              ? t('review.generate')
              : review.kind === 'memory'
                ? t('review.saveMemory')
                : t('review.accept')}
          </Button>
        </div>
      )}
    </article>
  );
}
