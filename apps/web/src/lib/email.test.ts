import { describe, expect, it } from 'vitest';
import { checkUniversityEmail } from './email';

describe('checkUniversityEmail', () => {
  it('accepts student addresses', () => {
    expect(checkUniversityEmail('abc.123@student.tharaka.ac.ke')).toEqual({
      ok: true, email: 'abc.123@student.tharaka.ac.ke', memberType: 'student',
    });
  });
  it('accepts staff addresses', () => {
    expect(checkUniversityEmail('jdoe@tharaka.ac.ke')).toMatchObject({ ok: true, memberType: 'staff' });
  });
  it('trims and lower-cases', () => {
    expect(checkUniversityEmail('  ABC@Student.Tharaka.AC.KE ')).toMatchObject({ ok: true, email: 'abc@student.tharaka.ac.ke' });
  });
  it('rejects other domains, including look-alikes', () => {
    for (const e of ['me@gmail.com', 'me@tharaka.ac.ke.evil.com', 'me@faketharaka.ac.ke', 'me@xstudent.tharaka.ac.ke']) {
      expect(checkUniversityEmail(e)).toEqual({ ok: false, reason: 'domain' });
    }
  });
  it('rejects malformed input', () => {
    expect(checkUniversityEmail('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkUniversityEmail('@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
    expect(checkUniversityEmail('a@b@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
    expect(checkUniversityEmail('a b@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
  });
});
