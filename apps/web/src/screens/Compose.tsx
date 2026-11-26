import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts';
import { PhotoCropper, POST_FRAMES } from '../components/PhotoCropper';
import { ApiError } from '../lib/api';
import { getGroup } from '../lib/community';
import { addPostToTop } from '../lib/feed-store';
import { createPost, IMAGE_MAX_BYTES, IMAGE_TYPES, POST_MAX, uploadImage } from '../lib/feed';

type Photo = { preview: string; imageId: string | null; uploading: boolean };

/** New post: text (required) and one optional photo (issues #22, #32). `?group=<id>` posts into that group. */
export function Compose() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const groupId = search.get('group');
  // Club admins: an announcement goes to the club's members and followers, in their feeds too.
  const announcement = !!groupId && search.get('announcement') === '1';
  const [groupName, setGroupName] = useState<string | null>(null);
  useEffect(() => { if (groupId) getGroup(groupId).then((g) => setGroupName(g.name)).catch(() => setGroupName(null)); }, [groupId]);
  // Kept on the phone while you type, so leaving the screen doesn't lose it (lib/drafts.ts).
  const draftKey = `post:${groupId ?? 'feed'}`;
  const [body, setBodyState] = useState(() => loadDraft(draftKey));
  const setBody = (v: string) => { setBodyState(v); saveDraft(draftKey, v); };
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const trimmed = body.trim();
  const tooLong = trimmed.length > POST_MAX;
  const canPost = trimmed.length > 0 && !tooLong && !posting && !photo?.uploading;

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPosting(true); setError(null);
    try {
      const created = await createPost({ body: trimmed, ...(photo?.imageId ? { imageId: photo.imageId } : {}), ...(groupId ? { groupId } : {}), ...(announcement ? { announcement: true } : {}) });
      clearDraft(draftKey);
      addPostToTop(created);
      // Back to the club tab the post went to (Discussion posts aren't on the Announcements tab).
      const clubTab = created.group?.kind === 'club' ? (created.announcement ? '?tab=announcements' : '?tab=discussion') : '';
      navigate(groupId ? `/groups/${groupId}${clubTab}` : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your post didn’t send. Try again.');
      setPosting(false);
    }
  }

  return (
    <form className="compose" onSubmit={submit}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => navigate(-1)}><Icon name="close" /></button>
        <h1 className="topbar-title">New post</h1>
        <button type="submit" className="btn post-btn" disabled={!canPost}>{posting ? 'Posting…' : 'Post'}</button>
      </header>

      <div className="screen compose-body">
        {groupId && <p className="notice">{announcement
          ? <>Announcement from {groupName ?? 'the club'}. Its members and followers will see it, in their feeds too.</>
          : <>Posting in {groupName ?? 'the group'}. Only its members will see it.</>}</p>}
        <label htmlFor="post-body" className="visually-hidden">What’s happening on campus?</label>
        <textarea id="post-body" className="compose-text" placeholder="What’s happening on campus?" autoFocus
          value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={tooLong} aria-describedby="post-count" />
        <p id="post-count" className={`hint count${tooLong ? ' over' : ''}`}>{trimmed.length} / {POST_MAX}</p>

        {photo && (
          <div className="compose-photo">
            <img src={photo.preview} alt="Selected photo" />
            {photo.uploading && <span className="compose-uploading" role="status">Uploading…</span>}
            <button type="button" className="icon-btn remove-photo" aria-label="Remove photo" onClick={() => { setPhoto(null); setOriginal(null); }}>
              <Icon name="close" />
            </button>
            {original && !photo.uploading && (
              <button type="button" className="btn secondary small-btn edit-photo" onClick={() => setEditing(true)}>Edit</button>
            )}
          </div>
        )}
        {editing && original && (
          <PhotoCropper file={original} frames={POST_FRAMES} title="Edit photo"
            onCancel={() => setEditing(false)}
            onDone={(edited) => { setEditing(false); void pick(edited); }} />
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <div className="compose-tools">
          <label className="btn secondary btn-link tool">
            <Icon name="image" /> {photo ? 'Change photo' : 'Add photo'}
            <input type="file" accept={IMAGE_TYPES} className="visually-hidden"
              onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="hint">Be kind. No photos of injured people, and don’t name anyone hurt or killed until it’s officially confirmed. Location data is removed from photos.</p>
      </div>
    </form>
  );
}
