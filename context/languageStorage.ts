// The UI language kept in localStorage. No imports, so node:test can check it.

export const LANGUAGE_STORAGE_KEY = 'risepath:language';

export type StoredLanguage = 'en' | 'jp' | 'fr';

type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/**
 * Even reading `window.localStorage` throws when storage is blocked (some private modes, blocked
 * site data, sandboxed frames), so the storage is fetched and used inside the same try.
 */
export const readStoredLanguage = (getStorage: StorageGetter): StoredLanguage => {
    try {
        const stored = getStorage()?.getItem(LANGUAGE_STORAGE_KEY);
        if (stored === 'jp' || stored === 'fr') return stored;
    } catch {
        // Storage unavailable: fall back to English.
    }
    return 'en';
};

/** Remembers the language when storage is available; otherwise it lasts for this visit only. */
export const writeStoredLanguage = (getStorage: StorageGetter, language: StoredLanguage): void => {
    try {
        getStorage()?.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
        // Storage unavailable: nothing to remember.
    }
};
