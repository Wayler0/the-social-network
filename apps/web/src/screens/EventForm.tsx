import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { getGroup, getMyOffices, type MyOffice } from '../lib/community';
import {
  createEvent, dateProblem, DESCRIPTION_MAX, fromLocalInput, getEvent, LOCATION_MAX, TITLE_MAX, toLocalInput, updateEvent,
  type CampusEvent, type EventPatch,
} from '../lib/events';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, uploadImage } from '../lib/feed';

type Photo = { preview: string; imageId: string | null; uploading: boolean };
/**
 * New event (`/events/new`, `?group=<id>` to host it in a group) or edit one (`/events/:id/edit`, the host only).
 * Members host as themselves or as an office they belong to. The photo can only be added when creating.
 */
export function EventForm() {
  const { id } = useParams();
  const editing = !!id;
  const groupId = useSearchParams()[0].get('group');
  const navigate = useNavigate();

  const [original, setOriginal] = useState<CampusEvent | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>(editing ? 'loading' : 'ready');
  const [groupName, setGroupName] = useState<string | null>(null);
  const [offices, setOffices] = useState<MyOffice[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (editing) {
      getEvent(id!).then((e) => {
        if (!e.canManage) { setLoadState('missing'); return; }
        setOriginal(e); setTitle(e.title); setDescription(e.description ?? ''); setLocation(e.location ?? '');
        setStart(toLocalInput(e.startsAt)); setEnd(e.endsAt ? toLocalInput(e.endsAt) : ''); setLoadState('ready');
      }).catch(() => setLoadState('missing'));
      return;
    }
    if (groupId) getGroup(groupId).then((g) => setGroupName(g.name)).catch(() => setGroupName(null));
    else getMyOffices().then((r) => setOffices(r.items)).catch(() => setOffices([]));
  }, [editing, id, groupId]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  const startsAt = fromLocalInput(start);
  const endsAt = fromLocalInput(end);
  const problem = dateProblem(startsAt, endsAt, !editing);
  const ok = title.trim().length > 0 && !problem && !photo?.uploading;

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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setTouched(true);
    if (!ok || !startsAt) return;
    setBusy(true); setError(null);
    try {
      let saved: CampusEvent;
      if (original) {
        // Send only what changed, so an edit never moves a time the host didn't touch.
        const patch: EventPatch = {};
        if (title.trim() !== original.title) patch.title = title.trim();
        if (description.trim() !== (original.description ?? '')) patch.description = description.trim() || null;
        if (location.trim() !== (original.location ?? '')) patch.location = location.trim() || null;
        if (start !== toLocalInput(original.startsAt)) patch.startsAt = startsAt;
        if (end !== (original.endsAt ? toLocalInput(original.endsAt) : '')) patch.endsAt = endsAt;
        saved = Object.keys(patch).length ? await updateEvent(original.id, patch) : original;
      } else {
        saved = await createEvent({
          title: title.trim(), startsAt,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(endsAt ? { endsAt } : {}),
          ...(photo?.imageId ? { imageId: photo.imageId } : {}),
          ...(groupId ? { groupId } : officeId ? { officeId } : {}),
        });
      }
      navigate(`/events/${saved.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The event didn’t save. Try again.');
      setBusy(false);
    }
  }

  const top = (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => navigate(-1)}><Icon name="close" /></button>
      <h1 className="topbar-title">{editing ? 'Edit event' : 'New event'}</h1>
      <span style={{ width: 44 }} />
    </header>
  );

  if (loadState === 'loading') return <>{top}<p className="feed-foot" role="status">Loading…</p></>;
  if (loadState === 'missing') {
    return <>{top}<section className="empty"><h1>Can’t edit this event</h1><p>It may have been deleted, or you aren’t its host.</p></section></>;
  }

  return (
    <form onSubmit={submit} noValidate>
      {top}
      <div className="screen form-stack">
        {groupId && <p className="notice">Hosting in {groupName ?? 'the group'}. Members of the group will see it.</p>}
        {!editing && !groupId && offices.length > 0 && (
          <label className="field"><span>Host as</span>
            <select className="input" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              <option value="">Yourself</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}

        <label className="field"><span>Title</span>
          <input className="input" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Freshers’ football match" aria-invalid={touched && !title.trim()} />
        </label>

          <label className="field"><span>Starts</span>
            <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
              aria-invalid={touched && !!problem && problem !== 'The end must be after the start.'} />
          </label>
          <label className="field"><span>Ends (optional)</span>
            <input className="input" type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)}
              aria-invalid={touched && problem === 'The end must be after the start.'} />
          </label>
        {(touched || start) && problem && <p className="error" role="alert">{problem}</p>}

        <label className="field"><span>Where (optional)</span>
          <input className="input" maxLength={LOCATION_MAX} value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Main field, Science Complex hall 2" />
        </label>

        <label className="field"><span>Details (optional)</span>
          <textarea className="input textarea" rows={5} maxLength={DESCRIPTION_MAX} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="What’s happening, who it’s for, what to bring" />
        </label>

        {!editing && (
          <>
            {photo && (
              <div className="compose-photo">
                <img src={photo.preview} alt="Selected photo" />
                {photo.uploading && <span className="compose-uploading" role="status">Uploading…</span>}
                <button type="button" className="icon-btn remove-photo" aria-label="Remove photo" onClick={() => setPhoto(null)}>
                  <Icon name="close" />
                </button>
              </div>
            )}
            <div className="compose-tools">
              <label className="btn secondary btn-link tool">
                <Icon name="image" /> {photo ? 'Change poster' : 'Add a poster'}
                <input type="file" accept={IMAGE_TYPES} className="visually-hidden"
                  onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </>
        )}

        {editing && original && !original.cancelled && (original.goingCount + original.interestedCount) > 0 && (
          <p className="hint">People who said they’re going aren’t notified of edits. If the event is off, cancel it instead so they’re told.</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || (touched && !ok)}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
