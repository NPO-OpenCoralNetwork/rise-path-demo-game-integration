// Phase 4 (design §4.1–§4.3, §2.6, §8 legalConsentFront): accepting the terms in the browser.
// - The sign-up form (components/common/ExperienceLoginView.tsx): with VITE_FEATURE_LEGAL_PAGES=true
//   a purpose notice linking /privacy#section-3 and one unticked, labelled checkbox whose links
//   open /terms and /privacy in a new tab; submit is blocked until it is ticked; the minor note.
//   Without the flag nothing changes.
// - services/legalConsentApi.ts: the sign-up marker keeps a hash of the email, never the email;
//   the GET/POST answers.
// - components/legal/legalGateClient.ts: off for the flag off, guests and non-primary sessions; a
//   matching marker records at once, any other marker asks; a 404, an error or a version skew is
//   `unavailable` (never `needed`), retried later; notices are dismissed per version.
// - The re-consent page and the notice bar, rendered against a React stub whose jsx() returns
//   { type, props } (as legalPagesFront.test.js); App.tsx's first branch and LEGAL_GATE_EXEMPT;
//   the link sites of design §2.6.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { validateSignupForm } from '../../services/authFormValidation.ts';
import { currentLegalVersions } from '../../shared/legal/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CURRENT = currentLegalVersions();
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const EMAIL = 'learner@example.com';
const NOW = Date.parse('2026-10-24T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}
const throwingStorage = () => ({
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
});

// ---------------------------------------------------------------------------------------------
// Bundles (flag on and off) against stubs; React's jsx() returns { type, props }

const ICONS = ['ArrowRight', 'CircleAlert', 'CloudOff', 'ExternalLink', 'Fingerprint', 'Info', 'Lock', 'Mail', 'ShieldCheck', 'Terminal', 'User', 'UserCircle', 'X'];
const STUBS = {
  // useState records its setter calls by hook index (globalThis.__sets) and takes overrides
  // (globalThis.__state[index]); hooks are counted from __resetHooks().
  react: `
    let index = 0;
    export const __resetHooks = () => { index = 0; };
    export const useState = (initial) => {
      const i = index++;
      const o = globalThis.__state;
      const value = o && i in o ? o[i] : (typeof initial === 'function' ? initial() : initial);
      return [value, (v) => { (globalThis.__sets ??= []).push([i, v]); }];
    };
    export const useRef = (value) => ({ current: value ?? null });
    let ids = 0;
    export const useId = () => ':r' + (ids += 1) + ':';
    export const useEffect = () => {};
    export const useLayoutEffect = () => {};
    export const useCallback = (fn) => fn;
    export const useMemo = (fn) => fn();
    export const useSyncExternalStore = (subscribe, get) => get();
    export const forwardRef = (fn) => fn;
    export const createContext = () => ({});
    export const useContext = () => null;
    export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore, forwardRef, createContext, useContext };
  `,
  'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': `
    export const Link = 'Link';
    export const useNavigate = () => (to) => { (globalThis.__navigations ??= []).push(to); };
    export const useLocation = () => ({ pathname: '/', hash: '', search: '' });
  `,
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  auth: `export const useAuth = () => globalThis.__auth ?? ({
    login: async () => {}, loginAsGuest() {}, signUp: async () => ({ status: 'session_ready' }), logout: async () => true,
  });`,
  button: "export const Button = 'Button'; export const ButtonLink = 'ButtonLink'; export default 'Button';",
  shell: "export const PublicPageShell = 'PublicPageShell'; export default 'PublicPageShell';",
  support: "export const SupportContact = 'SupportContact'; export default 'SupportContact';",
  supabase: `
    export const getSupabaseClient = () => globalThis.__main ?? null;
    export const isSupabaseConfigured = () => true;
    export const getNexloomSupabaseClient = () => null;
    export const createReauthClient = () => null;
  `,
  // LeftRecordsNotice (Phase 5) asks which lessons sync; the real client loads the course glob.
  lessonSync: 'export const isSyncableLesson = () => true;',
};

const ENTRY = [
  "export * from './components/legal/legalGateClient';",
  "export { LEGAL_ACCEPTED_EVENT } from './components/legal/legalEvents';",
  "export { hashEmail, rememberSignupAcceptance, readSignupAcceptance, forgetSignupAcceptance, signUpMadeNoAccount, readLegalStatus, readAcceptanceAnswer, getLegalStatus, postLegalAcceptance, SIGNUP_ACCEPTANCE_KEY } from './services/legalConsentApi';",
  "export { LegalConsentBody, CONSENT_PAGE_LINKS } from './components/legal/LegalConsentView';",
  "export { LegalNoticeBarBody, focusMainContent, default as LegalNoticeBar } from './components/legal/LegalNoticeBar';",
  "export { default as LoginView } from './components/common/ExperienceLoginView';",
  "export { features } from './config/features';",
  "export { __resetHooks } from 'react';",
].join('\n');

async function bundle(env) {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify({ PROD: true, ...env }) },
    plugins: [{
      name: 'stubs',
      setup(b) {
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^react-router-dom$/, 'react-router-dom');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/context\/AuthContext$/, 'auth');
        stub(/ui\/Button$/, 'button');
        stub(/ui\/PublicPageShell$/, 'shell');
        stub(/ui\/SupportContact$/, 'support');
        stub(/supabaseClient$/, 'supabase');
        stub(/\/progressSyncClient$/, 'lessonSync');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js', resolveDir: ROOT }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

let loads = 0;
const load = (text) => import(`data:text/javascript;base64,${Buffer.from(`${text}\n// load ${(loads += 1)}`).toString('base64')}`);

/** Calls function components until only host elements and stubs ('Link', …) are left. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (node && typeof node === 'object' && 'type' in node) {
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return { type: node.type, props: { ...node.props, children: expand(node.props?.children) } };
  }
  return node;
}
function walk(node, out = []) {
  if (Array.isArray(node)) for (const child of node) walk(child, out);
  else if (node && typeof node === 'object' && 'type' in node) {
    out.push({ el: node });
    walk(node.props?.children, out);
  } else if (typeof node === 'string' || typeof node === 'number') out.push({ text: String(node) });
  return out;
}
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);
const textOfElement = (el) => textOf(walk(el.props?.children));

/** Renders `component(props)` with globals set for the stubs; returns the element tokens. */
function render(mod, component, props, globals = {}) {
  Object.assign(globalThis, { __sets: [], ...globals });
  mod.__resetHooks();
  try {
    return walk(expand(component(props)));
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

let on = null;
let off = null;
let onText = '';
before(async () => {
  onText = await bundle({ VITE_FEATURE_LEGAL_PAGES: 'true' });
  on = await load(onText);
  off = await load(await bundle({}));
});

// ---------------------------------------------------------------------------------------------

describe('validateSignupForm (services/authFormValidation.ts)', () => {
  const valid = { email: 'user@example.com', password: 'password123', passwordConfirm: 'password123' };

  it('with requireLegalAcceptance: an unticked box → field legal; ticked → null', () => {
    assert.deepEqual(validateSignupForm(valid, { requireLegalAcceptance: true }), { field: 'legal', message: 'Agree to the terms of use to create an account.' });
    assert.deepEqual(validateSignupForm({ ...valid, acceptedLegal: false }, { requireLegalAcceptance: true })?.field, 'legal');
    assert.equal(validateSignupForm({ ...valid, acceptedLegal: true }, { requireLegalAcceptance: true }), null);
    // The other fields come first.
    assert.equal(validateSignupForm({ ...valid, email: 'x' }, { requireLegalAcceptance: true })?.field, 'email');
  });

  it('default (the flag off): today\'s rules, the box is not asked for', () => {
    assert.equal(validateSignupForm(valid), null);
    assert.equal(validateSignupForm({ ...valid, acceptedLegal: false }), null);
    assert.equal(validateSignupForm(valid, {}), null);
  });
});

describe('the sign-up form (ExperienceLoginView, VITE_FEATURE_LEGAL_PAGES)', () => {
  const signupProps = { initialMode: 'signup', onLoginSuccess() {} };
  const checkboxOf = (tokens) => elementsOf(tokens).find((el) => el.type === 'input' && el.props.type === 'checkbox');

  it('flag on: the purpose notice links /privacy#section-3 before the button; one unticked, labelled checkbox; the texts open in a new tab', () => {
    const tokens = render(on, on.LoginView, signupProps);
    const els = elementsOf(tokens);
    const box = checkboxOf(tokens);
    assert.ok(box, 'a checkbox');
    assert.equal(box.props.checked, false, 'unticked');
    assert.equal(box.props.defaultChecked, undefined);
    const label = els.find((el) => el.type === 'label' && el.props.htmlFor === box.props.id);
    assert.ok(label, 'labelled with <label htmlFor>');
    assert.equal(textOfElement(label).replace(/（新しいタブで開きます）/g, ''), '利用規約に同意し、プライバシーポリシーを読みました。');
    const labelLinks = elementsOf(walk(label.props.children)).filter((el) => el.type === 'Link');
    assert.deepEqual(labelLinks.map((l) => [l.props.to, l.props.target]), [['/terms', '_blank'], ['/privacy', '_blank']]);
    for (const link of labelLinks) assert.match(textOfElement(link), /（新しいタブで開きます）/);
    const described = box.props['aria-describedby'].split(' ');
    const purpose = els.find((el) => el.type === 'p' && el.props.id === described[0]);
    assert.ok(purpose, 'aria-describedby names the purpose notice');
    assert.match(textOfElement(purpose), /ご登録の情報は、プライバシーポリシーの「3\. 利用目的」に書いた目的で使います。/);
    assert.deepEqual(elementsOf(walk(purpose.props.children)).filter((el) => el.type === 'Link').map((l) => [l.props.to, l.props.target]), [['/privacy#section-3', '_blank']]);
    const minors = els.find((el) => el.type === 'p' && el.props.id === described[1]);
    assert.equal(textOfElement(minors), '18 歳未満の方は、保護者の方の同意を得てから登録してください。');
    // Before the submit button (APPI Art. 21(2): shown before the person sends anything).
    const order = els.map((el) => (el === box ? 'box' : el.type === 'button' && el.props.disabled !== undefined && !el.props.type ? 'submit' : null)).filter(Boolean);
    assert.deepEqual(order, ['box', 'submit']);
    // Footer: the two texts beside /ai-safety.
    const footer = els.filter((el) => el.type === 'Link' && !el.props.target).map((l) => l.props.to);
    assert.deepEqual(footer, ['/ai-safety', '/terms', '/privacy']);
  });

  it('flag on, English: the notice says the texts are in Japanese', () => {
    const tokens = render(on, on.LoginView, signupProps, { __language: 'en' });
    const text = textOf(tokens);
    assert.match(text, /We use the information you register for the purposes in section 3 of the Privacy Policy \(in Japanese\)\./);
    assert.match(text, /I agree to the Terms of Use.*and have read the Privacy Policy.*\. \(Both are in Japanese; the Japanese text is official\.\)/);
    assert.match(text, /If you are under 18, get your parent’s or guardian’s consent before you sign up\./);
  });

  it('flag off: no checkbox, no purpose notice, no links to the texts (today\'s form)', () => {
    const tokens = render(off, off.LoginView, signupProps);
    assert.equal(checkboxOf(tokens), undefined);
    assert.ok(!elementsOf(tokens).some((el) => el.type === 'Link' && /^\/(terms|privacy)/.test(el.props.to)));
    assert.doesNotMatch(textOf(tokens), /利用目的|利用規約/);
  });

  /** Renders once to learn which useState index each input writes, then again with values. */
  async function submitWith(mod, { ticked, signUp = async () => ({ status: 'session_ready' }) }) {
    const calls = [];
    const auth = {
      login: async () => {},
      loginAsGuest() {},
      logout: async () => {},
      signUp: async (...args) => {
        calls.push(args);
        return signUp(...args);
      },
    };
    const first = render(mod, mod.LoginView, signupProps, { __auth: auth });
    const inputs = elementsOf(first).filter((el) => el.type === 'input');
    const indexOf = (input, value) => {
      globalThis.__sets = [];
      input.props.onChange({ target: { value, checked: value } });
      return globalThis.__sets[0][0];
    };
    const email = inputs.find((el) => el.props.type === 'email');
    const [password, confirm] = inputs.filter((el) => el.props.type === 'password');
    const state = { [indexOf(email, EMAIL)]: EMAIL, [indexOf(password, 'password123')]: 'password123', [indexOf(confirm, 'password123')]: 'password123' };
    const box = inputs.find((el) => el.props.type === 'checkbox');
    if (box) state[indexOf(box, true)] = ticked;
    const tokens = render(mod, mod.LoginView, signupProps, { __auth: auth, __state: state });
    const form = elementsOf(tokens).find((el) => el.type === 'form');
    const checkbox = elementsOf(tokens).find((el) => el.type === 'input' && el.props.type === 'checkbox');
    let focused = false;
    if (checkbox) checkbox.props.ref.current = { focus: () => { focused = true; } };
    Object.assign(globalThis, { __sets: [], __auth: auth, __state: state });
    try {
      await form.props.onSubmit({ preventDefault() {} });
    } finally {
      delete globalThis.__auth;
      delete globalThis.__state;
    }
    return { calls, focused, sets: globalThis.__sets.map(([, v]) => v) };
  }

  it('flag on: an unticked box blocks the submit (no sign-up), says why and focuses the box', async () => {
    const result = await submitWith(on, { ticked: false });
    assert.equal(result.calls.length, 0, 'signUp is never called');
    assert.ok(result.sets.includes('登録するには、利用規約への同意が必要です。'));
    assert.ok(result.sets.includes('legal'), 'the error belongs to the checkbox (aria-invalid, aria-describedby)');
    assert.equal(result.focused, true);
  });

  it('flag on: ticked → signUp with legalAccepted: true; a failed sign-up removes the marker', async () => {
    const result = await submitWith(on, { ticked: true });
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.calls[0][2], { displayName: undefined, legalAccepted: true });
    const storage = memoryStorage({ 'rp:legal:signupAcceptance': '{"x":1}' });
    globalThis.window = { localStorage: storage };
    try {
      const failed = await submitWith(on, { ticked: true, signUp: async () => { throw new Error('User already registered'); } });
      assert.equal(failed.calls.length, 1);
      assert.equal(storage.getItem('rp:legal:signupAcceptance'), null, 'no account was made: the marker must not answer for a later sign-in');
    } finally {
      delete globalThis.window;
    }
  });

  it('flag off: the sign-up goes as today (legalAccepted false)', async () => {
    const result = await submitWith(off, { ticked: false });
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.calls[0][2], { displayName: undefined, legalAccepted: false });
  });

  it('AuthContext.signUp writes the marker only with the flag and a ticked box, before supabase.auth.signUp', () => {
    const code = read('context/AuthContext.tsx');
    const marker = code.indexOf('if (features.legalPages && options?.legalAccepted === true) await rememberSignupAcceptance(normalizedEmail);');
    assert.ok(marker > 0, 'the marker line');
    assert.ok(marker < code.indexOf('await supabase.auth.signUp('), 'before the account is created (handleSession may run during signUp)');
    assert.equal(code.match(/rememberSignupAcceptance\(/g).length, 1);
    assert.doesNotMatch(code.slice(code.indexOf('const handleSession'), code.indexOf('// Get initial sessions')), /legal/i, 'handleSession is not touched');
  });
});

// AuthContext.signUp itself, bundled against stubs (React hooks, the Supabase client, the data
// services it hydrates): the real legalConsentApi marker and config/features.
const AUTH_STUBS = {
  react: `
    export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    export const useEffect = () => {};
    export const useCallback = (fn) => fn;
    export const createContext = () => ({ Provider: 'Provider' });
    export const useContext = () => null;
    export default { useState, useEffect, useCallback, createContext, useContext };
  `,
  'react/jsx-runtime': STUBS['react/jsx-runtime'],
  supabase: STUBS.supabase,
  quiet: `
    export const hydrateFromApi = async () => {}; export const hydrateNotifications = async () => {};
    export const clearUserProfileCache = () => {}; export const clearSharedDeviceAiData = () => {};
    export const forgetDeletedAccountOnDevice = () => {}; export const signOutThisBrowser = async () => {};
    export const apiPut = async () => ({}); export const setAuthProvider = () => {};
    export const forgetProgressAccount = () => {}; export const progressChoicePending = () => false;
    export const signInProgressSync = () => {}; export const signOutProgressSync = () => {};
    export const stopProgressSync = () => {}; export const whenAccountKnown = async () => 'known';
    export const syncedLearnerId = () => null;
    export const confirmUnsavedLearning = async () => true; export const endUnsavedLearningQuestion = () => {};
  `,
};

async function bundleAuth(env) {
  const result = await build({
    stdin: { contents: "export { AuthProvider } from './context/AuthContext';", resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify({ PROD: true, ...env }) },
    plugins: [{
      name: 'auth-stubs',
      setup(b) {
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/supabaseClient$/, 'supabase');
        stub(/services\/(progressService|notificationService|userProfileService|sharedDeviceData|accountDeviceData|apiClient)$/, 'quiet');
        stub(/lesson\/progressSyncClient$/, 'quiet');
        stub(/lesson\/logoutGuard$/, 'quiet');
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: AUTH_STUBS[args.path], loader: 'js', resolveDir: ROOT }));
      },
    }],
    logLevel: 'silent',
  });
  return load(result.outputFiles[0].text);
}

