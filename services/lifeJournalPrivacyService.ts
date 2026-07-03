import { apiFetch, apiGet, isApiAvailable } from './apiClient';
import { clearUserProfileCache } from './userProfileService';
import { getClientTimezone } from './agentApi';

const STORAGE_KEY = 'rp_life_journal_v1';
const PRIVACY_STORAGE_KEY = 'rp_life_journal_privacy_v1';

export type LifeJournalPrivacyPrefs = {
  allow_diary_excerpts_in_ai: boolean;
};

const DEFAULT_PRIVACY: LifeJournalPrivacyPrefs = {
  allow_diary_excerpts_in_ai: false,
};

function loadLocalPrivacy(): LifeJournalPrivacyPrefs {
  if (typeof window === 'undefined') return DEFAULT_PRIVACY;
  try {
    const raw = window.localStorage.getItem(PRIVACY_STORAGE_KEY);
    if (!raw) return DEFAULT_PRIVACY;
    const parsed = JSON.parse(raw) as Partial<LifeJournalPrivacyPrefs>;
    return {
      allow_diary_excerpts_in_ai: parsed.allow_diary_excerpts_in_ai === true,
    };
  } catch {
    return DEFAULT_PRIVACY;
  }
}

function saveLocalPrivacy(prefs: LifeJournalPrivacyPrefs): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(prefs));
}

export async function loadLifeJournalPrivacy(): Promise<LifeJournalPrivacyPrefs> {
  if (!isApiAvailable()) {
    return loadLocalPrivacy();
  }

  try {
    const res = await apiGet<{ ok: boolean; privacy?: LifeJournalPrivacyPrefs }>(
      '/life-journal/privacy',
    );
    const privacy = res.privacy ?? DEFAULT_PRIVACY;
    saveLocalPrivacy(privacy);
    return privacy;
  } catch {
    return loadLocalPrivacy();
  }
}

export async function saveLifeJournalPrivacy(
  patch: Partial<LifeJournalPrivacyPrefs>,
): Promise<LifeJournalPrivacyPrefs> {
  const current = await loadLifeJournalPrivacy();
  const next: LifeJournalPrivacyPrefs = {
    ...current,
    ...patch,
  };

  if (!isApiAvailable()) {
    saveLocalPrivacy(next);
    return next;
  }

  const res = await apiFetch('/user/profile', {
    method: 'PUT',
    body: JSON.stringify({
      preferences: {
        privacy: {
          life_journal: next,
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Failed to save privacy settings (${res.status})`,
    );
  }

  saveLocalPrivacy(next);
  clearUserProfileCache();
  return next;
}

export interface LifeJournalExportPayload {
  ok: boolean;
  exported_at: string;
  schema_version: string;
  from: string;
  to: string;
  timezone: string;
  /** Days with at least one journal field populated */
  entry_count: number;
  /** Full calendar span (includes empty days); present on server export */
  total_days_in_range?: number;
  days: unknown[];
}

export async function exportLifeJournalData(): Promise<LifeJournalExportPayload> {
  const timezone = getClientTimezone();

  if (!isApiAvailable()) {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const store = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const days = Object.entries(store)
      .map(([date, entry]) => ({ date, ...(entry as object) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      ok: true,
      exported_at: new Date().toISOString(),
      schema_version: '2026-06-24-demo',
      from: days[0]?.date as string ?? '',
      to: days[days.length - 1]?.date as string ?? '',
      timezone,
      entry_count: days.length,
      days,
    };
  }

  const res = await apiFetch(`/life-journal/export?timezone=${encodeURIComponent(timezone)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Export failed (${res.status})`);
  }
  return res.json();
}

export function downloadLifeJournalExport(payload: LifeJournalExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `rise-path-life-journal-${payload.from}-${payload.to}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function deleteAllLifeJournalData(): Promise<void> {
  if (!isApiAvailable()) {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return;
  }

  const res = await apiFetch('/life-journal/data', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE', scope: 'all' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Delete failed (${res.status})`);
  }
}