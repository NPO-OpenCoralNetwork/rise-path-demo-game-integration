import { apiGet, apiPost, apiPut, isApiAvailable } from './apiClient';

export interface AppNotification {
  id: string;
  type: 'achievement' | 'reminder' | 'system' | 'tip';
  title: { en: string; jp: string };
  body: { en: string; jp: string };
  read: boolean;
  created_at: string;
}

const STORAGE_KEY = 'rp_notifications';

// --- localStorage cache ---

const getLocal = (): AppNotification[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
};

const saveLocal = (items: AppNotification[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

// --- Public API ---

export const getNotifications = (): AppNotification[] => getLocal();

export const getUnreadCount = (): number => getLocal().filter(n => !n.read).length;

export const addNotification = (n: Omit<AppNotification, 'id' | 'read' | 'created_at'>) => {
  // Local
  const items = getLocal();
  const newItem: AppNotification = {
    ...n,
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    read: false,
    created_at: new Date().toISOString(),
  };
  items.unshift(newItem);
  saveLocal(items.slice(0, 30));

  // API sync
  if (isApiAvailable()) {
    apiPost('/user/notifications', n).catch(() => {});
  }
};

export const markAsRead = (id: string) => {
  const items = getLocal();
  const item = items.find(n => n.id === id);
  if (item) { item.read = true; saveLocal(items); }

  if (isApiAvailable()) {
    apiPut(`/user/notifications/${id}/read`, {}).catch(() => {});
  }
};

export const markAllAsRead = () => {
  const items = getLocal();
  items.forEach(n => { n.read = true; });
  saveLocal(items);

  if (isApiAvailable()) {
    apiPut('/user/notifications/read-all', {}).catch(() => {});
  }
};

export const clearNotifications = () => {
  localStorage.removeItem(STORAGE_KEY);
};

// Hydrate from API
export const hydrateNotifications = async (): Promise<void> => {
  if (!isApiAvailable()) return;
  try {
    const res = await apiGet<{ ok: boolean; notifications: AppNotification[] }>('/user/notifications');
    if (res.ok && res.notifications?.length > 0) {
      saveLocal(res.notifications);
    }
  } catch {
    // Use local cache
  }
};

// Seed initial notifications if empty (for new users)
export const seedDemoNotifications = () => {
  if (getLocal().length > 0) return;
  const demos: Omit<AppNotification, 'id' | 'read' | 'created_at'>[] = [
    {
      type: 'system',
      title: { en: 'Welcome to Rise Path!', jp: 'Rise Pathへようこそ！' },
      body: { en: 'Start your learning journey by exploring the Learning Hub.', jp: 'ラーニングハブを探索して学習を始めましょう。' },
    },
    {
      type: 'tip',
      title: { en: 'Try AI Diagnosis', jp: 'AI診断を試してみよう' },
      body: { en: 'Take the personality assessment to get personalized course recommendations.', jp: 'パーソナリティ診断で自分に合ったコースを見つけましょう。' },
    },
  ];
  demos.forEach(d => addNotification(d));
};
