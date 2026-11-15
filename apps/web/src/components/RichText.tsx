import { Fragment } from 'react';

/** http(s) addresses only. Other schemes (javascript:, data:, file:) are never turned into links. */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
/** Punctuation that usually ends a sentence rather than the address: "see https://x.com/a." */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export type Piece = { text: string; href?: string };

/** Splits text into plain parts and links. Exported for tests. */
export function linkify(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = url.match(TRAILING)?.[0] ?? '';
    // Keep a closing bracket that belongs to the address, e.g. a Wikipedia link "…_(film)".
    const keepParen = trail.startsWith(')') && url.slice(0, -trail.length).includes('(');
    if (trail && !keepParen) url = url.slice(0, -trail.length);
    let href: string | null = null;
    try { const u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href; } catch { /* not a valid address */ }
    if (!href) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: url, href });
    last = m.index! + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * Member-written text with web addresses as links. Links open in a new tab and tell the other site
 * nothing about where the click came from; `ugc nofollow` marks them as user content.
 */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) => p.href
        ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-link"
            onClick={(e) => e.stopPropagation()}>{p.text}</a>
        : <Fragment key={i}>{p.text}</Fragment>)}
    </>
  );
}
