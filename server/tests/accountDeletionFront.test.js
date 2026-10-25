// Phase 4 (design §5.11, §8 accountDeletionFront): deleting one's own account in the browser.
// - services/accountDeletionState.ts: the "deleted elsewhere" signal is dispatched once per page
//   and held while this tab deletes its own account (finding 15); the outcome travels in the
//   deleted page's URL, never in storage (finding 24); the page shows a time only when it is a
//   valid one from the last 24 hours.
// - services/accountDeviceData.ts: what the deleted account leaves in this browser goes, device
//   preferences and every P-School key stay, blocked storage never stops it.
// - services/apiClient.ts: apiFetch reports 401 account_deleted, and only that, and returns the
//   response unchanged.
// - services/accountDeletionApi.ts: the flow's order (hold → password sign-in → POST → sign the
//   ephemeral session out → outcome → revoke → end the session), its outcomes, error mapping.
// - services/supabaseClient.ts createReauthClient: stores nothing, its own storage key.
// - config/support.ts + components/ui/SupportContact.tsx: https or mailto only, else the fallback.
// - the pages (DeleteAccountView, AccountDeletedView) rendered against a React stub whose jsx()
//   returns { type, props } (as billingFront.test.js), and static checks of AuthContext and App.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  ACCOUNT_DELETED_EVENT,
  ACCOUNT_DELETED_PATH,
  DELETED_AT_MAX_AGE_MS,
  accountDeletedUrl,
  createDeletionGate,
  readDeletedPage,
} from '../../services/accountDeletionState.ts';
import {
  DELETED_ACCOUNT_LOCAL_KEYS,
  DELETED_ACCOUNT_SESSION_KEYS,
  SIGN_OUT_WAIT_MS,
  forgetDeletedAccountOnDevice,
  signOutThisBrowser,
} from '../../services/accountDeviceData.ts';
import { AI_LOCAL_KEYS } from '../../services/sharedDeviceData.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const APP1 = '11111111-2222-4000-8000-000000000001';
const APP2 = '11111111-2222-4000-8000-000000000002';

