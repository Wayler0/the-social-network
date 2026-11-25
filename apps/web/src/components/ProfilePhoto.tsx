import { useEffect, useRef, useState } from 'react';
import { ApiError, call } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, uploadImage } from '../lib/feed';
import type { Me } from '../lib/profile';
import { initials } from './Avatar';
import { PhotoCropper } from './PhotoCropper';
import { Sheet } from './Sheet';

/** PATCH /api/me { photoImageId }: an id from POST /api/images sets the photo; null removes it. */
const setPhoto = (photoImageId: string | null) => call<Me>('PATCH', '/api/me', { photoImageId });

/**
 * What to tell the member when it fails. The server explains its own refusals (too big, wrong type,
 * too many uploads); no answer at all, or a gateway error, means the server couldn't be reached.
 */
function failText(err: unknown, fallback: string): string {
  const unreachable = !(err instanceof ApiError) || (err.status >= 500 && !err.code);
  if (unreachable) return 'Couldn’t reach the server. Check your connection and try again.';
  return err.message || fallback;
}

/**
 * Add, change or remove your profile photo. Saved straight away (not with the profile form), and
 * shown everywhere at once (posts, comments, stories). The server re-encodes it and makes a
 * 320 px thumbnail; `accept` lists JPEG/PNG/WebP so iPhones hand over a JPEG, not HEIC.
 */
function usePhotoUpload() {
  const { me, setMe } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // A chosen photo opens the editor first (crop, zoom, rotate); only the edited square is uploaded.
  const [editing, setEditing] = useState<File | null>(null);
  const afterUpload = useRef<((ok: boolean) => void) | undefined>(undefined);

  function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!IMAGE_TYPES.split(',').includes(file.type)) { setError('Choose a JPEG, PNG or WebP photo.'); return; }
    // The editor shrinks it to 800 × 800, so big camera photos are fine here.
    if (file.size > 4 * IMAGE_MAX_BYTES) { setError('That photo is too big. Choose a smaller one.'); return; }
    setEditing(file);
  }

  async function pick(file: File | undefined): Promise<boolean> {
    if (!file) return false;
    setError(null);
    if (file.size > IMAGE_MAX_BYTES) { setError('That photo is over 8 MB. Choose a smaller one.'); return false; }
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const up = await uploadImage(file);
      setMe(await setPhoto(up.imageId));
      return true;
    } catch (err) {
      setError(failText(err, 'The photo didn’t upload. Try again.'));
      return false;
    } finally {
      setPreview(null);
      setBusy(false);
    }
  }

  async function remove(): Promise<boolean> {
    setBusy(true); setError(null);
    try { setMe(await setPhoto(null)); return true; } catch (err) {
      setError(failText(err, 'Couldn’t remove the photo. Try again.'));
      return false;
    } finally { setBusy(false); }
  }

  const input = (onDone?: (ok: boolean) => void) => (
    <>
      <input ref={fileRef} type="file" accept={IMAGE_TYPES} hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; afterUpload.current = onDone; choose(f); }} />
      {editing && (
        <PhotoCropper file={editing} onCancel={() => setEditing(null)}
          onDone={(cropped) => { setEditing(null); void pick(cropped).then((ok) => afterUpload.current?.(ok)); }} />
      )}
    </>
  );
  return { me, fileRef, preview, busy, error, remove, input, choose: () => fileRef.current?.click() };
}

/** Edit profile: the photo with "Add photo" / "Change photo" and "Remove". */
export function ProfilePhoto() {
  const { me, preview, busy, error, remove, input, choose } = usePhotoUpload();
  if (!me) return null;
  const shown = preview ?? me.photoUrl;
  return (
    <section className="photo-edit" aria-labelledby="photo-edit-title">
      <h2 id="photo-edit-title" className="visually-hidden">Profile photo</h2>
      <button type="button" className="photo-edit-avatar" onClick={choose} disabled={busy}
        aria-label={me.photoUrl ? 'Change profile photo' : 'Add a profile photo'}>
        {shown
          ? <img className={`avatar-lg${busy ? ' uploading' : ''}`} src={shown} alt="" />
          : <span className="avatar-lg" aria-hidden="true">{initials(me.name)}</span>}
      </button>
      <div className="photo-edit-actions">
        {input()}
        <button type="button" className="btn secondary small-btn" onClick={choose} disabled={busy}>
          {busy ? 'Saving…' : me.photoUrl ? 'Change photo' : 'Add photo'}
        </button>
        {me.photoUrl && !busy && <button type="button" className="linkish" onClick={() => void remove()}>Remove</button>}
        {error ? <p className="error" role="alert">{error}</p> : <p className="hint">A clear photo of your face helps classmates find you.</p>}
      </div>
    </section>
  );
}

/**
 * Your own profile: tapping your photo (or initials) opens this. "Choose a photo" opens the
 * phone's picker (camera or gallery); the new photo shows as soon as it's saved.
 */
export function ProfilePhotoButton() {
  const { me, preview, busy, error, remove, input, choose } = usePhotoUpload();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const shown = preview ?? me.photoUrl;
  return (
    <>
      <button type="button" className="photo-edit-avatar" onClick={() => setOpen(true)} disabled={busy}
        aria-label={me.photoUrl ? 'Change profile photo' : 'Add a profile photo'} aria-haspopup="dialog">
        {shown
          ? <img className={`avatar-lg${busy ? ' uploading' : ''}`} src={shown} alt="" />
          : <span className="avatar-lg" aria-hidden="true">{initials(me.name)}</span>}
        <span className="photo-edit-badge" aria-hidden="true">+</span>
      </button>
      {input((ok) => { if (ok) setOpen(false); })}
      {open && (
        <Sheet title="Profile photo" onClose={() => setOpen(false)}>
          <button type="button" className="sheet-row" onClick={choose} disabled={busy}>
            {busy ? 'Saving…' : me.photoUrl ? 'Choose a new photo' : 'Choose a photo'}
          </button>
          {me.photoUrl && (
            <button type="button" className="sheet-row danger" disabled={busy}
              onClick={() => void remove().then((ok) => { if (ok) setOpen(false); })}>Remove photo</button>
          )}
          {error && <p className="error sheet-text" role="alert">{error}</p>}
          <button type="button" className="sheet-row muted" onClick={() => setOpen(false)}>Cancel</button>
        </Sheet>
      )}
    </>
  );
}
