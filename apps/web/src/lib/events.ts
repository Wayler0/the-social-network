/**
 * Events with Going / Interested (docs/api-contract.md section 14). Real API only.
 */
import { call } from './api';
import type { Author, Page, PostImage } from './feed';

export type Rsvp = 'going' | 'interested';
export type CampusEvent = {
  id: string; title: string; description: string | null; location: string | null;
  startsAt: string; endsAt: string | null; cancelled: boolean;
  createdBy: Author;
  office: { id: string; name: string; photoUrl: string | null; verified: boolean } | null;
  group: { id: string; name: string; kind: 'group' | 'club' } | null;
  image: PostImage | null;
  goingCount: number; interestedCount: number; myRsvp: Rsvp | null; canManage: boolean;
  createdAt: string;
};
export type Attendee = { id: string; name: string | null; photoUrl: string | null; since: string };
export type EventInput = {
  title: string; description?: string; location?: string; startsAt: string; endsAt?: string;
  imageId?: string; officeId?: string; groupId?: string;
};
export type EventPatch = {
  title?: string; description?: string | null; location?: string | null;
  startsAt?: string; endsAt?: string | null; cancelled?: boolean;
};

export const TITLE_MAX = 140;
export const LOCATION_MAX = 200;
export const DESCRIPTION_MAX = 5000;

const id = encodeURIComponent;
const q = (path: string, params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `${path}?${s}` : path;
};

export const getEvents = (when: 'upcoming' | 'past', opts: { groupId?: string; cursor?: string | null } = {}) =>
  call<Page<CampusEvent>>('GET', q('/api/events', { when, groupId: opts.groupId, limit: 20, cursor: opts.cursor }));
export const getMyEvents = (cursor?: string | null) => call<Page<CampusEvent>>('GET', q('/api/me/events', { limit: 20, cursor }));
export const getEvent = (eventId: string) => call<CampusEvent>('GET', `/api/events/${id(eventId)}`);
export const createEvent = (input: EventInput) => call<CampusEvent>('POST', '/api/events', input);
export const updateEvent = (eventId: string, patch: EventPatch) => call<CampusEvent>('PATCH', `/api/events/${id(eventId)}`, patch);
export const deleteEvent = (eventId: string) => call<void>('DELETE', `/api/events/${id(eventId)}`);
export const setRsvp = (eventId: string, status: Rsvp | null) =>
  call<{ myRsvp: Rsvp | null; goingCount: number; interestedCount: number }>(
    status ? 'PUT' : 'DELETE', `/api/events/${id(eventId)}/rsvp`, status ? { status } : undefined);
export const getAttendees = (eventId: string, status: Rsvp, cursor?: string | null) =>
  call<Page<Attendee>>('GET', q(`/api/events/${id(eventId)}/attendees`, { status, limit: 50, cursor }));

// ---------------------------------------------------------------- dates (the viewer's own time zone)

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "2:30 pm" */
export function clock(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
}

/** "Today", "Tomorrow", or "Sat 29 Nov" (with the year when it isn't this year). */
export function dayLabel(d: Date, now = new Date()): string {
  if (sameDay(d, now)) return 'Today';
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  // Built from parts: browsers disagree on commas in the combined format.
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${weekday} ${d.getDate()} ${month}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** "Today · 2:00 pm – 4:00 pm", or across days "Sat 29 Nov · 6:00 pm – Sun 30 Nov · 2:00 am". */
export function whenText(startsAt: string, endsAt: string | null, now = new Date()): string {
  const s = new Date(startsAt);
  const start = `${dayLabel(s, now)} · ${clock(s)}`;
  if (!endsAt) return start;
  const e = new Date(endsAt);
  return sameDay(s, e) ? `${start} – ${clock(e)}` : `${start} – ${dayLabel(e, now)} · ${clock(e)}`;
}

/** Day and month for the date tile on a card: { day: "29", month: "Nov" }. */
export function dateTile(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  return { day: String(d.getDate()), month: d.toLocaleDateString('en-GB', { month: 'short' }) };
}

/** Happening now: started and not yet ended (an event without an end counts for 2 hours). */
export function isLive(e: Pick<CampusEvent, 'startsAt' | 'endsAt' | 'cancelled'>, now = Date.now()): boolean {
  const start = new Date(e.startsAt).getTime();
  const end = e.endsAt ? new Date(e.endsAt).getTime() : start + 2 * 3600_000;
  return !e.cancelled && start <= now && now < end;
}

/** Over: past its end (or its start, when it has no end). RSVPs are closed then. */
export function isOver(e: Pick<CampusEvent, 'startsAt' | 'endsAt'>, now = Date.now()): boolean {
  return new Date(e.endsAt ?? e.startsAt).getTime() < now;
}

/** ISO time → the value a <input type="datetime-local"> wants, in local time ("2026-11-29T14:00"). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value (local time) → ISO with offset for the API; null if empty or not a date. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const YEAR_MS = 366 * 86_400_000;

/** What's wrong with an event's times, in words; null when they're fine. `isNew` also refuses a start in the past (with the API's hour of grace). */
export function dateProblem(startsAt: string | null, endsAt: string | null, isNew: boolean, now = Date.now()): string | null {
  if (!startsAt) return 'Choose when it starts.';
  const start = new Date(startsAt).getTime();
  if (isNew && start < now - 3600_000) return 'The start time is in the past.';
  if (start > now + YEAR_MS) return 'Events can be at most a year ahead.';
  if (endsAt && new Date(endsAt).getTime() <= start) return 'The end must be after the start.';
  return null;
}
