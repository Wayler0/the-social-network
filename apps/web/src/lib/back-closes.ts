import { useEffect, useRef } from 'react';

/**
 * Full-screen layers (photo viewer, stories) close with the phone's Back button: on open we add
 * ONE history entry; Back pops it and calls onClose. The entry is added once per opening, however
 * often the parent re-renders (and only once under React StrictMode). Close from code with
 * closeLayer(), which pops that entry.
 */
export function useBackCloses(key: string, onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if ((history.state as Record<string, unknown> | null)?.[key] !== true) {
      history.pushState({ ...(history.state as object | null), [key]: true }, '');
    }
    const onPop = () => {
      if ((history.state as Record<string, unknown> | null)?.[key] !== true) latest.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [key]);
}

/** Closes the layer opened with useBackCloses(key) by going back past its history entry. */
export function closeLayer(key: string): void {
  if ((history.state as Record<string, unknown> | null)?.[key] === true) history.back();
}
