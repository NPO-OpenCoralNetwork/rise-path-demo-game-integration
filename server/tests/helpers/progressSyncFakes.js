// Fakes for the lesson progress sync core (components/lesson/progressSync.ts), shared by
// lessonProgressSync.test.js (Phase 2–4) and progressSyncPhase5.test.js (Phase 5): a memory
// localStorage, a fake clock with timers, and the REST API with an in-memory server that merges
// like tools/core/lessonProgress.js. With `phase5` the fake server also behaves like the Phase 5
// server: GET sends capabilities and each record's generation (lessonEpoch, lessonResetAt), PUT
// refuses a record whose lessonEpoch is not the lesson's current one ('lesson_reset', with the
// generation and the stored record), POST /lesson-reset empties one lesson and starts a new
// generation, and delete-all keeps the generations (019: reset rows survive it). Without it, it is
// an older server (no capabilities, no generation fields, lessonEpoch ignored).
import { randomUUID } from 'node:crypto';
import { createProgressSync, parseSyncAccount, pendingKey, SYNC_ACCOUNT_KEY } from '../../../components/lesson/progressSync.ts';
import { progressKey } from '../../../components/lesson/progressStore.ts';
import { mergeProgress, sanitizeProgress } from '../../../shared/lesson/progressMerge.js';
import { emptyProgress, parseProgress } from '../../../shared/lesson/progress.js';
import { isUuid } from '../../utils/ids.js';

export const START = Date.parse('2026-10-20T09:00:00.000Z');
export const iso = (minutes) => new Date(START + minutes * 60_000).toISOString();

export const COURSE = 'course-a';
/** The client bundle's syncable lessons: course-a lessons named l*. */
export const isSyncable = (courseSlug, lessonId) => courseSlug === COURSE && lessonId.startsWith('l');
/** The server catalog knows them all except l-new (version skew: a newer front end). */
export const serverKnows = (courseSlug, lessonId) => isSyncable(courseSlug, lessonId) && lessonId !== 'l-new';

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export const putLocal = (storage, lessonId, progress) => storage.setItem(progressKey(COURSE, lessonId), JSON.stringify(progress));
export const getLocal = (storage, lessonId) => {
  const raw = storage.getItem(progressKey(COURSE, lessonId));
  return raw === null ? null : JSON.parse(raw);
};
export const marker = (storage, lessonId) => storage.getItem(pendingKey(COURSE, lessonId));
export const account = (storage) => parseSyncAccount(storage.getItem(SYNC_ACCOUNT_KEY));
export const setAccount = (storage, userId, epoch) => storage.setItem(SYNC_ACCOUNT_KEY, JSON.stringify({ userId, epoch }));

export const settle = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

export function fakeClock() {
  let t = START;
  let seq = 0;
  const queue = [];
  return {
    now: () => t,
    /** Timers waiting (tests count them). */
    pending: () => queue.length,
    timers: {
      setTimeout(fn, ms) {
        const handle = { at: t + Math.max(0, ms), fn, seq: (seq += 1) };
        queue.push(handle);
        return handle;
      },
      clearTimeout(handle) {
        const i = queue.indexOf(handle);
        if (i >= 0) queue.splice(i, 1);
      },
    },
    /** Runs every timer due within `ms`, letting promises settle between them. */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await settle();
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        t = next.at;
        next.fn();
      }
      t = end;
      await settle();
    },
  };
}

/**
 * The REST API with an in-memory server that merges like tools/core/lessonProgress.js (sanitize,
 * mergeProgress, 409 on a stale epoch, unknown_lesson per record). Steps queued with `script`
 * run instead of the default for the next call: { error } throws it, { hold } waits for release,
 * { respond } answers with that function's result.
 */