/** true when `promise` settles within `ms` (a guard that waits forever makes it false). */
const settledWithin = (promise, ms = 2_000) => {
  let timer;
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
const never = () => new Promise(() => {});

const toDataUrl = (text, tag) => `data:text/javascript;base64,${Buffer.from(`${text}\n// ${tag}`).toString('base64')}`;
let loads = 0;

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

// ---------------------------------------------------------------------------------------------

describe('the "deleted elsewhere" signal (services/accountDeletionState.ts)', () => {
  it('is dispatched once per page', () => {
    let sent = 0;
    const gate = createDeletionGate(() => {
      sent += 1;
    });
    gate.reportAccountDeleted();
    gate.reportAccountDeleted();
    assert.equal(sent, 1);
  });

  it('is held while a deletion runs; a failed deletion ends the hold and dispatches it then', () => {
    let sent = 0;
    const gate = createDeletionGate(() => {
      sent += 1;
    });
    gate.markDeletionInFlight();
    assert.equal(gate.deletionInFlight(), true);
    gate.reportAccountDeleted();
    gate.reportAccountDeleted();
    assert.equal(sent, 0, 'held');
    assert.equal(gate.clearDeletionInFlight(), true, 'a held signal is dispatched now');
    assert.equal(sent, 1);
    assert.equal(gate.deletionInFlight(), false);
  });

  it('a failed deletion without a held signal dispatches nothing, and the next report goes out', () => {
    let sent = 0;
    const gate = createDeletionGate(() => {
      sent += 1;
    });
    gate.markDeletionInFlight();
    assert.equal(gate.clearDeletionInFlight(), false);
    assert.equal(sent, 0);
    gate.reportAccountDeleted();
    assert.equal(sent, 1);
  });

  it('once the session ends (marked again, never cleared), later reports stay held', () => {
    let sent = 0;
    const gate = createDeletionGate(() => {
      sent += 1;
    });
    gate.markDeletionInFlight();
    gate.markDeletionInFlight();
    for (let i = 0; i < 3; i += 1) gate.reportAccountDeleted();
    assert.equal(sent, 0);
  });
});

describe('the deleted page address (the outcome in the URL, not in storage)', () => {
  const AT = '2026-10-24T05:05:00.000Z';
  const NOW = Date.parse(AT) + 60_000;

  it('accountDeletedUrl: by=self with the time, by=self alone, by=other; under the base path', () => {
    assert.equal(ACCOUNT_DELETED_PATH, '/account/deleted');
    assert.equal(accountDeletedUrl('/', 'self', AT), `/account/deleted?by=self&at=${encodeURIComponent(AT)}`);
    assert.equal(accountDeletedUrl('/', 'self', null), '/account/deleted?by=self');
    assert.equal(accountDeletedUrl('/', 'self', 'not a time'), '/account/deleted?by=self');
    assert.equal(accountDeletedUrl('/', 'other', AT), '/account/deleted?by=other');
    assert.equal(accountDeletedUrl('/app/', 'other'), '/app/account/deleted?by=other');
    assert.equal(accountDeletedUrl('/app', 'other'), '/app/account/deleted?by=other');
  });

  it('readDeletedPage: a valid time from the last 24 hours shows; a missing, old, future or malformed one does not', () => {
    const search = (url) => new URL(url, 'https://app.example.org').search;
    assert.deepEqual(readDeletedPage(search(accountDeletedUrl('/', 'self', AT)), NOW), { by: 'self', at: new Date(AT) });
    assert.deepEqual(readDeletedPage('?by=self', NOW), { by: 'self', at: null });
    assert.deepEqual(readDeletedPage(`?by=self&at=${AT}`, Date.parse(AT) + DELETED_AT_MAX_AGE_MS + 1), { by: 'self', at: null });
    assert.deepEqual(readDeletedPage(`?by=self&at=${AT}`, Date.parse(AT) - 5 * 60_000), { by: 'self', at: null });
    for (const bad of ['2026-10-24', '1729746300000', 'tomorrow', '2026-10-24T05:05:00', '2026-13-40T99:99:00Z']) {
      assert.deepEqual(readDeletedPage(`?by=self&at=${encodeURIComponent(bad)}`, NOW), { by: 'self', at: null }, bad);
    }
  });

  it('readDeletedPage: anything but by=self is the neutral page, without a time', () => {
    for (const query of ['', '?by=other', `?by=other&at=${AT}`, `?by=SELF&at=${AT}`, `?by=staff&at=${AT}`, '?at=x']) {
      assert.deepEqual(readDeletedPage(query, NOW), { by: 'other', at: null }, query);
    }
  });
});

describe('forgetDeletedAccountOnDevice (services/accountDeviceData.ts)', () => {
  const PSCHOOL = ['playerData', 'codeOfRuinsPlayerData', 'playerLevel', 'currentStage', 'customBlocks'];
  const PREFERENCES = ['rp_tts_preferences', 'rp:reader-settings', 'risepath:language', 'teacherBotBaseUrl'];

  it('removes what the account left (AI data, writing drafts, the listed keys) and keeps preferences and every P-School key', () => {
    const local = memoryStorage(Object.fromEntries([...DELETED_ACCOUNT_LOCAL_KEYS, ...AI_LOCAL_KEYS, ...PSCHOOL, ...PREFERENCES].map((k) => [k, 'x'])));
    const session = memoryStorage({ 'rp:returnTo': '/learn/a/b', 'rp:writingDraft:l1': 'my text', 'rp:chunkReload': '1' });
    forgetDeletedAccountOnDevice({ local, session });
    assert.deepEqual([...local.map.keys()].sort(), [...PSCHOOL, ...PREFERENCES].sort());
    assert.deepEqual([...session.map.keys()], ['rp:chunkReload']);
  });

  it('lists the keys the issue names, and the app really writes them', () => {
    assert.deepEqual([...DELETED_ACCOUNT_LOCAL_KEYS].sort(), [
      'rp:legal:noticeSeen',
      'rp:legal:signupAcceptance',
      'rp:oauthPending',
      'rp_ai_memory_privacy_v1',
      'rp_auth_user',
      'rp_life_journal_privacy_v1',
      'rp_life_journal_save_count',
      'rp_life_journal_v1',
      'rp_notifications',
      'teacherBotSessionId',
    ]);
    assert.deepEqual([...DELETED_ACCOUNT_SESSION_KEYS], ['rp:returnTo']);
    const writers = {
      rp_auth_user: 'context/AuthContext.tsx',
      rp_notifications: 'services/notificationService.ts',
      rp_life_journal_v1: 'services/lifeJournalApi.ts',
      rp_life_journal_privacy_v1: 'services/lifeJournalPrivacyService.ts',
      rp_life_journal_save_count: 'components/features/life-journal/LifeJournalView.tsx',
      rp_ai_memory_privacy_v1: 'services/learnerMemoryService.ts',
      'rp:oauthPending': 'services/oauthConsentRules.ts',
      teacherBotSessionId: 'components/features/blender/TeacherBotLiveView.tsx',
      'rp:returnTo': 'App.tsx',
      // The consent flow (stage 6): the sign-up marker and the dismissed change notices.
      'rp:legal:signupAcceptance': 'services/legalConsentApi.ts',
      'rp:legal:noticeSeen': 'components/legal/legalGateClient.ts',
    };
    for (const [key, file] of Object.entries(writers)) assert.ok(read(file).includes(`'${key}'`), `${key} in ${file}`);
  });

  it('survives storage that throws, and no storage at all', () => {
    const throwing = {
      get length() {
        throw new Error('blocked');
      },
      key() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    assert.doesNotThrow(() => forgetDeletedAccountOnDevice({ local: throwing, session: throwing }));
    assert.doesNotThrow(() => forgetDeletedAccountOnDevice({ local: null, session: null }));
  });
});

describe('signOutThisBrowser (services/accountDeviceData.ts, endDeletedAccountSession step 4)', () => {
  const KEY = 'sb-project-auth-token';
  const client = (signOut, storageKey = KEY) => ({ auth: { storageKey, signOut } });
  const stored = () =>
    memoryStorage({ [KEY]: '{"access_token":"t"}', [`${KEY}-code-verifier`]: 'v', [`${KEY}-user`]: '{}', playerData: 'x', 'risepath:language': 'jp' });

  it('signs each client out with scope local only and returns once they are done', async () => {
    const calls = [];
    const ok = (name) => client(async (options) => {
      calls.push({ name, options });
      return { error: null };
    });
    assert.equal(SIGN_OUT_WAIT_MS, 5_000);
    assert.equal(await settledWithin(signOutThisBrowser([ok('primary'), null, ok('nexloom')], { waitMs: 60_000, local: memoryStorage() })), true);
    assert.deepEqual(calls, [
      { name: 'primary', options: { scope: 'local' } },
      { name: 'nexloom', options: { scope: 'local' } },
    ]);
  });

  it('a sign-out that never answers: returns after the wait, and the stored session is gone', async () => {
    const local = stored();
    assert.equal(await settledWithin(signOutThisBrowser([client(never)], { waitMs: 20, local })), true, 'bounded');
    assert.deepEqual([...local.map.keys()].sort(), ['playerData', 'risepath:language']);
  });

  it('a failed logout request (offline: auth-js keeps the session) → the stored session is removed directly; throwing clients and blocked storage never stop it', async () => {
    const local = stored();
    const offline = client(async () => ({ error: new Error('Failed to fetch') }));
    const throwing = client(() => {
      throw new Error('boom');
    }, 'sb-other-auth-token');
    await signOutThisBrowser([offline, throwing], { waitMs: 1_000, local });
    assert.deepEqual([...local.map.keys()].sort(), ['playerData', 'risepath:language']);
    const blocked = {
      removeItem() {
        throw new Error('blocked');
      },
    };
    assert.equal(await settledWithin(signOutThisBrowser([offline], { waitMs: 20, local: blocked })), true);
    await signOutThisBrowser([offline], { waitMs: 20, local: null });
    // A client without a storage key (not supabase-js): signed out, nothing else removed.
    const other = stored();
    await signOutThisBrowser([client(async () => ({ error: null }), null)], { waitMs: 20, local: other });
    assert.equal(other.map.size, 5);
  });
});

// ---------------------------------------------------------------------------------------------
// The support contact (config/support.ts), bundled with a given import.meta.env

async function loadSupport(env) {
  const result = await build({
    stdin: { contents: "export { SUPPORT_CONTACT, parseSupportContact } from './config/support';", resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': JSON.stringify(env) },
    logLevel: 'silent',
  });
  loads += 1;
  return import(toDataUrl(result.outputFiles[0].text, `support ${loads}`));
}

describe('VITE_SUPPORT_CONTACT (config/support.ts)', () => {
  it('takes an https URL (host and path as the label) and mailto: with one address', async () => {
    assert.deepEqual((await loadSupport({ VITE_SUPPORT_CONTACT: 'https://forms.example.org/contact' })).SUPPORT_CONTACT, {
      href: 'https://forms.example.org/contact',
      label: 'forms.example.org/contact',
      kind: 'url',
    });
    assert.deepEqual((await loadSupport({ VITE_SUPPORT_CONTACT: ' mailto:help@example.org ' })).SUPPORT_CONTACT, {
      href: 'mailto:help@example.org',
      label: 'help@example.org',
      kind: 'mail',
    });
  });

  it('anything else counts as unset, with one warning in dev builds only', async () => {
    const { parseSupportContact } = await loadSupport({});
    for (const value of [
      'http://example.org/contact',
      'javascript:alert(1)',
      'mailto:a@example.org,b@example.org',
      'mailto:a@example.org?subject=hi',
      'mailto:not-an-address',
      'https://user:pass@example.org/',
      'help@example.org',
      'ftp://example.org',
      '',
      '   ',
    ]) {
      assert.equal(parseSupportContact(value), null, value);
    }
    assert.equal(parseSupportContact(undefined), null);
    assert.equal((await loadSupport({})).SUPPORT_CONTACT, null);
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(String(message));
    try {
      assert.equal((await loadSupport({ DEV: true, VITE_SUPPORT_CONTACT: 'http://example.org' })).SUPPORT_CONTACT, null);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /VITE_SUPPORT_CONTACT/);
      await loadSupport({ PROD: true, VITE_SUPPORT_CONTACT: 'http://example.org' });
      assert.equal(warnings.length, 1, 'no warning in a production build');
    } finally {
      console.warn = warn;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The flow: services/accountDeletionApi.ts with the real apiClient and accountDeletionState, the
// Supabase clients faked.

const FLOW_STUBS = {
  supabase: `
    export const getSupabaseClient = () => globalThis.__main ?? null;
    export const createReauthClient = () => (globalThis.__makeReauth ? globalThis.__makeReauth() : null);
    export const getNexloomSupabaseClient = () => null;
    export const isSupabaseConfigured = () => true;
  `,
};
let flowBundle = '';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fresh page: window, fetch and the two Supabase clients, then a fresh copy of the modules (the
 * signal is per page). `post` answers the deletion POST (it may await other requests first).
 */
async function flowPage({ post, signIn, routes = {}, revokeGrant, reauthSignOut } = {}) {
  const log = [];
  const win = new EventTarget();
  globalThis.window = win;
  win.addEventListener(ACCOUNT_DELETED_EVENT, () => log.push({ step: 'event' }));
  let mod = null;
  globalThis.__main = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: U1 }, access_token: 'tok-main' } } };
      },
      oauth: {
        async revokeGrant({ clientId }) {
          log.push({ step: 'revoke', clientId });
          if (revokeGrant) return revokeGrant({ clientId });
          return { error: null };
        },
      },
    },
  };
  globalThis.__makeReauth = () => ({
    auth: {
      async signInWithPassword(credentials) {
        log.push({ step: 'signIn', credentials, inFlight: mod.deletionInFlight() });
        if (signIn) return signIn(credentials);
        return { data: { session: { user: { id: U1 }, access_token: 'tok-reauth' } }, error: null };
      },
      async signOut(options) {
        log.push({ step: 'reauthSignOut', options });
        if (reauthSignOut) return reauthSignOut(options);
        return { error: null };
      },
    },
  });
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url).replace(/^\/api\/v2/, ''), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null };
    if (call.url === '/user/account/deletion' && call.method === 'POST') {
      log.push({ step: 'post', call, inFlight: mod.deletionInFlight() });
      return post ? post(call, mod, init) : json(200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T05:05:00.000Z' });
    }
    log.push({ step: 'fetch', call });
    const route = routes[`${call.method} ${call.url}`];
    if (route) return route(call);
    return json(404, { ok: false });
  };
  loads += 1;
  mod = await import(toDataUrl(flowBundle, `flow ${loads}`));
  return { mod, log, steps: () => log.map((entry) => entry.step) };
}

const endSessionInto = (log) => async (outcome) => {
  log.push({ step: 'endSession', outcome });
};

