import { z } from 'zod';
import type { AppEvent, Job, ProjectSnapshot } from '../adapters/contracts/api';
import { hostText, localizeHostText } from './host-text';
import type { Locale } from './types';

function validationMessage(issue: z.core.$ZodIssue, locale: Locale): string {
  switch (issue.code) {
    case 'invalid_type':
      return hostText(locale, 'validation.type', { type: issue.expected });
    case 'too_small':
      return hostText(locale, 'validation.minimum', { minimum: String(issue.minimum) });
    case 'too_big':
      return hostText(locale, 'validation.maximum', { maximum: String(issue.maximum) });
    case 'invalid_value':
      return hostText(locale, 'validation.value');
    case 'invalid_format':
      return hostText(locale, 'validation.format', { format: issue.format });
    case 'unrecognized_keys':
      return hostText(locale, 'validation.fields', { fields: issue.keys.join(', ') });
    case 'custom':
      return localizeHostText(issue.message, locale);
    default:
      return hostText(locale, 'validation.invalid');
  }
}
export function hostErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof z.ZodError) {
    const details = error.issues
      .slice(0, 3)
      .map((issue) =>
        [issue.path.join('.'), validationMessage(issue, locale)].filter(Boolean).join(': '),
      )
      .join(locale === 'zh-CN' ? '；' : '; ');
    return hostText(locale, 'error.invalidParameters', { details });
  }
  return error instanceof Error
    ? localizeHostText(error.message, locale)
    : hostText(locale, 'error.failed');
}

function presentJob(job: Job, locale: Locale): Job {
  return job.error ? { ...job, error: localizeHostText(job.error, locale) } : job;
}

/** This is a projection only: stored content, receipts, definitions and hashes are never rewritten. */
export function presentHostSnapshot(snapshot: ProjectSnapshot, locale: Locale): ProjectSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => presentJob(job, locale)),
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) =>
        message.role === 'tool'
          ? { ...message, text: localizeHostText(message.text, locale) }
          : message,
      ),
    })),
    recipes: snapshot.recipes.map((recipe) => ({
      ...recipe,
      steps: recipe.steps.map((step) => ({
        ...step,
        ...(step.error ? { error: localizeHostText(step.error, locale) } : {}),
        ...(step.history
          ? {
              history: step.history.map((attempt) =>
                attempt.error
                  ? { ...attempt, error: localizeHostText(attempt.error, locale) }
                  : attempt,
              ),
            }
          : {}),
      })),
    })),
  };
}

export function presentHostEvent(event: AppEvent, locale: Locale): AppEvent {
  return {
    ...event,
    ...(event.snapshot ? { snapshot: presentHostSnapshot(event.snapshot, locale) } : {}),
    ...(event.text && (event.type === 'error' || event.type === 'agent.status')
      ? { text: localizeHostText(event.text, locale) }
      : {}),
  };
}

export function presentHostResult<T>(result: T, locale: Locale): T {
  if (!result || typeof result !== 'object') return result;
  if ('sequences' in result && 'sessions' in result && 'recipes' in result)
    return presentHostSnapshot(result as unknown as ProjectSnapshot, locale) as T;
  if ('settings' in result && 'project' in result)
    return {
      ...result,
      project: result.project
        ? presentHostSnapshot(result.project as ProjectSnapshot, locale)
        : null,
    };
  if ('kind' in result && 'input' in result && 'createdAt' in result)
    return presentJob(result as unknown as Job, locale) as T;
  return result;
}