export function fakeApi({ epoch = null, rows = [], clock, phase5 = false } = {}) {
  const server = {
    epoch,
    rows: new Map(rows.map((row) => [`${row.courseSlug}:${row.lessonId}`, row])),
    /** Phase 5: lesson generations, `${course}:${lesson}` → { epoch, at } (never removed by a delete). */
    resets: new Map(),
    phase5,
    /** Phase 5 GET capabilities (undefined: an older server). */
    capabilities: phase5 ? { lessonReset: true, achievements: true } : undefined,
    /** true: every request fails like a dropped network (status 0), after scripted steps. */
    offline: false,
  };
  const calls = [];
  const scripts = { get: [], put: [], del: [], reset: [] };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const nextStep = async (kind) => {
    const step = scripts[kind].shift();
    if (step?.hold) await step.hold;
    if (step?.error) throw step.error;
    if (!step && server.offline) throw Object.assign(new Error('Network error'), { status: 0, errorType: 'network' });
    return step;
  };
  const genOf = (key) => server.resets.get(key) ?? { epoch: null, at: null };
  /** The row as the server sends it (with its generation when the server is Phase 5). */
  const out = (key, row) => (server.phase5 ? { ...clone(row), lessonEpoch: genOf(key).epoch, lessonResetAt: genOf(key).at } : clone(row));
  function resetOnServer(courseSlug, lessonId, atMs = clock?.now() ?? START) {
    const key = `${courseSlug}:${lessonId}`;
    const gen = { epoch: randomUUID(), at: new Date(atMs).toISOString() };
    server.resets.set(key, gen);
    const row = { courseSlug, lessonId, progress: emptyProgress(), pct: 0, state: 'not_started', updatedAt: new Date(0).toISOString() };
    server.rows.set(key, row);
    return { gen, row: out(key, row) };
  }
  const defaultPut = (body) => {
    if (body.epoch !== server.epoch) {
      throw Object.assign(new Error('reset'), { status: 409, errorType: 'progress_reset', epoch: server.epoch });
    }
    const records = [];
    const rejected = [];
    for (const item of body.records) {
      if (!serverKnows(item.courseSlug, item.lessonId)) {
        rejected.push({ courseSlug: item.courseSlug, lessonId: item.lessonId, error_type: 'unknown_lesson' });
        continue;
      }
      const key = `${item.courseSlug}:${item.lessonId}`;
      if (server.phase5) {
        // As tools/core/lessonProgress.js: a lessonEpoch that is not a uuid counts as null.
        const sent = isUuid(item.lessonEpoch) ? item.lessonEpoch.toLowerCase() : null;
        const gen = genOf(key);
        if (sent !== gen.epoch) {
          const stored = server.rows.get(key);
          rejected.push({
            courseSlug: item.courseSlug,
            lessonId: item.lessonId,
            error_type: 'lesson_reset',
            lessonEpoch: gen.epoch,
            lessonResetAt: gen.at,
            ...(stored ? { record: out(key, stored) } : {}),
          });
          continue;
        }
      }
      const stored = server.rows.get(key);
      const merged = mergeProgress(stored ? parseProgress(stored.progress) : null, sanitizeProgress(item.progress, { now: clock?.now() }));
      const row = { courseSlug: item.courseSlug, lessonId: item.lessonId, progress: merged, pct: Math.min(100, merged.seen.length * 10), state: 'in_progress', updatedAt: merged.updatedAt };
      server.rows.set(key, row);
      records.push(out(key, row));
    }
    return { epoch: server.epoch, records, rejected };
  };
  return {
    server,
    calls,
    puts: () => calls.filter((call) => call.kind === 'put'),
    gets: () => calls.filter((call) => call.kind === 'get'),
    resets: () => calls.filter((call) => call.kind === 'reset'),
    script(kind, step) {
      scripts[kind].push(step);
    },
    hold(kind) {
      let release;
      const hold = new Promise((resolve) => {
        release = resolve;
      });
      scripts[kind].push({ hold });
      return release;
    },
    /** Phase 5: start one lesson over on the server, as another device would (POST /lesson-reset). */
    resetOnServer,
    async get() {
      calls.push({ kind: 'get' });
      const step = await nextStep('get');
      if (step?.respond) return step.respond();
      // restarted: the account was deleted and opened again (Phase 4, server/routes/lessonProgress.js).
      return {
        epoch: server.epoch,
        ...(server.restarted ? { restarted: true } : {}),
        ...(server.capabilities ? { capabilities: clone(server.capabilities) } : {}),
        records: [...server.rows.entries()].map(([key, row]) => out(key, row)),
      };
    },
    async put(body, { keepalive }) {
      calls.push({ kind: 'put', body: clone(body), keepalive, bytes: JSON.stringify(body).length, at: clock?.now() });
      const step = await nextStep('put');
      if (step?.respond) return step.respond(body);
      return defaultPut(body);
    },
    async del() {
      calls.push({ kind: 'del' });
      await nextStep('del');
      const deleted = server.rows.size;
      server.rows.clear();
      server.epoch = randomUUID();
      return { deleted, epoch: server.epoch };
    },
    async resetLesson(body) {
      calls.push({ kind: 'reset', body: clone(body), at: clock?.now() });
      const step = await nextStep('reset');
      if (step?.respond) return step.respond(body);
      if (!server.phase5) throw Object.assign(new Error('Not found'), { status: 404 });
      if (body.epoch !== server.epoch) {
        throw Object.assign(new Error('reset'), { status: 409, errorType: 'progress_reset', epoch: server.epoch });
      }
      if (!serverKnows(body.courseSlug, body.lessonId)) {
        throw Object.assign(new Error('unknown'), { status: 400, errorType: 'unknown_lesson' });
      }
      const { gen, row } = resetOnServer(body.courseSlug, body.lessonId);
      return { epoch: server.epoch, lessonEpoch: gen.epoch, lessonResetAt: gen.at, record: row };
    },
  };
}

export function setup({ storage = memoryStorage(), rows = [], epoch = null, apiEnabled, phase5 = false, random = () => 0.5 } = {}) {
  const clock = fakeClock();
  const api = fakeApi({ epoch, rows, clock, phase5 });
  const events = { progress: [], account: 0 };
  const sync = createProgressSync({
    storage,
    api,
    isSyncable,
    apiEnabled,
    now: clock.now,
    timers: clock.timers,
    random,
    lessonTitle: (courseSlug, lessonId) => `Title of ${lessonId}`,
    events: {
      progress: (detail) => events.progress.push(detail),
      account: () => {
        events.account += 1;
      },
    },
  });
  return { sync, storage, api, clock, events };
}

/** Two tabs of one browser: one storage, one server, one clock. */
export function twoTabs({ storage = memoryStorage(), rows = [], epoch = null, phase5 = false } = {}) {
  const clock = fakeClock();
  const api = fakeApi({ epoch, rows, clock, phase5 });
  const make = () => createProgressSync({ storage, api, isSyncable, now: clock.now, timers: clock.timers, random: () => 0.5 });
  return { storage, api, clock, a: make(), b: make() };
}
