/**
 * Profile rules shared by onboarding and edit profile (docs/api-contract.md section 4).
 * The API checks all of this again; this is for instant feedback.
 */
export type StudentType = 'fresher' | 'continuing' | 'alumni';
export type MemberTypeFull = StudentType | 'staff';

export type Me = {
  id: string;
  campus: { slug: string; name: string };
  email: string;
  memberType: MemberTypeFull | null;
  name: string | null;
  photoUrl: string | null;
  course: string | null;
  yearOfStudy: number | null;
  graduationYear: number | null;
  memberNumber: string | null;
  memberNumberStatus: 'unverified' | 'verified' | 'disputed';
  isUnder18: boolean | null;
  badges: string[];
  isAdmin: boolean;
  profileComplete: boolean;
};

export type ProfileInput = {
  name: string;
  memberType: MemberTypeFull;
  course: string;
  yearOfStudy: number | null;
  graduationYear: number | null;
  memberNumber: string;
  isUnder18: boolean | null;
};

export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

/** Upper-case, drop spaces and dashes, keep "/" — the same rule the API uses for uniqueness. */
export function normaliseMemberNumber(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

export const MAX_YEAR_OF_STUDY = 6;

export function validateProfile(p: ProfileInput, now = new Date()): ProfileErrors {
  const e: ProfileErrors = {};
  const name = p.name.trim();
  if (name.length < 2) e.name = 'Enter your name as people know you.';
  else if (name.length > 80) e.name = 'Keep your name under 80 characters.';

  if (p.memberType !== 'staff') {
    if (!p.course.trim()) e.course = 'Enter your course.';
    else if (p.course.trim().length > 120) e.course = 'Keep the course under 120 characters.';
  }

  if (p.memberType === 'continuing') {
    if (p.yearOfStudy == null || p.yearOfStudy < 2 || p.yearOfStudy > MAX_YEAR_OF_STUDY) e.yearOfStudy = 'Choose your year of study.';
  }
  if (p.memberType === 'alumni') {
    const y = p.graduationYear;
    if (y == null || !Number.isInteger(y) || y < 1990 || y > now.getFullYear()) e.graduationYear = 'Enter the year you graduated.';
  }

  const n = normaliseMemberNumber(p.memberNumber);
  const label = p.memberType === 'staff' ? 'staff number' : 'registration number';
  if (!n) e.memberNumber = `Enter your ${label}.`;
  else if (!/^[A-Z0-9/]+$/.test(n)) e.memberNumber = `Use only letters, numbers and "/" in your ${label}.`;
  else if (n.length < 3 || n.length > 40) e.memberNumber = `That doesn't look like a ${label}.`;

  if ((p.memberType === 'fresher' || p.memberType === 'continuing') && p.isUnder18 == null) {
    e.isUnder18 = 'Please answer this question.';
  }
  return e;
}

/** The body sent to PATCH /api/me. Fills in what the member type decides on its own. */
export function toPatch(p: ProfileInput) {
  const staff = p.memberType === 'staff';
  return {
    name: p.name.trim(),
    memberType: p.memberType,
    course: staff ? null : p.course.trim(),
    yearOfStudy: p.memberType === 'fresher' ? 1 : p.memberType === 'continuing' ? p.yearOfStudy : null,
    graduationYear: p.memberType === 'alumni' ? p.graduationYear : null,
    memberNumber: p.memberNumber.trim(),
    // Staff and alumni are adults; only current students are asked.
    isUnder18: p.memberType === 'fresher' || p.memberType === 'continuing' ? p.isUnder18 : false,
  };
}

/** Same rule as profileComplete in the contract. */
export function isComplete(me: Pick<Me, 'name' | 'memberType' | 'memberNumber' | 'yearOfStudy' | 'graduationYear' | 'isUnder18'>): boolean {
  if (!me.name || !me.memberType || !me.memberNumber || me.isUnder18 == null) return false;
  if (me.memberType === 'fresher' || me.memberType === 'continuing') return me.yearOfStudy != null;
  if (me.memberType === 'alumni') return me.graduationYear != null;
  return true;
}

export const memberTypeLabel: Record<MemberTypeFull, string> = {
  fresher: 'Fresher',
  continuing: 'Student',
  alumni: 'Alumni',
  staff: 'Staff',
};
