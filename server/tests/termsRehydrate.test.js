// @ts-check
// Phase 8 in-app check, finding 1 (S5): with the server's terms check on (LEGAL_TERMS_REQUIRED), the
// reads AuthContext makes at sign-in (legacy course progress GET /user/progress, learning events
// GET /user/events, notifications GET /user/notifications) are refused with 403 terms_required
// while the consent page shows. Nothing read them again after 「同意して続ける」, so until the next
// reload or sign-in the learner's server-side legacy progress, history and notifications were not
// merged on that device. Now:
// - services/apiClient.ts: apiGet (and progressService's getAs) throw ApiReadError, whose
//   termsRequired says the server's terms check refused the read (the message is unchanged);
// - hydrateFromApi and hydrateNotifications answer whether a read was refused that way;
// - services/termsRetry.ts runs them once more after this page recorded an acceptance
//   (LEGAL_ACCEPTED_EVENT), only when they were refused that way: with the check off nothing is,
//   so nothing changes (no extra request);
// - context/AuthContext.tsx wires it (read as source).
// The services are bundled with esbuild (Vite modules) with the course outline, Supabase and React
// stubbed, against a fake window, storage and fetch (the harness of legacyProgressOwner.test.js).
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** @param {string} rel */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEGACY_KEY = 'rp_learning_progress';
const EVENTS_KEY = 'rp_learning_events';
const NOTIFICATIONS_KEY = 'rp_notifications';

/** @type {Record<string, string>} */
const STUBS = {
  content: `
    export const getCourse = () => undefined;
    export const getLessonEntry = () => undefined;
  `,
  supabase: `
    export const getSupabaseClient = () => globalThis.__supabase ?? null;
    export const getNexloomSupabaseClient = () => null;
    export const isSupabaseConfigured = () => true;
  `,
  react: 'export const useSyncExternalStore = () => undefined;',
};

/** @type {import('esbuild').Plugin} */
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/\.\.\/content$/ }, () => ({ path: 'content', namespace: 'stub' }));
    b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

