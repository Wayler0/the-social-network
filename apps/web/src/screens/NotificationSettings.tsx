import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import {
  PUSH_KINDS, getPushSettings, getPushState, turnPushOff, turnPushOn, updatePushSettings,
  type PushKind, type PushSettings, type PushState,
} from '../lib/notifications';

const LABELS: Record<PushKind, [string, string]> = {
  comments: ['Comments', 'On your posts'],
  answers: ['Answers', 'To your Ask a Senior questions'],
  follows: ['New followers', 'When someone follows you'],
  groups: ['Groups', 'Join requests for groups you run, and when you’re let in'],
  events: ['Events', 'When an event you’re going to is cancelled'],
  urgent: ['Urgent campus news', 'Urgent announcements from official offices'],
};

const DEVICE_TEXT: Record<Exclude<PushState, 'on' | 'off'>, string> = {
  unsupported: 'This browser can’t show notifications. On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then open it from there.',
  unavailable: 'Notifications aren’t switched on for the server yet. You’ll still see everything in the Notifications tab.',
  denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.',
};

/** Push on this device, and which kinds push to all your devices. The inbox always records everything. */
export function NotificationSettings() {
  const [device, setDevice] = useState<PushState | null>(null);
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setDevice).catch(() => setDevice('unavailable'));
    getPushSettings().then(setSettings).catch(() => setError('Couldn’t load your settings. Check your connection.'));
  }, []);

  async function toggleDevice() {
    setBusy(true); setError(null);
    try { setDevice(device === 'on' ? await turnPushOff() : await turnPushOn()); }
    catch { setError('That didn’t work. Try again.'); }
    finally { setBusy(false); }
  }

  async function toggle(kind: PushKind) {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, [kind]: !settings[kind] });
    try { setSettings(await updatePushSettings({ [kind]: !before[kind] })); }
    catch { setSettings(before); setError('Couldn’t save. Try again.'); }
  }

  return (
    <>
      <header className="topbar">
        <Link to="/settings" className="icon-btn" aria-label="Back to settings"><Icon name="back" /></Link>
        <h1 className="topbar-title">Notifications</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen settings">
        <h2 className="list-label" style={{ padding: '8px 0 0' }}>This device</h2>
        {device === null && <p className="muted" role="status">Checking…</p>}
        {(device === 'on' || device === 'off') && (
          <label className="switch-row">
            <span className="list-main"><strong>Push notifications</strong>
              <span className="muted small">{device === 'on' ? 'On for this browser.' : 'Off for this browser.'} Lock screens show no names or messages.</span></span>
            <input type="checkbox" role="switch" className="switch" checked={device === 'on'} disabled={busy} onChange={toggleDevice} />
          </label>
        )}
        {device && device !== 'on' && device !== 'off' && <p className="notice">{DEVICE_TEXT[device]}</p>}

        <h2 className="list-label" style={{ padding: '16px 0 0' }}>Send pushes for</h2>
        <p className="muted small" style={{ margin: 0 }}>Applies to all your devices. Everything still shows in the Notifications tab.</p>
        {settings && PUSH_KINDS.map((k) => (
          <label key={k} className="switch-row">
            <span className="list-main"><strong>{LABELS[k][0]}</strong><span className="muted small">{LABELS[k][1]}</span></span>
            <input type="checkbox" role="switch" className="switch" checked={settings[k]} onChange={() => toggle(k)} />
          </label>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );
}
