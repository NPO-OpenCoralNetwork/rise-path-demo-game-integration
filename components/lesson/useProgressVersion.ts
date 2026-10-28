import { useEffect, useState } from 'react';
import { LAST_LESSON_KEY, PROGRESS_EVENT } from './progressStore.ts';
import { SYNC_ACCOUNT_EVENT } from './progressSync.ts';

/**
 * A number that changes whenever stored lesson progress may have changed: a write in this tab
 * (PROGRESS_EVENT, including synced server data), a sync account change (sign-in, reset, delete,
 * logout) or a write in another tab. Pages that read progress synchronously (the dashboard, the
 * course maps) put it in their memo dependencies, so hydrated progress shows without a reload.
 */
export function useProgressVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('rp:progress') || event.key === LAST_LESSON_KEY) bump();
    };
    window.addEventListener(PROGRESS_EVENT, bump);
    window.addEventListener(SYNC_ACCOUNT_EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PROGRESS_EVENT, bump);
      window.removeEventListener(SYNC_ACCOUNT_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return version;
}