/** @param {string} contents */
async function bundle(contents) {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': '{"PROD":true}' },
    plugins: [stubPlugin],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

let loads = 0;
/** @param {string} code */
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(`${code}\n// load ${(loads += 1)}`).toString('base64')}`);

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @param {() => boolean} check */
async function until(check, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TERMS_REQUIRED = () => json(403, { error: 'Accept the current terms of use to continue.', error_type: 'terms_required', current: { terms: 't', privacy: 'p' } });

// ---------------------------------------------------------------------------------------------
// services/termsRetry.ts
// ---------------------------------------------------------------------------------------------

describe('createTermsRetry: runs again after an acceptance only when the last run was refused for the terms', () => {
  /** @type {any} */
  let mod = null;
  before(async () => {
    mod = await load(await bundle("export { createTermsRetry } from './services/termsRetry';"));
  });

  /**
   * A task whose answers the test gives: each run waits for `answer(refused)` (or answers at once
   * with `auto`).
   * @param {boolean | null} [auto]
   */
  const tasks = (auto = null) => {
    /** @type {Array<(refused: boolean) => void>} */
    const waiting = [];
    let runs = 0;
    const task = () => {
      runs += 1;
      if (auto !== null) return Promise.resolve(auto);
      return new Promise((resolve) => waiting.push(resolve));
    };
    return {
      task,
      runs: () => runs,
      /** @param {boolean} refused */
      answer: async (refused) => {
        const next = waiting.shift();
        assert.ok(next, 'a run is waiting');
        next(refused);
        await wait(0);
      },
      waiting: () => waiting.length,
    };
  };

  it('never refused (the server check off): an acceptance adds no run', async () => {
    const t = tasks(false);
    const retry = mod.createTermsRetry(t.task);
    await retry.run();
    retry.accepted();
    retry.accepted();
    await wait(5);
    assert.equal(t.runs(), 1);
  });

  it('refused, then accepted: exactly one more run; a later acceptance adds none once it read', async () => {
    const t = tasks();
    const retry = mod.createTermsRetry(t.task);
    const first = retry.run();
    await t.answer(true);
    await first;
    assert.equal(t.runs(), 1);
    retry.accepted();
    assert.equal(t.runs(), 2, 'read again at once');
    retry.accepted();
    assert.equal(t.runs(), 2, 'not twice for the run on its way');
    await t.answer(false);
    retry.accepted();
    await wait(5);
    assert.equal(t.runs(), 2, 'the read went through: nothing more');
  });

  it('accepted while a run is on its way that then answers refused (its check ran first): exactly one more run', async () => {
    const t = tasks();
    const retry = mod.createTermsRetry(t.task);
    const first = retry.run();
    retry.accepted();
    assert.equal(t.runs(), 1, 'the run on its way decides');
    await t.answer(true);
    await until(() => t.runs() === 2);
    await t.answer(false);
    await first;
    await wait(5);
    assert.equal(t.runs(), 2);
  });

  it('accepted while a run is on its way that then succeeds: no more run', async () => {
    const t = tasks();
    const retry = mod.createTermsRetry(t.task);
    const first = retry.run();
    retry.accepted();
    await t.answer(false);
    await first;
    await wait(5);
    assert.equal(t.runs(), 1);
  });

  it('a run that started after the acceptance covers an older refused one (no third run)', async () => {
    const t = tasks();
    const retry = mod.createTermsRetry(t.task);
    const older = retry.run();
    retry.accepted();
    const newer = retry.run(); // a session event (SIGNED_IN on focus) after the acceptance
    await t.answer(true); // the older one: refused, but the newer one started after the acceptance
    await t.answer(false);
    await Promise.all([older, newer]);
    await wait(5);
    assert.equal(t.runs(), 2);
  });

  it('refused again after the acceptance (another API process had not seen it yet): waits for the next acceptance, no loop', async () => {
    const t = tasks();
    const retry = mod.createTermsRetry(t.task);
    const first = retry.run();
    await t.answer(true);
    await first;
    retry.accepted();
    await t.answer(true);
    await wait(5);
    assert.equal(t.runs(), 2, 'no loop');
    retry.accepted();
    assert.equal(t.runs(), 3);
    await t.answer(false);
  });

  it('a task that throws counts as not refused', async () => {
    let runs = 0;
    const retry = mod.createTermsRetry(async () => {
      runs += 1;
      throw new Error('boom');
    });
    await retry.run();
    retry.accepted();
    await wait(5);
    assert.equal(runs, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// The real reads: apiGet, hydrateFromApi, hydrateNotifications, composed as AuthContext does
// ---------------------------------------------------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    /** @param {number} i */
    key: (i) => [...map.keys()][i] ?? null,
    /** @param {string} key */
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    /** @param {string} key @param {unknown} value */
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    /** @param {string} key */
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** @type {string} */
let servicesBundle = '';

/**
 * A page with the services loaded, the primary session U1's and a fake API. `server.terms` is the
 * server's terms check: 'off' (never refuses), 'needed' (refuses every gated read with
 * terms_required), 'accepted'.
 * @param {{ terms?: 'off' | 'needed' | 'accepted', routes?: Record<string, () => Response> }} [o]
 */
async function page({ terms = 'off', routes = {} } = {}) {
  const storage = memoryStorage();
  /** @type {any} */
  const win = new EventTarget();
  win.localStorage = storage;
  /** @type {any} */
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  Object.assign(globalThis, { window: win, document: doc, localStorage: storage });
  /** @type {any} */ (globalThis).__supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: U1 }, access_token: 'tok-session' } } }) },
  };
  const server = { terms };
  /** @type {Array<{ method: string, url: string }>} */
  const calls = [];
  const GATED = new Set(['/user/progress', '/user/events', '/user/notifications']);
  /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const call = { url: String(url).replace(/^\/api\/v2/, ''), method: init.method ?? 'GET' };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`];
    if (route) return route();
    if (call.method === 'GET' && GATED.has(call.url) && server.terms === 'needed') return TERMS_REQUIRED();
    if (call.url === '/user/lesson-progress' && call.method === 'GET') return json(200, { ok: true, epoch: null, records: [] });
    if (call.url === '/user/progress' && call.method === 'GET') return json(200, { ok: true, progress: { blender: { completedStages: ['1', '2'], completedSteps: {} } } });
    if (call.url === '/user/events' && call.method === 'GET') return json(200, { ok: true, events: [{ id: 'e1', type: 'stage_complete', title: { en: 'S', jp: 'S' }, description: { en: '', jp: '' }, timestamp: '2026-10-29T00:00:00.000Z' }] });
    if (call.url === '/user/notifications' && call.method === 'GET') return json(200, { ok: true, notifications: [{ id: 'n1', type: 'system', title: { en: 'Hi', jp: 'こんにちは' }, body: { en: '', jp: '' }, read: false, created_at: '2026-10-29T00:00:00.000Z' }] });
    return json(404, { ok: false });
  };
  /** @type {any} */
  const client = await load(servicesBundle);
  client.setAuthProvider(() => U1);
  client.signInProgressSync(U1, 'tok-1');
  assert.equal(await client.whenAccountKnown(), 'known');
  /** The sign-in reads, as context/AuthContext.tsx hydrateUserDataOnce composes them. */
  const hydrateOnce = async () => {
    const refused = await Promise.all([client.whenAccountKnown().then((/** @type {string} */ s) => client.hydrateFromApi({ pushLocal: s === 'known', learnerId: client.syncedLearnerId() })), client.hydrateNotifications()]);
    return refused.some((/** @type {unknown} */ value) => value === true);
  };
  /** @param {string} url */
  const gets = (url) => calls.filter((c) => c.method === 'GET' && c.url === url).length;
  /** @param {string} key */
  const stored = (key) => JSON.parse(storage.getItem(key) ?? 'null');
  return { client, server, calls, gets, stored, hydrateOnce };
}

