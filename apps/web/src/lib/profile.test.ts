import { describe, expect, it } from 'vitest';
import { isComplete, matchesRegFormat, normaliseMemberNumber, toPatch, validateProfile, type ProfileInput } from './profile';

const base: ProfileInput = {
  name: 'Wanjiru M.', memberType: 'continuing', course: 'BSc Computer Science',
  yearOfStudy: 3, graduationYear: null, memberNumber: 'abc1 12345-24', isUnder18: false,
};
const now = new Date('2026-11-13T00:00:00Z');

describe('normaliseMemberNumber', () => {
  it('upper-cases and drops spaces and dashes, keeping slashes', () => {
    expect(normaliseMemberNumber(' abc1 / 12345-24 ')).toBe('ABC1/1234524');
    expect(normaliseMemberNumber('abc1/12345/24')).toBe('ABC1/12345/24');
  });
});

describe('validateProfile', () => {
  it('accepts a complete continuing student', () => {
    expect(validateProfile(base, now)).toEqual({});
  });
  it('requires a year of study 2+ for continuing students', () => {
    expect(validateProfile({ ...base, yearOfStudy: 1 }, now)).toHaveProperty('yearOfStudy');
    expect(validateProfile({ ...base, yearOfStudy: null }, now)).toHaveProperty('yearOfStudy');
  });
  it('requires a past graduation year for alumni', () => {
    const alum = { ...base, memberType: 'alumni' as const, yearOfStudy: null, isUnder18: null };
    expect(validateProfile({ ...alum, graduationYear: 2027 }, now)).toHaveProperty('graduationYear');
    expect(validateProfile({ ...alum, graduationYear: 2024 }, now)).toEqual({});
  });
  it('asks current students about age but not staff or alumni', () => {
    expect(validateProfile({ ...base, memberType: 'fresher', isUnder18: null }, now)).toHaveProperty('isUnder18');
    expect(validateProfile({ ...base, memberType: 'staff', course: '', isUnder18: null }, now)).toEqual({});
  });
  it('rejects bad member numbers and short names', () => {
    expect(validateProfile({ ...base, memberNumber: 'AB#1' }, now)).toHaveProperty('memberNumber');
    expect(validateProfile({ ...base, memberNumber: '  ' }, now)).not.toHaveProperty('memberNumber');   // optional for students
    expect(validateProfile({ ...base, memberType: 'staff', course: '', memberNumber: '  ' }, now)).toHaveProperty('memberNumber');
    expect(validateProfile({ ...base, name: ' W ' }, now)).toHaveProperty('name');
  });
});

describe('toPatch', () => {
  it('sets year 1 for freshers and clears fields that do not apply', () => {
    expect(toPatch({ ...base, memberType: 'fresher', yearOfStudy: 4, graduationYear: 2020 }))
      .toMatchObject({ yearOfStudy: 1, graduationYear: null, course: 'BSc Computer Science' });
    expect(toPatch({ ...base, memberType: 'staff', isUnder18: null }))
      .toMatchObject({ course: null, yearOfStudy: null, isUnder18: false });
  });
});

describe('isComplete', () => {
  const me = { name: 'A', memberType: 'continuing' as const, memberNumber: 'X1', yearOfStudy: 2, graduationYear: null, isUnder18: false };
  it('matches the contract rule', () => {
    expect(isComplete(me)).toBe(true);
    expect(isComplete({ ...me, isUnder18: null })).toBe(false);
    expect(isComplete({ ...me, memberType: 'alumni' })).toBe(false);
    expect(isComplete({ ...me, memberType: null })).toBe(false);
  });
});

describe('registration number format (from the campus row)', () => {
  const reg = { pattern: '^[A-Z]{2,4}[0-9]/[0-9]{5}/[0-9]{2}$', example: 'ABT5/09919/23' };
  const now = new Date('2026-11-25');
  const student: ProfileInput = { name: 'Amina W.', memberType: 'continuing', course: 'BSc CS', yearOfStudy: 2, graduationYear: null, memberNumber: 'ABT5/09919/23', isUnder18: false };
  it('refuses numbers in the wrong format, with the example', () => {
    for (const bad of ['EBT1', 'ABT5/0991/23', 'ABT/09919/23']) {
      expect(validateProfile({ ...student, memberNumber: bad }, now, reg).memberNumber, bad).toContain('ABT5/09919/23');
    }
  });
  it('accepts the right format, typed loosely', () => {
    expect(validateProfile({ ...student, memberNumber: 'abt5 / 09919 / 23' }, now, reg)).toEqual({});
    expect(validateProfile({ ...student, memberNumber: 'EB1/12345/21' }, now, reg)).toEqual({});
  });
  it('never checks staff numbers, and no pattern means no check', () => {
    expect(validateProfile({ ...student, memberType: 'staff', course: '', memberNumber: 'TS-1042' }, now, reg)).toEqual({});
    expect(validateProfile({ ...student, memberNumber: 'EBT1' }, now, null)).toEqual({});
    expect(matchesRegFormat('X', '([')).toBe(true);   // a broken pattern doesn't lock people out
  });
});

describe('registration number is optional (team decision 25 Nov 2026)', () => {
  const now = new Date('2026-11-25');
  const student: ProfileInput = { name: 'Amina W.', memberType: 'continuing', course: 'BSc CS', yearOfStudy: 2, graduationYear: null, memberNumber: '', isUnder18: false };
  it('students and alumni can leave it empty; staff cannot', () => {
    expect(validateProfile(student, now)).toEqual({});
    expect(validateProfile({ ...student, memberType: 'alumni', yearOfStudy: null, graduationYear: 2024 }, now)).toEqual({});
    expect(validateProfile({ ...student, memberType: 'staff', course: '' }, now)).toHaveProperty('memberNumber');
  });
  it('a profile without a reg number is complete', () => {
    expect(isComplete({ name: 'A', memberType: 'continuing', memberNumber: null, yearOfStudy: 2, graduationYear: null, isUnder18: false })).toBe(true);
    expect(isComplete({ name: 'A', memberType: 'staff', memberNumber: null, yearOfStudy: null, graduationYear: null, isUnder18: false })).toBe(false);
  });
});