describe('apiFetch and the deletion flow (services/accountDeletionApi.ts)', () => {
  before(async () => {
    const result = await build({
      stdin: {
        contents: [
          "export * from './services/accountDeletionApi';",
          "export { deletionInFlight, markDeletionInFlight, clearDeletionInFlight } from './services/accountDeletionState';",
          "export { apiFetch } from './services/apiClient';",
        ].join('\n'),
        resolveDir: ROOT,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: FLOW_STUBS[args.path], loader: 'js' }));
        },
      }],
      logLevel: 'silent',
    });
    flowBundle = result.outputFiles[0].text;
  });

  it('apiFetch reports 401 account_deleted once per page, and returns the response unchanged', async () => {
    const body = { error: 'This Rise Path account was deleted.', error_type: 'account_deleted' };
    const t = await flowPage({ routes: { 'GET /user/profile': () => json(401, body) } });
    const res = await t.mod.apiFetch('/user/profile');
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), body, 'the caller still reads the body');
    await t.mod.apiFetch('/user/profile');
    assert.equal(t.steps().filter((s) => s === 'event').length, 1);
  });

  it('apiFetch reports nothing for any other answer: another 401, a page that is not JSON, a 200 or 403 saying account_deleted', async () => {
    const t = await flowPage({
      routes: {
        'GET /a': () => json(401, { error_type: 'invalid_token' }),
        'GET /b': () => new Response('<html>401</html>', { status: 401 }),
        'GET /c': () => json(200, { error_type: 'account_deleted' }),
        'GET /d': () => json(403, { error_type: 'account_deleted' }),
        'GET /e': () => json(401, { error: 'account_deleted' }),
      },
    });
    for (const p of ['/a', '/b', '/c', '/d', '/e']) {
      const res = await t.mod.apiFetch(p);
      assert.ok(res instanceof Response);
    }
    assert.equal(t.steps().filter((s) => s === 'event').length, 0);
  });

  it('holds the signal before the password sign-in and the POST; a 401 to another request meanwhile dispatches nothing; then revoke, end the session', async () => {
    const t = await flowPage({
      routes: { 'GET /user/profile': () => json(401, { error_type: 'account_deleted' }) },
      post: async (call, mod) => {
        // A background request of this tab, answered after the deletion committed.
        await mod.apiFetch('/user/profile');
        return json(200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T05:05:00.000Z' });
      },
    });
    const outcome = await t.mod.deleteAccount({
      email: 'learner@example.org',
      userId: U1,
      password: 'pw-1',
      connectedAppIds: [APP1, APP2, APP1, 'not-a-uuid'],
      endSession: endSessionInto(t.log),
    });
    assert.deepEqual(outcome, { kind: 'self', deletedAt: '2026-10-24T05:05:00.000Z' });
    assert.deepEqual(t.steps(), ['signIn', 'post', 'fetch', 'reauthSignOut', 'revoke', 'revoke', 'endSession']);
    const [signIn, post] = t.log;
    assert.deepEqual(signIn.credentials, { email: 'learner@example.org', password: 'pw-1' });
    assert.equal(signIn.inFlight, true, 'held before the sign-in');
    assert.equal(post.inFlight, true, 'held during the POST');
    assert.equal(post.call.headers.Authorization, 'Bearer tok-reauth', "the re-auth sign-in's token, not the main session's");
    assert.deepEqual(post.call.body, { confirm: 'delete-my-account' });
    assert.deepEqual(t.log.find((e) => e.step === 'reauthSignOut').options, { scope: 'local' });
    assert.deepEqual(t.log.filter((e) => e.step === 'revoke').map((e) => e.clientId), [APP1, APP2]);
    assert.deepEqual(t.log.at(-1).outcome, { by: 'self', at: '2026-10-24T05:05:00.000Z' });
    assert.equal(t.mod.deletionInFlight(), true, 'still held: the page is being replaced');
  });

  it('a 401 account_deleted answer to the POST itself (a second request after the commit) is the self outcome', async () => {
    const t = await flowPage({ post: () => json(401, { error: 'deleted', error_type: 'account_deleted' }) });
    const outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', connectedAppIds: [APP1], endSession: endSessionInto(t.log) });
    assert.deepEqual(outcome, { kind: 'self', deletedAt: null });
    assert.deepEqual(t.steps(), ['signIn', 'post', 'reauthSignOut', 'revoke', 'endSession']);
    assert.deepEqual(t.log.at(-1).outcome, { by: 'self', at: null });
  });

  it('a failed POST with a held signal ends as deleted elsewhere (other): the signal goes out once, no revoke, no self page', async () => {
    const t = await flowPage({
      routes: { 'GET /user/profile': () => json(401, { error_type: 'account_deleted' }) },
      post: async (call, mod) => {
        await mod.apiFetch('/user/profile');
        return json(503, { error: 'busy', error_type: 'account_busy', memory_deleted: false });
      },
    });
    const outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', connectedAppIds: [APP1], endSession: endSessionInto(t.log) });
    assert.deepEqual(outcome, { kind: 'other' });
    assert.deepEqual(t.steps(), ['signIn', 'post', 'fetch', 'reauthSignOut', 'event']);
  });

  it('a failed POST without a held signal shows the error (memory_deleted kept) and ends the hold', async () => {
    const t = await flowPage({
      routes: { 'GET /user/profile': () => json(401, { error_type: 'account_deleted' }) },
      post: () => json(503, { error: 'x', error_type: 'deletion_unavailable', memory_deleted: true }),
    });
    const outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', connectedAppIds: [APP1], endSession: endSessionInto(t.log) });
    assert.deepEqual(outcome, { kind: 'error', error: 'unavailable', memoryDeleted: true });
    assert.deepEqual(t.steps(), ['signIn', 'post', 'reauthSignOut']);
    assert.equal(t.mod.deletionInFlight(), false);
    // Deleted elsewhere later: the signal goes out as usual.
    await t.mod.apiFetch('/user/profile');
    assert.equal(t.steps().at(-1), 'event');
  });

  it('a wrong password or another account\'s sign-in sends no POST', async () => {
    const wrong = await flowPage({ signIn: () => ({ data: { session: null }, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } }) });
    const a = await wrong.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'nope', connectedAppIds: [APP1], endSession: endSessionInto(wrong.log) });
    assert.deepEqual(a, { kind: 'error', error: 'wrong_password', memoryDeleted: false });
    assert.deepEqual(wrong.steps(), ['signIn', 'reauthSignOut']);
    assert.equal(wrong.mod.deletionInFlight(), false);

    const other = await flowPage({ signIn: () => ({ data: { session: { user: { id: U2 }, access_token: 'tok-u2' } }, error: null }) });
    const b = await other.mod.deleteAccount({ email: 'b@example.org', userId: U1, password: 'pw', connectedAppIds: [], endSession: endSessionInto(other.log) });
    assert.deepEqual(b, { kind: 'error', error: 'reauth_required', memoryDeleted: false });
    assert.deepEqual(other.steps(), ['signIn', 'reauthSignOut']);
  });

  it('a POST cut off after sending says to reload (it may have finished)', async () => {
    const t = await flowPage({ post: () => Promise.reject(new TypeError('Failed to fetch')) });
    const outcome = await t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' });
    assert.deepEqual(outcome, { kind: 'error', error: 'connection_lost', memoryDeleted: false });
  });

  it('a POST answered by a 500 or 520 HTML page (not the api) says to reload, never "nothing was deleted"', async () => {
    for (const status of [500, 520]) {
      const t = await flowPage({ post: () => new Response(`<html><body>${status}</body></html>`, { status, headers: { 'Content-Type': 'text/html' } }) });
      const outcome = await t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' });
      assert.deepEqual(outcome, { kind: 'error', error: 'connection_lost', memoryDeleted: false }, String(status));
    }
  });

  it('a POST that never answers is cut off by the timeout and says to reload', async () => {
    const t = await flowPage({
      post: (call, mod, init) =>
        new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }),
    });
    let outcome = null;
    const done = t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' }, { requestTimeoutMs: 20 }).then((o) => {
      outcome = o;
    });
    assert.equal(await settledWithin(done), true, 'bounded by the timeout');
    assert.deepEqual(outcome, { kind: 'error', error: 'connection_lost', memoryDeleted: false });
    assert.deepEqual(t.steps(), ['signIn', 'post', 'reauthSignOut']);
  });

  it('a password sign-in that never answers is cut off: nothing sent, "can\'t delete right now", the held signal released', async () => {
    const t = await flowPage({ signIn: never });
    let outcome = null;
    const done = t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' }, { signInWaitMs: 20, signOutWaitMs: 20 }).then((o) => {
      outcome = o;
    });
    assert.equal(await settledWithin(done), true, 'bounded');
    assert.deepEqual(outcome, { kind: 'error', error: 'unavailable', memoryDeleted: false });
    assert.deepEqual(t.steps(), ['signIn', 'reauthSignOut'], 'no POST');
    assert.equal(t.mod.deletionInFlight(), false, 'the held signal is released');
  });

  it('a sign-in that answers after the cut-off is signed out again (no session left at Supabase)', async () => {
    let answer;
    const t = await flowPage({ signIn: () => new Promise((resolve) => { answer = resolve; }) });
    const outcome = await t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' }, { signInWaitMs: 20, signOutWaitMs: 20 });
    assert.deepEqual(outcome, { kind: 'error', error: 'unavailable', memoryDeleted: false });
    answer({ data: { session: { user: { id: U1 }, access_token: 'tok-late' } }, error: null });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(t.steps(), ['signIn', 'reauthSignOut', 'reauthSignOut'], 'the late session is signed out; still no POST');
  });

  it('the POST carries the names Supabase gives the used apps (the server knows only ids), never another app\'s', async () => {
    const t = await flowPage();
    const records = [
      { clientId: APP1.toUpperCase(), clientName: null, firstSeenAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-20T00:00:00.000Z', revokedAt: null },
      { clientId: APP2, clientName: 'Kept at revocation', firstSeenAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-10-02T00:00:00.000Z' },
      { clientId: '11111111-2222-4000-8000-000000000003', clientName: null, firstSeenAt: null, lastUsedAt: null, revokedAt: '2026-10-02T00:00:00.000Z' },
    ];
    const grants = [
      { client: { id: APP1, name: '  Claude Code  ' } },
      { client: { id: APP2, name: 'Other name' } },
      { client: { id: '11111111-2222-4000-8000-000000000003', name: 'never used' } },
      { client: { id: '99999999-2222-4000-8000-000000000009', name: 'Nexloom app (not a Rise Path record)' } },
      { client: { id: 'not-a-uuid', name: 'x' } },
    ];
    const apps = t.mod.deletionAppNames(records, grants);
    assert.deepEqual(apps, [{ clientId: APP1, clientName: 'Claude Code' }]);
    assert.deepEqual(t.mod.deletionAppNames(records, null), [], 'listGrants failed: no names');
    assert.deepEqual(t.mod.deletionAppNames(null, grants), []);
    const outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', apps, connectedAppIds: [APP1], endSession: endSessionInto(t.log) });
    assert.equal(outcome.kind, 'self');
    assert.deepEqual(t.log.find((e) => e.step === 'post').call.body, { confirm: 'delete-my-account', apps: [{ clientId: APP1, clientName: 'Claude Code' }] });
  });

  it('an ephemeral sign-out that never answers does not hold the outcome', async () => {
    const t = await flowPage({ reauthSignOut: never });
    let outcome = null;
    const done = t.mod.deleteAccountWithPassword({ email: 'a@example.org', userId: U1, password: 'pw' }, { signOutWaitMs: 20 }).then((o) => {
      outcome = o;
    });
    assert.equal(await settledWithin(done), true, 'bounded');
    assert.deepEqual(outcome, { kind: 'self', deletedAt: '2026-10-24T05:05:00.000Z' });
  });

  it('a grant revoke that never answers does not hold the page: at most the wait', async () => {
    const t = await flowPage({ revokeGrant: never });
    assert.equal(await settledWithin(t.mod.revokeRisePathGrants([APP1, APP2], 20)), true, 'bounded');
    assert.deepEqual(t.log.filter((e) => e.step === 'revoke').map((e) => e.clientId), [APP1, APP2]);
  });

  it('a revoke that throws synchronously skips no other revoke and never stops the session from ending', async () => {
    const t = await flowPage();
    globalThis.__main.auth.oauth = {
      revokeGrant({ clientId }) {
        t.log.push({ step: 'revoke', clientId });
        if (clientId === APP1) throw new TypeError('revokeGrant is not available');
        return Promise.resolve({ error: null });
      },
    };
    const outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', connectedAppIds: [APP1, APP2], endSession: endSessionInto(t.log) });
    assert.deepEqual(outcome, { kind: 'self', deletedAt: '2026-10-24T05:05:00.000Z' });
    assert.deepEqual(t.log.filter((e) => e.step === 'revoke').map((e) => e.clientId), [APP1, APP2], 'the second revoke still started');
    assert.equal(t.steps().at(-1), 'endSession');
  });

  it('a revoke step that fails outright (the client cannot be had) still ends the session after a self deletion', async () => {
    let broken = false;
    const t = await flowPage({
      post: () => {
        broken = true; // from the deletion's answer on, the main client cannot be had
        return json(200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T05:05:00.000Z' });
      },
    });
    const main = globalThis.__main;
    Object.defineProperty(globalThis, '__main', {
      configurable: true,
      get() {
        if (broken) throw new Error('the client could not be created');
        return main;
      },
    });
    let outcome;
    try {
      outcome = await t.mod.deleteAccount({ email: 'a@example.org', userId: U1, password: 'pw', connectedAppIds: [APP1], endSession: endSessionInto(t.log) });
    } finally {
      Object.defineProperty(globalThis, '__main', { configurable: true, writable: true, value: main });
    }
    assert.deepEqual(outcome, { kind: 'self', deletedAt: '2026-10-24T05:05:00.000Z' });
    assert.deepEqual(t.log.at(-1), { step: 'endSession', outcome: { by: 'self', at: '2026-10-24T05:05:00.000Z' } });
  });

  it('the waits: 30 s for the password sign-in, 120 s for the POST, 3 s for the ephemeral sign-out, 5 s for the revokes, used by default', async () => {
    const t = await flowPage();
    assert.equal(t.mod.REAUTH_SIGN_IN_WAIT_MS, 30_000);
    assert.equal(t.mod.DELETION_REQUEST_TIMEOUT_MS, 120_000);
    assert.equal(t.mod.REAUTH_SIGN_OUT_WAIT_MS, 3_000);
    assert.equal(t.mod.GRANT_REVOKE_WAIT_MS, 5_000);
    const code = read('services/accountDeletionApi.ts');
    assert.match(code, /\{ requestTimeoutMs = DELETION_REQUEST_TIMEOUT_MS, signOutWaitMs = REAUTH_SIGN_OUT_WAIT_MS, signInWaitMs = REAUTH_SIGN_IN_WAIT_MS \}: DeletionWaits = \{\}/);
    assert.match(code, /waitMs: number = GRANT_REVOKE_WAIT_MS/);
    assert.match(code, /const outcome = await deleteAccountWithPassword\(\{ email, userId, password, apps \}\);\n[^\n]*\n[^\n]*\n {2}await revokeRisePathGrants\(connectedAppIds\)\.catch\(/);
  });

  it('readDeletionAnswer maps every answer of server/routes/account.js', async () => {
    const t = await flowPage();
    const r = t.mod.readDeletionAnswer;
    assert.deepEqual(r(200, { ok: true, status: 'deleted', deletedAt: '2026-10-24T05:05:00.000Z', repeated: true }), { kind: 'self', deletedAt: '2026-10-24T05:05:00.000Z' });
    assert.deepEqual(r(200, { ok: true, status: 'deleted', deletedAt: 'x' }), { kind: 'self', deletedAt: null });
    const err = (status, errorType, memory = false) => r(status, { error: 'x', error_type: errorType, memory_deleted: memory });
    assert.deepEqual(err(401, 'reauth_required'), { kind: 'error', error: 'reauth_required', memoryDeleted: false });
    assert.deepEqual(err(409, 'subscription_active', true), { kind: 'error', error: 'subscription_active', memoryDeleted: true });
    for (const type of ['payment_provider_unavailable', 'memory_service_unavailable', 'deletion_disabled']) {
      assert.deepEqual(err(503, type), { kind: 'error', error: type, memoryDeleted: false });
    }
    assert.deepEqual(err(429, 'rate_limited'), { kind: 'error', error: 'rate_limited', memoryDeleted: false });
    for (const type of ['account_busy', 'deletion_unavailable', 'auth_unavailable']) {
      assert.deepEqual(err(503, type, true), { kind: 'error', error: 'unavailable', memoryDeleted: true });
    }
    for (const type of ['confirm_required', 'body_too_large', 'invalid_body', 'sign_in_required', 'oauth_client_token']) {
      assert.equal(err(400, type).error, 'unavailable', type);
    }
    assert.equal(r(404, null).error, 'unavailable', 'an api without the route');
    assert.equal(r(429, null).error, 'rate_limited');
    assert.equal(r(502, null).error, 'connection_lost');
    assert.equal(r(504, null).error, 'connection_lost');
    assert.equal(r(200, null).error, 'connection_lost');
    // A page that is not the api's refusal (no error_type) after the POST went out: a 5xx or a
    // timeout from a host, proxy or CDN may hide a finished deletion, so never "nothing was deleted".
    for (const status of [500, 503, 520, 523, 524, 530, 408]) {
      assert.equal(r(status, null).error, 'connection_lost', `${status} HTML page`);
    }
    assert.equal(r(500, { error: 'Internal Server Error' }).error, 'connection_lost', 'JSON without an api error_type');
    // The api's own refusals still say nothing was deleted; a 4xx without an error_type never reached a route.
    assert.deepEqual(err(503, 'deletion_unavailable'), { kind: 'error', error: 'unavailable', memoryDeleted: false });
    assert.deepEqual(err(503, 'auth_unavailable'), { kind: 'error', error: 'unavailable', memoryDeleted: false });
    assert.equal(r(403, null).error, 'unavailable', "a firewall's 403");
    assert.equal(r(401, { error: 'Invalid or expired token' }).error, 'unavailable');
    assert.equal(t.mod.readSignInError({ code: 'over_request_rate_limit', status: 429 }), 'rate_limited');
    assert.equal(t.mod.readSignInError({ status: 0, message: 'fetch failed' }), 'unavailable');
  });

  it('the preflight: 404 (an older api), a network error, 5xx or another shape is "not available yet"', async () => {
    const t = await flowPage({
      routes: {
        'GET /user/account/deletion': () => json(200, { ok: true, enabled: true, subscription: 'none', reauthWindowSeconds: 120 }),
      },
    });
    assert.deepEqual(await t.mod.getDeletionPreflight(), { kind: 'ready', preflight: { enabled: true, subscription: 'none', reauthWindowSeconds: 120 } });
    const r = t.mod.readPreflight;
    assert.deepEqual(r(404, { ok: false }), { kind: 'unavailable' });
    assert.deepEqual(r(503, { error_type: 'deletion_unavailable' }), { kind: 'unavailable' });
    assert.deepEqual(r(401, { error_type: 'sign_in_required' }), { kind: 'unavailable' });
    assert.deepEqual(r(200, null), { kind: 'unavailable' });
    assert.deepEqual(r(200, { ok: true, enabled: 'yes', subscription: 'none' }), { kind: 'unavailable' });
    assert.deepEqual(r(200, { ok: true, enabled: true, subscription: 'maybe' }), { kind: 'unavailable' });
    assert.equal(r(200, { ok: true, enabled: false, subscription: 'renewing' }).preflight.subscription, 'renewing');
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    assert.deepEqual(await t.mod.getDeletionPreflight(), { kind: 'unavailable' });
  });
});

describe('createReauthClient (services/supabaseClient.ts)', () => {
  it('stores nothing, refreshes nothing, reads no session from the URL, under its own storage key; a new client each time', async () => {
    const result = await build({
      stdin: { contents: "export * from './services/supabaseClient';", resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://project.example.org', VITE_SUPABASE_ANON_KEY: 'anon-test' }) },
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'supabase-js', namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const createClient = (url, key, options) => { (globalThis.__clients ??= []).push({ url, key, options }); return { auth: {}, n: globalThis.__clients.length }; };',
            loader: 'js',
          }));
        },
      }],
      logLevel: 'silent',
    });
    globalThis.__clients = [];
    loads += 1;
    const mod = await import(toDataUrl(result.outputFiles[0].text, `supabase ${loads}`));
    const main = mod.getSupabaseClient();
    const a = mod.createReauthClient();
    const b = mod.createReauthClient();
    assert.notEqual(a, b);
    assert.equal(mod.getSupabaseClient(), main, 'the main client is still the one cached');
    const [mainOptions, reauthOptions] = globalThis.__clients.map((c) => c.options);
    assert.deepEqual(reauthOptions.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'rp-reauth' });
    assert.equal(mod.REAUTH_STORAGE_KEY, 'rp-reauth');
    assert.equal(mainOptions.auth.storageKey, undefined, "the main session keeps supabase-js's default key");
    assert.equal(mainOptions.auth.persistSession, true);
  });
});