describe('the sign-in reads say when the server\'s terms check refused them (bundled)', () => {
  /** @type {any} */
  let current = null;
  before(async () => {
    servicesBundle = await bundle([
      "export * from './components/lesson/progressSyncClient';",
      "export { hydrateFromApi } from './services/progressService';",
      "export { hydrateNotifications } from './services/notificationService';",
      "export { apiGet, apiReadError, ApiReadError, isTermsRefusal, setAuthProvider } from './services/apiClient';",
      "export { createTermsRetry } from './services/termsRetry';",
    ].join('\n'));
  });
  afterEach(async () => {
    current?.client.stopProgressSync();
    current = null;
    await wait(30);
  });

  it('apiGet: a 403 terms_required is an ApiReadError with termsRequired; other refusals are not; the message stays', async () => {
    const answers = {
      terms: TERMS_REQUIRED,
      other403: () => json(403, { error: 'x', error_type: 'guardian_consent_required' }),
      proxy403: () => new Response('<html>Forbidden</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }),
      server500: () => json(500, { error: 'x', error_type: 'terms_required' }),
    };
    const t = (current = await page({
      routes: Object.fromEntries(Object.entries(answers).map(([name, answer]) => [`GET /probe/${name}`, answer])),
    }));
    /** @param {string} name */
    const failure = async (name) => {
      try {
        await t.client.apiGet(`/probe/${name}`);
      } catch (error) {
        return /** @type {any} */ (error);
      }
      throw new Error(`${name} did not fail`);
    };
    const terms = await failure('terms');
    assert.ok(terms instanceof t.client.ApiReadError);
    assert.deepEqual([terms.message, terms.status, terms.termsRequired, t.client.isTermsRefusal(terms)], ['API /probe/terms: 403', 403, true, true]);
    for (const name of ['other403', 'proxy403', 'server500']) {
      const error = await failure(name);
      assert.equal(t.client.isTermsRefusal(error), false, name);
      assert.match(error.message, new RegExp(`^API /probe/${name}: (403|500)$`));
    }
    assert.equal(t.client.isTermsRefusal(new Error('API /x: 403')), false, 'only the API client\'s own error');
  });

  it('hydrateFromApi and hydrateNotifications answer true only for a terms_required refusal, and write nothing then', async () => {
    let t = (current = await page({ terms: 'needed' }));
    assert.equal(await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() }), true);
    assert.equal(await t.client.hydrateNotifications(), true);
    assert.deepEqual([t.gets('/user/progress'), t.gets('/user/events'), t.gets('/user/notifications')], [1, 1, 1]);
    assert.equal(t.stored(EVENTS_KEY), null);
    assert.equal(t.stored(NOTIFICATIONS_KEY), null);
    t.client.stopProgressSync();

    t = current = await page({ terms: 'off' });
    assert.equal(await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() }), false);
    assert.equal(await t.client.hydrateNotifications(), false);
    assert.deepEqual(t.stored(LEGACY_KEY).blender.completedStages, ['1', '2']);
    t.client.stopProgressSync();

    // Only the events read refused: still true (the progress part ran on its own).
    t = current = await page({ routes: { 'GET /user/events': TERMS_REQUIRED, 'GET /user/notifications': () => json(500, {}) } });
    assert.equal(await t.client.hydrateFromApi({ pushLocal: true, learnerId: t.client.syncedLearnerId() }), true);
    assert.deepEqual(t.stored(LEGACY_KEY).blender.completedStages, ['1', '2']);
    assert.equal(await t.client.hydrateNotifications(), false, 'a 500 is not the terms check');
  });

  it('behind the consent page, then 「同意して続ける」: the three reads run once more and merge (in-app check, finding 1)', async () => {
    const t = (current = await page({ terms: 'needed' }));
    const retry = t.client.createTermsRetry(t.hydrateOnce);
    await retry.run();
    assert.deepEqual([t.gets('/user/progress'), t.gets('/user/events'), t.gets('/user/notifications')], [1, 1, 1], 'refused once each');
    // The learner accepts; the server stores it, then the page announces it (LEGAL_ACCEPTED_EVENT).
    t.server.terms = 'accepted';
    retry.accepted();
    await until(() => t.gets('/user/notifications') === 2 && t.stored(NOTIFICATIONS_KEY) !== null && t.stored(EVENTS_KEY) !== null);
    assert.deepEqual([t.gets('/user/progress'), t.gets('/user/events'), t.gets('/user/notifications')], [2, 2, 2]);
    assert.deepEqual(t.stored(LEGACY_KEY).blender.completedStages, ['1', '2'], 'the legacy progress is merged on this device');
    assert.equal(t.stored(EVENTS_KEY)[0].id, 'e1', 'the history');
    assert.equal(t.stored(NOTIFICATIONS_KEY)[0].id, 'n1', 'the notifications');
    retry.accepted();
    await wait(30);
    assert.deepEqual([t.gets('/user/progress'), t.gets('/user/events'), t.gets('/user/notifications')], [2, 2, 2], 'never again');
  });

  it('with the server\'s check off (or already accepted): an acceptance adds no request (nothing changes)', async () => {
    const t = (current = await page({ terms: 'off' }));
    const retry = t.client.createTermsRetry(t.hydrateOnce);
    await retry.run();
    const before = t.calls.length;
    retry.accepted();
    await wait(30);
    assert.equal(t.calls.length, before);
  });
});

