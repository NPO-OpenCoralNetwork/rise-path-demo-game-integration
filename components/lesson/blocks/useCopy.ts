import { useCallback, useEffect, useRef, useState } from 'react';

/** Clipboard copy with a short-lived "copied" flag for an aria-live message. */
export function useCopy(resetMs = 2000) {
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // Fallback for insecure origins / older browsers.
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        area.remove();
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? 'ok' : 'error');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), resetMs);
    return ok;
  }, [resetMs]);

  return { copied, copy };
}
