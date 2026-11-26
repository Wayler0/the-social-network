import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';

/** Width the edited photo is saved at (the server re-encodes to at most 1080 px wide and makes a thumbnail). */
const OUT_WIDTH = 1080;
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number; turns: number };
const START: View = { zoom: 1, x: 0, y: 0, turns: 0 };

/** A frame shape: width ÷ height, or `null` for the photo's own shape. */
export type Aspect = { label: string; ratio: number | null };

/** Ready-made frames. */
export const PROFILE_FRAME: Aspect[] = [{ label: 'Square', ratio: 1 }];
export const POST_FRAMES: Aspect[] = [
  { label: 'Original', ratio: null }, { label: 'Square', ratio: 1 },
  { label: 'Portrait', ratio: 4 / 5 }, { label: 'Landscape', ratio: 16 / 9 },
];
export const STORY_FRAME: Aspect[] = [{ label: 'Story', ratio: 9 / 16 }];

/**
 * Edit a photo before it is uploaded: drag to position it in the frame, zoom (slider, pinch or
 * mouse wheel), rotate a quarter turn at a time, and pick a frame shape when there is a choice.
 * Profile photos use a circle; posts can be original, square, portrait or landscape; stories are
 * tall (9:16). "Use photo" gives a JPEG of what is inside the frame; only that is uploaded, which is
 * lighter on data. Runs in the browser (canvas); nothing leaves the phone until "Use photo".
 */
export function PhotoCropper({ file, onCancel, onDone, frames = PROFILE_FRAME, circle = false, title = 'Edit photo' }: {
  file: File;
  onCancel: () => void;
  onDone: (edited: File) => void;
  frames?: Aspect[];
  /** Show the frame as a circle (profile photos); the saved photo is still square. */
  circle?: boolean;
  title?: string;
}) {
  // Made and released in the same effect, so React's mount/unmount/mount check can't leave it revoked.
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(START);
  const [frame, setFrame] = useState<Aspect>(frames[0]!);
  const [box, setBox] = useState({ w: 320, h: 420 });
  const areaRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    setImg(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
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

  // The photo's size after rotating, and the frame: as big as fits the space, in the chosen shape.
  const sideways = view.turns % 2 === 1;
  const w = img ? (sideways ? img.naturalHeight : img.naturalWidth) : 1;
  const h = img ? (sideways ? img.naturalWidth : img.naturalHeight) : 1;
  const ratio = frame.ratio ?? w / h;
  const frameW = Math.max(1, Math.min(box.w, box.h * ratio));
  const frameH = frameW / ratio;
  const cover = Math.max(frameW / w, frameH / h);   // smallest scale that fills the frame
  const scale = cover * view.zoom;

  /** Keeps the frame covered: the photo can't be dragged so far that a gap shows. */
  const clampWith = (v: View, c: number): View => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    const s = c * zoom;
    const limX = Math.max(0, (w * s - frameW) / 2);
    const limY = Math.max(0, (h * s - frameH) / 2);
    return { ...v, zoom, x: Math.min(limX, Math.max(-limX, v.x)), y: Math.min(limY, Math.max(-limY, v.y)) };
  };
  const update = (fn: (v: View) => View) => setView((v) => clampWith(fn(v), cover));

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
    // As wide as the photo's real detail inside the frame allows, at most OUT_WIDTH: never enlarged.
    const outW = Math.max(1, Math.min(OUT_WIDTH, Math.round(frameW / scale)));
    const outH = Math.round(outW / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const k = outW / frameW;   // from screen pixels to output pixels
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2 + view.x * k, outH / 2 + view.y * k);
    ctx.rotate((view.turns * Math.PI) / 2);
    ctx.scale(scale * k, scale * k);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    canvas.toBlob((blob) => {
      if (blob) onDone(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label={title}>
      <header className="cropper-bar">
        <button type="button" className="cropper-text-btn" onClick={onCancel}>Cancel</button>
        <h2>{title}</h2>
        <button type="button" className="cropper-text-btn strong" onClick={save} disabled={!img}>Use photo</button>
      </header>

      <div className="cropper-area" ref={areaRef}>
        <div className="cropper-stage" data-zoomable style={{ width: frameW, height: frameH }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={(e) => update((v) => ({ ...v, zoom: v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) }))}>
          {src && <img src={src} alt="" draggable={false}
            onLoad={(e) => setImg(e.currentTarget)} onError={() => setFailed(true)}
            style={img ? {
              width: img.naturalWidth, height: img.naturalHeight,
              marginLeft: -img.naturalWidth / 2, marginTop: -img.naturalHeight / 2,
              transform: `translate(${view.x}px, ${view.y}px) rotate(${view.turns * 90}deg) scale(${scale})`,
            } : { opacity: 0 }} />}
          <div className={`cropper-mask${circle ? ' circle' : ''}`} aria-hidden="true" />
          {failed && <p className="cropper-error" role="alert">This photo can’t be opened. Choose a JPEG, PNG or WebP photo.</p>}
        </div>
      </div>

      <div className="cropper-tools">
        {frames.length > 1 && (
          <div className="cropper-frames" role="radiogroup" aria-label="Shape">
            {frames.map((f) => (
              <button key={f.label} type="button" role="radio" aria-checked={frame.label === f.label}
                className={`chip cropper-chip${frame.label === f.label ? ' selected' : ''}`}
                onClick={() => { setFrame(f); setView(START); }}>{f.label}</button>
            ))}
          </div>
        )}
        <label className="cropper-zoom">
          <Icon name="discover" size={18} aria-hidden="true" />
          <span className="visually-hidden">Zoom</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom}
            onChange={(e) => update((v) => ({ ...v, zoom: Number(e.target.value) }))} />
        </label>
        <div className="cropper-buttons">
          <button type="button" className="btn secondary small-btn"
            onClick={() => update((v) => ({ ...v, turns: (v.turns + 1) % 4, x: 0, y: 0 }))}>Rotate</button>
          <button type="button" className="btn secondary small-btn" onClick={() => { setView(START); setFrame(frames[0]!); }}>Reset</button>
        </div>
        <p className="hint">Drag to move. Pinch or use the slider to zoom.</p>
      </div>
    </div>
  );
}