// ---------------------------------------------------------------------------------------------
// The pages, bundled against stubs

const ICONS = ['ArrowLeft', 'CircleAlert', 'CircleCheck', 'CreditCard', 'ExternalLink', 'Eye', 'EyeOff', 'Info', 'Trash2'];
const REACT_STUB = `
  // globalThis.__stateQueue: values for the next useState calls, in order (undefined = initial).
  export function useState(initial) {
    const queue = globalThis.__stateQueue;
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (next !== undefined) return [next, () => {}];
    }
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  }
  export const useRef = (value) => ({ current: value ?? null });
  let ids = 0;
  export const useId = () => 'id' + (ids += 1);
  export const useEffect = () => {};
  export const useLayoutEffect = () => {};
  export const useCallback = (fn) => fn;
  export const useMemo = (fn) => fn();
  export const forwardRef = (fn) => fn;
  export const createContext = () => ({});
  export const useContext = () => null;
  export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, createContext, useContext };
`;
const PAGE_STUBS = {
  react: REACT_STUB,
  'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': "export const Link = 'Link'; export const useNavigate = () => () => {}; export const useLocation = () => ({ search: globalThis.__search ?? '' });",
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  auth: 'export const useAuth = () => ({ isLoggedIn: globalThis.__loggedIn === true, user: null, endDeletedAccountSession: async () => {} });',
  features: 'export const features = { frLocale: false, get billing() { return globalThis.__billing === true; } };',
  brand: "export default 'BrandMark';",
  button: "export const Button = 'Button'; export const ButtonLink = 'ButtonLink'; export default 'Button';",
  header: "export default 'PageHeader';",
  dialog: "export const ConfirmDialog = 'ConfirmDialog'; export default 'ConfirmDialog';",
  supabase: 'export const getSupabaseClient = () => null; export const createReauthClient = () => null;',
  billing: 'export const openBillingPortal = (locale) => { (globalThis.__portalCalls ??= []).push(locale); return globalThis.__portalUrl ? Promise.resolve(globalThis.__portalUrl) : new Promise(() => {}); };',
};

