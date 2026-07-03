export type GeminiApiKeySource = 'env' | 'local' | 'none';

const GEMINI_STORAGE_KEY = 'rise-path.gemini_api_key';

const readLocalApiKey = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(GEMINI_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Failed to read local API key:', error);
    return '';
  }
};

const readEnvApiKey = (): string => {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  return typeof envKey === 'string' ? envKey : '';
};

export const getGeminiApiKeyInfo = (): { key: string; source: GeminiApiKeySource } => {
  const envKey = readEnvApiKey();
  if (envKey) {
    return { key: envKey, source: 'env' };
  }
  const localKey = readLocalApiKey();
  if (localKey) {
    return { key: localKey, source: 'local' };
  }
  return { key: '', source: 'none' };
};

export const hasGeminiApiKey = (): boolean => Boolean(getGeminiApiKeyInfo().key);

export const setGeminiApiKey = (key: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = key.trim();
  try {
    if (!trimmed) {
      window.localStorage.removeItem(GEMINI_STORAGE_KEY);
    } else {
      window.localStorage.setItem(GEMINI_STORAGE_KEY, trimmed);
    }
  } catch (error) {
    console.warn('Failed to store local API key:', error);
  }
};

export const clearGeminiApiKey = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GEMINI_STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear local API key:', error);
  }
};