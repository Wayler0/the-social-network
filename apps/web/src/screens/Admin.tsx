import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ApiError } from '../lib/api';
import {
  createOffice, endRole, findUsers, getLog, getOffices, getReports, grantRole, isModerator, OFFICE_TYPES,
  removeOfficeMember, resolveReport, roleLabel, ROLES, setOfficeMember, suspendUser, unhideContent, unsuspendUser,
  type AdminOffice, type AdminReport, type AdminUser, type ContentType, type LogEntry, type OfficeType, type ReportStatus, type Role,
} from '../lib/admin';
import { useAuth } from '../lib/auth';
import { REPORT_REASONS, timeAgo } from '../lib/feed';

type Tab = 'reports' | 'members' | 'offices' | 'log';
const errText = (err: unknown, fallback = 'That didn’t work. Try again.') => (err instanceof ApiError ? err.message : fallback);
const reasonLabel = (r: string) => REPORT_REASONS.find(([v]) => v === r)?.[1] ?? r;
const CONTENT: readonly string[] = ['post', 'comment', 'question', 'answer'];
const officeTypeLabel: Record<OfficeType, string> = { office: 'Office', department: 'Department', student_council: 'Student council', club: 'Club' };

/** Moderation and admin (issue #13). Moderators see Reports; admins also Members, Offices and the Log. */
export function Admin() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const admin = !!me?.isAdmin;
  const tab = (params.get('tab') as Tab | null) ?? 'reports';
  if (!isModerator(me)) return <Navigate to="/" replace />;
  if (!admin && tab !== 'reports') return <Navigate to="/admin" replace />;

  const show = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra }, { replace: true });
  const tabs: [Tab, string][] = admin
    ? [['reports', 'Reports'], ['members', 'Members'], ['offices', 'Offices'], ['log', 'Log']]
    : [['reports', 'Reports']];

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">{admin ? 'Admin' : 'Moderation'}</h1>
        <span style={{ width: 44 }} />
      </header>
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => show(t)}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'reports' && <Reports admin={admin} onFindMember={(name) => show('members', { q: name })} />}
      {tab === 'members' && <Members initial={params.get('q') ?? ''} myId={me!.id} />}
      {tab === 'offices' && <Offices />}
      {tab === 'log' && <Log />}
    </>
  );
}

// ================================================================ Reports

function Reports({ admin, onFindMember }: { admin: boolean; onFindMember: (name: string) => void }) {
  const [status, setStatus] = useState<ReportStatus>('open');
  const [items, setItems] = useState<AdminReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string | null) => {
    if (!from) setState('loading');
    try {
      const page = await getReports(status, from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch (err) { setError(errText(err, 'Reports didn’t load.')); setState('error'); }
  }, [status]);
  useEffect(() => { void load(null); }, [load]);

  /** After a decision every open report on the same item is closed, so drop them all from the queue. */
  const decided = (r: AdminReport) => setItems((list) => list.filter((x) => !(x.targetType === r.targetType && x.targetId === r.targetId)));

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Which reports">
        {(['open', 'hidden', 'dismissed'] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={status === s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s === 'open' ? 'To review' : s === 'hidden' ? 'Hidden' : 'Kept'}
          </button>
        ))}
      </div>
      {status === 'open' && <p className="hint admin-hint">Oldest first. Three reports from different members hide content automatically until you decide.</p>}
      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && <p className="feed-foot" role="alert">{error} <button type="button" className="linkish" onClick={() => load(null)}>Try again</button></p>}
      {state === 'ready' && items.length === 0 && <p className="feed-foot">{status === 'open' ? 'Nothing to review. 🎉' : 'Nothing here.'}</p>}
      {/* One card per reported item: "3 reports" is on the card, and one decision closes them all. */}
      {items.filter((r, i) => items.findIndex((x) => x.targetType === r.targetType && x.targetId === r.targetId) === i)
        .map((r) => <ReportCard key={r.id} r={r} admin={admin} onDecided={decided} onFindMember={onFindMember} />)}
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </>
  );
}

