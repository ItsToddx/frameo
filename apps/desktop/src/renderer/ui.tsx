import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
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
          <IconButton label="关闭窗口" disabled={busy} onClick={onClose}>
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
export const jobLabels: Record<string, string> = {
  queued: '等待执行',
  submitting: '提交云端',
  running: '执行中',
  unknown: '状态待确认',
  reconciling: '查询云端状态',
  finalizing: '保存素材',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
export const roleLabels: Record<string, string> = {
  creative: '创意',
  visual: '视觉',
  editor: '剪辑',
};
