import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, disputeMemberNumber, updateMe, type MemberType } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Onboarding: the profile fields the API needs before a member can post or join groups
 * (PATCH /api/me; profileComplete). A plain working form: the designed screen is Solomon's
 * (design canvas). Staff accounts come from staff emails and stay staff.
 */
const THIS_YEAR = new Date().getFullYear();

export function Onboarding() {
  const { me, setMe, signOut } = useAuth();
  const navigate = useNavigate();
  const isStaff = me!.memberType === 'staff';

  const [name, setName] = useState(me!.name ?? '');
  const [memberType, setMemberType] = useState<MemberType>(isStaff ? 'staff' : me!.memberType);
  const [course, setCourse] = useState(me!.course ?? '');
  const [yearOfStudy, setYearOfStudy] = useState<string>(me!.yearOfStudy?.toString() ?? '');
  const [graduationYear, setGraduationYear] = useState<string>(me!.graduationYear?.toString() ?? '');
  const [memberNumber, setMemberNumber] = useState(me!.memberNumber ?? '');
  const [isUnder18, setIsUnder18] = useState<boolean | null>(me!.isUnder18);
  const [error, setError] = useState<string | null>(null);
  const [numberTaken, setNumberTaken] = useState(false);
  const [disputeSent, setDisputeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const student = memberType === 'fresher' || memberType === 'continuing';
  const alumni = memberType === 'alumni';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (isUnder18 === null) { setError('Tell us whether you are under 18.'); return; }
    setBusy(true);
    setError(null);
    setNumberTaken(false);
    try {
      const updated = await updateMe({
        name: name.trim(),
        ...(isStaff ? {} : { memberType }),
        course: course.trim() || null,
        yearOfStudy: student && yearOfStudy ? Number(yearOfStudy) : null,
        graduationYear: alumni && graduationYear ? Number(graduationYear) : null,
        memberNumber: memberNumber.trim(),
        isUnder18,
      });
      setMe(updated);
      if (updated.profileComplete) navigate('/', { replace: true });
      else setError(student ? 'Choose your year of study.' : alumni ? 'Enter your graduation year.' : 'Some details are missing.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'member_number_taken') setNumberTaken(true);
      setError(err instanceof ApiError ? err.message : 'Couldn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function dispute() {
    try {
      await disputeMemberNumber(memberNumber.trim());
      setDisputeSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send. Try again.');
    }
  }

  return (
    <main className="auth">
      <div className="auth-hero" style={{ paddingTop: 0 }}>
        <h1 className="screen-title">About you</h1>
        <p>This is how classmates will know you. Your {isStaff ? 'staff' : 'registration'} number stays private.</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" className="input" autoComplete="name" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {!isStaff && (
          <div className="field">
            <label htmlFor="memberType">I am</label>
            <select id="memberType" className="input" value={memberType} onChange={(e) => setMemberType(e.target.value as MemberType)}>
              <option value="fresher">A fresher (first year, just joined)</option>
              <option value="continuing">A continuing student</option>
              <option value="alumni">An alumnus / alumna</option>
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="course">Course {isStaff && <span className="hint">(or department)</span>}</label>
          <input id="course" className="input" maxLength={120} placeholder="e.g. BSc Computer Science" value={course} onChange={(e) => setCourse(e.target.value)} />
          {student && <span className="hint">You’ll join your class group automatically.</span>}
        </div>

        {student && (
          <div className="field">
            <label htmlFor="year">Year of study</label>
            <select id="year" className="input" value={yearOfStudy} onChange={(e) => setYearOfStudy(e.target.value)}>
              <option value="">Choose…</option>
              {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
          </div>
        )}

        {alumni && (
          <div className="field">
            <label htmlFor="grad">Graduation year</label>
            <input id="grad" className="input" inputMode="numeric" placeholder={`e.g. ${THIS_YEAR - 2}`} maxLength={4}
              value={graduationYear} onChange={(e) => setGraduationYear(e.target.value.replace(/\D/g, ''))} />
          </div>
        )}

        <div className="field">
          <label htmlFor="memberNumber">{isStaff ? 'Staff number' : 'Registration number'}</label>
          <input id="memberNumber" className="input" autoCapitalize="characters" spellCheck={false} maxLength={40}
            placeholder={isStaff ? '' : 'e.g. ABT5/09919/23'} value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} />
          <span className="hint">Only you and the admins can see it.</span>
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Are you under 18?</legend>
          <label><input type="radio" name="under18" checked={isUnder18 === false} onChange={() => setIsUnder18(false)} /> No, I’m 18 or older</label>
          <label><input type="radio" name="under18" checked={isUnder18 === true} onChange={() => setIsUnder18(true)} /> Yes, I’m under 18</label>
          <span className="hint">Under-18 members get safer settings, such as no messages from strangers.</span>
        </fieldset>

        {error && <span className="error" role="alert">{error}</span>}
        {numberTaken && !disputeSent && (
          <button type="button" className="linkish" onClick={dispute}>This is my number — tell the admins</button>
        )}
        {disputeSent && <span className="hint" role="status">Thanks. The admins will look into it; we’ll be in touch by email.</span>}

        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        <button className="btn secondary" type="button" onClick={() => void signOut()}>Log out</button>
      </form>
    </main>
  );
}
