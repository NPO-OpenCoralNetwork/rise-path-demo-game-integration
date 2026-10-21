import { LearningPortal, LocalizedText } from '../types';

type LearningPortalResponse = {
  ok: boolean;
  portals?: LearningPortal[];
  error?: string;
};

const normalizeLocalizedText = (value: unknown): LocalizedText => {
  if (!value) {
    return { en: '', jp: '' };
  }
  if (typeof value === 'string') {
    return { en: value, jp: value };
  }
  if (typeof value !== 'object') {
    return { en: '', jp: '' };
  }
  const record = value as Record<string, unknown>;
  const en = typeof record.en === 'string' ? record.en : '';
  const jp = typeof record.jp === 'string' ? record.jp : '';
  return {
    en: en || jp,
    jp: jp || en,
  };
};

// GET /api/learning-portals is a public legacy route outside /api/v2 (server.js), so it needs no
// token. The server has no routes to edit portals.
export const fetchLearningPortals = async (): Promise<LearningPortal[]> => {
  const response = await fetch('/api/learning-portals');
  if (!response.ok) {
    throw new Error('Failed to load learning portals.');
  }

  const payload: LearningPortalResponse = await response.json();
  if (!payload.portals || !Array.isArray(payload.portals)) {
    return [];
  }

  return payload.portals.map((portal) => ({
    ...portal,
    title: normalizeLocalizedText(portal.title),
    subtitle: normalizeLocalizedText(portal.subtitle),
    description: normalizeLocalizedText(portal.description),
    isActive: typeof portal.isActive === 'boolean' ? portal.isActive : true,
    sortOrder: typeof portal.sortOrder === 'number' && Number.isFinite(portal.sortOrder) ? portal.sortOrder : 0,
  }));
};
