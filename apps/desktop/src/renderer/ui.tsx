import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n, normalizeLocale } from './i18n';
import type { MessageKey } from '../localization';
import { StudioButton } from './components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './components/ui/dialog';
import { Tooltip } from './components/ui/tooltip';

export const uid = () => crypto.randomUUID();
export const mediaUrl = (path: string) => `frameo-media://local/${encodeURIComponent(path)}`;
export const seconds = (frames: number, fps: number) => frames / fps;
export function timecode(value: number) {
  const s = Math.max(0, value);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}.${Math.floor((s % 1) * 100)
    .toString()
    .padStart(2, '0')}`;
}
export function Button({
  children,
  title,
  onClick,
  disabled,
  kind = '',
  testId,
  type = 'button',
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  kind?: string;
  testId?: string;
  type?: 'button' | 'submit';
}) {
  const variant =
    kind === 'accent'
      ? 'default'
      : kind === 'danger'
        ? 'destructive'
        : kind === 'ghost'
          ? 'ghost'
          : 'outline';
  return (
    <StudioButton
      type={type}
      variant={variant}
      className={`button ${kind}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {children}
    </StudioButton>
  );
}
export function IconButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <StudioButton
        size="icon"
        variant="ghost"
        className={`icon-button${active ? ' active' : ''}`}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </StudioButton>
    </Tooltip>
  );
}
export function LanguagePicker({ disabled = false }: { disabled?: boolean }) {
  const { t, locale, setLocale, hostText } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <span className="language-picker">
      <select
        className="language-select"
        aria-label={t('language.label')}
        data-testid="language-select"
        value={locale}
        disabled={disabled || saving}
        onChange={async (event) => {
          const next = normalizeLocale(event.target.value);
          setSaving(true);
          setError('');
          try {
            await window.frameo.setLanguage(next);
            setLocale(next);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          } finally {
            setSaving(false);
          }
        }}
      >
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
      {error && <span role="alert">{hostText(error)}</span>}
    </span>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={wide ? 'wide' : undefined}
        aria-label={title}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current?.isConnected) previousFocus.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          const element = event.currentTarget as HTMLElement;
          const field = element.querySelector<HTMLElement>(
            'input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
          );
          if (field) {
            event.preventDefault();
            field.focus();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <DialogTitle asChild>
              <h2>{title}</h2>
            </DialogTitle>
            {description ? (
              <DialogDescription asChild>
                <p>{description}</p>
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{title}</DialogDescription>
            )}
          </div>
          <LanguagePicker disabled={busy} />
          <IconButton label={t('dialog.close')} disabled={busy} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export const jobLabels: Record<string, MessageKey> = {
  queued: 'job.queued',
  submitting: 'job.submitting',
  running: 'job.running',
  unknown: 'job.unknown',
  reconciling: 'job.reconciling',
  finalizing: 'job.finalizing',
  succeeded: 'job.succeeded',
  failed: 'job.failed',
  cancelled: 'job.cancelled',
};
export const roleLabels: Record<string, MessageKey> = {
  creative: 'role.creative',
  visual: 'role.visual',
  editor: 'role.editor',
};
