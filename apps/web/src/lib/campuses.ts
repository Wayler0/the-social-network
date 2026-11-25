import { useEffect, useState } from 'react';
import type { Campus } from '../config';

/**
 * Campuses and their email domains come from the server (GET /api/campuses), never from the
 * code: campus is data (CLAUDE.md section 13). Loaded once per visit. In mock mode a made-up
 * demo campus stands in.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const MOCK_CAMPUSES: Campus[] = [
  { slug: 'demo', name: 'Demo University', emailDomains: { 'student.example.ac.ke': 'student', 'example.ac.ke': 'staff' } },
];

let loading: Promise<Campus[]> | null = null;

export function getCampuses(): Promise<Campus[]> {
  if (MOCK) return Promise.resolve(MOCK_CAMPUSES);
  loading ??= fetch('/api/campuses', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body: { campuses: Campus[] }) => body.campuses)
    .catch((err) => { loading = null; throw err; }); // try again next time
  return loading;
}

/** The campus list, or null while loading or if it couldn't load (the server still checks emails). */
export function useCampuses(): Campus[] | null {
  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  useEffect(() => {
    let alive = true;
    getCampuses().then((c) => { if (alive) setCampuses(c); }).catch(() => { /* offline: server decides */ });
    return () => { alive = false; };
  }, []);
  return campuses;
}

export const mockCampuses = () => MOCK_CAMPUSES;
