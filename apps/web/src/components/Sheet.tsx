import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Bottom sheet for menus and short forms (phone pattern). Escape or a tap on the backdrop closes it;
 * focus moves into the sheet and back to where it was afterwards. Never uses browser alert/confirm.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, textarea, input, [href]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus(); };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
