import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PhotoCropper, STORY_FRAME } from '../components/PhotoCropper';
import { ApiError } from '../lib/api';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, uploadImage } from '../lib/feed';
import { createStory, STORY_BACKGROUND_LABEL, STORY_BACKGROUNDS, STORY_MAX, type StoryBackground } from '../lib/stories';

type Photo = { preview: string; imageId: string | null; uploading: boolean };

/**
 * Add to your story: a photo (with an optional caption) or text on its own. Gone after 24 hours.
 * Followers see it by default, or only your close friends. Photo and text only for now (CLAUDE.md section 4).
 */
export function StoryNew() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [audience, setAudience] = useState<'followers' | 'close_friends'>('followers');
  const [background, setBackground] = useState<StoryBackground>('black');
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const trimmed = body.trim();
  const canShare = (trimmed.length > 0 || !!photo?.imageId) && trimmed.length <= STORY_MAX && !posting && !photo?.uploading;

  // A chosen photo opens the editor first (crop, zoom, rotate); only the edited photo is uploaded.
  const [original, setOriginal] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!IMAGE_TYPES.split(',').includes(file.type)) return setError('Choose a JPEG, PNG or WebP photo.');
    // The editor shrinks big camera photos, so they are fine here.
    if (file.size > 4 * IMAGE_MAX_BYTES) return setError('That photo is too big. Choose a smaller one.');
    setOriginal(file);
    setEditing(true);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!IMAGE_TYPES.split(',').includes(file.type)) return setError('Choose a JPEG, PNG or WebP photo.');
    if (file.size > IMAGE_MAX_BYTES) return setError('That photo is over 8 MB. Choose a smaller one.');
    const next: Photo = { preview: URL.createObjectURL(file), imageId: null, uploading: true };
    setPhoto(next);
    try {
      const up = await uploadImage(file);
      setPhoto((cur) => (cur?.preview === next.preview ? { ...cur, imageId: up.imageId, uploading: false } : cur));
    } catch (err) {
      setPhoto((cur) => (cur?.preview === next.preview ? null : cur));
      setError(err instanceof ApiError ? err.message : 'The photo didn’t upload. Try again.');
    }
  }

  async function share() {
    if (!canShare) return;
    setPosting(true); setError(null);
    try {
      await createStory({ ...(trimmed ? { body: trimmed } : {}), ...(photo?.imageId ? { imageId: photo.imageId } : {}), audience, ...(photo ? {} : { background }) });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your story didn’t post. Try again.');
      setPosting(false);
    }
  }

  return (
    <div className="story-new">
      <header className="topbar story-new-bar">
        <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => navigate(-1)}><Icon name="close" /></button>
        <h1 className="topbar-title">Your story</h1>
        <button type="button" className="btn post-btn" disabled={!canShare} onClick={() => void share()}>{posting ? 'Sharing…' : 'Share'}</button>
      </header>

      <div className={`story-canvas story-bg-${photo ? 'black' : background}${photo ? ' has-photo' : ''}`}>
        {photo && <img src={photo.preview} alt="" />}
        {photo?.uploading && <span className="story-canvas-note" role="status">Uploading photo…</span>}
        <label htmlFor="story-text" className="visually-hidden">{photo ? 'Caption' : 'Write something'}</label>
        <textarea id="story-text" className={`story-input${photo ? ' over-photo' : ''}`} maxLength={STORY_MAX}
          placeholder={photo ? 'Add a caption…' : 'Type something…'} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      {!photo && (
        <div className="story-swatches" role="radiogroup" aria-label="Background colour">
          {STORY_BACKGROUNDS.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={background === b} aria-label={STORY_BACKGROUND_LABEL[b]}
              className={`story-swatch story-bg-${b}${background === b ? ' chosen' : ''}`} onClick={() => setBackground(b)} />
          ))}
        </div>
      )}
      <div className="story-tools">
        <input ref={fileRef} type="file" accept={IMAGE_TYPES} hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        {editing && original && (
          <PhotoCropper file={original} frames={STORY_FRAME} title="Edit story photo"
            onCancel={() => setEditing(false)}
            onDone={(edited) => { setEditing(false); void pick(edited); }} />
        )}
        {photo
          ? <span className="story-photo-actions">
              {original && !photo.uploading && <button type="button" className="btn secondary small-btn" onClick={() => setEditing(true)}>Edit photo</button>}
              <button type="button" className="btn secondary small-btn" onClick={() => { setPhoto(null); setOriginal(null); }}>Remove photo</button>
            </span>
          : <button type="button" className="btn secondary small-btn" onClick={() => fileRef.current?.click()}>Add a photo</button>}
        <fieldset className="story-audience">
          <legend className="visually-hidden">Who can see it</legend>
          {(['followers', 'close_friends'] as const).map((a) => (
            <label key={a} className={`chip${audience === a ? ' selected' : ''}`}>
              <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} />
              {a === 'followers' ? 'Followers' : 'Close friends'}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="hint story-hint">Disappears after 24 hours. You’ll see who viewed it.</p>
      {error && <p className="error story-hint" role="alert">{error}</p>}
    </div>
  );
}
