import { describe, expect, it } from 'vitest';
import type { Campus } from '../config';
import { checkCampusEmail, emailErrorText } from './email';

describe('checkCampusEmail (default campus list)', () => {
  it('accepts student addresses', () => {
    expect(checkCampusEmail('abc.123@student.tharaka.ac.ke')).toEqual({
      ok: true, email: 'abc.123@student.tharaka.ac.ke', memberType: 'student', campus: 'tharaka',
    });
  });
  it('accepts staff addresses', () => {
    expect(checkCampusEmail('jdoe@tharaka.ac.ke')).toMatchObject({ ok: true, memberType: 'staff' });
  });
  it('trims and lower-cases', () => {
    expect(checkCampusEmail('  ABC@Student.Tharaka.AC.KE ')).toMatchObject({ ok: true, email: 'abc@student.tharaka.ac.ke' });
  });
  it('rejects other domains, including look-alikes', () => {
    for (const e of ['me@gmail.com', 'me@tharaka.ac.ke.evil.com', 'me@faketharaka.ac.ke', 'me@xstudent.tharaka.ac.ke']) {
      expect(checkCampusEmail(e)).toEqual({ ok: false, reason: 'domain' });
    }
  });
  it('rejects malformed input', () => {
    expect(checkCampusEmail('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkCampusEmail('@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
    expect(checkCampusEmail('a@b@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
    expect(checkCampusEmail('a b@tharaka.ac.ke')).toEqual({ ok: false, reason: 'format' });
  });
  it('is not fooled by object property names', () => {
    expect(checkCampusEmail('me@constructor')).toEqual({ ok: false, reason: 'domain' });
    expect(checkCampusEmail('me@__proto__')).toEqual({ ok: false, reason: 'domain' });
  });
});

describe('a second campus is only data', () => {
  const two: Campus[] = [
    { slug: 'a', name: 'Campus A', emailDomains: { 'students.a.example': 'student' } },
    { slug: 'b', name: 'Campus B', emailDomains: { 'b.example': 'staff' } },
  ];
  it('matches each campus by its own domains', () => {
    expect(checkCampusEmail('x@students.a.example', two)).toMatchObject({ ok: true, campus: 'a', memberType: 'student' });
    expect(checkCampusEmail('x@b.example', two)).toMatchObject({ ok: true, campus: 'b', memberType: 'staff' });
    expect(checkCampusEmail('x@tharaka.ac.ke', two)).toEqual({ ok: false, reason: 'domain' });
  });
  it('lists the allowed domains in the error', () => {
    expect(emailErrorText('domain', two)).toContain('@students.a.example or @b.example');
  });
});
