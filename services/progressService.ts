/**
 * Learning Progress Service
 *
 * Uses backend API for persistence (production) with localStorage as cache.
 * Falls back to localStorage-only when API is unavailable.
 */

import { apiGet, apiPut, apiPost, isApiAvailable } from './apiClient';

const STORAGE_KEY = 'rp_learning_progress';
const EVENTS_KEY = 'rp_learning_events';

// --- Types ---

export interface CourseProgress {
    courseId: string;
    progress: number;
    completedStages: string[];
    completedSteps: Record<string, string[]>;
    lastAccessedAt: string;
}

interface ProgressStore {
    [courseId: string]: CourseProgress;
}

export interface LearningEvent {
    id: string;
    type: 'lesson_start' | 'lesson_complete' | 'stage_complete' | 'course_complete' | 'diagnosis_complete' | 'course_generated';
    title: { en: string; jp: string };
    description: { en: string; jp: string };
    timestamp: string;
}

// --- localStorage helpers (cache layer) ---

const loadStore = (): ProgressStore => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
};

const saveStore = (store: ProgressStore): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const loadEvents = (): LearningEvent[] => {
    try {
        const raw = localStorage.getItem(EVENTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveEvents = (events: LearningEvent[]): void => {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
};

// --- Sync to API (fire-and-forget) ---

const syncProgressToApi = (courseId: string, data: CourseProgress): void => {
    if (!isApiAvailable()) return;
    apiPut(`/user/progress/${courseId}`, {
        completedStages: data.completedStages,
        completedSteps: data.completedSteps,
    }).catch(e => console.warn('[progressService] API sync failed:', e.message));
};

const syncEventToApi = (event: Omit<LearningEvent, 'id' | 'timestamp'>): void => {
    if (!isApiAvailable()) return;
    apiPost('/user/events', event)
        .catch(e => console.warn('[progressService] Event sync failed:', e.message));
};

// --- Hydrate from API (call once on app boot) ---

export const hydrateFromApi = async (): Promise<void> => {
    if (!isApiAvailable()) return;
    try {
        const [progressRes, eventsRes] = await Promise.all([
            apiGet<{ ok: boolean; progress: Record<string, { completedStages: string[]; completedSteps: Record<string, string[]> }> }>('/user/progress'),
            apiGet<{ ok: boolean; events: LearningEvent[] }>('/user/events'),
        ]);

        if (progressRes.ok && progressRes.progress) {
            const store: ProgressStore = {};
            for (const [courseId, data] of Object.entries(progressRes.progress)) {
                store[courseId] = {
                    courseId,
                    progress: 0,
                    completedStages: data.completedStages || [],
                    completedSteps: data.completedSteps || {},
                    lastAccessedAt: new Date().toISOString(),
                };
            }
            // Merge with local (keep whichever has more data)
            const local = loadStore();
            for (const [courseId, localData] of Object.entries(local)) {
                const remote = store[courseId];
                if (!remote || localData.completedStages.length > remote.completedStages.length) {
                    store[courseId] = localData;
                    // Push local-only data to API
                    syncProgressToApi(courseId, localData);
                }
            }
            saveStore(store);
        }

        if (eventsRes.ok && eventsRes.events && eventsRes.events.length > 0) {
            saveEvents(eventsRes.events);
        }
    } catch (e) {
        console.warn('[progressService] Hydrate failed, using local cache:', (e as Error).message);
    }
};

// --- Public API ---

export const getCourseProgress = (courseId: string): CourseProgress => {
    const store = loadStore();
    return store[courseId] || {
        courseId,
        progress: 0,
        completedStages: [],
        completedSteps: {},
        lastAccessedAt: new Date().toISOString(),
    };
};

export const getAllProgress = (): ProgressStore => loadStore();

export const updateCourseProgress = (courseId: string, progress: number): void => {
    const store = loadStore();
    const existing = getCourseProgress(courseId);
    existing.progress = Math.max(existing.progress, progress);
    existing.lastAccessedAt = new Date().toISOString();
    store[courseId] = existing;
    saveStore(store);
    syncProgressToApi(courseId, existing);
};

export const markStageCompleted = (courseId: string, stageId: string): void => {
    const store = loadStore();
    const existing = getCourseProgress(courseId);
    if (!existing.completedStages.includes(stageId)) {
        existing.completedStages.push(stageId);
    }
    existing.lastAccessedAt = new Date().toISOString();
    store[courseId] = existing;
    saveStore(store);
    syncProgressToApi(courseId, existing);
};

export const isStageCompleted = (courseId: string, stageId: string): boolean => {
    return getCourseProgress(courseId).completedStages.includes(stageId);
};

export const setCompletedStepsForStage = (courseId: string, stageId: string, stepIds: string[]): void => {
    const store = loadStore();
    const existing = getCourseProgress(courseId);
    existing.completedSteps[stageId] = stepIds;
    existing.lastAccessedAt = new Date().toISOString();
    store[courseId] = existing;
    saveStore(store);
    syncProgressToApi(courseId, existing);
};

export const getCompletedStepsForStage = (courseId: string, stageId: string): string[] => {
    return getCourseProgress(courseId).completedSteps[stageId] || [];
};

export const clearCourseProgress = (courseId: string): void => {
    const store = loadStore();
    delete store[courseId];
    saveStore(store);
};

export const clearAllProgress = (): void => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(EVENTS_KEY);
};

export const getLearningEvents = (): LearningEvent[] => loadEvents();

export const addLearningEvent = (event: Omit<LearningEvent, 'id' | 'timestamp'>): void => {
    const events = loadEvents();
    events.unshift({
        ...event,
        id: `e_${Date.now()}`,
        timestamp: new Date().toISOString(),
    });
    if (events.length > 50) events.length = 50;
    saveEvents(events);
    syncEventToApi(event);
};
