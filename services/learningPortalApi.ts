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

export const fetchLearningPortals = async (options?: { includeInactive?: boolean }): Promise<LearningPortal[]> => {
  const params = new URLSearchParams();
  if (options?.includeInactive) {
    params.set('include_inactive', 'true');
  }
  const query = params.toString();
  const response = await fetch(`/api/learning-portals${query ? `?${query}` : ''}`);
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

export const updateLearningPortal = async (
  id: string,
  updates: { isActive?: boolean; sortOrder?: number }
): Promise<void> => {
  const payload: Record<string, unknown> = {};
  if (typeof updates.isActive === 'boolean') {
    payload.is_active = updates.isActive;
  }
  if (typeof updates.sortOrder === 'number' && Number.isFinite(updates.sortOrder)) {
    payload.sort_order = updates.sortOrder;
  }
  const response = await fetch(`/api/learning-portals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.json().catch(() => null);
    throw new Error(message?.error || 'Failed to update learning portal.');
  }
};

export const updateLearningPortalOrder = async (order: Array<{ id: string; sortOrder: number }>): Promise<void> => {
  const response = await fetch('/api/learning-portals/order', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: order.map(item => ({ id: item.id, sort_order: item.sortOrder })) }),
  });
  if (!response.ok) {
    const message = await response.json().catch(() => null);
    throw new Error(message?.error || 'Failed to reorder learning portals.');
  }
};
