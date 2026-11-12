import { Placeholder } from '../components/Placeholder';
import { useAuth } from '../lib/auth';

/** Real profile screen is issue #7. */
export function Profile() {
  const { signOut } = useAuth();
  return (
    <>
      <Placeholder title="Your profile" text="Course, year, interests and badges — coming in week 1." />
      <div style={{ padding: '0 16px' }}>
        <button className="btn secondary" onClick={signOut}>Log out</button>
      </div>
    </>
  );
}
