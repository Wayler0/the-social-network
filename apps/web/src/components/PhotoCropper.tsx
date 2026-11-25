import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';

/** Size of the square the cropped photo is saved at (the server re-encodes it and makes a 320 px thumbnail). */
const OUT = 800;
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number; turns: number };
const START: View = { zoom: 1, x: 0, y: 0, turns: 0 };

/**
 * Edit a photo before it becomes your profile picture: drag to position it in the circle, zoom
 * (slider, pinch or mouse wheel), rotate a quarter turn at a time. "Use photo" gives a square JPEG
 * of what is inside the frame; only that is uploaded, which is lighter on data.
 * Runs in the browser (canvas); nothing leaves the phone until "Use photo".
 */
export function PhotoCropper({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (cropped: File) => void }) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(START);
  const [size, setSize] = useState(320);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize(el.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onCancel]);

  // Width and height after rotating, and the scale at which the photo just covers the square.
  const sideways = view.turns % 2 === 1;
  const w = img ? (sideways ? img.naturalHeight : img.naturalWidth) : 1;
  const h = img ? (sideways ? img.naturalWidth : img.naturalHeight) : 1;
  const cover = size / Math.min(w, h);
  const scale = cover * view.zoom;

  /** Keeps the frame covered: the photo can't be dragged so far that a gap shows. */
  const clamp = (v: View): View => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    const s = cover * zoom;
    const limX = Math.max(0, (w * s - size) / 2);
    const limY = Math.max(0, (h * s - size) / 2);
    return { ...v, zoom, x: Math.min(limX, Math.max(-limX, v.x)), y: Math.min(limY, Math.max(-limY, v.y)) };
  };
  const update = (fn: (v: View) => View) => setView((v) => clamp(fn(v)));

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  function down(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: distance(), zoom: view.zoom };
  }
  function move(e: ReactPointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current && pinch.current.dist > 0) {
      const z = pinch.current.zoom * (distance() / pinch.current.dist);
      update((v) => ({ ...v, zoom: z }));
    } else if (pointers.current.size === 1) {
      update((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  }
  function up(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function save() {
    if (!img) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const k = OUT / size;   // from screen pixels to output pixels
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.translate(OUT / 2 + view.x * k, OUT / 2 + view.y * k);
    ctx.rotate((view.turns * Math.PI) / 2);
    ctx.scale(scale * k, scale * k);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    canvas.toBlob((blob) => {
      if (blob) onDone(new File([blob], 'profile.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label="Edit profile photo">
      <header className="cropper-bar">
        <button type="button" className="cropper-text-btn" onClick={onCancel}>Cancel</button>
        <h2>Edit photo</h2>
        <button type="button" className="cropper-text-btn strong" onClick={save} disabled={!img}>Use photo</button>
      </header>

      <div className="cropper-stage" ref={stageRef} data-zoomable
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={(e) => update((v) => ({ ...v, zoom: v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) }))}>
        <img src={src} alt="" draggable={false}
          onLoad={(e) => setImg(e.currentTarget)} onError={() => setFailed(true)}
          style={img ? {
            width: img.naturalWidth, height: img.naturalHeight,
            marginLeft: -img.naturalWidth / 2, marginTop: -img.naturalHeight / 2,
            transform: `translate(${view.x}px, ${view.y}px) rotate(${view.turns * 90}deg) scale(${scale})`,
          } : { opacity: 0 }} />
        <div className="cropper-mask" aria-hidden="true" />
        {failed && <p className="cropper-error" role="alert">This photo can’t be opened. Choose a JPEG, PNG or WebP photo.</p>}
      </div>

      <div className="cropper-tools">
        <label className="cropper-zoom">
          <Icon name="discover" size={18} aria-hidden="true" />
          <span className="visually-hidden">Zoom</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom}
            onChange={(e) => update((v) => ({ ...v, zoom: Number(e.target.value) }))} />
        </label>
        <div className="cropper-buttons">
          <button type="button" className="btn secondary small-btn"
            onClick={() => update((v) => ({ ...v, turns: (v.turns + 1) % 4, x: 0, y: 0 }))}>Rotate</button>
          <button type="button" className="btn secondary small-btn" onClick={() => setView(START)}>Reset</button>
        </div>
        <p className="hint">Drag to move. Pinch or use the slider to zoom.</p>
      </div>
    </div>
  );
}
