import { useAuth } from '../lib/auth';

/** The member's own profile from GET /api/me. The designed screen is issue #7 (Solomon). */
export function Profile() {
  const { me, signOut } = useAuth();
  if (!me) return null;
  const detail = [
    me.course,
    me.memberType === 'alumni' ? (me.graduationYear ? `Class of ${me.graduationYear}` : null)
      : me.yearOfStudy ? `Year ${me.yearOfStudy}` : null,
  ].filter(Boolean).join(' · ');
  const type = { fresher: 'Fresher', continuing: 'Student', alumni: 'Alumni', staff: 'Staff' }[me.memberType];

  return (
    <section className="screen" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <h1 className="screen-title">{me.name}</h1>
      <p className="muted">{[type, detail].filter(Boolean).join(' · ')}</p>
      {me.badges.length > 0 && (
        <p>{me.badges.map((b) => <span key={b} className="pill" style={{ marginRight: 6 }}>{b}</span>)}</p>
      )}
      <p className="hint">{me.campus.name} · {me.email}</p>
      <button className="btn secondary" onClick={() => void signOut()}>Log out</button>
    </section>
  );
}
