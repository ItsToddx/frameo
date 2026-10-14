import {
  MessageNotSentError,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { Session } from '../adapters/contracts/api';

export const CHAT_SUBMISSION_FAILURE =
  'Message was not sent. Your draft is kept. Check model settings and project state, then retry.';

export interface ChatProjection {
  session?: Session;
  delta: string;
  running: boolean;
  streamSessionId?: string | null;
}

export function isChatSubmitKey(
  event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number },
  composing: boolean,
): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !composing
  );
}

/** UI drafts are scoped by project and session, independently of persisted history. */
export class ChatDrafts {
  private readonly drafts = new Map<string, { text: string; pending: boolean }>();

  private entry(key: string) {
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { text: '', pending: false };
      this.drafts.set(key, draft);
    }
    return draft;
  }

  get(key: string): string {
    return this.drafts.get(key)?.text ?? '';
  }

  set(key: string, text: string): void {
    this.entry(key).text = text;
  }

  isSubmitting(key: string): boolean {
    return this.drafts.get(key)?.pending ?? false;
  }

  adopt(previousKey: string, sessionKey: string): void {
    const draft = this.drafts.get(previousKey);
    if (!draft || this.get(sessionKey)) return;
    this.drafts.set(sessionKey, draft);
    this.drafts.delete(previousKey);
  }

  async submit(key: string, onPrompt: (text: string) => Promise<boolean>): Promise<boolean> {
    const entry = this.entry(key);
    const draft = entry.text;
    if (!draft.trim() || entry.pending) return false;
    entry.pending = true;
    try {
      const sent = await onPrompt(draft.trim());
      if (sent && entry.text === draft) entry.text = '';
      return sent;
    } finally {
      entry.pending = false;
    }
  }
}

/** The runtime receives a view of host history; it never writes its own messages. */
export function projectSessionMessages({
  session,
  delta,
  running,
  streamSessionId,
}: ChatProjection): ThreadMessageLike[] {
  const messages: ThreadMessageLike[] = (session?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === 'tool' ? 'assistant' : message.role,
    content: [{ type: 'text', text: message.text }],
    createdAt: new Date(message.createdAt),
    status: message.role === 'user' ? undefined : { type: 'complete', reason: 'stop' },
    metadata: { custom: { hostRole: message.role, author: message.agent } },
  }));
  const lastMessage = session?.messages.at(-1);
  const persistedStream = lastMessage?.role === 'assistant' && lastMessage.text === delta;
  if (
    session &&
    delta &&
    running &&
    !persistedStream &&
    (!streamSessionId || streamSessionId === session.id)
  ) {
    messages.push({
      id: `stream:${session.id}`,
      role: 'assistant',
      content: [{ type: 'text', text: delta }],
      status: { type: 'running' },
      metadata: { custom: { hostRole: 'assistant', streaming: true } },
    });
  }
  return messages;
}

export interface ChatAdapterInput extends ChatProjection {
  drafts: ChatDrafts;
  draftKey: string;
  disabled: boolean;
  sendDisabled: boolean;
  onPrompt: (text: string) => Promise<boolean>;
  onStop: () => void;
  onSubmission?: (state: { pending: boolean; error?: string }) => void;
}

export function createChatAdapter(
  input: ChatAdapterInput,
): ExternalStoreAdapter<ThreadMessageLike> {
  const ownsRun =
    input.running && (!input.streamSessionId || input.streamSessionId === input.session?.id);
  return {
    messages: projectSessionMessages(input),
    convertMessage: (message) => message,
    isRunning: ownsRun,
    isDisabled: input.disabled,
    isSendDisabled: input.sendDisabled || input.running,
    unstable_persistsHistory: true,
    onNew: async (message) => {
      if (
        input.disabled ||
        input.sendDisabled ||
        input.running ||
        input.drafts.isSubmitting(input.draftKey)
      ) {
        throw new MessageNotSentError();
      }
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      input.drafts.set(input.draftKey, text);
      input.onSubmission?.({ pending: true });
      try {
        if (!(await input.drafts.submit(input.draftKey, input.onPrompt))) {
          throw new MessageNotSentError(CHAT_SUBMISSION_FAILURE);
        }
        input.onSubmission?.({ pending: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : CHAT_SUBMISSION_FAILURE;
        input.onSubmission?.({ pending: false, error: message });
        throw new MessageNotSentError(message);
      }
    },
    onCancel: async () => {
      input.onStop();
    },
  };
}