describe('AuthContext.signUp and the sign-up marker (bundled)', () => {
  let authOn = null;
  let authOff = null;
  before(async () => {
    authOn = await bundleAuth({ VITE_FEATURE_LEGAL_PAGES: 'true' });
    authOff = await bundleAuth({});
  });

  /** Runs signUp with Supabase answering `answer`; returns the result and the marker during and after the call. */
  async function signUpWith(mod, answer, options = { legalAccepted: true }) {
    const storage = memoryStorage();
    let during = 'not called';
    globalThis.window = { location: { origin: 'http://localhost:3007' }, localStorage: storage };
    globalThis.__main = {
      auth: {
        signUp: async () => {
          during = storage.getItem('rp:legal:signupAcceptance');
          return answer;
        },
      },
    };
    try {
      const { signUp } = mod.AuthProvider({ children: null }).props.value;
      const result = await signUp(EMAIL, 'a-long-password', options);
      return { result, during, after: storage.getItem('rp:legal:signupAcceptance') };
    } finally {
      delete globalThis.window;
      delete globalThis.__main;
    }
  }
  const newUser = { id: U1, email: EMAIL, identities: [{ id: U1, provider: 'email' }] };

  it('a new address, email confirmation on: the marker is written before the account and stays for the first sign-in', async () => {
    const { result, during, after } = await signUpWith(authOn, { data: { user: newUser, session: null }, error: null });
    assert.deepEqual(result, { status: 'email_confirmation_required', email: EMAIL });
    assert.ok(during, 'written before supabase.auth.signUp');
    assert.equal(after, during);
    assert.equal(JSON.parse(after).emailHash, sha256(EMAIL));
  });

  it('an address that is already registered (Supabase\'s made-up user, no identities): the marker is removed, the answer stays the same', async () => {
    const { result, during, after } = await signUpWith(authOn, { data: { user: { id: U2, email: EMAIL, identities: [] }, session: null }, error: null });
    assert.deepEqual(result, { status: 'email_confirmation_required', email: EMAIL }, 'which addresses exist stays hidden');
    assert.ok(during, 'written before the call');
    assert.equal(after, null, 'no account was made: the owner\'s later sign-in here must not count this tick');
  });

  it('no tick, or the flag off: no marker at all', async () => {
    assert.equal((await signUpWith(authOn, { data: { user: newUser, session: null }, error: null }, { legalAccepted: false })).during, null);
    assert.equal((await signUpWith(authOff, { data: { user: newUser, session: null }, error: null })).during, null);
  });

  it('signUpMadeNoAccount: only a user with an empty identities list', () => {
    assert.equal(on.signUpMadeNoAccount({ id: U1, identities: [] }), true);
    for (const user of [newUser, { id: U1 }, { id: U1, identities: null }, null, undefined, 'x']) {
      assert.equal(on.signUpMadeNoAccount(user), false, JSON.stringify(user));
    }
  });
});

