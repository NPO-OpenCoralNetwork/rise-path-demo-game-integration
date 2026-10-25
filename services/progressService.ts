/**
 * Learning Progress Service
 *
 * Uses backend API for persistence (production) with localStorage as cache.
 * Falls back to localStorage-only when API is unavailable.
 *
 * Phase 5 (doc/brushup-2026/ai-access-plan.ja.md §9): the server turns Blender stages into XP, so
 * legacy course progress (rp_learning_progress) belongs to a learner. Each entry carries the
 * learner it was recorded for (`ownerId`: whose lesson progress this browser syncs, the account
 * key of components/lesson/progressSync.ts), and goes only to that learner's account, through
 * apiFetchAs (the primary session must be theirs). A tab whose own primary learner (or, without
 * one, the learner it shows) is not the one this browser now syncs writes and sends nothing.
 * Learning events are history only; an event is posted for the learner it was recorded for.
 * Without a synced learner (dev guests, mock users, Nexloom-only sessions) entries are unowned
 * and sent as before, never built on a learner's owned entry (nor shown).
 *
 * The legacy PUT replaces the account's completed_stages, so a change is only ever sent on top of
 * the learner's own data: their stored entry, or their server entry read first through their own
 * session. Another learner's entry, an unowned one or none is never built on; until the server
 * entry is known the change waits in the learner's entry marked `unmerged` (shown, never sent as
 * it is), and the next change or hydrate puts it on top of the server entry. The mark goes only
 * once the server took the result.
 */

import { apiFetchAs, apiGet, apiPut, apiPost, currentAuthUserId, isApiAvailable } from './apiClient';
import { ACHIEVEMENTS_STALE_EVENT } from './achievementsApi';
import { SYNC_ACCOUNT_KEY, parseSyncAccount } from '../components/lesson/progressSync.ts';

const STORAGE_KEY = 'rp_learning_progress';
const EVENTS_KEY = 'rp_learning_events';

// --- Types ---

export interface CourseProgress {
    courseId: string;
    progress: number;
    completedStages: string[];
    completedSteps: Record<string, string[]>;
    lastAccessedAt: string;
    /** Phase 5: the learner it was recorded for (absent: nobody's, e.g. a guest's or before Phase 5). */
    ownerId?: string;
    /**
     * Phase 5: the owner's changes made while their server entry was not known here (the stored
     * entry was another learner's, unowned or missing), until the server took them on top of that
     * entry. Shown, never sent as they are: the next change or hydrate puts them on top of the
     * server entry.
     */
    unmerged?: true;
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
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch { /* Storage full or blocked: keep going without saving. */ }
};