function ReportCard({ r, admin, onDecided, onFindMember }: {
  r: AdminReport; admin: boolean; onDecided: (r: AdminReport) => void; onFindMember: (name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const t = r.target;
  const isContent = CONTENT.includes(r.targetType);

  async function act(fn: () => Promise<unknown>, message: string, remove = true) {
    setBusy(true); setError(null);
    try { await fn(); setDone(message); if (remove) setTimeout(() => onDecided(r), 900); } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  }

  return (
    <article className="report">
      <header className="report-head">
        <span className="badge-pill">{r.targetType}</span>
        <strong>{reasonLabel(r.reason)}</strong>
        {r.status === 'open' && r.reportCount > 1 && <span className="badge-pill strong">{r.reportCount} reports</span>}
        <time className="post-meta" dateTime={r.createdAt}>{timeAgo(r.createdAt)}</time>
      </header>

      {!t && <p className="muted report-target">This {r.targetType} no longer exists.</p>}
      {t && (
        <div className="report-target">
          {t.body !== undefined && <p className="report-body">{t.body}</p>}
          {t.name !== undefined && <p className="report-body"><strong>{t.name}</strong>{t.memberType && ` · ${t.memberType}`}</p>}
          <p className="post-meta">{[
            t.author && `by ${t.author.deleted ? 'a deleted member' : t.author.name}`,
            t.deletedAt && 'Deleted by its author',
            t.hiddenAt && (t.autoHidden ? 'Hidden automatically (3 reports)' : 'Hidden by a moderator'),
            t.suspended && `Suspended${t.suspendedUntil ? ` until ${new Date(t.suspendedUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`,
            t.deleted && 'Account deleted',
          ].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      {r.details && <p className="report-details">“{r.details}”</p>}
      <p className="post-meta">
        Reported by {r.reporter?.name ?? 'a deleted member'}
        {r.resolvedBy && ` · decided by ${r.resolvedBy.name ?? 'a former moderator'}${r.resolvedAt ? ` ${timeAgo(r.resolvedAt)} ago` : ''}`}
      </p>

      {done ? <p className="notice" role="status">{done}</p> : (
        <div className="report-actions">
          {r.status === 'open' && isContent && t && (
            <button type="button" className="btn danger small-btn" disabled={busy}
              onClick={() => act(() => resolveReport(r.id, 'hide'), 'Hidden. Every report on it is closed.')}>Hide</button>
          )}
          {r.status === 'open' && (
            <button type="button" className="btn secondary small-btn" disabled={busy}
              onClick={() => act(() => resolveReport(r.id, 'dismiss'), isContent && t?.hiddenAt ? 'Kept and shown again.' : 'Kept. Reports closed.')}>
              {isContent ? 'Keep' : 'Dismiss'}
            </button>
          )}
          {r.status === 'hidden' && isContent && t?.hiddenAt && (
            <button type="button" className="btn secondary small-btn" disabled={busy}
              onClick={() => act(() => unhideContent(r.targetType as ContentType, r.targetId), 'Shown again.')}>Unhide</button>
          )}
          {admin && r.targetType === 'user' && t?.name && (
            <button type="button" className="btn secondary small-btn" onClick={() => onFindMember(t.name!)}>Open member</button>
          )}
          {admin && isContent && t?.author?.name && (
            <button type="button" className="linkish" onClick={() => onFindMember(t.author!.name!)}>Author’s account</button>
          )}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

// ================================================================ Members (admins)

function Members({ initial, myId }: { initial: string; myId: string }) {
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems(null); return; }
    const t = setTimeout(() => {
      findUsers(term).then((r) => { setItems(r.items); setError(null); }).catch((err) => setError(errText(err)));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const replace = (u: AdminUser) => setItems((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null);

  return (
    <div className="screen form-stack">
      <label className="field"><span>Find a member</span>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" autoFocus />
      </label>
      <p className="hint">Emails and registration numbers are private: never share them outside this screen.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {items && items.length === 0 && <p className="muted">No one found.</p>}
      {items?.map((u) => <MemberCard key={u.id} u={u} self={u.id === myId} onChange={replace} />)}
    </div>
  );
}

function MemberCard({ u, self, onChange }: { u: AdminUser; self: boolean; onChange: (u: AdminUser) => void }) {
  const [sheet, setSheet] = useState<'suspend' | 'role' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = [u.memberType, u.course, u.yearOfStudy && `Year ${u.yearOfStudy}`, u.graduationYear && `Class of ${u.graduationYear}`].filter(Boolean).join(' · ');

  async function run(fn: () => Promise<AdminUser | void>, after?: (u: AdminUser) => void) {
    setBusy(true); setError(null);
    try { const r = await fn(); if (r) (after ?? onChange)(r); } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  }

  return (
    <article className="member-card">
      <header>
        <strong>{u.name ?? '(no name yet)'}</strong>{self && <span className="badge-pill">You</span>}
        {u.deleted && <span className="badge-pill">Deleted</span>}
        {u.isUnder18 && <span className="badge-pill strong">Under 18</span>}
      </header>
      <p className="post-meta">{u.email ?? '—'}{u.memberNumber && ` · ${u.memberNumber}`}</p>
      {detail && <p className="post-meta">{detail}</p>}
      <p className="post-meta">Joined {new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>

      {u.suspended && (
        <p className="notice danger-notice">
          Suspended {u.suspended.until ? `until ${new Date(u.suspended.until).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'until an admin lifts it'}
          {u.suspended.reason && ` — ${u.suspended.reason}`}
        </p>
      )}

      {u.roles.length > 0 && (
        <ul className="role-list">
          {u.roles.map((r) => (
            <li key={r.id}>
              <span className="badge-pill strong">{roleLabel[r.role] ?? r.role}</span>
              {r.title && <span>{r.title}</span>}
              {r.endsAt && <span className="post-meta">until {new Date(r.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              {!(self && r.role === 'admin') && (
                <button type="button" className="linkish" disabled={busy}
                  onClick={() => run(async () => { await endRole(r.id); onChange({ ...u, roles: u.roles.filter((x) => x.id !== r.id) }); })}>End</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!u.deleted && (
        <div className="report-actions">
          {!self && (u.suspended
            ? <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => run(() => unsuspendUser(u.id))}>Lift suspension</button>
            : <button type="button" className="btn danger small-btn" onClick={() => setSheet('suspend')}>Suspend</button>)}
          <button type="button" className="btn secondary small-btn" onClick={() => setSheet('role')}>Add role</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {sheet === 'suspend' && <SuspendSheet u={u} onClose={() => setSheet(null)} onDone={(n) => { onChange(n); setSheet(null); }} />}
      {sheet === 'role' && <RoleSheet u={u} onClose={() => setSheet(null)} onDone={(n) => { onChange(n); setSheet(null); }} />}
    </article>
  );
}

const SUSPEND_DAYS = [1, 3, 7, 30, 0] as const;

function SuspendSheet({ u, onClose, onDone }: { u: AdminUser; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={`Suspend ${u.name ?? 'this member'}?`} onClose={onClose}>
      <form className="sheet-form" onSubmit={async (e) => {
        e.preventDefault(); if (!reason.trim()) return;
        setBusy(true); setError(null);
        try {
          onDone(await suspendUser(u.id, reason.trim(), days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined));
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <p className="sheet-text">They are signed out everywhere and can’t sign in until it ends. The reason is kept in the admin log.</p>
        <label className="field"><span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Repeated spam after a warning" />
        </label>
        <label className="field"><span>For how long</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {SUSPEND_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Until an admin lifts it' : `${d} day${d === 1 ? '' : 's'}`}</option>)}
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn danger" disabled={!reason.trim() || busy}>{busy ? 'Suspending…' : 'Suspend'}</button>
      </form>
    </Sheet>
  );
}

function RoleSheet({ u, onClose, onDone }: { u: AdminUser; onClose: () => void; onDone: (u: AdminUser) => void }) {
  const [role, setRole] = useState<Role>('moderator');
  const [title, setTitle] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeBound = role === 'student_leader' || role === 'club_leader';
  return (
    <Sheet title={`Give ${u.name ?? 'this member'} a role`} onClose={onClose}>
      <form className="sheet-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
          onDone(await grantRole(u.id, role, title.trim() || undefined, endsAt ? new Date(`${endsAt}T23:59:00`).toISOString() : undefined));
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <label className="field"><span>Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
        </label>
        {role === 'staff' && <p className="hint">Only for accounts that signed up with a staff email.</p>}
        {role === 'admin' && <p className="notice">Admins can suspend members, grant roles and see private details. Give it to very few people.</p>}
        <label className="field"><span>Title (optional, shown on the badge)</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={timeBound ? 'e.g. Class rep, BSc CS Year 2' : ''} />
        </label>
        <label className="field"><span>Ends on {timeBound ? '(end of their term of office)' : '(optional)'}</span>
          <input className="input" type="date" value={endsAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || (timeBound && !endsAt)}>{busy ? 'Saving…' : 'Give role'}</button>
      </form>
    </Sheet>
  );
}

// ================================================================ Offices (admins)

function Offices() {
  const [items, setItems] = useState<AdminOffice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<AdminOffice | null>(null);
  const load = useCallback(() => getOffices().then((r) => setItems(r.items)).catch((err) => setError(errText(err))), []);
  useEffect(() => { void load(); }, [load]);

  async function remove(o: AdminOffice, userId: string) {
    setError(null);
    try { await removeOfficeMember(o.id, userId); await load(); } catch (err) { setError(errText(err)); }
  }

  return (
    <div className="screen form-stack">
      <p className="hint">Official accounts post to the Today board. On handover, add the new holder and remove the old one: the office keeps its history.</p>
      <button type="button" className="btn secondary" onClick={() => setCreating(true)}>New official account</button>
      {error && <p className="error" role="alert">{error}</p>}
      {!items && !error && <p className="muted" role="status">Loading…</p>}
      {items?.map((o) => (
        <article key={o.id} className="member-card">
          <header><strong>{o.name}</strong><span className="badge-pill">{officeTypeLabel[o.type] ?? o.type}</span>{o.verified && <span className="badge-pill strong">Official</span>}</header>
          {o.members.length === 0 && <p className="post-meta">No one can post for it yet.</p>}
          <ul className="role-list">
            {o.members.map((m) => (
              <li key={m.id}>
                <span>{m.name ?? 'Deleted member'}</span><span className="badge-pill">{m.role}</span>
                <button type="button" className="linkish" onClick={() => remove(o, m.id)}>Remove</button>
              </li>
            ))}
          </ul>
          <button type="button" className="linkish" onClick={() => setAddingTo(o)}>+ Add a person</button>
        </article>
      ))}
      {creating && <NewOfficeSheet onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} />}
      {addingTo && <AddOfficeMemberSheet office={addingTo} onClose={() => setAddingTo(null)} onDone={() => { setAddingTo(null); void load(); }} />}
    </div>
  );
}

function NewOfficeSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<OfficeType>('office');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="New official account" onClose={onClose}>
      <form className="sheet-form" onSubmit={async (e) => {
        e.preventDefault(); if (!name.trim()) return;
        setBusy(true); setError(null);
        try { await createOffice(name.trim(), type); onDone(); } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <label className="field"><span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Registrar" />
        </label>
        <label className="field"><span>Type</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as OfficeType)}>
            {OFFICE_TYPES.map((t) => <option key={t} value={t}>{officeTypeLabel[t]}</option>)}
          </select>
        </label>
        <p className="hint">It gets the OFFICIAL badge. Only create accounts for real offices you have checked.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create'}</button>
      </form>
    </Sheet>
  );
}

function AddOfficeMemberSheet({ office, onClose, onDone }: { office: AdminOffice; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [role, setRole] = useState<'owner' | 'editor'>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => findUsers(q.trim()).then((r) => setResults(r.items.filter((u) => !u.deleted))).catch(() => setResults([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Sheet title={`Add a person to ${office.name}`} onClose={onClose}>
      <form className="sheet-form" onSubmit={async (e) => {
        e.preventDefault(); if (!picked) return;
        setBusy(true); setError(null);
        try { await setOfficeMember(office.id, picked.id, role); onDone(); } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        {picked
          ? <p className="notice">{picked.name} <button type="button" className="linkish" onClick={() => setPicked(null)}>Change</button></p>
          : <>
              <label className="field"><span>Find the member</span>
                <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" autoFocus />
              </label>
              <div className="sheet-actions">
                {results.map((u) => (
                  <button key={u.id} type="button" className="sheet-row" onClick={() => setPicked(u)}>{u.name ?? u.email} · {u.memberType}</button>
                ))}
              </div>
            </>}
        <label className="field"><span>Can</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'editor')}>
            <option value="editor">Post announcements (editor)</option>
            <option value="owner">Post and delete announcements (owner)</option>
          </select>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={!picked || busy}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
    </Sheet>
  );
}

// ================================================================ Log (admins)

/** Plain words for each action the API logs (apps/api/src/admin: logAction calls). */
const ACTIONS: Record<string, string> = {
  'report.hide': 'hid a reported', 'report.dismiss': 'kept a reported',
  'content.hide': 'hid a', 'content.unhide': 'showed again a',
  'user.suspend': 'suspended a member', 'user.unsuspend': 'lifted a suspension',
  'role.grant': 'gave a role', 'role.end': 'ended a role',
  'office.create': 'created an official account', 'office.member.add': 'added someone to an official account',
  'office.member.remove': 'removed someone from an official account',
  'group.verify_club': 'gave a group the CLUB badge', 'group.unverify_club': 'removed a CLUB badge',
  'dispute.resolve': 'resolved a reg-number dispute',
};
function describe(e: LogEntry): string {
  const words = ACTIONS[e.action] ?? e.action;
  // "hid a reported" / "hid a" need the kind of content after them.
  return /\ba( reported)?$/.test(words) ? `${words} ${e.targetType}` : words;
}

function Log() {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (from: string | null) => {
    try {
      const page = await getLog(from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items)); setCursor(page.nextCursor);
    } catch (err) { setError(errText(err)); }
  }, []);
  useEffect(() => { void load(null); }, [load]);
  return (
    <>
      <p className="hint admin-hint">Every moderation and admin action, newest first. Kept for accountability.</p>
      {error && <p className="error" role="alert" style={{ padding: '0 16px' }}>{error}</p>}
      <ul className="list">
        {items.map((e) => (
          <li key={e.id} className="list-row log-row">
            <span className="list-main">
              <span><strong>{e.by?.name ?? 'System'}</strong> {describe(e)}</span>
              {e.details && typeof e.details.reason === 'string' && <span className="post-meta">“{e.details.reason}”</span>}
              <span className="post-meta">{e.action} · {timeAgo(e.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show older</button>}
    </>
  );
}
