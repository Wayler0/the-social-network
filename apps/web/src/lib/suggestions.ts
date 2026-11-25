import { call } from './api';
import type { MemberTypeFull } from './profile';

/** Who to follow (GET /api/suggestions): classmates and course-mates first, then mutual follows; public clubs. */
export type SuggestedPerson = {
  id: string; name: string; photoUrl: string | null; memberType: MemberTypeFull; course: string | null;
  yearOfStudy: number | null; badges: string[]; reason: string; mutualCount: number;
};
export type SuggestedClub = { id: string; name: string; description: string | null; clubVerified: boolean; followerCount: number };

export const getSuggestions = () => call<{ people: SuggestedPerson[]; clubs: SuggestedClub[] }>('GET', '/api/suggestions');
