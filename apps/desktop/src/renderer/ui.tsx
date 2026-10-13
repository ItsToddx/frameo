import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const uid = () => crypto.randomUUID();
export const mediaUrl = (path: string) => `reelbeam-media://local/${encodeURIComponent(path)}`;
export const seconds = (frames: number, fps: number) => frames / fps;
export function timecode(value: number) {const s = Math.max(0, value); return `${Math.floor(s / 60).toString().padStart(2,'0')}:${Math.floor(s % 60).toString().padStart(2,'0')}.${Math.floor((s % 1) * 100).toString().padStart(2,'0')}`;}
export function Button({children, title, onClick, disabled, kind = '', testId, type = 'button'}: {children: ReactNode; title?: string; onClick?: () => void; disabled?: boolean; kind?: string; testId?: string; type?: 'button'|'submit'}) {
  return <button type={type} className={`button ${kind}`} title={title} aria-label={title} onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>;
}
export function IconButton({children, label, onClick, disabled, active}: {children: ReactNode; label: string; onClick?: () => void; disabled?: boolean; active?: boolean}) {
  return <button type="button" className={`icon-button${active?' active':''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({title, description, children, onClose, wide}: {title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') || []);
        const first = all[0], last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {e.preventDefault(); last?.focus();}
        if (!e.shiftKey && document.activeElement === last) {e.preventDefault(); first?.focus();}
      }
    };
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('keydown',key); prior?.focus();};
  },[onClose]);
  return <div className="modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget) onClose();}}><div ref={ref} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><IconButton label="关闭窗口" onClick={onClose}><X size={18}/></IconButton></div>{children}</div></div>;
}
export function Empty({icon, title, children}: {icon?: ReactNode; title: string; children?: ReactNode}) {return <div className="empty-state">{icon}<strong>{title}</strong>{children&&<p>{children}</p>}</div>;}
export const jobLabels: Record<string,string> = {queued:'等待执行',submitting:'提交云端',running:'执行中',unknown:'状态待确认',reconciling:'查询云端状态',finalizing:'保存素材',succeeded:'已完成',failed:'失败',cancelled:'已取消'};
export const roleLabels: Record<string,string> = {creative:'创意',visual:'视觉',editor:'剪辑'};
