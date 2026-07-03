import { apiFetch, apiGet, isApiAvailable } from './apiClient';
import { clearUserProfileCache } from './userProfileService';

const PRIVACY_STORAGE_KEY = 'rp_ai_memory_privacy_v1';

export type AiMemoryPrivacyPrefs = {
  enabled: boolean;
  allow_conversation_capture: boolean;
};

export type LearnerMemoryItem = {
  id?: string;
  type?: string;
  title?: string | null;
  content?: string;
  confidence?: number;
  tags?: string[];
  score?: number | null;
  created_at?: string | null;
};

const DEFAULT_PRIVACY: AiMemoryPrivacyPrefs = {
  enabled: false,
  allow_conversation_capture: false,
};

function loadLocalPrivacy(): AiMemoryPrivacyPrefs {
  if (typeof window === 'undefined') return DEFAULT_PRIVACY;
  try {
    const raw = window.localStorage.getItem(PRIVACY_STORAGE_KEY);
    if (!raw) return DEFAULT_PRIVACY;
    const parsed = JSON.parse(raw) as Partial<AiMemoryPrivacyPrefs>;
    return {
      enabled: parsed.enabled === true,
      allow_conversation_capture: parsed.allow_conversation_capture === true,
    };
  } catch {
    return DEFAULT_PRIVACY;
  }
}

function saveLocalPrivacy(prefs: AiMemoryPrivacyPrefs): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(prefs));
}

export async function loadAiMemoryPrivacy(): Promise<AiMemoryPrivacyPrefs> {
  if (!isApiAvailable()) {
    return loadLocalPrivacy();
  }

  try {
    const res = await apiGet<{ ok: boolean; privacy?: AiMemoryPrivacyPrefs }>(
      '/learner-memory/privacy',
    );
    const privacy = res.privacy ?? DEFAULT_PRIVACY;
    saveLocalPrivacy(privacy);
    return privacy;
  } catch {
    return loadLocalPrivacy();
  }
}

export async function saveAiMemoryPrivacy(
  patch: Partial<AiMemoryPrivacyPrefs>,
): Promise<AiMemoryPrivacyPrefs> {
  const current = await loadAiMemoryPrivacy();
  const next: AiMemoryPrivacyPrefs = {
    enabled: patch.enabled ?? current.enabled,
    allow_conversation_capture: patch.enabled === false
      ? false
      : (patch.allow_conversation_capture ?? current.allow_conversation_capture),
  };

  if (!isApiAvailable()) {
    saveLocalPrivacy(next);
    return next;
  }

  const res = await apiFetch('/learner-memory/privacy', {
    method: 'PUT',
    body: JSON.stringify(next),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Failed to save AI memory settings (${res.status})`,
    );
  }

  const body = await res.json() as { privacy?: AiMemoryPrivacyPrefs };
  const privacy = body.privacy ?? next;
  saveLocalPrivacy(privacy);
  clearUserProfileCache();
  return privacy;
}

export async function listLearnerMemories(limit = 50): Promise<{
  count: number;
  memories: LearnerMemoryItem[];
  semantic_memory_status: string;
}> {
  if (!isApiAvailable()) {
    return { count: 0, memories: [], semantic_memory_status: 'disabled' };
  }

  const res = await apiFetch(`/learner-memory?limit=${encodeURIComponent(String(limit))}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to list memories (${res.status})`);
  }

  const body = await res.json() as {
    count?: number;
    memories?: LearnerMemoryItem[];
    semantic_memory_status?: string;
  };

  return {
    count: body.count ?? 0,
    memories: body.memories ?? [],
    semantic_memory_status: body.semantic_memory_status ?? 'disabled',
  };
}

export async function deleteLearnerMemory(memoryId: string): Promise<void> {
  if (!isApiAvailable()) return;

  const res = await apiFetch(`/learner-memory/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Delete failed (${res.status})`);
  }
}

export async function purgeAllLearnerMemories(): Promise<void> {
  if (!isApiAvailable()) return;

  const res = await apiFetch('/learner-memory', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Purge failed (${res.status})`);
  }
}