import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen photo: the one place in the app where zoom works (see lib/no-zoom.ts).
 * Pinch or double-tap to zoom, drag to move a zoomed photo, wheel to zoom on desktop.
 * Close with the X, Escape, or the phone's Back button.
 */
export function PhotoViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [view, setView] = useState<View>(RESET);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Back button closes the viewer instead of leaving the page.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    history.pushState({ photoViewer: true }, '');
    const onPop = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') history.back(); };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, [onClose]);

  const close = () => history.back(); // pops our history entry, which calls onClose

  const clamp = (v: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
    if (scale === 1) return RESET;
    // Don't let the photo be dragged far off screen.
    const limX = (window.innerWidth * (scale - 1)) / 2;
    const limY = (window.innerHeight * (scale - 1)) / 2;
    return { scale, x: Math.min(limX, Math.max(-limX, v.x)), y: Math.min(limY, Math.max(-limY, v.y)) };
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function onPointerDown(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), scale: viewRef.current.scale };
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        if (viewRef.current.scale > 1) setView(RESET);
        else {
          // Zoom in towards where the member tapped.
          const cx = e.clientX - window.innerWidth / 2;
          const cy = e.clientY - window.innerHeight / 2;
          setView(clamp({ scale: DOUBLE_TAP_SCALE, x: -cx * (DOUBLE_TAP_SCALE - 1), y: -cy * (DOUBLE_TAP_SCALE - 1) }));
        }
      } else lastTap.current = now;
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const d = distance();
      if (pinch.current.dist > 0) setView((v) => clamp({ ...v, scale: pinch.current!.scale * (d / pinch.current!.dist) }));
    } else if (pointers.current.size === 1 && viewRef.current.scale > 1) {
      setView((v) => clamp({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" data-zoomable>
      <button ref={closeRef} type="button" className="photo-viewer-close" aria-label="Close photo" onClick={close}>
        <Icon name="close" />
      </button>
      <div className="photo-viewer-stage"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={(e) => setView((v) => clamp({ ...v, scale: v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15) }))}>
        <img src={src} alt={alt} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
    </div>
  );
}
