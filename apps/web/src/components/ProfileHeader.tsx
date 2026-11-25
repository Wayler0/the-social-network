import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { memberTypeLabel, type MemberTypeFull } from '../lib/profile';
import { initials } from './Avatar';

export type ProfileFacts = {
  name: string | null;
  photoUrl: string | null;
  memberType: MemberTypeFull | null;
  course: string | null;
  yearOfStudy: number | null;
  graduationYear: number | null;
  badges: string[];
  interests?: string[];
};

export type FollowCounts = { followerCount: number; followingCount: number };

/**
 * Photo, name, member type, badges, course and year, follower counts: the same on your profile
 * and anyone else's. `listLinks` makes the counts open your followers / following lists (yours only).
 */
export function ProfileHeader({ p, campusName, counts, listLinks = false, extra }: {
  p: ProfileFacts; campusName?: string; counts?: FollowCounts | null; listLinks?: boolean; extra?: ReactNode;
}) {
  const detail = p.memberType === 'staff' ? campusName ?? ''
    : p.memberType === 'alumni' ? [p.course, p.graduationYear && `Class of ${p.graduationYear}`].filter(Boolean).join(' · ')
    : [p.course, p.yearOfStudy && `Year ${p.yearOfStudy}`].filter(Boolean).join(' · ');
  const count = (n: number, label: string, to: string) => {
    const inner = <><strong>{n}</strong> {label}</>;
    return listLinks ? <Link to={to} className="profile-count">{inner}</Link> : <span className="profile-count">{inner}</span>;
  };
  return (
    <section className="profile-head">
      {p.photoUrl
        ? <img className="avatar-lg" src={p.photoUrl} alt="" />
        : <div className="avatar-lg" aria-hidden="true">{initials(p.name)}</div>}
      <div className="profile-id">
        <h2>{p.name}</h2>
        <div className="badges">
          {p.memberType && <span className="badge-pill">{memberTypeLabel[p.memberType]}</span>}
          {p.badges.map((b) => <span key={b} className="badge-pill strong">{b}</span>)}
          {extra}
        </div>
        {detail && <p className="muted">{detail}</p>}
        {p.interests && p.interests.length > 0 && <p className="muted profile-interests">{p.interests.join(' · ')}</p>}
        {counts && (
          <p className="profile-counts">
            {count(counts.followerCount, counts.followerCount === 1 ? 'follower' : 'followers', '/profile/followers')}
            {count(counts.followingCount, 'following', '/profile/following')}
          </p>
        )}
      </div>
    </section>
  );
}
