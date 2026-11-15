export function initials(name: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Round photo, or initials on a sunshine circle when there is no photo. Decorative: the name is always shown next to it. */
export function Avatar({ name, photoUrl, size = 40 }: { name: string | null; photoUrl: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return photoUrl
    ? <img className="avatar" src={photoUrl} alt="" style={style} loading="lazy" />
    : <span className="avatar" aria-hidden="true" style={style}>{initials(name)}</span>;
}
