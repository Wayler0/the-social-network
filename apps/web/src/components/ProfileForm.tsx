import { useState, type FormEvent } from 'react';
import { ApiError, disputeMemberNumber, updateMe } from '../lib/api';
import {
  MAX_YEAR_OF_STUDY, toPatch, validateProfile,
  type Me, type MemberTypeFull, type ProfileErrors, type ProfileInput, type StudentType,
} from '../lib/profile';

const studentTypes: { value: StudentType; label: string; hint: string }[] = [
  { value: 'fresher', label: 'Fresher', hint: 'First year' },
  { value: 'continuing', label: 'Continuing', hint: 'Year 2 or above' },
  { value: 'alumni', label: 'Alumni', hint: 'Graduated' },
];

function initial(me: Me): ProfileInput {
  return {
    name: me.name ?? '',
    memberType: (me.memberType ?? 'fresher') as MemberTypeFull,
    course: me.course ?? '',
    yearOfStudy: me.yearOfStudy,
    graduationYear: me.graduationYear,
    memberNumber: me.memberNumber ?? '',
    isUnder18: me.isUnder18,
  };
}

/**
 * Onboarding and edit-profile form (issue #7). Sends PATCH /api/me.
 * Staff (decided by their email domain) don't pick a member type, course or year.
 */
export function ProfileForm({ me, submitLabel, onSaved }: { me: Me; submitLabel: string; onSaved: (me: Me) => void }) {
  const staff = me.memberType === 'staff';
  const [p, setP] = useState<ProfileInput>(() => initial(me));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [disputeSent, setDisputeSent] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => {
    setP((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (key === 'memberNumber') { setTaken(false); setDisputeSent(false); }
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateProfile(p);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      onSaved(await updateMe(toPatch(p)));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'member_number_taken') {
        setTaken(true);
        setErrors({ memberNumber: err.message });
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Couldn’t save. Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function reportTaken() {
    try {
      await disputeMemberNumber(p.memberNumber, 'Reported from the profile form: number already used by another account.');
      setDisputeSent(true);
    } catch {
      setFormError('Couldn’t send the report. Try again.');
    }
  }

  const numberLabel = staff ? 'Staff number' : 'Registration number';
  const currentStudent = p.memberType === 'fresher' || p.memberType === 'continuing';

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" className="input" autoComplete="name" value={p.name} maxLength={80}
          onChange={(e) => set('name', e.target.value)} aria-invalid={errors.name ? 'true' : 'false'} aria-describedby="name-msg" />
        {errors.name ? <span id="name-msg" className="error">{errors.name}</span>
          : <span id="name-msg" className="hint">Shown on your profile and posts.</span>}
      </div>

      {!staff && (
        <fieldset className="field choice-group">
          <legend>I am a</legend>
          <div className="choices">
            {studentTypes.map((t) => (
              <label key={t.value} className={`choice${p.memberType === t.value ? ' selected' : ''}`}>
                <input type="radio" name="memberType" value={t.value} checked={p.memberType === t.value}
                  onChange={() => set('memberType', t.value)} />
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {!staff && (
        <div className="field">
          <label htmlFor="course">Course</label>
          <input id="course" className="input" value={p.course} maxLength={120} placeholder="e.g. BSc Computer Science"
            onChange={(e) => set('course', e.target.value)} aria-invalid={errors.course ? 'true' : 'false'} aria-describedby="course-msg" />
          {errors.course ? <span id="course-msg" className="error">{errors.course}</span>
            : <span id="course-msg" className="hint">We use it to add you to your class group.</span>}
        </div>
      )}

      {p.memberType === 'continuing' && (
        <div className="field">
          <label htmlFor="year">Year of study</label>
          <select id="year" className="input" value={p.yearOfStudy ?? ''}
            onChange={(e) => set('yearOfStudy', e.target.value ? Number(e.target.value) : null)}
            aria-invalid={errors.yearOfStudy ? 'true' : 'false'}>
            <option value="">Choose…</option>
            {Array.from({ length: MAX_YEAR_OF_STUDY - 1 }, (_, i) => i + 2).map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
          {errors.yearOfStudy && <span className="error">{errors.yearOfStudy}</span>}
        </div>
      )}

      {p.memberType === 'alumni' && (
        <div className="field">
          <label htmlFor="grad">Year you graduated</label>
          <input id="grad" className="input" inputMode="numeric" maxLength={4} placeholder="e.g. 2024"
            value={p.graduationYear ?? ''} onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              set('graduationYear', v ? Number(v) : null);
            }} aria-invalid={errors.graduationYear ? 'true' : 'false'} />
          {errors.graduationYear && <span className="error">{errors.graduationYear}</span>}
        </div>
      )}

      <div className="field">
        <label htmlFor="number">{numberLabel}</label>
        <input id="number" className="input" autoCapitalize="characters" spellCheck={false} maxLength={40}
          placeholder={staff ? 'Your staff number' : 'As on your student ID'}
          value={p.memberNumber} onChange={(e) => set('memberNumber', e.target.value)}
          aria-invalid={errors.memberNumber ? 'true' : 'false'} aria-describedby="number-msg" />
        {errors.memberNumber ? <span id="number-msg" className="error">{errors.memberNumber}</span>
          : <span id="number-msg" className="hint">Private: only you and the admins can see it.</span>}
        {taken && (disputeSent
          ? <span className="notice">Thanks. An admin will look into it and contact you.</span>
          : <button type="button" className="linkish" onClick={reportTaken}>This is my number. Report it.</button>)}
      </div>

      {currentStudent && (
        <fieldset className="field choice-group">
          <legend>Are you under 18?</legend>
          <div className="choices two">
            {[{ v: false, l: 'No, 18 or older' }, { v: true, l: 'Yes, under 18' }].map((o) => (
              <label key={String(o.v)} className={`choice${p.isUnder18 === o.v ? ' selected' : ''}`}>
                <input type="radio" name="under18" checked={p.isUnder18 === o.v} onChange={() => set('isUnder18', o.v)} />
                <strong>{o.l}</strong>
              </label>
            ))}
          </div>
          {errors.isUnder18 ? <span className="error">{errors.isUnder18}</span>
            : <span className="hint">Members under 18 get safer settings, such as no messages from strangers.</span>}
        </fieldset>
      )}

      {formError && <span className="error" role="alert">{formError}</span>}
      <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