let pages = null;

async function loadPages() {
  const plugin = {
    name: 'stubs',
    setup(b) {
      const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
      stub(/^react$/, 'react');
      stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
      stub(/^react-router-dom$/, 'react-router-dom');
      stub(/^lucide-react$/, 'lucide-react');
      stub(/context\/LanguageContext$/, 'language');
      stub(/context\/AuthContext$/, 'auth');
      stub(/config\/features$/, 'features');
      stub(/common\/BrandMark$/, 'brand');
      stub(/ui\/Button$/, 'button');
      stub(/ui\/PageHeader$/, 'header');
      stub(/safety\/ConfirmDialog$/, 'dialog');
      stub(/services\/supabaseClient$/, 'supabase');
      stub(/services\/billingApi$/, 'billing');
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: PAGE_STUBS[args.path], loader: 'js', resolveDir: ROOT }));
    },
  };
  const result = await build({
    stdin: {
      contents: [
        "export { SupportContact } from './components/ui/SupportContact';",
        "export { DeletedContent, formatDeletedAt, default as AccountDeletedView } from './components/features/settings/AccountDeletedView';",
        "export { DeletionStateBody, DeletionExplainer, DeletionForm, DeletionErrorNotice, deletionErrorLines, deletePageState, sessionAccount, default as DeleteAccountView } from './components/features/settings/DeleteAccountView';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  loads += 1;
  return import(toDataUrl(result.outputFiles[0].text, `pages ${loads}`));
}

/** Calls the pages' own components until only host elements and stubs ('Button', 'Link', …) are left. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}
function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
  } else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') {
    out.push({ text: String(node) });
  }
  return out;
}
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('\n');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);

function render(component, props, language = 'jp', globals = {}) {
  globalThis.__language = language;
  Object.assign(globalThis, globals);
  try {
    return walk(expand(component(props)));
  } finally {
    delete globalThis.__language;
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

describe('the delete page and the deleted page (rendered)', () => {
  before(async () => {
    pages = await loadPages();
  });

  it('SupportContact: a form opens in a new tab (said for screen readers), a mail address does not; unset → tell the staff', () => {
    const url = render(pages.SupportContact, { contact: { href: 'https://forms.example.org/c', label: 'forms.example.org/c', kind: 'url' } });
    const a = elementsOf(url).find((el) => el.type === 'a');
    assert.equal(a.props.href, 'https://forms.example.org/c');
    assert.equal(a.props.target, '_blank');
    assert.equal(a.props.rel, 'noopener noreferrer');
    assert.match(textOf(url), /お問い合わせ:[\s\S]*forms\.example\.org\/c[\s\S]*（新しいタブで開きます）/);
    const mail = render(pages.SupportContact, { contact: { href: 'mailto:help@example.org', label: 'help@example.org', kind: 'mail' } }, 'en');
    const m = elementsOf(mail).find((el) => el.type === 'a');
    assert.equal(m.props.href, 'mailto:help@example.org');
    assert.equal(m.props.target, undefined);
    assert.match(textOf(mail), /^Contact:/);
    // Under a heading that already says "Contact" (Settings, stage 6): the link alone.
    const bare = render(pages.SupportContact, { contact: { href: 'mailto:help@example.org', label: 'help@example.org', kind: 'mail' }, showLabel: false });
    assert.equal(textOf(bare), 'help@example.org');
    assert.equal(textOf(render(pages.SupportContact, { contact: null, showLabel: false })), 'ご利用の拠点のスタッフにお伝えください。');
    assert.equal(textOf(render(pages.SupportContact, { contact: null })), 'ご利用の拠点のスタッフにお伝えください。');
    assert.equal(textOf(render(pages.SupportContact, { contact: null }, 'en')), 'Please tell the staff at your learning site.');
    // The app's default (VITE_SUPPORT_CONTACT unset in this bundle): the fallback line, no link.
    const unset = render(pages.SupportContact, {});
    assert.equal(elementsOf(unset).some((el) => el.type === 'a'), false);
  });

  it('the deleted page: by=self with a recent time shows it in Japan time; without a time, none; anything else is neutral', () => {
    const at = new Date('2026-10-24T05:05:00.000Z');
    const self = textOf(render(pages.DeletedContent, { language: 'jp', by: 'self', at }));
    assert.match(self, /Rise Path のデータを削除しました/);
    assert.ok(self.includes(`${pages.formatDeletedAt(at, 'jp')}に削除しました（日本時間）`), self);
    assert.match(pages.formatDeletedAt(at, 'jp'), /2026年10月24日 14:05/);
    assert.match(self, /1 分ほどたってからログインしてください/);
    assert.match(self, /P-School を使うときも Rise Path にログインするため/);
    assert.doesNotMatch(textOf(render(pages.DeletedContent, { language: 'jp', by: 'self', at: null })), /日本時間/);
    const other = textOf(render(pages.DeletedContent, { language: 'jp', by: 'other', at }));
    assert.match(other, /この Rise Path のアカウントは削除されています/);
    assert.match(other, /この端末の記録を消して、ログアウトしました。/);
    assert.doesNotMatch(other, /日本時間|データを削除しました/);
    assert.match(textOf(render(pages.DeletedContent, { language: 'en', by: 'self', at })), /Deleted on 24 October 2026 at 14:05 \(Japan time\)/);
  });

  it('the deleted page reads its URL: signed out it has the public frame; a forged by= is neutral; an old time is not shown', () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const page = render(pages.AccountDeletedView, {}, 'jp', { __search: `?by=self&at=${encodeURIComponent(recent)}` });
    assert.ok(elementsOf(page).some((el) => el.type === 'main' && el.props.id === 'public-main'), 'PublicPageShell');
    assert.match(textOf(page), /（日本時間）/);
    const h1 = elementsOf(page).find((el) => el.type === 'h1');
    assert.equal(h1.props.tabIndex, -1, 'focusable: focus starts on the heading');
    assert.match(textOf(render(pages.AccountDeletedView, {}, 'jp', { __search: '?by=admin' })), /アカウントは削除されています/);
    const old = new Date(Date.now() - 2 * DELETED_AT_MAX_AGE_MS).toISOString();
    assert.doesNotMatch(textOf(render(pages.AccountDeletedView, {}, 'jp', { __search: `?by=self&at=${encodeURIComponent(old)}` })), /日本時間/);
    const signedIn = render(pages.AccountDeletedView, {}, 'jp', { __search: '?by=other', __loggedIn: true });
    assert.equal(elementsOf(signedIn).some((el) => el.type === 'main'), false, 'inside the Layout when signed in again');
  });

  it('the page says what is deleted and what stays; the AI apps line only when an app was used', () => {
    const text = textOf(render(pages.DeletionExplainer, { language: 'jp', usedApps: false }));
    for (const line of ['消えるもの', '学習の進み具合と解答、学習の履歴、XP とバッジ、学んだ日、やり直したレッスンの記録', 'ライフジャーナル（日記と生活の記録）', 'この端末に保存された Rise Path の記録', '消えないもの', 'Nexloom と P-School と共通なので', 'P-School のゲームの記録', '（アカウント ID・版・日時だけ。5 年）', '決済サービス Stripe の記録にはアカウント ID が残ります', '最長 365 日', '今日の分だけ。30 日まで', 'バックアップ', 'ほかの端末では、次に開いたときにログアウトされ', '18 歳未満の方は、保護者の方といっしょに確かめてください。', 'ご利用の拠点のスタッフにお伝えください。']) {
      assert.ok(text.includes(line), line);
    }
    assert.doesNotMatch(text, /使ったことのある AI アプリ/);
    assert.match(textOf(render(pages.DeletionExplainer, { language: 'jp', usedApps: true })), /使ったことのある AI アプリの名前と、使い始めた日・最後に使った日（3 年）/);
    assert.match(textOf(render(pages.DeletionExplainer, { language: 'en', usedApps: true })), /The names of AI apps you used/);
    // Phase 5: the XP ledger, learning days and lesson reset rows cascade with the account (019).
    assert.match(textOf(render(pages.DeletionExplainer, { language: 'en', usedApps: false })), /Lesson progress and answers, learning history, XP, badges, learning days and the lessons you started over/);
  });

  it('the payment line names no fixed period while privacy §8 leaves it open and no retention rule deletes billing rows', async () => {
    const { RETENTION_RULES } = await import('../services/retention.js');
    const policy = read('doc/legal/privacy-policy.draft.ja.md');
    const billingLine = policy.split('\n').find((line) => line.startsWith('- 有料プランのお支払いの記録'));
    assert.ok(billingLine, 'privacy §8 has the payment line');
    if (billingLine.includes('【要記入: 期間') && !RETENTION_RULES.some((rule) => /billing/.test(rule.name))) {
      const jp = textOf(render(pages.DeletionExplainer, { language: 'jp', usedApps: false }));
      const en = textOf(render(pages.DeletionExplainer, { language: 'en', usedApps: false }));
      assert.doesNotMatch(jp, /税と会計のため 7 年/);
      assert.doesNotMatch(en, /7 years for tax/);
      assert.match(jp, /期間は目安 7 年で、いま決めているところです/);
      assert.match(en, /the exact period is still being decided/);
    }
  });

  it('the form: a labelled current-password field with a show toggle, a submit button, and a danger dialog naming "What stays"', () => {
    const form = render(pages.DeletionForm, { language: 'jp', busy: false, billing: false, error: null, onConfirm() {}, onClearError() {} });
    const els = elementsOf(form);
    const input = els.find((el) => el.type === 'input');
    const label = els.find((el) => el.type === 'label');
    assert.equal(label.props.htmlFor, input.props.id);
    assert.match(textOf(walk(label)), /確認のため、パスワードを入れてください/);
    assert.equal(input.props.type, 'password');
    assert.equal(input.props.autoComplete, 'current-password');
    assert.equal(input.props.required, true);
    const toggle = els.find((el) => el.type === 'button' && 'aria-pressed' in el.props);
    assert.equal(toggle.props['aria-pressed'], false);
    assert.equal(toggle.props['aria-controls'], input.props.id);
    assert.ok(els.some((el) => el.type === 'button' && el.props.type === 'submit'));
    const dialog = els.find((el) => el.type === 'ConfirmDialog');
    assert.equal(dialog.props.confirmTone, 'danger');
    assert.equal(dialog.props.title, '本当に削除しますか？');
    assert.equal(dialog.props.body, '上の「消えないもの」以外の Rise Path のデータを削除します。元に戻せません。');
    assert.equal(dialog.props.cancelLabel, 'やめる');
    assert.equal(dialog.props.confirmLabel, '削除する');
    assert.equal(dialog.props.busy, false);
    const busy = elementsOf(render(pages.DeletionForm, { language: 'en', busy: true, billing: false, error: null, onConfirm() {}, onClearError() {} }));
    const busyDialog = busy.find((el) => el.type === 'ConfirmDialog');
    assert.equal(busyDialog.props.confirmLabel, 'Deleting…');
    assert.equal(busyDialog.props.busy, true);
    assert.match(busyDialog.props.body, /except what is listed under “What stays”/);
  });

  it('an error is a focusable alert above the field; the memory_deleted variant says what is gone', () => {
    const els = elementsOf(render(pages.DeletionForm, {
      language: 'jp', busy: false, billing: false, error: { error: 'unavailable', memoryDeleted: true }, onConfirm() {}, onClearError() {},
    }));
    const alert = els.find((el) => el.props?.role === 'alert');
    assert.equal(alert.props.tabIndex, -1);
    assert.ok(els.indexOf(alert) < els.findIndex((el) => el.type === 'input'));
    const text = textOf(walk(alert));
    assert.match(text, /いまは削除できません。\nAI の記憶は消えました。それ以外は消えていません。\nしばらくしてから、もう一度お試しください。/);
    assert.doesNotMatch(text, /何も消えていません/);
  });

  it('error copy by error_type, in both languages', () => {
    const lines = (language, error, memoryDeleted = false, billing = false) => {
      const tokens = render(pages.DeletionErrorNotice, { language, error: { error, memoryDeleted }, billing, portal: { busy: false, failed: false, onOpen() {} } });
      return textOf(tokens);
    };
    assert.equal(lines('jp', 'wrong_password'), 'パスワードがちがいます。\n何も消えていません。');
    assert.equal(lines('en', 'wrong_password'), 'That password is not correct.\nNothing was deleted.');
    assert.equal(lines('jp', 'reauth_required'), '確認できませんでした。もう一度パスワードを入れてください。\n何も消えていません。');
    assert.match(lines('jp', 'subscription_active', false, true), /先に「お支払いと解約」から解約してから削除してください。\n何も消えていません。\nお支払いと解約$/);
    assert.match(lines('jp', 'subscription_active', false, false), /解約の手続きは、お問い合わせ先にご連絡ください。\n何も消えていません。\nご利用の拠点のスタッフにお伝えください。/);
    assert.equal(lines('jp', 'payment_provider_unavailable'), 'お支払いのサービスで、契約の状態を確かめられませんでした。\n何も消えていません。\nしばらくしてから、もう一度お試しください。');
    assert.equal(lines('en', 'memory_service_unavailable'), 'We could not reach the AI memory service.\nNothing was deleted.\nPlease try again later.');
    assert.match(lines('jp', 'deletion_disabled'), /^いまはこの画面から削除できません。\nご利用の拠点のスタッフにお伝えください。$/);
    assert.equal(lines('jp', 'rate_limited'), '続けて試せる回数をこえました。1 分ほど待ってから、もう一度お試しください。');
    assert.equal(lines('en', 'unavailable'), 'We can’t delete right now.\nNothing was deleted.\nPlease try again later.');
    const lost = render(pages.DeletionErrorNotice, { language: 'jp', error: { error: 'connection_lost', memoryDeleted: false }, billing: false, portal: { busy: false, failed: false, onOpen() {} } });
    assert.match(textOf(lost), /^通信が切れました。削除できたかを確かめるため、ページを読み込み直してください。\nページを読み込み直す$/);
    assert.ok(elementsOf(lost).some((el) => el.type === 'Button'));
  });

  it('409 subscription_active with billing on: the error box has the portal button; billing off: the contact, no button', () => {
    let opened = 0;
    const notice = (props) => render(pages.DeletionErrorNotice, { language: 'jp', error: { error: 'subscription_active', memoryDeleted: false }, billing: true, ...props });
    const portalOf = (tokens) => elementsOf(tokens).find((el) => el.type === 'Button' && /お支払いと解約|Payment and cancellation|Stripe/.test(textOf(walk(el.props.children))));
    const on = notice({ portal: { busy: false, failed: false, onOpen: () => { opened += 1; } } });
    const box = elementsOf(on).find((el) => el.props?.role === 'alert');
    const button = portalOf(on);
    assert.ok(button, 'the portal button');
    assert.ok(elementsOf(walk(box.props.children)).includes(button), 'inside the alert box');
    button.props.onClick();
    assert.equal(opened, 1);
    const busy = portalOf(notice({ portal: { busy: true, failed: false, onOpen() {} } }));
    assert.equal(busy.props['aria-disabled'], true);
    assert.equal(busy.props.onClick, undefined);
    assert.match(textOf(walk(busy.props.children)), /Stripe の画面を開いています…/);
    const failed = notice({ portal: { busy: false, failed: true, onOpen() {} } });
    const line = elementsOf(failed).find((el) => el.type === 'p' && textOf(walk(el.props.children)).startsWith('決済サービスにつながりませんでした'));
    assert.ok(line, 'why it did not open');
    assert.equal(line.props.role, undefined, 'no alert inside the alert box');
    assert.equal(elementsOf(failed).filter((el) => el.props?.role === 'alert').length, 1);
    const off = render(pages.DeletionErrorNotice, { language: 'en', error: { error: 'subscription_active', memoryDeleted: false }, billing: false, portal: { busy: false, failed: false, onOpen() {} } }, 'en');
    assert.equal(portalOf(off), undefined);
    assert.match(textOf(off), /Please use the contact below to cancel it\.\nNothing was deleted\.\nPlease tell the staff/);
  });

  it('the page wires the error box\'s portal button to the Stripe portal', async () => {
    // DeleteAccountView's useState order: state, attempt, account, appIds, appNames, busy, error, …
    const tokens = render(pages.DeleteAccountView, {}, 'en', {
      __billing: true,
      __stateQueue: [{ kind: 'ready', usedApps: false }, undefined, undefined, undefined, undefined, undefined, { error: 'subscription_active', memoryDeleted: false }],
    });
    const button = elementsOf(tokens).find((el) => el.type === 'Button' && textOf(walk(el.props.children)) === 'Payment and cancellation');
    assert.ok(button, 'shown in the error box');
    const assigned = [];
    const previous = globalThis.window;
    globalThis.window = { location: { assign: (url) => assigned.push(url) } };
    globalThis.__portalUrl = 'https://billing.stripe.example/session';
    try {
      button.props.onClick();
      for (let i = 0; i < 5 && assigned.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    } finally {
      globalThis.window = previous;
      delete globalThis.__portalUrl;
    }
    assert.deepEqual(globalThis.__portalCalls?.at(-1), 'en');
    assert.deepEqual(assigned, ['https://billing.stripe.example/session']);
  });

  it('preflight not answered (404, network, 5xx) → "not available yet" with a retry and no form', () => {
    const state = pages.deletePageState({ kind: 'unavailable' }, null);
    assert.deepEqual(state, { kind: 'unavailable' });
    const tokens = render(pages.DeletionStateBody, { language: 'jp', state, billing: true, onRetry() {} });
    assert.match(textOf(tokens), /この画面は準備中です。しばらくしてから、もう一度開いてください。/);
    assert.match(textOf(tokens), /もう一度読み込む/);
    assert.equal(elementsOf(tokens).some((el) => el.type === 'input' || el.type === 'form' || el.type === 'ConfirmDialog'), false);
    assert.match(textOf(render(pages.DeletionStateBody, { language: 'en', state, billing: true, onRetry() {} })), /This page is not available yet\. Please open it again later\./);
  });

  it('page states from the preflight: off, renewing, ending, ready; the AI apps line from used records', () => {
    const ready = (pre) => ({ kind: 'ready', preflight: { reauthWindowSeconds: 120, ...pre } });
    assert.deepEqual(pages.deletePageState(ready({ enabled: false, subscription: 'renewing' }), []), { kind: 'disabled', usedApps: false });
    assert.deepEqual(pages.deletePageState(ready({ enabled: true, subscription: 'renewing' }), []), { kind: 'renewing', usedApps: false });
    assert.deepEqual(pages.deletePageState(ready({ enabled: true, subscription: 'ending' }), []), { kind: 'ready', usedApps: false });
    const used = [{ clientId: APP1, clientName: 'App', firstSeenAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null }];
    const unused = [{ clientId: APP2, clientName: 'App', firstSeenAt: null, lastUsedAt: null, revokedAt: '2026-10-02T00:00:00Z' }];
    assert.equal(pages.deletePageState(ready({ enabled: true, subscription: 'none' }), used).usedApps, true);
    assert.equal(pages.deletePageState(ready({ enabled: true, subscription: 'none' }), unused).usedApps, false);
    // The list could not be read (GET /user/connected-apps failed): the server still keeps used records, so say so.
    assert.deepEqual(pages.deletePageState(ready({ enabled: true, subscription: 'none' }), null), { kind: 'ready', usedApps: true });
    assert.deepEqual(pages.deletePageState(ready({ enabled: false, subscription: 'none' }), null), { kind: 'disabled', usedApps: true });
    assert.deepEqual(pages.deletePageState(ready({ enabled: true, subscription: 'renewing' }), null), { kind: 'renewing', usedApps: true });
  });

  it('a renewing plan: the portal button with billing on (no delete button), the contact without it; turned off: no form', () => {
    const on = render(pages.DeletionStateBody, { language: 'jp', state: { kind: 'renewing', usedApps: false }, billing: true, onRetry() {}, onPortal() {} });
    const els = elementsOf(on);
    assert.match(textOf(on), /有料プランが続いています。先に「お支払いと解約」から解約してから削除してください。/);
    const portal = els.find((el) => el.type === 'Button' && textOf(walk(el.props.children)).includes('お支払いと解約'));
    assert.ok(portal, 'portal button');
    assert.equal(els.some((el) => el.type === 'input' || el.type === 'ConfirmDialog' || (el.type === 'button' && el.props.type === 'submit')), false);
    const off = render(pages.DeletionStateBody, { language: 'jp', state: { kind: 'renewing', usedApps: false }, billing: false, onRetry() {} });
    assert.match(textOf(off), /解約の手続きは、下のお問い合わせ先にご連絡ください。/);
    assert.equal(elementsOf(off).some((el) => el.type === 'Button'), false);
    const disabled = render(pages.DeletionStateBody, { language: 'jp', state: { kind: 'disabled', usedApps: false }, billing: false, onRetry() {} });
    assert.match(textOf(disabled), /いまはこの画面から削除できません。/);
    assert.equal(elementsOf(disabled).some((el) => el.type === 'input'), false);
  });

  it('guests, Nexloom-only and mock sessions: no records on the server, with the Privacy page link', () => {
    const tokens = render(pages.DeletionStateBody, { language: 'jp', state: { kind: 'no_server_account' }, billing: false, onRetry() {} });
    assert.match(textOf(tokens), /このログインでは、Rise Path のサーバーに記録はありません。/);
    assert.ok(elementsOf(tokens).some((el) => el.type === 'Link' && el.props.to === '/settings/privacy'));
  });

  it('which account the page may delete: only the primary session of the learner shown, with an email', () => {
    const learner = { id: U1, isGuest: false };
    const primary = { user: { id: U1, email: 'learner@example.org' } };
    assert.deepEqual(pages.sessionAccount(learner, primary), { id: U1, email: 'learner@example.org' });
    assert.equal(pages.sessionAccount(null, primary), null, 'signed out');
    assert.equal(pages.sessionAccount({ id: 'guest', isGuest: true }, primary), null, 'guest');
    assert.equal(pages.sessionAccount({ id: 'mock_1', isGuest: false }, null), null, 'mock: no Supabase');
    assert.equal(pages.sessionAccount({ id: U2, isGuest: false }, null), null, 'Nexloom-only: no primary session');
    assert.equal(pages.sessionAccount({ id: U2, isGuest: false }, primary), null, "another account's primary session");
    assert.equal(pages.sessionAccount(learner, { user: { id: U1, email: '' } }), null, 'no email');
    assert.equal(pages.sessionAccount(learner, { user: { id: '', email: 'learner@example.org' } }), null, 'no id');
    assert.equal(pages.sessionAccount(learner, { user: null }), null);
  });

  it('an empty password: the message is announced (role="alert") and describes the field', () => {
    // DeletionForm's useState order: password, show, missing.
    const els = elementsOf(render(pages.DeletionForm, {
      language: 'jp', busy: false, billing: false, error: null, onConfirm() {}, onClearError() {},
    }, 'jp', { __stateQueue: [undefined, undefined, true] }));
    const input = els.find((el) => el.type === 'input');
    const message = els.find((el) => el.type === 'p' && textOf(walk(el.props.children)) === 'パスワードを入れてください。');
    assert.ok(message, 'shown');
    assert.equal(message.props.role, 'alert');
    assert.equal(input.props['aria-describedby'], message.props.id);
    assert.notEqual(message.props.id, input.props.id);
    assert.equal(input.props['aria-invalid'], true);
  });

  it('"Try again" on the not-available page moves focus to the page title before it reloads', () => {
    // DeleteAccountView's first useState is the page state.
    const tokens = render(pages.DeleteAccountView, {}, 'jp', { __stateQueue: [{ kind: 'unavailable' }] });
    const els = elementsOf(tokens);
    const header = els.find((el) => el.type === 'PageHeader');
    assert.ok(header.props.titleRef, 'the title is a focus target');
    let focused = 0;
    header.props.titleRef.current = {
      focus() {
        focused += 1;
      },
    };
    const retry = els.find((el) => el.type === 'Button' && textOf(walk(el.props.children)) === 'もう一度読み込む');
    retry.props.onClick();
    assert.equal(focused, 1);
    const ui = read('components/ui/PageHeader.tsx');
    assert.match(ui, /ref=\{titleRef\}\s*tabIndex=\{titleRef \? -1 : undefined\}/);
  });
});

// ---------------------------------------------------------------------------------------------
// Static checks

describe('wiring (static)', () => {
  const auth = read('context/AuthContext.tsx');
  const endFn = stripComments(auth.slice(auth.indexOf('const endDeletedAccountSession'), auth.indexOf('const logout')));

  const forgetFn = stripComments(auth.slice(auth.indexOf('const forgetDeletedAccountHere'), auth.indexOf('export const AuthProvider')));

  it('endDeletedAccountSession never logs out (no upload, no global sign-out): both clients through signOutThisBrowser (scope local)', () => {
    assert.ok(endFn.length > 200, 'found');
    assert.doesNotMatch(endFn, /logout\(/);
    assert.doesNotMatch(endFn, /signOutProgressSync/);
    assert.doesNotMatch(endFn, /\.signOut\(/, 'no sign-out of its own: the bounded helper does it');
    assert.match(endFn, /await signOutThisBrowser\(\[getSupabaseClient\(\), getNexloomSupabaseClient\(\)\]\);/);
  });

  it('the device wipe: lesson progress, the account\'s keys, the profile cache, the api identity', () => {
    const order = ['forgetProgressAccount()', 'forgetDeletedAccountOnDevice()', 'clearUserProfileCache()', 'setAuthProvider(() => null)'].map((needle) => forgetFn.indexOf(needle));
    assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it('it holds the signal, wipes, signs out, wipes again (what was written meanwhile), then replaces the page with the outcome in the URL (no storage)', () => {
    const first = endFn.indexOf('forgetDeletedAccountHere()');
    const signOut = endFn.indexOf('await signOutThisBrowser(');
    const second = endFn.indexOf('forgetDeletedAccountHere()', signOut);
    const stay = endFn.indexOf('if (path.endsWith(ACCOUNT_DELETED_PATH)) return;');
    const order = [endFn.indexOf('markDeletionInFlight()'), first, signOut, second, stay, endFn.indexOf('window.location.replace(accountDeletedUrl(import.meta.env.BASE_URL')];
    assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.doesNotMatch(endFn, /sessionStorage|localStorage\.setItem/);
    assert.match(endFn, /path\.endsWith\(ACCOUNT_DELETED_PATH\)\) return;/, 'never reloads the deleted page itself');
  });

  it('sign-up does not wait for the legacy hydrate (which waits for the lesson-progress GET and its retries)', () => {
    const signUp = stripComments(auth.slice(auth.indexOf('const signUp'), auth.indexOf('const loginAsGuest')));
    assert.match(signUp, /if \(data\.session\) \{\s*void hydrateUserData\(\);/);
    assert.doesNotMatch(signUp, /await hydrateUserData\(\)/);
  });

  it('AuthContext hears the signal and ends the session as "other"; the re-auth client is never subscribed', () => {
    const code = stripComments(auth);
    assert.match(code, /window\.addEventListener\(ACCOUNT_DELETED_EVENT, onDeleted\)/);
    assert.match(code, /void endDeletedAccountSession\(\{ by: 'other' \}\)/);
    assert.doesNotMatch(code, /createReauthClient/);
    assert.match(read('services/accountDeletionApi.ts'), /markDeletionInFlight\(\);\n {2}let outcome/);
  });

  it('apiFetch passes every 401 through the account_deleted check', () => {
    const client = stripComments(read('services/apiClient.ts'));
    assert.match(client, /const res = await fetch\(`\$\{API_BASE\}\$\{path\}`, \{ \.\.\.options, headers \}\);\s*if \(res\.status === 401\) await noteAccountDeleted\(res\);\s*return res;/);
  });

  it('routes: /account/deleted is public and in both blocks; /settings/delete-account in the Layout; ViewState and VIEW_PATHS', () => {
    const app = read('App.tsx');
    assert.match(app, /PUBLIC_PATHS = new Set\(\[[^\]]*'\/account\/deleted'[^\]]*\]\)/);
    assert.equal(app.match(/<Route path="\/account\/deleted" element=\{<AccountDeletedView \/>\} \/>/g)?.length, 2);
    assert.equal(app.match(/<Route path="\/settings\/delete-account" element=\{<DeleteAccountView \/>\} \/>/g)?.length, 1);
    const layout = app.slice(app.indexOf('<Layout currentView'));
    assert.match(layout, /path="\/settings\/delete-account"/);
    const view = app.slice(app.indexOf('const getCurrentViewState'), app.indexOf('const handleNavigate'));
    assert.ok(view.indexOf("'/settings/delete-account'") < view.indexOf("path.startsWith('/settings')) return ViewState.SETTINGS;"));
    assert.match(view, /if \(path === '\/account\/deleted'\) return ViewState\.ACCOUNT_DELETED;/);
    assert.match(read('types.ts'), /ACCOUNT_DELETED = 'ACCOUNT_DELETED'/);
    assert.match(read('types.ts'), /SETTINGS_DELETE_ACCOUNT = 'SETTINGS_DELETE_ACCOUNT'/);
    const paths = read('navigation/viewPaths.ts');
    assert.match(paths, /\[ViewState\.SETTINGS_DELETE_ACCOUNT\]: '\/settings\/delete-account'/);
    assert.match(paths, /\[ViewState\.ACCOUNT_DELETED\]: '\/account\/deleted'/);
    const lazy = read('components/routes/lazyRoutes.tsx');
    assert.match(lazy, /export const DeleteAccountView = lazy\(\(\) => import\('\.\.\/features\/settings\/DeleteAccountView'\)\);/);
    assert.match(lazy, /export const AccountDeletedView = lazy\(\(\) => import\('\.\.\/features\/settings\/AccountDeletedView'\)\);/);
  });

  it('link sites: Settings (not for guests), the Privacy page, /ai-safety in both languages', () => {
    const settings = read('components/features/settings/SettingsView.tsx');
    assert.match(settings, /\{user && !user\.isGuest && \(\s*<SettingsRow\s*icon=\{<Trash2 size=\{20\} \/>\}\s*label=\{t\.deleteAccount\}[\s\S]*?onNavigate\(ViewState\.SETTINGS_DELETE_ACCOUNT\)/);
    assert.match(settings, /deleteAccount: 'アカウントを削除する'/);
    assert.match(settings, /deleteAccount: 'Delete account'/);
    assert.match(read('components/features/settings/SettingsPrivacyView.tsx'), /<Link to="\/settings\/delete-account"/);
    const safety = read('components/features/safety/AiSafetyGuideView.tsx');
    // True also while deletion is off on the server (the default until ACCOUNT_DELETION_ENABLED=true): it only says where to go.
    assert.ok(safety.includes("'アカウントを削除するときは、設定の「アカウントを削除する」を開いてください。'"));
    assert.ok(safety.includes("'To delete your account, open Settings → Delete account.'"));
    assert.doesNotMatch(safety, /いつでも削除|at any time from Settings/);
  });

  it('the new UI uses design tokens only and copy in both languages', () => {
    for (const file of [
      'components/features/settings/DeleteAccountView.tsx',
      'components/features/settings/AccountDeletedView.tsx',
      'components/ui/PublicPageShell.tsx',
      'components/ui/SupportContact.tsx',
    ]) {
      const text = read(file);
      assert.doesNotMatch(text, /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/, file);
      assert.match(text, /const copy = \{\s*en: \{/, file);
      assert.match(text, /jp: \{/, file);
      // です・ます, no 「簡単です」「誰でも」 (AGENTS.md).
      assert.doesNotMatch(text, /簡単です|誰でも/, file);
    }
  });
});