describe('context/AuthContext.tsx wiring (static)', () => {
  const auth = read('context/AuthContext.tsx');

  it('the sign-in reads go through one createTermsRetry; every hydrateUserData call is its run()', () => {
    assert.match(auth, /^import \{ createTermsRetry \} from '\.\.\/services\/termsRetry';$/m);
    assert.match(auth, /^import \{ LEGAL_ACCEPTED_EVENT \} from '\.\.\/components\/legal\/legalEvents';$/m);
    const once = auth.slice(auth.indexOf('const hydrateUserDataOnce'), auth.indexOf('const hydration = '));
    assert.match(once, /const refused = await Promise\.all\(\[progressChoicePending\(\) \? Promise\.resolve\(\) : whenAccountKnown\(\)\.then\(\(s\) => hydrateFromApi\(\{ pushLocal: s === 'known', learnerId: syncedLearnerId\(\) \}\)\), hydrateNotifications\(\)\]\);\s*return refused\.some\(\(value\) => value === true\);/);
    assert.match(once, /catch \(e\) \{\s*console\.warn\('\[Auth\] Hydration partial failure:', e\);\s*return false;/);
    assert.match(auth, /^const hydration = createTermsRetry\(hydrateUserDataOnce\);\nconst hydrateUserData = \(\) => hydration\.run\(\);$/m);
    assert.equal((auth.match(/hydrateUserDataOnce/g) ?? []).length, 2, 'defined once, passed once');
    assert.equal((auth.match(/createTermsRetry\(/g) ?? []).length, 1);
  });

  it('the page\'s acceptance (LEGAL_ACCEPTED_EVENT) reaches accepted(), and the listener goes on unmount', () => {
    assert.match(auth, /useEffect\(\(\) => \{\s*const onAccepted = \(\) => hydration\.accepted\(\);\s*window\.addEventListener\(LEGAL_ACCEPTED_EVENT, onAccepted\);\s*return \(\) => window\.removeEventListener\(LEGAL_ACCEPTED_EVENT, onAccepted\);\s*\}, \[\]\);/);
    // The event is the one the gate sends after an acceptance this page recorded.
    assert.match(read('components/legal/legalEvents.ts'), /^export const LEGAL_ACCEPTED_EVENT = 'rp:legal-accepted';$/m);
    assert.match(read('components/legal/legalGateClient.ts'), /window\.dispatchEvent\(new CustomEvent\(LEGAL_ACCEPTED_EVENT\)\)/);
  });

  it('the readers report a terms refusal: progressService\'s getAs and apiGet both throw apiReadError', () => {
    assert.match(read('services/progressService.ts'), /if \(!res\.ok\) throw await apiReadError\(path, res\);/);
    assert.match(read('services/apiClient.ts'), /export const apiGet = async <T = any>\(path: string\): Promise<T> => \{\s*const res = await apiFetch\(path\);\s*if \(!res\.ok\) throw await apiReadError\(path, res\);/);
    assert.match(read('services/notificationService.ts'), /\} catch \(error\) \{\s*\/\/ Use local cache\s*return isTermsRefusal\(error\);/);
  });
});