const loadEvents = (): LearningEvent[] => {
    try {
        const raw = localStorage.getItem(EVENTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveEvents = (events: LearningEvent[]): void => {
    try {
        localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    } catch { /* Storage full or blocked: keep going without saving. */ }
};

const emptyEntry = (courseId: string): CourseProgress => ({
    courseId,
    progress: 0,
    completedStages: [],
    completedSteps: {},
    lastAccessedAt: new Date().toISOString(),
});

const stringsOf = (value: unknown): string[] =>
    (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** A course entry as the server sends it, stamped with the learner it was read for (if any). */
const remoteEntry = (courseId: string, data: { completedStages?: unknown; completedSteps?: unknown } | undefined, owner: string | null): CourseProgress => {
    const completedSteps: Record<string, string[]> = {};
    const steps = data?.completedSteps;
    if (steps && typeof steps === 'object' && !Array.isArray(steps)) {
        for (const [stageId, ids] of Object.entries(steps)) completedSteps[stageId] = stringsOf(ids);
    }
    return { ...emptyEntry(courseId), completedStages: stringsOf(data?.completedStages), completedSteps, ...(owner ? { ownerId: owner } : {}) };
};

const joined = (first: string[], second: string[]): string[] => [...first, ...second.filter((id) => !first.includes(id))];

/** The owner's unmerged changes on top of their server entry: stages, and each stage's steps, joined. */
const withChanges = (remote: CourseProgress, changes: CourseProgress): CourseProgress => {
    const completedSteps = { ...remote.completedSteps };
    for (const [stageId, ids] of Object.entries(changes.completedSteps)) completedSteps[stageId] = joined(completedSteps[stageId] ?? [], ids);
    return {
        ...remote,
        progress: Math.max(remote.progress, changes.progress),
        completedStages: joined(remote.completedStages, changes.completedStages),
        completedSteps,
        lastAccessedAt: changes.lastAccessedAt,
    };
};

/** Whether the changes hold a stage or step the server entry lacks. */
const addsTo = (remote: CourseProgress, changes: CourseProgress): boolean =>
    changes.completedStages.some((id) => !remote.completedStages.includes(id))
    || Object.entries(changes.completedSteps).some(([stageId, ids]) => ids.some((id) => !(remote.completedSteps[stageId] ?? []).includes(id)));

const sameContent = (a: CourseProgress, b: CourseProgress): boolean =>
    JSON.stringify([a.completedStages, a.completedSteps]) === JSON.stringify([b.completedStages, b.completedSteps]);

// --- Whose data this is (Phase 5) ---

/** The learner whose lesson progress this browser syncs (not one who left it), or null. */
export const syncedOwner = (): string | null => {
    try {
        const account = parseSyncAccount(localStorage.getItem(SYNC_ACCOUNT_KEY));
        return account && !account.loggedOut ? account.userId : null;
    } catch {
        return null;
    }
};

/**
 * This tab's primary learner: the one its lesson-progress sync runs for (progressSyncClient.ts
 * syncedLearnerId, set from there: that module imports this one). Null when the sync does not run
 * here (guests, mock users, Nexloom-only, signed out).
 */
let tabLearner: () => string | null = () => null;
export const setProgressTabLearner = (source: () => string | null): void => {
    tabLearner = source;
};

/**
 * The owner to record for a change made in this tab, or false when the tab must write nothing:
 * this browser now syncs another learner than this tab's own primary learner (another tab
 * switched it). The tab's primary learner decides, not the learner AuthContext shows (it can be a
 * Nexloom session beside the primary one); without one, the learner shown.
 */
const ownerForWrite = (): string | null | false => {
    const owner = syncedOwner();
    if (!owner) return null;
    let viewer: string | null = null;
    try {
        viewer = tabLearner() ?? currentAuthUserId();
    } catch {
        viewer = currentAuthUserId();
    }
    return viewer && viewer !== owner ? false : owner;
};

const dispatchWindowEvent = (type: string): void => {
    try {
        window.dispatchEvent(new CustomEvent(type));
    } catch {
        // No window or CustomEvent: nothing listens either.
    }
};

// --- Sync to API (fire-and-forget) ---

/**
 * PUT /user/progress/:courseId. With an owner only through that learner's own session (nothing is
 * sent otherwise). Resolves true when the server took it; never rejects.
 */
const syncProgressToApi = async (courseId: string, data: CourseProgress, owner: string | null): Promise<boolean> => {
    if (!isApiAvailable()) return false;
    const body = { completedStages: data.completedStages, completedSteps: data.completedSteps };
    try {
        if (!owner) {
            await apiPut(`/user/progress/${courseId}`, body);
            return true;
        }
        const res = await apiFetchAs(owner, `/user/progress/${courseId}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!res) return false;
        if (!res.ok) throw new Error(`API /user/progress/${courseId}: ${res.status}`);
        return true;
    } catch (e) {
        console.warn('[progressService] API sync failed:', (e as Error).message);
        return false;
    }
};

const syncEventToApi = (event: Omit<LearningEvent, 'id' | 'timestamp'>, owner: string | null): void => {
    if (!isApiAvailable()) return;
    const sent = owner
        ? apiFetchAs(owner, '/user/events', { method: 'POST', body: JSON.stringify(event) }).then((res) => {
            if (res && !res.ok) throw new Error(`API /user/events: ${res.status}`);
        })
        : apiPost('/user/events', event);
    sent.catch(e => console.warn('[progressService] Event sync failed:', e.message));
};

/** apiGet through the learner's own session (null: the session is not theirs, nothing was sent). */
const getAs = async <T>(learnerId: string, path: string): Promise<T | null> => {
    const res = await apiFetchAs(learnerId, path);
    if (!res) return null;
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
    return res.json();
};

// --- Hydrate from API (call once on app boot) ---

type ProgressResponse = { ok: boolean; progress: Record<string, { completedStages: string[]; completedSteps: Record<string, string[]> }> };
type EventsResponse = { ok: boolean; events: LearningEvent[] };

/**
 * Loads the learner's course progress and learning events. `pushLocal` (default true): also
 * upload course progress that only this device has. AuthContext and the adoption choice pass
 * false unless this page load's lesson-progress GET succeeded (whenAccountKnown, Phase 4 design
 * §5.10): until then a re-opened account's old epoch rule has not run, and this device's legacy
 * progress may still be the deleted account's.
 *
 * `learnerId` (Phase 5): the learner the lesson-progress sync runs for (syncedLearnerId). The
 * requests and pushes go only through that learner's own session; after the GETs nothing is
 * written unless this browser still syncs that learner. A local entry counts only when it is that
 * learner's (ownerId), or unowned and `adoptUnowned` (the adoption dialog's "Add"; it is then
 * stamped); other entries are dropped and never pushed (owner O3: device-only data is not carried
 * over), also when the progress GET fails (the learner's own entries then stay as they are, an
 * added one as their unmerged changes). Their unmerged changes go on top of their server entry.
 * Without a learnerId (dev guests, mock users) nothing is pushed and local entries stay.
 */
export const hydrateFromApi = async ({ pushLocal = true, learnerId = null, adoptUnowned = false }: {
    pushLocal?: boolean;
    learnerId?: string | null;
    adoptUnowned?: boolean;
} = {}): Promise<void> => {
    if (!isApiAvailable()) return;
    // Each part stands on its own: a failed events GET must not keep the progress part (and its
    // clean-up of entries that are not this learner's) from running.
    const [progressGot, eventsGot] = await Promise.allSettled([
        learnerId ? getAs<ProgressResponse>(learnerId, '/user/progress') : apiGet<ProgressResponse>('/user/progress'),
        learnerId ? getAs<EventsResponse>(learnerId, '/user/events') : apiGet<EventsResponse>('/user/events'),
    ]);
    for (const got of [progressGot, eventsGot]) {
        if (got.status === 'rejected') console.warn('[progressService] Hydrate failed, using local cache:', (got.reason as Error | null)?.message);
    }
    try {
        // The browser switched to another learner (or they left) while the GETs ran: not theirs to write.
        if (learnerId && syncedOwner() !== learnerId) return;

        const progressRes = progressGot.status === 'fulfilled' ? progressGot.value : null;
        if (progressRes?.ok && progressRes.progress) {
            const store: ProgressStore = {};
            for (const [courseId, data] of Object.entries(progressRes.progress)) store[courseId] = remoteEntry(courseId, data, learnerId);
            // Merge with local (keep whichever has more data)
            const local = loadStore();
            const pushes: [string, CourseProgress][] = [];
            for (const [courseId, localData] of Object.entries(local)) {
                if (learnerId && !(localData.ownerId === learnerId || (!localData.ownerId && adoptUnowned))) continue;
                const remote = store[courseId];
                if (learnerId && localData.unmerged) {
                    // The learner's changes made before their server entry was known here: on top of it.
                    const base = remote ?? remoteEntry(courseId, undefined, learnerId);
                    const merged = withChanges(base, localData);
                    if (!addsTo(base, localData)) {
                        store[courseId] = merged; // the server has them all
                        continue;
                    }
                    // Marked until the server took them: unsent (this page load's lesson-progress GET
                    // failed) or refused, they wait for the next change or hydrate, never for the
                    // "longer wins" rule below (which would lose a step, or a stage when the server
                    // has as many).
                    store[courseId] = { ...merged, unmerged: true };
                    if (pushLocal) pushes.push([courseId, merged]);
                    continue;
                }
                if (!remote || localData.completedStages.length > remote.completedStages.length) {
                    store[courseId] = learnerId ? { ...localData, ownerId: learnerId } : localData;
                    // Push local-only data to API (only to the learner it belongs to)
                    if (pushLocal && learnerId) void syncProgressToApi(courseId, store[courseId], learnerId);
                }
            }
            saveStore(store);
            const owner = learnerId;
            if (owner) {
                for (const [courseId, merged] of pushes) {
                    void syncProgressToApi(courseId, merged, owner).then((sent) => {
                        if (sent) settleSent(courseId, owner, merged);
                    });
                }
            }
        } else if (learnerId) {
            keepOnlyLearners(learnerId, adoptUnowned);
        }

        const eventsRes = eventsGot.status === 'fulfilled' ? eventsGot.value : null;
        if (eventsRes?.ok && eventsRes.events && eventsRes.events.length > 0) {
            saveEvents(eventsRes.events);
        }
    } catch (e) {
        console.warn('[progressService] Hydrate failed, using local cache:', (e as Error).message);
    }
};

/**
 * The progress GET failed: entries that are not the learner's go all the same (never pushed);
 * unowned ones they chose to add stay as their unmerged changes; their own stay as they are.
 */
const keepOnlyLearners = (learnerId: string, adoptUnowned: boolean): void => {
    const kept: ProgressStore = {};
    let changed = false;
    for (const [courseId, entry] of Object.entries(loadStore())) {
        if (entry.ownerId === learnerId) {
            kept[courseId] = entry;
        } else {
            changed = true;
            if (!entry.ownerId && adoptUnowned) kept[courseId] = { ...entry, ownerId: learnerId, unmerged: true };
        }
    }
    if (changed) saveStore(kept);
};

// --- Public API ---

/**
 * The course's entry this tab may show (Phase 5): never another learner's. With a synced learner,
 * theirs, or an unowned entry while they have none of their own (before Phase 5 every entry was
 * unowned: until their first hydrate a stage page shows, and toggles, what it showed before).
 * Without one, only an unowned entry.
 */
export const getCourseProgress = (courseId: string): CourseProgress => {
    const stored = loadStore()[courseId];
    const owner = syncedOwner();
    return stored && (!stored.ownerId || stored.ownerId === owner) ? stored : emptyEntry(courseId);
};

export const getAllProgress = (): ProgressStore => loadStore();

/** Stores the entry for `owner` (unowned without one) and sends it to that learner's account. */
const saveOwned = (courseId: string, entry: CourseProgress, owner: string | null): Promise<boolean> => {
    const store = loadStore();
    const { ownerId: _previous, unmerged: _unmerged, ...rest } = entry;
    const next: CourseProgress = owner ? { ...rest, ownerId: owner } : rest;
    store[courseId] = next;
    saveStore(store);
    return syncProgressToApi(courseId, next, owner);
};

/**
 * The server took `sent` for the owner: the unmerged mark goes, unless a change came meanwhile
 * (still to send: false). True when nothing is left to send.
 */
const settleSent = (courseId: string, owner: string, sent: CourseProgress): boolean => {
    const store = loadStore();
    const entry = store[courseId];
    if (!entry || entry.ownerId !== owner || !entry.unmerged) return true; // merged or gone meanwhile
    if (!sameContent(entry, sent)) return false;
    const { unmerged: _unmerged, ...rest } = entry;
    store[courseId] = rest;
    saveStore(store);
    return true;
};

/** One read of the owner's server entry per learner and course at a time. */
const merging = new Map<string, Promise<boolean>>();
/** Rounds of read + PUT per call while the learner keeps changing the entry during the PUT. */
const MERGE_PASSES = 3;

/**
 * Reads the owner's server entry through their own session, puts their unmerged changes on top
 * and sends the result; the entry stays marked unmerged until the server took it. A change made
 * while this runs joins the unmerged entry and goes with it (made during the PUT: another round).
 * Nothing is sent when the read fails, the session is not theirs, or this tab may no longer write
 * for them: the changes wait for the next change or hydrate. Never rejects.
 */
const mergeAndSend = (courseId: string, owner: string): Promise<boolean> => {
    const key = `${owner}:${courseId}`;
    const running = merging.get(key);
    if (running) return running;
    const run = (async (): Promise<boolean> => {
        try {
            for (let pass = 0; pass < MERGE_PASSES; pass += 1) {
                const res = await getAs<ProgressResponse>(owner, '/user/progress');
                if (!res?.ok || !res.progress || ownerForWrite() !== owner) return false;
                const store = loadStore();
                const changes = store[courseId];
                // Merged meanwhile (a hydrate), or gone (another learner signed in here): nothing to add.
                if (!changes || changes.ownerId !== owner || !changes.unmerged) return pass > 0;
                const next = withChanges(remoteEntry(courseId, res.progress[courseId], owner), changes);
                store[courseId] = { ...next, unmerged: true };
                saveStore(store);
                if (!(await syncProgressToApi(courseId, next, owner))) return false;
                if (settleSent(courseId, owner, next)) return true;
            }
            return true; // sent; a change still coming in waits for the next change or hydrate
        } catch (e) {
            console.warn('[progressService] API read failed:', (e as Error).message);
            return false;
        }
    })();
    merging.set(key, run);
    void run.then(() => {
        if (merging.get(key) === run) merging.delete(key);
    });
    return run;
};

/**
 * Records a change to the course's entry and sends it; resolves true when the server took it.
 * A stale tab writes and sends nothing. Without a synced learner an unowned stored entry is built
 * on and sent as before; a learner's entry never is (it would become unowned, and the next
 * learner's "Add" would take that learner's stages). With one (the owner) only their own merged
 * entry is built on (G25): otherwise the change is stored as their unmerged changes and goes on
 * top of their server entry.
 */
const changeEntry = (courseId: string, change: (entry: CourseProgress) => void): Promise<boolean> => {
    const owner = ownerForWrite();
    if (owner === false) return Promise.resolve(false);
    const stored: CourseProgress | undefined = loadStore()[courseId];
    const base = owner ? (stored?.ownerId === owner ? stored : undefined) : (stored && !stored.ownerId ? stored : undefined);
    const entry: CourseProgress = base
        ? { ...base, completedStages: [...base.completedStages], completedSteps: { ...base.completedSteps } }
        : emptyEntry(courseId);
    change(entry);
    entry.lastAccessedAt = new Date().toISOString();
    if (!owner || (base && !base.unmerged)) return saveOwned(courseId, entry, owner);
    const store = loadStore();
    store[courseId] = { ...entry, ownerId: owner, unmerged: true };
    saveStore(store);
    return mergeAndSend(courseId, owner);
};

export const updateCourseProgress = (courseId: string, progress: number): void => {
    void changeEntry(courseId, (entry) => {
        entry.progress = Math.max(entry.progress, progress);
    });
};

export const markStageCompleted = (courseId: string, stageId: string): void => {
    void changeEntry(courseId, (entry) => {
        if (!entry.completedStages.includes(stageId)) entry.completedStages.push(stageId);
    }).then((sent) => {
        // The server may award XP for it: the badges and XP are read again once it was taken.
        if (sent) dispatchWindowEvent(ACHIEVEMENTS_STALE_EVENT);
    });
};

export const isStageCompleted = (courseId: string, stageId: string): boolean => {
    return getCourseProgress(courseId).completedStages.includes(stageId);
};

export const setCompletedStepsForStage = (courseId: string, stageId: string, stepIds: string[]): void => {
    void changeEntry(courseId, (entry) => {
        entry.completedSteps[stageId] = stepIds;
    });
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
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(EVENTS_KEY);
    } catch { /* Storage blocked: nothing to clear. */ }
};

export const getLearningEvents = (): LearningEvent[] => loadEvents();

export const addLearningEvent = (event: Omit<LearningEvent, 'id' | 'timestamp'>): void => {
    // History only (Phase 5: never XP). Recorded for the learner this browser syncs now.
    const owner = ownerForWrite();
    if (owner === false) return;
    const events = loadEvents();
    events.unshift({
        ...event,
        id: `e_${Date.now()}`,
        timestamp: new Date().toISOString(),
    });
    if (events.length > 50) events.length = 50;
    saveEvents(events);
    syncEventToApi(event, owner);
};