describe('the sign-up marker (services/legalConsentApi.ts)', () => {
  it('stores a SHA-256 of the normalised email and the current versions — never the email', async () => {
    const storage = memoryStorage();
    await on.rememberSignupAcceptance('  Learner@Example.COM ', { storage, now: NOW });
    const raw = storage.getItem(on.SIGNUP_ACCEPTANCE_KEY);
    assert.ok(raw);
    assert.doesNotMatch(raw, /@|learner|example/i, 'no address on a shared device');
    assert.deepEqual(JSON.parse(raw), { emailHash: sha256(EMAIL), terms: CURRENT.terms, privacy: CURRENT.privacy, at: NOW });
    assert.equal(await on.hashEmail(' LEARNER@example.com'), sha256(EMAIL));
  });

  it('reads only a well-formed marker of the last 7 days (anything else is removed); storage that throws or no SubtleCrypto writes nothing', async () => {
    const storage = memoryStorage();
    await on.rememberSignupAcceptance(EMAIL, { storage, now: NOW });
    assert.equal(on.readSignupAcceptance(storage, NOW + 7 * DAY).emailHash, sha256(EMAIL));
    assert.equal(on.readSignupAcceptance(storage, NOW + 7 * DAY + 1), null, 'stale');
    assert.equal(storage.getItem(on.SIGNUP_ACCEPTANCE_KEY), null, 'a stale marker is removed');
    for (const bad of ['{', '[]', '{"emailHash":"x","terms":"t","privacy":"p","at":1}', JSON.stringify({ emailHash: sha256(EMAIL), terms: 't', privacy: 'p', at: NOW + DAY })]) {
      const s = memoryStorage({ [on.SIGNUP_ACCEPTANCE_KEY]: bad });
      assert.equal(on.readSignupAcceptance(s, NOW), null, bad);
      assert.equal(s.getItem(on.SIGNUP_ACCEPTANCE_KEY), null, bad);
    }
    await assert.doesNotReject(on.rememberSignupAcceptance(EMAIL, { storage: throwingStorage(), now: NOW }));
    assert.equal(on.readSignupAcceptance(throwingStorage(), NOW), null);
    assert.doesNotThrow(() => on.forgetSignupAcceptance(throwingStorage()));
    const noCrypto = memoryStorage();
    await on.rememberSignupAcceptance(EMAIL, { storage: noCrypto, now: NOW, subtle: null });
    assert.equal(noCrypto.getItem(on.SIGNUP_ACCEPTANCE_KEY), null, 'an insecure context: asked once after signing in');
  });

  it('readLegalStatus / readAcceptanceAnswer: the server\'s shapes; anything else is unavailable or failed', () => {
    const body = { ok: true, published: false, current: CURRENT, accepted: false, acceptedAt: null, lastAccepted: null, notice: [] };
    assert.deepEqual(on.readLegalStatus(200, body), { kind: 'ok', status: { published: false, current: CURRENT, accepted: false, acceptedAt: null, lastAccepted: null, notice: [] } });
    assert.deepEqual(on.readLegalStatus(401, { error_type: 'account_deleted' }), { kind: 'account_deleted' });
    for (const [status, b] of [[404, { ok: false }], [401, { error_type: 'sign_in_required' }], [503, { error_type: 'legal_unavailable' }], [200, null], [200, { ...body, accepted: 'yes' }], [200, { ...body, current: null }], [200, { ...body, notice: [{ document: 'cookies', version: 'x' }] }]]) {
      assert.deepEqual(on.readLegalStatus(status, b), { kind: 'unavailable' }, `${status} ${JSON.stringify(b)}`);
    }
    assert.deepEqual(on.readAcceptanceAnswer(201, { ok: true, accepted: true, acceptedAt: '2026-10-24T03:00:00.000Z' }), { kind: 'accepted', acceptedAt: '2026-10-24T03:00:00.000Z' });
    assert.deepEqual(on.readAcceptanceAnswer(200, { ok: true, accepted: true, acceptedAt: null }), { kind: 'accepted', acceptedAt: null });
    assert.deepEqual(on.readAcceptanceAnswer(409, { error_type: 'legal_version_mismatch' }), { kind: 'version_mismatch' });
    assert.deepEqual(on.readAcceptanceAnswer(409, { error_type: 'legal_not_published' }), { kind: 'not_published' });
    assert.deepEqual(on.readAcceptanceAnswer(401, { error_type: 'account_deleted' }), { kind: 'account_deleted' });
    for (const [status, b] of [[500, { error_type: 'legal_version_conflict' }], [503, null], [404, {}], [200, { ok: true }]]) {
      assert.deepEqual(on.readAcceptanceAnswer(status, b), { kind: 'failed' });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The gate (createLegalGate with fakes)

const okStatus = (over = {}) => ({
  kind: 'ok',
  status: { published: false, current: CURRENT, accepted: false, acceptedAt: null, lastAccepted: null, notice: [], ...over },
});
const USER = { id: U1, email: EMAIL, isGuest: false };

function fakeGate(over = {}) {
  const calls = [];
  const storage = over.storage ?? memoryStorage();
  const timers = [];
  const statuses = [...(over.statuses ?? [])];
  const posts = [...(over.posts ?? [])];
  // over.sessions: primarySession's answers in turn (an Error is thrown); else over.session or U1's.
  const sessions = [...(over.sessions ?? [])];
  const deps = {
    enabled: over.enabled ?? true,
    current: CURRENT,
    getStatus: async () => {
      calls.push('get');
      return statuses.length > 1 ? statuses.shift() : (statuses[0] ?? okStatus());
    },
    postAcceptance: async (versions) => {
      calls.push(['post', versions]);
      return posts.length > 1 ? posts.shift() : (posts[0] ?? { kind: 'accepted', acceptedAt: '2026-10-24T03:00:00.000Z' });
    },
    primarySession: async () => {
      if (sessions.length > 0) {
        const next = sessions.length > 1 ? sessions.shift() : sessions[0];
        if (next instanceof Error) throw next;
        return next;
      }
      return over.session === undefined ? { userId: U1, email: EMAIL } : over.session;
    },
    storage: () => storage,
    hashEmail: (email) => on.hashEmail(email),
    readMarker: (s, now) => on.readSignupAcceptance(s, now),
    forgetMarker: (s) => on.forgetSignupAcceptance(s),
    now: () => over.now ?? NOW,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, live: true });
      return timers.length;
    },
    clearTimer: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false;
    },
    warn: (message) => calls.push(['warn', message]),
    announceAccepted: () => calls.push('announce'),
  };
  const gate = on.createLegalGate(deps);
  return {
    gate, calls, storage, timers,
    posts: () => calls.filter((c) => Array.isArray(c) && c[0] === 'post'),
    warns: () => calls.filter((c) => Array.isArray(c) && c[0] === 'warn'),
    announces: () => calls.filter((c) => c === 'announce').length,
  };
}

/** Waits until the gate's status satisfies `predicate` (or 2 s). */
async function until(gate, predicate = (s) => s.status !== 'loading' && s.status !== 'off') {
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    if (predicate(gate.getState())) return gate.getState();
    await new Promise((resolve) => setImmediate(resolve));
  }
  return gate.getState();
}
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('the legal gate (components/legal/legalGateClient.ts)', () => {
  it('off: the flag off, nobody, a guest, a Nexloom-only session, another user\'s primary session — and no request', async () => {
    for (const [over, user] of [[{ enabled: false }, USER], [{}, null], [{}, { ...USER, isGuest: true }], [{ session: null }, USER], [{ session: { userId: U2, email: EMAIL } }, USER]]) {
      const t = fakeGate(over);
      t.gate.setUser(user);
      await settle();
      assert.equal(t.gate.getState().status, 'off', JSON.stringify({ over, user }));
      assert.ok(!t.calls.includes('get'), 'no status request');
    }
  });

  it('the primary session could not be read (getSession failed, e.g. a refresh offline) → unavailable and asked again, never off for good', async () => {
    const t = fakeGate({ sessions: [new Error('Failed to fetch'), { userId: U1, email: EMAIL }], statuses: [okStatus()] });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'unavailable', 'not off: App.tsx would never call setUser again for the same person');
    assert.ok(!t.calls.includes('get'), 'no status request without a session');
    assert.equal(t.warns().length, 1);
    const retry = t.timers.find((x) => x.live);
    assert.equal(retry.ms, on.LEGAL_RETRY_MS);
    retry.fn();
    assert.equal((await until(t.gate, (s) => s.status === 'needed')).status, 'needed', 'the retry reads the session and the status');

    const focus = fakeGate({ sessions: [new Error('lock timeout'), { userId: U1, email: EMAIL }], statuses: [okStatus({ accepted: true })] });
    focus.gate.setUser(USER);
    assert.equal((await until(focus.gate)).status, 'unavailable');
    focus.gate.retryIfUnavailable(); // window focus
    assert.equal((await until(focus.gate, (s) => s.status === 'accepted')).status, 'accepted');
  });

  it('accepted: the app; a notice not dismissed yet comes along', async () => {
    const notice = [{ document: 'privacy', version: 'privacy-2027-04-01', effectiveDate: '2027-04-01' }];
    const t = fakeGate({ statuses: [okStatus({ accepted: true, notice })] });
    t.gate.setUser(USER);
    assert.deepEqual(await until(t.gate), { status: 'accepted', notice, lastAccepted: null });
    assert.equal(t.posts().length, 0);
  });

  it('not accepted, no marker → needed (the page asks); lastAccepted tells a terms change from a first time', async () => {
    const last = { termsVersion: 'terms-2026-12-01', privacyVersion: 'privacy-2026-12-01', acceptedAt: '2026-12-02T00:00:00.000Z' };
    const t = fakeGate({ statuses: [okStatus({ lastAccepted: last })] });
    t.gate.setUser(USER);
    assert.deepEqual(await until(t.gate), { status: 'needed', notice: [], lastAccepted: last });
    assert.equal(t.posts().length, 0);
  });

  it('a sign-up marker of this email (any case) and these versions → recorded at once, no question; the marker is removed', async () => {
    const t = fakeGate();
    await on.rememberSignupAcceptance(' Learner@Example.com', { storage: t.storage, now: NOW - DAY });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'accepted');
    assert.deepEqual(t.posts(), [['post', CURRENT]]);
    assert.equal(t.storage.getItem(on.SIGNUP_ACCEPTANCE_KEY), null);
  });

  it('a marker of another email, other versions or older than 7 days → asked, nothing posted, the marker removed', async () => {
    const cases = [
      async (s) => on.rememberSignupAcceptance('someone.else@example.com', { storage: s, now: NOW }),
      async (s) => on.rememberSignupAcceptance(EMAIL, { storage: s, now: NOW, versions: { terms: 'terms-draft-2026-10-01', privacy: CURRENT.privacy } }),
      async (s) => on.rememberSignupAcceptance(EMAIL, { storage: s, now: NOW - 8 * DAY }),
    ];
    for (const write of cases) {
      const t = fakeGate();
      await write(t.storage);
      t.gate.setUser(USER);
      assert.equal((await until(t.gate)).status, 'needed');
      assert.equal(t.posts().length, 0, 'never recorded for someone else or another text');
      assert.equal(t.storage.getItem(on.SIGNUP_ACCEPTANCE_KEY), null);
    }
  });

  it('a marker whose POST fails (network) → unavailable, the marker stays, the retry records it', async () => {
    const t = fakeGate({ posts: [{ kind: 'failed' }, { kind: 'accepted', acceptedAt: null }] });
    await on.rememberSignupAcceptance(EMAIL, { storage: t.storage, now: NOW });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'unavailable', 'never blocks on an error');
    assert.ok(t.storage.getItem(on.SIGNUP_ACCEPTANCE_KEY), 'kept: the person did tick the box');
    const retry = t.timers.find((x) => x.live);
    assert.equal(retry.ms, on.LEGAL_RETRY_MS);
    retry.fn();
    assert.equal((await until(t.gate, (s) => s.status === 'accepted')).status, 'accepted');
    assert.equal(t.posts().length, 2);
  });

  it('the server\'s versions differ from this bundle (deploy skew), a 404 from an older api, an error → unavailable, never needed; one warning', async () => {
    for (const status of [okStatus({ current: { terms: 'terms-2027-04-01', privacy: CURRENT.privacy } }), { kind: 'unavailable' }, { kind: 'account_deleted' }]) {
      const t = fakeGate({ statuses: [status] });
      await on.rememberSignupAcceptance(EMAIL, { storage: t.storage, now: NOW });
      t.gate.setUser(USER);
      assert.equal((await until(t.gate)).status, 'unavailable', JSON.stringify(status));
      assert.equal(t.posts().length, 0, 'nothing recorded against another text');
      t.gate.retryIfUnavailable();
      await settle();
      assert.equal(t.gate.getState().status, 'unavailable');
      assert.equal(t.warns().length, 1, 'one console.warn per page');
    }
  });

  it('unavailable is read again after 60 s and on focus; a later answer opens or asks', async () => {
    const t = fakeGate({ statuses: [{ kind: 'unavailable' }, okStatus({ accepted: true })] });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'unavailable');
    t.gate.retryIfUnavailable(); // window focus
    assert.equal((await until(t.gate, (s) => s.status === 'accepted')).status, 'accepted');
    assert.ok(t.timers.every((x) => !x.live), 'the 60 s retry was cancelled by the focus read');
  });

  it('accept(): accepted → the app; version mismatch → the page stays (reload offered); account_deleted → left to the deleted-account flow', async () => {
    const t = fakeGate({ statuses: [okStatus()], posts: [{ kind: 'accepted', acceptedAt: null }] });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'needed');
    assert.equal(await t.gate.accept(), 'accepted');
    assert.equal(t.gate.getState().status, 'accepted');
    assert.deepEqual(t.posts(), [['post', CURRENT]], 'the versions this bundle shows');

    const m = fakeGate({ statuses: [okStatus(), okStatus({ current: { terms: 'terms-2027-04-01', privacy: CURRENT.privacy } })], posts: [{ kind: 'version_mismatch' }] });
    m.gate.setUser(USER);
    await until(m.gate);
    assert.equal(await m.gate.accept(), 'version_mismatch');
    // A 409 only means the api has other versions than this page: a second read would answer
    // `unavailable` (skew) and drop the page with nothing recorded and nothing said.
    assert.equal(m.gate.getState().status, 'needed');
    assert.equal(m.calls.filter((c) => c === 'get').length, 1, 'no skew re-read removes the page');

    const d = fakeGate({ posts: [{ kind: 'account_deleted' }] });
    d.gate.setUser(USER);
    await until(d.gate);
    assert.equal(await d.gate.accept(), 'account_deleted');
    assert.equal(d.gate.getState().status, 'needed');
    const f = fakeGate({ posts: [{ kind: 'failed' }] });
    f.gate.setUser(USER);
    await until(f.gate);
    assert.equal(await f.gate.accept(), 'failed');
    assert.equal(f.gate.getState().status, 'needed');
  });

  it('takeFocusAfterAccept: true once after an accepted "Agree and continue" (focus moves to the app), false after a mismatch or a failure', async () => {
    const t = fakeGate({ statuses: [okStatus()], posts: [{ kind: 'accepted', acceptedAt: null }] });
    t.gate.setUser(USER);
    await until(t.gate);
    assert.equal(t.gate.takeFocusAfterAccept(), false, 'nothing accepted yet');
    assert.equal(await t.gate.accept(), 'accepted');
    assert.equal(t.gate.takeFocusAfterAccept(), true);
    assert.equal(t.gate.takeFocusAfterAccept(), false, 'once');
    for (const kind of ['version_mismatch', 'failed', 'account_deleted']) {
      const other = fakeGate({ statuses: [okStatus()], posts: [{ kind }] });
      other.gate.setUser(USER);
      await until(other.gate);
      await other.gate.accept();
      assert.equal(other.gate.takeFocusAfterAccept(), false, kind);
    }
  });

  it('Phase 8: an acceptance this page recorded is announced once (accept(), the sign-up marker); a status read that answers accepted never is', async () => {
    const t = fakeGate({ statuses: [okStatus()], posts: [{ kind: 'accepted', acceptedAt: null }] });
    t.gate.setUser(USER);
    assert.equal((await until(t.gate)).status, 'needed');
    assert.equal(t.announces(), 0);
    assert.equal(await t.gate.accept(), 'accepted');
    assert.equal(t.announces(), 1);
    assert.ok(t.calls.indexOf('announce') > t.calls.findIndex((c) => Array.isArray(c) && c[0] === 'post'), 'after the server answered');

    const marker = fakeGate();
    await on.rememberSignupAcceptance(EMAIL, { storage: marker.storage, now: NOW });
    marker.gate.setUser(USER);
    assert.equal((await until(marker.gate)).status, 'accepted');
    assert.equal(marker.announces(), 1, 'the sign-up marker\'s POST');

    const read = fakeGate({ statuses: [okStatus({ accepted: true })] });
    read.gate.setUser(USER);
    assert.equal((await until(read.gate)).status, 'accepted');
    await read.gate.refresh();
    assert.equal(read.announces(), 0, 'already accepted: nothing recorded, nothing announced');

    for (const kind of ['version_mismatch', 'failed', 'account_deleted']) {
      const other = fakeGate({ statuses: [okStatus()], posts: [{ kind }] });
      other.gate.setUser(USER);
      await until(other.gate);
      await other.gate.accept();
      assert.equal(other.announces(), 0, kind);
    }
    const late = fakeGate({ posts: [{ kind: 'failed' }, { kind: 'accepted', acceptedAt: null }] });
    await on.rememberSignupAcceptance(EMAIL, { storage: late.storage, now: NOW });
    late.gate.setUser(USER);
    assert.equal((await until(late.gate)).status, 'unavailable');
    assert.equal(late.announces(), 0, 'a marker POST that failed');
    late.timers.find((x) => x.live).fn();
    assert.equal((await until(late.gate, (st) => st.status === 'accepted')).status, 'accepted');
    assert.equal(late.announces(), 1, 'the retry that recorded it');
  });

  it('Phase 8: an announcement that throws never breaks the acceptance', async () => {
    const storage = memoryStorage();
    const gate = on.createLegalGate({
      enabled: true, current: CURRENT, getStatus: async () => okStatus(), postAcceptance: async () => ({ kind: 'accepted', acceptedAt: null }),
      primarySession: async () => ({ userId: U1, email: EMAIL }), storage: () => storage, hashEmail: async () => null, readMarker: () => null, forgetMarker: () => {},
      now: () => NOW, setTimer: () => 0, clearTimer: () => {}, warn: () => {}, announceAccepted: () => { throw new Error('no window'); },
    });
    gate.setUser(USER);
    await until(gate);
    assert.equal(await gate.accept(), 'accepted');
    assert.equal(gate.getState().status, 'accepted');
  });

  it('a change of user while a status read runs: the old answer is dropped', async () => {
    let release;
    const t = fakeGate();
    const first = new Promise((resolve) => {
      release = resolve;
    });
    let n = 0;
    const gate = on.createLegalGate({
      ...Object.fromEntries(Object.entries({})),
      enabled: true,
      current: CURRENT,
      getStatus: async () => {
        n += 1;
        return n === 1 ? first : okStatus({ accepted: true });
      },
      postAcceptance: async () => ({ kind: 'accepted', acceptedAt: null }),
      primarySession: async () => ({ userId: n === 0 ? U1 : U2, email: EMAIL }),
      storage: () => t.storage,
      hashEmail: on.hashEmail,
      readMarker: on.readSignupAcceptance,
      forgetMarker: on.forgetSignupAcceptance,
      now: () => NOW,
      setTimer: () => 0,
      clearTimer: () => {},
      warn: () => {},
    });
    gate.setUser(USER);
    await settle();
    gate.setUser({ id: U2, email: 'b@example.com', isGuest: false });
    assert.equal((await until(gate)).status, 'accepted');
    release(okStatus());
    await settle();
    assert.equal(gate.getState().status, 'accepted', 'U1\'s late "not accepted" never shows for U2');
  });

  it('dismissNotice on a shared device: one learner\'s "Close" never hides the bar for another; the same learner keeps it hidden', async () => {
    const notice = [{ document: 'privacy', version: 'privacy-2027-04-01', effectiveDate: '2027-04-01' }];
    const storage = memoryStorage();
    const a = fakeGate({ storage, statuses: [okStatus({ accepted: true, notice })] });
    a.gate.setUser(USER);
    await until(a.gate);
    a.gate.dismissNotice('privacy-2027-04-01');
    assert.deepEqual(a.gate.getState().notice, []);
    const b = fakeGate({ storage, session: { userId: U2, email: 'b@example.com' }, statuses: [okStatus({ accepted: true, notice })] });
    b.gate.setUser({ id: U2, email: 'b@example.com', isGuest: false });
    assert.deepEqual((await until(b.gate)).notice.map((n) => n.version), ['privacy-2027-04-01'], 'child B still sees the change');
    const again = fakeGate({ storage, statuses: [okStatus({ accepted: true, notice })] });
    again.gate.setUser({ ...USER, id: U1.toUpperCase() });
    assert.deepEqual((await until(again.gate)).notice, [], 'child A (any case of the id) keeps it hidden');
    // Many learners: the newest NOTICE_SEEN_MAX entries are kept.
    for (let i = 0; i < on.NOTICE_SEEN_MAX + 5; i += 1) {
      const id = `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const g = fakeGate({ storage, session: { userId: id, email: EMAIL }, statuses: [okStatus({ accepted: true, notice })] });
      g.gate.setUser({ id, email: EMAIL, isGuest: false });
      await until(g.gate);
      g.gate.dismissNotice('privacy-2027-04-01');
    }
    const kept = JSON.parse(storage.getItem(on.NOTICE_SEEN_KEY));
    assert.equal(kept.length, on.NOTICE_SEEN_MAX);
    assert.equal(kept.at(-1), `bbbbbbbb-0000-4000-8000-${String(on.NOTICE_SEEN_MAX + 4).padStart(12, '0')}:privacy-2027-04-01`);
  });

  it('dismissNotice: remembered per account and version on this device; another version still shows; blocked storage shows the bar again, no crash', async () => {
    const notice = [
      { document: 'privacy', version: 'privacy-2027-04-01', effectiveDate: '2027-04-01' },
      { document: 'terms', version: 'terms-2027-04-01', effectiveDate: '2027-04-01' },
    ];
    const t = fakeGate({ statuses: [okStatus({ accepted: true, notice })] });
    t.gate.setUser(USER);
    await until(t.gate);
    t.gate.dismissNotice('privacy-2027-04-01');
    assert.deepEqual(t.gate.getState().notice.map((n) => n.version), ['terms-2027-04-01']);
    assert.deepEqual(JSON.parse(t.storage.getItem(on.NOTICE_SEEN_KEY)), [`${U1}:privacy-2027-04-01`]);
    const again = fakeGate({ storage: t.storage, statuses: [okStatus({ accepted: true, notice })] });
    again.gate.setUser(USER);
    assert.deepEqual((await until(again.gate)).notice.map((n) => n.version), ['terms-2027-04-01'], 'the next page load remembers');

    const blocked = fakeGate({ storage: throwingStorage(), statuses: [okStatus({ accepted: true, notice })] });
    blocked.gate.setUser(USER);
    assert.equal((await until(blocked.gate)).notice.length, 2);
    assert.doesNotThrow(() => blocked.gate.dismissNotice('privacy-2027-04-01'));
    const reload = fakeGate({ storage: throwingStorage(), statuses: [okStatus({ accepted: true, notice })] });
    reload.gate.setUser(USER);
    assert.equal((await until(reload.gate)).notice.length, 2, 'lost storage only shows the bar again');
  });

  it('the page\'s gate: getSession with an error → unavailable (asked again); no stored session (Nexloom-only) → off; no request either way', async () => {
    const cases = [
      [async () => ({ data: { session: null }, error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }) }), 'unavailable'],
      [async () => {
        throw new Error('Acquiring an exclusive Navigator LockManager lock timed out');
      }, 'unavailable'],
      [async () => ({ data: { session: null }, error: null }), 'off'],
    ];
    for (const [getSession, expected] of cases) {
      const mod = await load(onText);
      globalThis.window = new EventTarget();
      globalThis.__main = { auth: { getSession } };
      const savedFetch = globalThis.fetch;
      const savedWarn = console.warn;
      const urls = [];
      console.warn = () => {};
      globalThis.fetch = async (url) => {
        urls.push(String(url));
        return new Response('{}', { status: 500 });
      };
      try {
        mod.syncLegalGate(true, USER);
        const gate = mod.legalGate(true);
        await settle();
        assert.equal(gate.getState().status, expected, String(getSession));
        assert.deepEqual(urls, []);
      } finally {
        mod.syncLegalGate(true, null); // cancels the real 60 s retry timer
        globalThis.fetch = savedFetch;
        console.warn = savedWarn;
        delete globalThis.window;
        delete globalThis.__main;
      }
    }
  });

  it('Phase 8: the page\'s gate sends LEGAL_ACCEPTED_EVENT (rp:legal-accepted) on window once after "Agree and continue"', async () => {
    const mod = await load(onText);
    assert.equal(mod.LEGAL_ACCEPTED_EVENT, 'rp:legal-accepted');
    const answers = {
      '/user/legal': () => new Response(JSON.stringify({ ok: true, published: false, current: CURRENT, accepted: false, acceptedAt: null, lastAccepted: null, notice: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      '/user/legal/acceptance': () => new Response(JSON.stringify({ ok: true, accepted: true, acceptedAt: '2026-10-28T00:00:00.000Z' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    };
    const target = new EventTarget();
    let fired = 0;
    target.addEventListener(mod.LEGAL_ACCEPTED_EVENT, () => { fired += 1; });
    globalThis.window = target;
    globalThis.__main = { auth: { getSession: async () => ({ data: { session: { user: { id: U1, email: EMAIL }, access_token: 'tok' } } }) } };
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const p = String(url).replace(/^\/api\/v2/, '');
      return answers[p] ? answers[p]() : new Response('{}', { status: 500 });
    };
    try {
      mod.syncLegalGate(true, USER);
      const gate = mod.legalGate(true);
      assert.equal((await until(gate)).status, 'needed');
      assert.equal(fired, 0, 'a status read announces nothing');
      assert.equal(await gate.accept(), 'accepted');
      assert.equal(fired, 1);
    } finally {
      mod.syncLegalGate(true, null);
      globalThis.fetch = savedFetch;
      delete globalThis.window;
      delete globalThis.__main;
    }
  });

  it('the page\'s gate: a 404 from an older api is unavailable (real getLegalStatus over apiFetch), never needed', async () => {
    const mod = await load(onText);
    const answers = { '/user/legal': () => new Response('{"ok":false}', { status: 404, headers: { 'Content-Type': 'application/json' } }) };
    globalThis.window = new EventTarget();
    globalThis.__main = { auth: { getSession: async () => ({ data: { session: { user: { id: U1, email: EMAIL }, access_token: 'tok' } } }) } };
    const savedFetch = globalThis.fetch;
    const savedWarn = console.warn;
    const urls = [];
    console.warn = () => {};
    globalThis.fetch = async (url, init = {}) => {
      const p = String(url).replace(/^\/api\/v2/, '');
      urls.push([p, init.headers?.Authorization]);
      return answers[p] ? answers[p]() : new Response('{}', { status: 500 });
    };
    try {
      mod.syncLegalGate(true, USER);
      const gate = mod.legalGate(true);
      assert.equal((await until(gate)).status, 'unavailable');
      assert.deepEqual(urls, [['/user/legal', 'Bearer tok']]);
    } finally {
      // Signing out cancels the 60 s retry timer (a real one here), so the test process can exit.
      mod.syncLegalGate(true, null);
      globalThis.fetch = savedFetch;
      console.warn = savedWarn;
      delete globalThis.window;
      delete globalThis.__main;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The re-consent page and the notice bar (rendered)

describe('the re-consent page (components/legal/LegalConsentView.tsx)', () => {
  const props = (over = {}) => ({ language: 'jp', changed: [], ticked: false, busy: false, error: null, onTick() {}, onAgree() {}, onSignOut() {}, ...over });

  it('first time: the texts in a new tab, an unticked labelled checkbox, "Agree and continue" disabled until ticked, "Sign out"', () => {
    const tokens = render(on, on.LegalConsentBody, props());
    const els = elementsOf(tokens);
    const text = textOf(tokens);
    assert.match(text, /^利用規約とプライバシーポリシーのご確認/);
    assert.match(text, /Rise Path を使うには、利用規約への同意が必要です。プライバシーポリシーには、個人情報の利用目的と扱い方を書いています。/);
    const box = els.find((el) => el.type === 'input' && el.props.type === 'checkbox');
    assert.equal(box.props.checked, false);
    const label = els.find((el) => el.type === 'label' && el.props.htmlFor === box.props.id);
    assert.equal(textOfElement(label).replace(/（新しいタブで開きます）/g, ''), '利用規約に同意し、プライバシーポリシーを読みました。');
    const newTab = els.filter((el) => el.type === 'Link' && el.props.target === '_blank').map((l) => l.props.to);
    assert.deepEqual(newTab, ['/terms', '/privacy', '/terms', '/privacy']);
    const buttons = els.filter((el) => el.type === 'Button');
    assert.deepEqual(buttons.map((b) => [b.props.type, b.props.disabled, textOfElement(b)]), [['submit', true, '同意して続ける'], ['button', false, 'ログアウト']]);
    const ticked = elementsOf(render(on, on.LegalConsentBody, props({ ticked: true }))).filter((el) => el.type === 'Button');
    assert.equal(ticked[0].props.disabled, false);
    // The minor note (finding 23) is part of the checkbox's description.
    const minors = els.find((el) => el.type === 'p' && el.props.id === box.props['aria-describedby']);
    assert.equal(textOfElement(minors), '18 歳未満の方は、保護者の方の同意を得てから「同意して続ける」を押してください。');
  });

  it('links the withdrawal, privacy and delete pages and the support contact (they need no agreement)', () => {
    const tokens = render(on, on.LegalConsentBody, props());
    const els = elementsOf(tokens);
    const inApp = els.filter((el) => el.type === 'Link' && !el.props.target).map((l) => [l.props.to, textOfElement(l)]);
    assert.deepEqual(inApp, [
      ['/settings/ai-access', 'AI 機能への保護者の同意をやめる'],
      ['/settings/privacy', 'プライバシーの設定（記録を消す）'],
      ['/settings/delete-account', 'アカウントを削除する'],
    ]);
    assert.deepEqual(Object.values(on.CONSENT_PAGE_LINKS), ['/settings/ai-access', '/settings/privacy', '/settings/delete-account']);
    assert.ok(els.some((el) => el.type === 'SupportContact'));
    assert.match(textOf(tokens), /同意しなくても、次のことはできます/);
  });

  it('after a terms change that requires acceptance; errors are announced; English', () => {
    assert.match(textOf(render(on, on.LegalConsentBody, props({ changed: ['terms'] }))), /利用規約を改定しました。続けて使うには、新しい利用規約への同意が必要です。/);
    const reloads = [];
    const mismatchEls = elementsOf(render(on, on.LegalConsentBody, props({ error: 'mismatch', onReload: () => reloads.push('reload') })));
    const mismatch = mismatchEls.find((el) => el.props?.role === 'alert');
    assert.match(textOfElement(mismatch), /文が新しくなりました。ページを読み込み直して、もう一度読んでから同意してください。/);
    const reload = mismatchEls.find((el) => el.type === 'Button' && textOfElement(el) === '読み込み直す');
    assert.ok(reload, 'a 409 offers a reload (only a reload shows the new texts)');
    reload.props.onClick();
    assert.deepEqual(reloads, ['reload']);
    assert.ok(!elementsOf(render(on, on.LegalConsentBody, props({ error: 'failed', onReload() {} }))).some((el) => el.type === 'Button' && textOfElement(el) === '読み込み直す'), 'no reload for a network failure');
    assert.match(textOf(render(on, on.LegalConsentBody, props({ language: 'en', error: 'mismatch', onReload() {} }))), /The text has changed\. Reload the page, read it again, then agree\.Reload/);
    const failed = elementsOf(render(on, on.LegalConsentBody, props({ error: 'failed' }))).find((el) => el.props?.role === 'alert');
    assert.match(textOfElement(failed), /記録できませんでした。通信を確かめて、もう一度お試しください。/);
    assert.equal(failed.props.tabIndex, -1, 'focusable, so focus can move there');
    const en = textOf(render(on, on.LegalConsentBody, props({ language: 'en', changed: ['terms'] })));
    assert.match(en, /Please review our Terms of Use and Privacy Policy/);
    assert.match(en, /We updated the Terms of Use\. To keep using Rise Path, please agree to the new Terms of Use\./);
    assert.match(en, /If you are under 18, get your parent’s or guardian’s consent before you press “Agree and continue”\./);
  });

  it('a privacy version that needs acceptance names the Privacy Policy, not the Terms; both changed names both', () => {
    const privacy = textOf(render(on, on.LegalConsentBody, props({ changed: ['privacy'] })));
    assert.match(privacy, /プライバシーポリシーを改定しました。続けて使うには、新しいプライバシーポリシーへの同意が必要です。/);
    assert.doesNotMatch(privacy, /利用規約を改定しました/);
    assert.match(textOf(render(on, on.LegalConsentBody, props({ changed: ['terms', 'privacy'] }))), /利用規約とプライバシーポリシーを改定しました。続けて使うには、新しい内容への同意が必要です。/);
    assert.match(textOf(render(on, on.LegalConsentBody, props({ language: 'en', changed: ['privacy'] }))), /We updated the Privacy Policy\. To keep using Rise Path, please agree to the new Privacy Policy\./);
    assert.match(read('components/legal/LegalConsentView.tsx'), /changed=\{documentsToAcceptAgain\(gate\.lastAccepted\)\}/);
  });

  it('the view focuses its heading, names the tab, uses the gate\'s accept() and the app\'s logout', () => {
    const code = read('components/legal/LegalConsentView.tsx');
    assert.match(code, /titleRef\.current\?\.focus\(\);/);
    assert.match(code, /setPageTitle\(window\.document, legalPageTitle\(copy\[language\]\.title\)\)/);
    assert.match(code, /legalGate\(features\.legalPages\)\.accept\(\)/);
    assert.match(code, /logout\(\)/);
    assert.match(code, /<PublicPageShell>/);
    assert.doesNotMatch(code, /ConfirmDialog|role="dialog"/, 'a page, not a dialog (Esc would close it)');
  });
});

describe('the notice bar (components/legal/LegalNoticeBar.tsx)', () => {
  const notice = [{ document: 'privacy', version: 'privacy-2027-04-01', effectiveDate: '2027-04-01' }];

  it('accepted with a notice: role="status", the change with its date, "Read" and "Close" (remembered per version)', () => {
    const dismissed = [];
    const tokens = render(on, on.LegalNoticeBarBody, { language: 'jp', status: 'accepted', notice, onDismiss: (v) => dismissed.push(v) });
    const els = elementsOf(tokens);
    assert.equal(els[0].props.role, 'status');
    assert.match(textOf(tokens), /プライバシーポリシーを改定しました（2027 年 4 月 1 日から）。/);
    assert.deepEqual(els.filter((el) => el.type === 'Link').map((l) => l.props.to), ['/privacy']);
    const close = els.find((el) => el.type === 'button');
    assert.equal(close.props['aria-label'], 'プライバシーポリシーのお知らせを閉じる');
    close.props.onClick();
    assert.deepEqual(dismissed, ['privacy-2027-04-01']);
    const en = textOf(render(on, on.LegalNoticeBarBody, { language: 'en', status: 'accepted', notice: [{ ...notice[0], document: 'terms', version: 'terms-2027-04-01' }], onDismiss() {} }));
    assert.match(en, /We updated the Terms of Use \(from April 1, 2027\)\./);
  });

  it('needed on an exempt page: the slim bar with "Review" → /; an empty live region for other states or no notice', () => {
    const tokens = render(on, on.LegalNoticeBarBody, { language: 'jp', status: 'needed', notice: [], onDismiss() {} });
    assert.equal(elementsOf(tokens)[0].props.role, 'status');
    assert.match(textOf(tokens), /Rise Path を使い続けるには、利用規約への同意が必要です。確認する/);
    assert.deepEqual(elementsOf(tokens).filter((el) => el.type === 'Link').map((l) => l.props.to), ['/']);
    for (const [status, list] of [['off', notice], ['loading', notice], ['unavailable', notice], ['accepted', []]]) {
      const region = on.LegalNoticeBarBody({ language: 'jp', status, notice: list, onDismiss() {} });
      assert.deepEqual(region, { type: 'div', props: { role: 'status', children: null } }, `${status}: an empty region, no bar`);
    }
  });

  it('the live region exists before it has anything to say and stays the same element (so a later bar is announced)', () => {
    const states = [['loading', []], ['accepted', []], ['accepted', notice], ['needed', []], ['unavailable', []]];
    const regions = states.map(([status, list]) => on.LegalNoticeBarBody({ language: 'jp', status, notice: list, onDismiss() {} }));
    for (const region of regions) {
      assert.ok(region, 'never null while the flag is on');
      assert.equal(region.type, 'div');
      assert.deepEqual(Object.keys(region.props).sort(), ['children', 'role']);
      assert.equal(region.props.role, 'status');
    }
    // Only the content inside the region carries the bar (no second live region inside).
    for (const region of regions) {
      const inner = elementsOf(walk(expand(region.props.children)));
      assert.ok(inner.every((el) => el.props?.role === undefined), 'one live region');
    }
  });

  it('"Close" moves focus to the Layout\'s main (its own button unmounts); the bar focuses main once after an accepted agreement', () => {
    const dismissed = [];
    let focused = 0;
    const tokens = render(on, on.LegalNoticeBarBody, { language: 'jp', status: 'accepted', notice, onDismiss: (v) => dismissed.push(v), focusAfterDismiss: () => { focused += 1; } });
    elementsOf(tokens).find((el) => el.type === 'button').props.onClick();
    assert.deepEqual(dismissed, ['privacy-2027-04-01']);
    assert.equal(focused, 1);
    const savedDocument = globalThis.document;
    const calls = [];
    globalThis.document = { getElementById: (id) => (id === 'main-content' ? { focus: (options) => calls.push(options) } : null) };
    try {
      on.focusMainContent();
    } finally {
      if (savedDocument === undefined) delete globalThis.document;
      else globalThis.document = savedDocument;
    }
    assert.deepEqual(calls, [{ preventScroll: true }]);
    const code = read('components/legal/LegalNoticeBar.tsx');
    assert.match(code, /focusAfterDismiss=\{focusMainContent\}/);
    assert.match(code, /useEffect\(\(\) => \{\s*if \(features\.legalPages && legalGate\(features\.legalPages\)\.takeFocusAfterAccept\(\)\) focusMainContent\(\);\s*\}, \[\]\);/);
  });

  it('flag off: the bar renders nothing', () => {
    assert.equal(off.LegalNoticeBar(), null);
    assert.equal(off.features.legalPages, false);
  });
});

// ---------------------------------------------------------------------------------------------
// App.tsx and the link sites

describe('App.tsx: the gate branch and its exemptions', () => {
  const app = read('App.tsx');
  const literal = (name) => {
    const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(app);
    assert.ok(match, name);
    return match[1];
  };
  const strings = (text) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it('LEGAL_GATE_EXEMPT is PUBLIC_PATHS plus exactly the six pages that never need the agreement', () => {
    const publicPaths = strings(literal('PUBLIC_PATHS'));
    const exempt = literal('LEGAL_GATE_EXEMPT');
    assert.match(exempt, /^\s*\.\.\.PUBLIC_PATHS,/);
    assert.deepEqual(strings(exempt).sort(), [
      '/settings/ai-access', '/settings/ai-memory', '/settings/connected-apps', '/settings/delete-account', '/settings/plan', '/settings/privacy',
    ]);
    for (const p of ['/', '/p-school', '/oauth/consent', '/settings', '/settings/plan/confirm', '/auth/callback']) {
      assert.ok(!publicPaths.includes(p) && !strings(exempt).includes(p), `${p} is gated`);
    }
    assert.ok(publicPaths.includes('/terms') && publicPaths.includes('/privacy'), 'the texts can always be read');
  });

  it('the consent page is the first branch after the auth check (before /oauth/consent and the sign-in redirects), only for needed', () => {
    const start = app.indexOf('{authLoading ? (');
    const gate = app.indexOf(") : isLoggedIn && legal.status === 'needed' && !LEGAL_GATE_EXEMPT.has(normalizePath(location.pathname)) ? (");
    const consent = app.indexOf(') : consentPath ? (');
    const postSignIn = app.indexOf(') : isLoggedIn && POST_SIGN_IN_PATHS.has(');
    assert.ok(start > 0 && start < gate && gate < consent && consent < postSignIn, 'order');
    assert.match(app.slice(gate, consent), /<Suspense fallback=\{<RouteLoading \/>\}>\s*<LegalConsentView \/>\s*<\/Suspense>/);
    assert.match(app, /const legal = useLegalGate\(features\.legalPages\);/);
    assert.match(app, /syncLegalGate\(features\.legalPages, user \? \{ id: user\.id, email: user\.email, isGuest: user\.isGuest \} : null\);/);
    // The notice bar goes in the Layout's notice slot, above the routes (Phase 5: beside the
    // save-stopped notice; the flag still folds the legal bar away).
    assert.match(app, /<Layout currentView=\{getCurrentViewState\(\)\} onNavigate=\{handleNavigate\} onLogout=\{handleLogout\} notice=\{<>\{features\.legalPages \? <LegalNoticeBar \/> : null\}<SaveStoppedNotice \/><\/>\}>\s*<Suspense/);
  });

  it('the Layout prints the whole page: the frame grows in print and the app chrome is hidden (a signed-in /privacy printout was one page)', () => {
    const layout = read('components/common/Layout.tsx');
    assert.match(layout, /<div className="flex h-screen[^"]*print:h-auto[^"]*print:overflow-visible[^"]*">/, 'the root frame');
    const main = /<main\s+id="main-content"[\s\S]*?className=\{`([^`]+)`\}/.exec(layout);
    assert.ok(main, '<main id="main-content">');
    for (const cls of ['print:h-auto', 'print:overflow-visible', 'print:pt-0']) assert.ok(main[1].includes(cls), cls);
    assert.match(/id="app-sidebar"[\s\S]*?className=\{`([^`]+)`\}/.exec(layout)?.[1] ?? '', /print:hidden/, 'the sidebar');
    assert.match(/<header[\s\S]*?className=\{`([^`]+)`\}/.exec(layout)?.[1] ?? '', /md:hidden fixed[^`]*print:hidden/, 'the fixed phone header');
  });

  it('the Layout\'s main pads its scroll area under the fixed phone header (a #section heading lands below it, not under it)', () => {
    const layout = read('components/common/Layout.tsx');
    const main = /<main\s+id="main-content"[\s\S]*?className=\{`([^`]+)`\}/.exec(layout)?.[1] ?? '';
    assert.match(main, /'pt-14 scroll-pt-14 md:pt-0 md:scroll-pt-0'/, 'scroll padding wherever the header padding is');
  });

  it('the Layout puts the notice slot in the content frame on every page, full-bleed ones too (the dashboard, lessons)', () => {
    const layout = read('components/common/Layout.tsx');
    const frame = /const CONTENT_FRAME = '([^']+)';/.exec(layout);
    assert.ok(frame, 'CONTENT_FRAME');
    assert.match(frame[1], /\bpx-4\b/);
    assert.match(layout, /\{notice \? <div className=\{CONTENT_FRAME\}>\{notice\}<\/div> : null\}\s*<div\s+className=\{`min-h-full w-full \$\{\s*isFullBleedView\s*\?\s*''\s*:\s*CONTENT_FRAME\s*\}`\}/);
    assert.match(layout, /\(\{ currentView, onNavigate, onLogout, notice, children \}\)/);
  });
});

describe('link sites (design §2.6)', () => {
  it('Landing and the login footer link the texts only with the flag', () => {
    const landing = read('components/common/ExperienceLandingView.tsx');
    assert.match(landing, /\{features\.legalPages && \(\s*<>\s*<Link to="\/terms"[\s\S]*?<Link to="\/privacy"/);
    const login = read('components/common/ExperienceLoginView.tsx');
    assert.match(login, /\{features\.legalPages && \(\s*<>\s*<Link to="\/terms"[\s\S]*?<Link to="\/privacy"/);
    assert.match(login, /\{isSignup && features\.legalPages && \(/);
    assert.doesNotMatch(login, /defaultChecked|checked=\{true\}/);
  });

  it('the login and sign-up screen scrolls: the root box scrolls and an inner min-h-full wrapper centres (the form with the legal block is taller than a laptop or phone screen)', () => {
    const login = read('components/common/ExperienceLoginView.tsx');
    const root = /<div className="(fixed inset-0 z-\[100\][^"]*)">/.exec(login);
    assert.ok(root, 'the fixed root');
    assert.match(root[1], /overflow-y-auto/);
    assert.doesNotMatch(root[1], /\bflex\b|items-center/, 'centring a fixed box pushes the top and the bottom off screen');
    const after = login.slice(root.index + root[0].length);
    assert.match(after, /^[\s\S]*?<div className="[^"]*min-h-full[^"]*items-center[^"]*justify-center/);
  });

  it('Settings: terms and privacy rows with the flag, the contact line always; Privacy page: the policy line with the flag', () => {
    const settings = read('components/features/settings/SettingsView.tsx');
    assert.match(settings, /<SettingsSection title=\{t\.about\}>\s*\{features\.legalPages && \(\s*<>[\s\S]*?ViewState\.LEGAL_TERMS[\s\S]*?ViewState\.LEGAL_PRIVACY[\s\S]*?<\/>\s*\)\}\s*<div[^>]*>[\s\S]*?<SupportContact/);
    assert.match(settings, /about: 'このサービスについて'/);
    assert.match(settings, /about: 'About this service'/);
    assert.match(settings, /contact: 'お問い合わせ'/);
    // The card's heading says 「お問い合わせ」, so the line under it is the link alone.
    assert.match(settings, /<h3[^>]*>\{t\.contact\}<\/h3>\s*<SupportContact className="mt-1" showLabel=\{false\} \/>/);
    const privacy = read('components/features/settings/SettingsPrivacyView.tsx');
    assert.match(privacy, /\{features\.legalPages && \(\s*<p className="text-body text-fg-2">\s*\{t\.policyLead\}\s*<Link to="\/privacy"/);
    assert.match(privacy, /<Link to="\/settings\/delete-account"/, 'the delete link stays (always)');
  });

  it('/ai-safety: "being prepared" only while off, links once on; the deletion line stays', () => {
    const safety = read('components/features/safety/AiSafetyGuideView.tsx');
    assert.match(safety, /いま準備しています。公開したら、このページからリンクします。', when: 'legalPagesOff'/);
    assert.match(safety, /being prepared\. We will link them from this page once they are published\.', when: 'legalPagesOn'|being prepared\. We will link them from this page once they are published\.', when: 'legalPagesOff'/);
    assert.match(safety, /when: 'legalPagesOn',\s*pages: \[\{ to: '\/privacy', label: 'プライバシーポリシー' \}, \{ to: '\/terms', label: '利用規約' \}\]/);
    assert.match(safety, /const shownNow = \(item: ComplianceItem\) => !item\.when \|\| \(item\.when === 'legalPagesOn'\) === features\.legalPages;/);
    assert.match(safety, /\.filter\(shownNow\)\.map\(/);
    assert.ok(safety.includes("'アカウントを削除するときは、設定の「アカウントを削除する」を開いてください。'"));
  });

  it('the agent connection page and the delete page link the texts in a new tab, only with the flag', () => {
    const oauth = read('components/features/oauth/OAuthConsentView.tsx');
    assert.match(oauth, /\{features\.legalPages && \(\s*<p[^>]*>\s*\{\[\s*\{ to: '\/terms', label: t\.termsLink \},\s*\{ to: '\/privacy', label: t\.privacyLink \},\s*\]\.map\(\(page\) => \(\s*<Link\s*key=\{page\.to\}\s*to=\{page\.to\}\s*target="_blank"/);
    const del = read('components/features/settings/DeleteAccountView.tsx');
    assert.match(del, /\{features\.legalPages \? \(\s*<p[^>]*>\s*\{t\.keptPolicyLead\}\s*<LegalNewTabLink to="\/privacy#section-8"/);
  });

  it('the new UI uses design tokens only and copy in both languages (です・ます, no 「簡単です」「誰でも」)', () => {
    const login = read('components/common/ExperienceLoginView.tsx');
    const loginBlock = login.slice(login.indexOf('{/* Phase 4 (APPI'), login.indexOf('{error && ('));
    for (const [file, text] of [
      ['components/legal/LegalConsentView.tsx', read('components/legal/LegalConsentView.tsx')],
      ['components/legal/LegalNoticeBar.tsx', read('components/legal/LegalNoticeBar.tsx')],
      ['components/legal/LegalLinks.tsx', read('components/legal/LegalLinks.tsx')],
      ['ExperienceLoginView Phase 4 block', loginBlock],
    ]) {
      assert.doesNotMatch(text, /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/, file);
      assert.doesNotMatch(text, /簡単です|誰でも/, file);
    }
    for (const file of ['components/legal/LegalConsentView.tsx', 'components/legal/LegalNoticeBar.tsx']) {
      const text = read(file);
      assert.match(text, /const copy = \{\s*en: \{/, file);
      assert.match(text, /jp: \{/, file);
    }
  });
});
