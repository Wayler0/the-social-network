import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { APP_NAME } from '../config';

/**
 * Help: short answers to what testers actually ask (usability review 25 Nov 2026, heuristic 10).
 * Each answer says where to tap. Keep it true to what the app does today; add questions from
 * user-feedback issues. Public page, like the privacy policy.
 */
const QUESTIONS: { q: string; a: ReactNode }[] = [
  { q: 'Why do I sign in with a code instead of a password?',
    a: <>We email a 6-digit code to your university address. It proves you’re a member, and there’s no password to forget or leak. Each code works once and expires after 10 minutes. After that you stay signed in on that phone for about 6 months, unless you log out.</> },
  { q: 'Why am I in a class group? Why are my classmates missing?',
    a: <>{APP_NAME} puts you in a group with everyone on the same course and year. If classmates typed the course differently, you end up in different groups. In <Link to="/profile/edit">Edit profile</Link>, pick your course from the suggestions so you all match.</> },
  { q: 'Do I have to give my registration number?',
    a: <>No, it’s optional for students. Your university email already proves you’re a member. If you give it, it must look like ABT5/09919/23, and nobody else ever sees it.</> },
  { q: 'Who can see my posts and stories?',
    a: <>Feed posts are seen by members of your campus. Posts in a group are seen by that group’s members. Stories disappear after 24 hours: choose <em>Followers</em> or <em>Close friends</em> when you post. Staff can’t see student-only groups, and members under 18 get safer defaults.</> },
  { q: 'Can I change a post after posting it?',
    a: <>Yes. Tap <strong>···</strong> on your post, then <strong>Edit post</strong>. Only the text can change, and the post will say “Edited”. You can also delete it from the same menu.</> },
  { q: 'Can I ask a question without my name showing?',
    a: <>Yes, in <Link to="/ask">Ask a Senior</Link> tick “Hide my name from other students”. Other students won’t see who asked. Moderators still can, to keep it safe.</> },
  { q: 'Someone is bothering me. What can I do?',
    a: <>Tap <strong>···</strong> on their post, comment, story or profile to <strong>Report</strong> or <strong>Block</strong> them. Blocked people can’t see your posts or find you in search. Moderators review every report. If someone is in danger right now, call campus security or 999.</> },
  { q: 'How do I find people and groups?',
    a: <>Tap the search icon on Home, or the search box in Discover. Search finds names, groups, posts and questions, never emails or registration numbers.</> },
  { q: 'Where are messages?',
    a: <>Private chat is coming in January. It will be end-to-end encrypted, so only you and the person you’re talking to can read it.</> },
  { q: 'How do I install the app?',
    a: <>On Android, tap <strong>Install</strong> when the banner appears, or use the browser menu and choose <em>Install app</em> or <em>Add to Home screen</em>. On iPhone, tap Share, then <em>Add to Home Screen</em>.</> },
  { q: 'What happens to my account when I graduate?',
    a: <>The university closes your student email soon after graduation. Before that, go to <Link to="/settings/personal-email">Settings → Keep access after graduating</Link> and link a personal email. After graduating, choose “Graduated? Sign in with your linked personal email” on the sign-in screen.</> },
  { q: 'Is this the official university app?',
    a: <>No. {APP_NAME} is an independent app built by students for the campus community. Official offices have verified accounts on it, marked OFFICIAL.</> },
  { q: 'How do I download or delete my data?',
    a: <>In <Link to="/settings">Settings</Link>: <strong>Download my data</strong> gives you a file with everything we hold about you. <strong>Delete account</strong> removes your profile and logs you out everywhere. Read more in the <Link to="/privacy">privacy policy</Link>.</> },
];

export function Help() {
  const navigate = useNavigate();
  return (
    <div className="legal">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><Icon name="back" /></button>
        <h1 className="topbar-title">Help</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="help-list">
        {QUESTIONS.map((x) => (
          <details key={x.q} className="help-item">
            <summary>{x.q}</summary>
            <p>{x.a}</p>
          </details>
        ))}
        <p className="muted help-foot">Still stuck? Use <strong>Send feedback</strong> in <Link to="/settings">Settings</Link> and tell us what happened.</p>
      </div>
    </div>
  );
}
