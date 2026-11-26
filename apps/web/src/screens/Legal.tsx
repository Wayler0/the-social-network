import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { APP_NAME, CONTACT_EMAIL, LEGAL_UPDATED } from '../config';

/**
 * Privacy policy and terms with community guidelines: public pages (no sign-in), linked from
 * sign-up and Settings. Plain language, written from what the app actually does (CLAUDE.md
 * sections 1, 6, 10, 12). A draft by the team, not legal advice: check it against the Office of
 * the Data Protection Commissioner's guidance and update LEGAL_UPDATED in config.ts when it changes.
 */
function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="legal">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}><Icon name="back" /></button>
        <h1 className="topbar-title">{title}</h1>
        <span style={{ width: 44 }} />
      </header>
      <article className="legal-body">
        <p className="muted">Last updated {LEGAL_UPDATED}</p>
        {children}
      </article>
    </div>
  );
}

const Contact = () => (CONTACT_EMAIL
  ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  : <>any member of the {APP_NAME} team</>);

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy policy">
      <p><strong>In short:</strong> {APP_NAME} is a members-only app for your university community. We collect only what the app
        needs, we keep it on our own server in Kenya, we never sell it, and you can download or delete it at any time.</p>

      <h2>Who we are</h2>
      <p>{APP_NAME} is an independent project built and run by students. It is <strong>not an official university app</strong>.
        We, the {APP_NAME} team, decide how your data is used (we are the “data controller” under the Kenya Data Protection Act, 2019).
        Questions or requests: <Contact />.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your university email</strong>, to send you a sign-in code and prove you belong to the university.</li>
        <li><strong>Your profile:</strong> name, whether you are a fresher, continuing student, alumnus or staff, course, year of study or
          graduation year, interests, and a profile photo if you add one.</li>
        <li><strong>Registration or staff number</strong>, optional for students. It is <strong>never shown</strong> to other members;
          only you and the admins can see it.</li>
        <li><strong>Whether you are under 18</strong>, so we can give you safer settings.</li>
        <li><strong>What you post and do:</strong> posts, photos, comments, stories, questions and answers, likes and reactions, follows,
          saved posts, groups and clubs you join, reports and blocks, and feedback you send.</li>
        <li><strong>Sign-in details:</strong> a session cookie that keeps you signed in, and for each session the device/browser name and
          IP address, so you can see where you are signed in and we can stop abuse.</li>
        <li><strong>Push notifications</strong>, only if you turn them on.</li>
      </ul>
      <p>We do <strong>not</strong> collect your location, contacts, or anything from other apps. We do not use tracking or advertising cookies.</p>

      <h2>Who can see what</h2>
      <ul>
        <li>Only signed-in members of your university can see anything on {APP_NAME}. Search engines and outsiders cannot. Links shared
          outside the app show only the {APP_NAME} logo, never your post or photo.</li>
        <li>Your posts and profile are visible to members. Stories go to your followers (or only close friends, if you choose), and
          disappear after 24 hours.</li>
        <li>Your email and registration number are never shown to other members.</li>
        <li>Members under 18: strangers cannot message them, and their stories reach only people they follow back.</li>
        <li>Staff cannot see student-only groups.</li>
        <li>Moderators and admins can see reported content and the details needed to deal with it.</li>
      </ul>

      <h2>Where it is kept, and who else handles it</h2>
      <ul>
        <li>Your data is stored on our own server in Kenya. Connections to it are encrypted (HTTPS), and access to the server is limited to the team.</li>
        <li>Connections pass through Cloudflare, which protects the site from attacks. Cloudflare handles the traffic in transit
          (it can see it while delivering it) and keeps technical logs such as IP addresses. It does not keep copies of your posts,
          photos or profile: those are marked private and never cached.</li>
        <li>Sign-in code emails are sent through an email delivery service (Resend), which sees your email address and the code.</li>
        <li>If you turn on push notifications, your phone’s push service (Google, Apple or Mozilla) delivers them. The text is kept
          general (for example “New comment on your post”).</li>
        <li>We never sell your data or share it with advertisers. If we show sponsored content in future, it will be clearly labelled
          and use only what you have told us in your profile, never your location.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Sign-in codes are deleted within 24 hours. Stories are deleted 24 hours after posting, unless reported.</li>
        <li>Reported content is kept until moderators have dealt with the report.</li>
        <li>When you <strong>delete your account</strong>, we delete your email, name, photo, profile details, registration number,
          sessions, likes, follows, saved posts and uploaded photos. Your posts and comments stay, shown as “Deleted member”, so
          conversations still make sense; delete any you want gone first.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li><strong>See and download</strong> everything we hold about you: Settings → Download my data.</li>
        <li><strong>Correct</strong> your details: Profile → Edit profile.</li>
        <li><strong>Delete</strong> your account: Settings → Delete account.</li>
        <li><strong>Object or ask questions:</strong> <Contact />. You can also complain to the Office of the Data Protection
          Commissioner (odpc.go.ke).</li>
      </ul>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you in the app before it applies.</p>
      <p className="muted">See also the <Link to="/terms">Terms and community guidelines</Link>.</p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms and guidelines">
      <p><strong>In short:</strong> {APP_NAME} is for real members of your university community. Be yourself, be kind, keep people
        safe, and report anything that isn’t right.</p>

      <h2>Using {APP_NAME}</h2>
      <ul>
        <li>{APP_NAME} is free. There are no payments in the app.</li>
        <li>It is an independent student project, <strong>not an official university app</strong>. Official offices have verified
          accounts marked “Official”.</li>
        <li>You must sign in with your own university email and use your real name. One account per person; don’t use someone
          else’s email, registration number or identity.</li>
        <li>You own what you post. By posting, you let {APP_NAME} show it to the members who are allowed to see it.</li>
        <li>This is an early version: features may change, and things can break. We may suspend or remove accounts that break these rules.</li>
      </ul>

      <h2>Community guidelines</h2>
      <ul>
        <li><strong>Be respectful.</strong> No harassment, bullying, threats, hate speech or encouraging violence.</li>
        <li><strong>Keep it safe.</strong> No nudity or sexual content, and nothing sexual involving anyone under 18, ever.</li>
        <li><strong>Sad news and emergencies:</strong> don’t name someone who has died or been seriously hurt until it is officially
          confirmed or their family has been told, and never post photos or videos of injured or dead people. Use the official
          accounts for confirmed information.</li>
        <li><strong>Respect privacy.</strong> Don’t post other people’s phone numbers, addresses, registration numbers or private
          photos without their permission.</li>
        <li><strong>No scams.</strong> No spam or fake offers. Never pay anyone to apply for a job or a place.</li>
        <li><strong>Be honest.</strong> Don’t pretend to be another person, an office or a club.</li>
      </ul>

      <h2>Reporting and moderation</h2>
      <ul>
        <li>Every post, comment, story, group and profile has <strong>Report</strong> and <strong>Block</strong> in its “…” menu.</li>
        <li>Moderators review reports. They can hide content, and warn, suspend or ban accounts. Group and club admins look after
          their own groups.</li>
        <li>In an emergency, contact campus security or call 999 / 112 first.</li>
      </ul>

      <p className="muted">How we handle your data: <Link to="/privacy">Privacy policy</Link>. Questions: <Contact />.</p>
    </LegalPage>
  );
}
