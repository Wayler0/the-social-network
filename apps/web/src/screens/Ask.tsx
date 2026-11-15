import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ContentMenu } from '../components/ContentMenu';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  answerQuestion, askQuestion, deleteAnswer, deleteQuestion, getQuestion, getQuestions, HIDDEN_AUTHOR, markHelpful,
  type Answer, type Question,
} from '../lib/community';
import { plural, timeAgo } from '../lib/feed';

const BODY_MAX = 5000;

/** Who wrote it, as this viewer may see it. Moderators see hidden askers, with a note. */
function Who({ author, nameHidden, byAsker }: { author: Question['author']; nameHidden?: boolean; byAsker?: boolean }) {
  const a = author ?? HIDDEN_AUTHOR;
  return (
    <span className="post-name">
      <strong>{a.name}</strong>
      {a.badges.map((b) => <span key={b} className="badge-pill">{b}</span>)}
      {byAsker && <span className="badge-pill">Asker</span>}
      {author && nameHidden && <span className="hint">(name hidden from students)</span>}
    </span>
  );
}

/** Ask a Senior: search questions and answers, ask your own, name hidden if you want (issue #27). */
export function Ask() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Question[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (from: string | null) => {
    if (!from) setState('loading');
    try {
      const page = await getQuestions(search.length >= 2 ? search : undefined, from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, [search]);
  useEffect(() => { void load(null); }, [load]);

  // Search a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Ask a Senior</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen ask-top">
        <p className="muted">Hostels, offices, lecturers, where things are: ask anything. Seniors and alumni answer, and answers stay here for the next person.</p>
        <label htmlFor="ask-search" className="visually-hidden">Search questions and answers</label>
        <input id="ask-search" className="input" type="search" placeholder="Search, e.g. “register units”" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn" onClick={() => setAsking(true)}>Ask a question</button>
      </div>

      {asking && <AskForm onClose={() => setAsking(false)} onAsked={(q) => navigate(`/ask/${q.id}`)} />}

      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && <p className="feed-foot" role="alert">Didn’t load. <button type="button" className="linkish" onClick={() => load(null)}>Try again</button></p>}
      {state === 'ready' && items.length === 0 && (
        <p className="feed-foot">{search ? `Nothing found for “${search}”. Ask it!` : 'No questions yet. Be the first to ask.'}</p>
      )}
      <ul className="list">
        {items.map((q) => (
          <li key={q.id}>
            <Link to={`/ask/${q.id}`} className="list-row question-row">
              <span className="list-main">
                <span className="question-body">{q.body}</span>
                <span className="post-meta">
                  {(q.author ?? HIDDEN_AUTHOR).name} · {timeAgo(q.createdAt)} · {q.answerCount === 0 ? 'No answers yet' : plural(q.answerCount, 'answer')}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </>
  );
}

function AskForm({ onClose, onAsked }: { onClose: () => void; onAsked: (q: Question) => void }) {
  const [body, setBody] = useState('');
  const [hideName, setHideName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = body.trim().length > 0 && body.trim().length <= BODY_MAX;
  return (
    <form className="screen ask-form" onSubmit={async (e) => {
      e.preventDefault(); if (!ok) return;
      setBusy(true); setError(null);
      try { onAsked(await askQuestion(body.trim(), hideName)); } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Your question didn’t send. Try again.'); setBusy(false);
      }
    }}>
      <label className="field"><span>Your question</span>
        <textarea className="input textarea" rows={3} maxLength={BODY_MAX} autoFocus value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Where do I collect my student ID?" />
      </label>
      <label className="check">
        <input type="checkbox" checked={hideName} onChange={(e) => setHideName(e.target.checked)} />
        <span><strong>Hide my name from other students</strong> — moderators can still see who asked.</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn" disabled={!ok || busy}>{busy ? 'Asking…' : 'Ask'}</button>
      </div>
    </form>
  );
}

/** One question with its answers (most helpful first), a box to answer, and "helpful" (issue #27). */
export function AskQuestion() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [q, setQ] = useState<(Question & { answers: Answer[] }) | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: 'question' | 'answer'; id: string; author: Question['author']; isOwn: boolean } | null>(null);

  const load = useCallback(async () => {
    try { setQ(await getQuestion(id)); setState('ready'); } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const top = (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
      <h1 className="topbar-title">Question</h1>
      {q ? <button type="button" className="icon-btn" aria-label="Question options"
        onClick={() => setMenu({ kind: 'question', id: q.id, author: q.author, isOwn: q.isMine })}><Icon name="more" /></button>
        : <span style={{ width: 44 }} />}
    </header>
  );
  if (state === 'loading') return <>{top}<p className="feed-foot" role="status">Loading…</p></>;
  if (state !== 'ready' || !q) {
    return (<>{top}<section className="empty"><h1>{state === 'missing' ? 'Question not available' : 'Didn’t load'}</h1>
      <p>{state === 'missing' ? 'It may have been deleted or hidden.' : 'Check your connection.'}</p></section></>);
  }

  async function helpful(a: Answer) {
    const want = !a.helpfulByMe;
    try {
      const r = await markHelpful(a.id, want);
      setQ((cur) => cur && { ...cur, answers: cur.answers.map((x) => (x.id === a.id ? { ...x, helpfulByMe: r.helpful, helpfulCount: r.helpfulCount } : x)) });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'That didn’t save. Try again.'); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !q) return;
    setBusy(true); setError(null);
    try {
      const a = await answerQuestion(q.id, body);
      setQ({ ...q, answerCount: q.answerCount + 1, answers: [...q.answers, a] });
      setText('');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Your answer didn’t send. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {top}
      <article className="question">
        <header className="post-head">
          <Avatar name={(q.author ?? HIDDEN_AUTHOR).name} photoUrl={q.author?.photoUrl ?? null} />
          <div className="post-who"><Who author={q.author} nameHidden={q.nameHidden} />
            <div className="post-meta"><time dateTime={q.createdAt}>{timeAgo(q.createdAt)}</time></div></div>
        </header>
        <p className="post-body question-text">{q.body}</p>
      </article>

      <section className="answers" aria-label="Answers">
        <h2 className="list-label">{q.answers.length === 0 ? 'No answers yet' : plural(q.answers.length, 'answer')}</h2>
        {q.answers.map((a) => (
          <div key={a.id} className="answer">
            <div className="post-head">
              <Avatar name={(a.author ?? HIDDEN_AUTHOR).name} photoUrl={a.author?.photoUrl ?? null} size={32} />
              <div className="post-who"><Who author={a.author} byAsker={a.byAsker} />
                <div className="post-meta"><time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time></div></div>
              <button type="button" className="icon-btn small" aria-label="Answer options"
                onClick={() => setMenu({ kind: 'answer', id: a.id, author: a.author, isOwn: a.isMine })}><Icon name="more" size={18} /></button>
            </div>
            <p className="post-body">{a.body}</p>
            <div className="post-actions">
              {a.isMine
                ? <span className="action static">{plural(a.helpfulCount, 'person', 'people')} found this helpful</span>
                : <button type="button" className={`action${a.helpfulByMe ? ' liked' : ''}`} aria-pressed={a.helpfulByMe} onClick={() => helpful(a)}>
                    <Icon name="check" /> Helpful · {a.helpfulCount}
                  </button>}
            </div>
          </div>
        ))}
      </section>

      <form className="comment-form" onSubmit={send}>
        <label htmlFor="answer" className="visually-hidden">Write an answer</label>
        <input id="answer" className="input" placeholder={q.isMine ? 'Add more detail…' : 'Write an answer…'} maxLength={BODY_MAX}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="linkish" disabled={!text.trim() || busy}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
      {error && <p className="error comment-error" role="alert">{error}</p>}

      {menu && (
        <ContentMenu kind={menu.kind} targetId={menu.id} author={menu.author ?? HIDDEN_AUTHOR} isOwn={menu.isOwn}
          canDelete={menu.isOwn || !!me?.isAdmin}
          onDelete={async () => {
            if (menu.kind === 'question') { await deleteQuestion(menu.id); navigate('/ask', { replace: true }); return; }
            await deleteAnswer(menu.id);
            setQ((cur) => cur && { ...cur, answerCount: cur.answerCount - 1, answers: cur.answers.filter((x) => x.id !== menu.id) });
          }}
          onBlocked={() => navigate('/ask', { replace: true })}
          onClose={() => setMenu(null)} />
      )}
    </>
  );
}
