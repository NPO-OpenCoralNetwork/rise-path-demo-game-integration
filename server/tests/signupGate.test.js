// Phase 9 (D1; design §3): the app's own sign-up is closed until VITE_FEATURE_LEGAL_PAGES=true.
// - services/authFormValidation.ts: SIGNUP_CLOSED and mapSignupErrorMessage.
// - components/common/ExperienceLoginView.tsx: with the flag off there is no tab row, no 「新規登録」 /
//   "Create Account" button anywhere, a caller's signup mode is turned into the sign-in form, the
//   sign-up submit refuses, and the footer shows the closed notice (jp and en). With the flag on:
//   today's tab row and "Create one" link.
// - components/features/oauth/OAuthConsentView.tsx: the signed-out card offers sign-in only and
//   says sign-up is closed; with the flag on, today's two buttons and the hint.
// - context/AuthContext.tsx: signUp rejects signup_closed before anything else, the Supabase
//   branch and the mock branch alike (bundled against stubs).
// - e2e/support/ui.mjs carries the same two strings (every Learner end-to-end flow checks them).
// Rendering: esbuild bundles against stubs whose jsx() returns { type, props } (as
// legalConsentFront.test.js).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { SIGNUP_CLOSED, mapSignupErrorMessage } from '../../services/authFormValidation.ts';
import { UI } from '../../e2e/support/ui.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CLOSED = {
  jp: 'まだ新しいアカウントの登録は受け付けていません。試験運用に参加している方は、担当者から案内されたアカウントでログインしてください。',
  en: 'New accounts are not open yet. If you are taking part in the trial, sign in with the account the Rise Path team told you to use.',
};
const CONSENT_CLOSED = {
  jp: 'まだ新しいアカウントの登録は受け付けていません。お持ちのアカウントでログインしてください。',
  en: 'New accounts are not open yet. Sign in with an account you already have.',
};
const SIGNUP_WORDS = /新規登録|アカウントを作成|アカウントを作る|Create Account|Create an account|Create one/;

// ---------------------------------------------------------------------------------------------
// Bundles (flag on and off) against stubs

/** Every icon name the components import from lucide-react (the stub exports each as a string). */
const ICONS = (() => {
  const names = new Set();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(rel);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const m of read(rel).matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
          for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim();
            if (/^[A-Z]\w*$/.test(name)) names.add(name);
          }
        }
      }
    }
  };
  visit('components');
  return [...names];
})();
const STUBS = {
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
    export const createContext = () => ({ Provider: 'Provider' });
    export const useContext = () => null;
    export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore, forwardRef, createContext, useContext };
  `,
  'react/jsx-runtime': "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'react-router-dom': `
    export const Link = 'Link';
    export const useNavigate = () => (to) => { (globalThis.__navigations ??= []).push(to); };
    export const useLocation = () => ({ pathname: '/oauth/consent', hash: '', search: '?authorization_id=AbCdEfGhIjKlMnOpQrStUvWxYz012345' });
  `,
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  auth: `export const useAuth = () => globalThis.__auth ?? ({
    isLoggedIn: false, user: null,
    login: async () => {}, loginAsGuest() {}, signUp: async () => ({ status: 'session_ready' }), logout: async () => true,
  });`,
  button: "export const Button = 'Button'; export const ButtonLink = 'ButtonLink'; export default 'Button';",
  supabase: `
    export const getSupabaseClient = () => globalThis.__main ?? null;
    export const isSupabaseConfigured = () => globalThis.__configured ?? true;
    export const getNexloomSupabaseClient = () => null;
    export const createReauthClient = () => null;
  `,
  lessonSync: 'export const isSyncableLesson = () => true;',
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

const VIEWS = [
  "export { default as LoginView } from './components/common/ExperienceLoginView';",
  "export { default as OAuthConsentView } from './components/features/oauth/OAuthConsentView';",
  "export { __resetHooks } from 'react';",
].join('\n');

async function bundle(entry, env, extraStubs = () => {}) {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [{
      name: 'stubs',
      setup(b) {
        const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
        stub(/^react$/, 'react');
        stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
        stub(/^react-router-dom$/, 'react-router-dom');
        stub(/^lucide-react$/, 'lucide-react');
        stub(/context\/LanguageContext$/, 'language');
        stub(/ui\/Button$/, 'button');
        stub(/supabaseClient$/, 'supabase');
        extraStubs(stub);
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js', resolveDir: ROOT }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

let loads = 0;
const load = (text) => import(`data:text/javascript;base64,${Buffer.from(`${text}\n// load ${(loads += 1)}`).toString('base64')}`);

const viewStubs = (stub) => {
  stub(/context\/AuthContext$/, 'auth');
  stub(/\/progressSyncClient$/, 'lessonSync');
};
const authStubs = (stub) => {
  stub(/services\/(progressService|notificationService|userProfileService|sharedDeviceData|accountDeviceData|apiClient)$/, 'quiet');
  stub(/lesson\/progressSyncClient$/, 'quiet');
  stub(/lesson\/logoutGuard$/, 'quiet');
};

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

function render(mod, component, props, globals = {}) {
  Object.assign(globalThis, { __sets: [], ...globals });
  mod.__resetHooks();
  try {
    return walk(expand(component(props)));
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

/** Every element a person can press: host buttons and the design system's Button. */
const pressables = (tokens) => elementsOf(tokens).filter((el) => el.type === 'button' || el.type === 'Button');
const tabRow = (tokens) => elementsOf(tokens).find((el) => el.type === 'div' && /^flex rounded-full/.test(String(el.props.className ?? '')));

let on = null;
let off = null;
before(async () => {
  on = await load(await bundle(VIEWS, { PROD: true, VITE_FEATURE_LEGAL_PAGES: 'true' }, viewStubs));
  off = await load(await bundle(VIEWS, { PROD: true }, viewStubs));
});

// ---------------------------------------------------------------------------------------------

describe('SIGNUP_CLOSED and mapSignupErrorMessage (services/authFormValidation.ts)', () => {
  it('signup_closed maps to itself; the other answers are unchanged', () => {
    assert.equal(SIGNUP_CLOSED, 'signup_closed');
    assert.equal(mapSignupErrorMessage('signup_closed'), SIGNUP_CLOSED);
    assert.equal(mapSignupErrorMessage('User already registered'), 'already_registered');
    assert.equal(mapSignupErrorMessage('Password should be at least 8 characters'), 'Password should be at least 8 characters');
  });
});

describe('the login view (ExperienceLoginView) with the sign-up closed', () => {
  for (const initialMode of ['login', 'signup']) {
    for (const language of ['jp', 'en']) {
      it(`flag off, initialMode ${initialMode}, ${language}: the sign-in form, no tab row, no sign-up button, the closed notice`, () => {
        const tokens = render(off, off.LoginView, { initialMode, onLoginSuccess() {} }, { __language: language });
        assert.equal(tabRow(tokens), undefined, 'no tab row');
        for (const el of pressables(tokens)) assert.doesNotMatch(textOfElement(el), SIGNUP_WORDS, 'no sign-up button');
        assert.ok(!pressables(tokens).some((el) => textOfElement(el) === UI.signupTab), 'no element named 新規登録');
        const passwords = elementsOf(tokens).filter((el) => el.type === 'input' && el.props.type === 'password');
        assert.deepEqual(passwords.map((el) => el.props.autoComplete), ['current-password'], 'the sign-in form (no confirmation, no display name)');
        const notice = elementsOf(tokens).find((el) => el.type === 'p' && textOfElement(el) === CLOSED[language]);
        assert.ok(notice, 'the closed notice');
        assert.equal(notice.props.className, 'text-center text-sm text-white/70');
      });
    }
  }

  it('flag off: the form submits a sign-in for either mode, never a sign-up', async () => {
    for (const initialMode of ['login', 'signup']) {
      const calls = { login: 0, signUp: 0 };
      const auth = {
        login: async () => { calls.login += 1; }, loginAsGuest() {}, logout: async () => true,
        signUp: async () => { calls.signUp += 1; return { status: 'session_ready' }; },
      };
      const tokens = render(off, off.LoginView, { initialMode, onLoginSuccess() {} }, { __auth: auth });
      const form = elementsOf(tokens).find((el) => el.type === 'form');
      Object.assign(globalThis, { __sets: [], __auth: auth });
      try {
        await form.props.onSubmit({ preventDefault() {} });
      } finally {
        delete globalThis.__auth;
      }
      assert.deepEqual(calls, { login: 1, signUp: 0 }, initialMode);
    }
  });

  it('flag off: a sign-up form forced on (mode state "signup") still refuses: the closed notice as the error, signUp never called', async () => {
    let signUps = 0;
    const auth = {
      login: async () => {}, loginAsGuest() {}, logout: async () => true,
      signUp: async () => { signUps += 1; return { status: 'session_ready' }; },
    };
    const props = { initialMode: 'signup', onLoginSuccess() {} };
    // useState index 0 is the mode: force it, as a stale state or a future caller could.
    const tokens = render(off, off.LoginView, props, { __auth: auth, __state: { 0: 'signup' } });
    const form = elementsOf(tokens).find((el) => el.type === 'form');
    Object.assign(globalThis, { __sets: [], __auth: auth, __state: { 0: 'signup' } });
    try {
      await form.props.onSubmit({ preventDefault() {} });
    } finally {
      delete globalThis.__auth;
      delete globalThis.__state;
    }
    assert.equal(signUps, 0);
    assert.ok(globalThis.__sets.some(([, value]) => value === CLOSED.jp), 'the closed notice is the error');
    // And the sign-up error path maps AuthContext's refusal to the same notice.
    assert.match(read('components/common/ExperienceLoginView.tsx'), /if \(mapped === SIGNUP_CLOSED\) \{\s*\n\s*setError\(t\.signupClosed\);/);
  });

  it('switchMode refuses "signup" while the sign-up is closed (its first statement)', () => {
    const code = read('components/common/ExperienceLoginView.tsx');
    assert.match(code, /const switchMode = \(next: AuthMode\) => \{\s*\n\s*if \(next === 'signup' && !features\.legalPages\) return;\s*\n\s*setMode\(next\);/);
    assert.match(code, /useState<AuthMode>\(features\.legalPages \? initialMode : 'login'\)/);
    assert.match(code, /setMode\(features\.legalPages \? initialMode : 'login'\);/);
  });

  it('flag on: today\'s tab row (ログイン / 新規登録) and the "Create one" link; signup mode is the sign-up form', () => {
    const login = render(on, on.LoginView, { initialMode: 'login', onLoginSuccess() {} });
    const row = tabRow(login);
    assert.ok(row, 'the tab row');
    assert.deepEqual(elementsOf(walk(row.props.children)).filter((el) => el.type === 'button').map(textOfElement), ['ログイン', '新規登録']);
    assert.ok(pressables(login).some((el) => textOfElement(el) === '新規登録' && el !== row), 'the footer link');
    assert.doesNotMatch(textOf(login), /まだ新しいアカウントの登録は受け付けていません/);
    const signup = render(on, on.LoginView, { initialMode: 'signup', onLoginSuccess() {} });
    assert.equal(elementsOf(signup).filter((el) => el.type === 'input' && el.props.type === 'password').length, 2, 'password and confirmation');
    // The sign-up tab switches the mode.
    const signupTab = elementsOf(walk(row.props.children)).find((el) => el.type === 'button' && textOfElement(el) === '新規登録');
    globalThis.__sets = [];
    signupTab.props.onClick();
    assert.deepEqual(globalThis.__sets[0], [0, 'signup']);
    const en = render(on, on.LoginView, { initialMode: 'login', onLoginSuccess() {} }, { __language: 'en' });
    assert.deepEqual(elementsOf(walk(tabRow(en).props.children)).filter((el) => el.type === 'button').map(textOfElement), ['Sign In', 'Create Account']);
  });

  it('e2e/support/ui.mjs carries the jp tab name and the closed notice exactly (every Learner end-to-end flow checks them)', () => {
    assert.equal(UI.signupClosed, CLOSED.jp);
    assert.equal(UI.signupTab, '新規登録');
    const code = read('components/common/ExperienceLoginView.tsx');
    assert.ok(code.includes(`tabSignup: '${UI.signupTab}',`));
    assert.ok(code.includes(`signupClosed: '${UI.signupClosed}',`));
    const flows = read('e2e/support/flows.ts');
    const signIn = flows.slice(flows.indexOf('export async function signIn'), flows.indexOf('export const storedSession'));
    const click = signIn.indexOf("getByRole('button', { name: UI.login, exact: true }).first().click()");
    const visible = signIn.indexOf('await expect(page.getByText(UI.signupClosed)).toBeVisible();');
    const none = signIn.indexOf("await expect(page.getByRole('button', { name: UI.signupTab, exact: true })).toHaveCount(0);");
    const email = signIn.indexOf('input[type="email"]');
    assert.ok(click > 0 && click < visible && visible < none && none < email, 'after the login click, before the email: notice visible, then no sign-up button');
  });
});

describe('the consent page (OAuthConsentView) signed out', () => {
  const signedOut = { 0: { kind: 'signed_out' } };
  for (const language of ['jp', 'en']) {
    it(`flag off, ${language}: sign-in only, the closed line, no sign-up button or hint`, () => {
      const modes = [];
      const tokens = render(off, off.OAuthConsentView, { onSignIn: (mode) => modes.push(mode) }, { __state: signedOut, __language: language });
      const buttons = elementsOf(tokens).filter((el) => el.type === 'Button');
      assert.deepEqual(buttons.map(textOfElement), [language === 'jp' ? 'サインイン' : 'Sign in']);
      for (const el of pressables(tokens)) assert.doesNotMatch(textOfElement(el), SIGNUP_WORDS);
      const line = elementsOf(tokens).find((el) => el.type === 'p' && textOfElement(el) === CONSENT_CLOSED[language]);
      assert.ok(line, 'the closed line');
      assert.equal(line.props.className, 'mt-4 text-small text-fg-2');
      assert.doesNotMatch(textOf(tokens), /確認メール|confirmation email/);
      buttons[0].props.onClick();
      assert.deepEqual(modes, ['login']);
    });
  }

  it('flag on: today\'s two buttons and the hint', () => {
    const modes = [];
    const tokens = render(on, on.OAuthConsentView, { onSignIn: (mode) => modes.push(mode) }, { __state: signedOut });
    const buttons = elementsOf(tokens).filter((el) => el.type === 'Button');
    assert.deepEqual(buttons.map(textOfElement), ['サインイン', 'アカウントを作る']);
    buttons[1].props.onClick();
    assert.deepEqual(modes, ['signup']);
    assert.match(textOf(tokens), /アカウントを作る場合は、確認メールをこのブラウザで開いてください。/);
    assert.doesNotMatch(textOf(tokens), /まだ新しいアカウントの登録は受け付けていません/);
  });
});

describe('AuthContext.signUp with the sign-up closed (bundled)', () => {
  let authOff = null;
  let authOffDev = null;
  before(async () => {
    authOff = await load(await bundle("export { AuthProvider } from './context/AuthContext';", { PROD: true }, authStubs));
    // The dev build without Supabase: the mock branch (allowMockLogin) is the one signUp would take.
    authOffDev = await load(await bundle("export { AuthProvider } from './context/AuthContext';", { PROD: false, DEV: true }, authStubs));
  });

  const memoryStorage = () => {
    const map = new Map();
    return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  };

  it('the Supabase branch: rejects signup_closed; no supabase.auth.signUp, nothing stored', async () => {
    const storage = memoryStorage();
    let calls = 0;
    globalThis.window = { location: { origin: 'http://localhost:3007' }, localStorage: storage };
    globalThis.__main = { auth: { signUp: async () => { calls += 1; return { data: { user: null, session: null }, error: null }; } } };
    try {
      const { signUp } = authOff.AuthProvider({ children: null }).props.value;
      await assert.rejects(signUp('learner@example.com', 'a-long-password', { legalAccepted: true }), { message: SIGNUP_CLOSED });
    } finally {
      delete globalThis.window;
      delete globalThis.__main;
    }
    assert.equal(calls, 0);
    assert.equal(storage.map.size, 0);
  });

  it('the mock branch (dev, no Supabase): rejects signup_closed too; no mock sign-in', async () => {
    const storage = memoryStorage();
    globalThis.window = { location: { origin: 'http://localhost:3007' }, localStorage: storage };
    globalThis.localStorage = storage;
    globalThis.__configured = false;
    try {
      const { signUp } = authOffDev.AuthProvider({ children: null }).props.value;
      await assert.rejects(signUp('learner@example.com', 'a-long-password'), { message: SIGNUP_CLOSED });
    } finally {
      delete globalThis.window;
      delete globalThis.localStorage;
      delete globalThis.__configured;
    }
    assert.equal(storage.getItem('rp_auth_user'), null, 'no mock user was signed in');
  });

  it('the refusal is signUp\'s first statement', () => {
    const code = read('context/AuthContext.tsx');
    const body = code.slice(code.indexOf('const signUp = useCallback(async ('));
    assert.match(body, /\): Promise<SignUpResult> => \{\s*\n(\s*\/\/[^\n]*\n)*\s*if \(!features\.legalPages\) throw new Error\(SIGNUP_CLOSED\);\s*\n\s*const normalizedEmail/);
  });
});

describe('the documents say the sign-up is closed in code (D1; design §1.1 D1 docs, §8.3, §8.4 D17)', () => {
  it('config/features.ts and deploy/vercel/README.md (plain form) name the closed sign-up and the pilot list', () => {
    assert.match(read('config/features.ts'), /the app's sign-up \(the login view's tab and form, AuthContext\.signUp, the\s*\n\s*\*\s*consent page's sign-up button\) is closed while this is off/);
    const line = read('deploy/vercel/README.md').split('\n').find((l) => l.startsWith('- `VITE_FEATURE_LEGAL_PAGES`'));
    assert.ok(line);
    assert.match(line, /アプリの新規登録はコードで閉じている（ログインの画面に「新規登録」がなく、`AuthContext\.signUp` も断る。Phase 9）/);
    assert.match(line, /試験運用の名簿 `PILOT_ACCOUNT_IDS` で断る。\[手順書 10\.1\]\(\.\.\/\.\.\/doc\/guides\/first-launch\.ja\.md\)/);
  });
  it('doc/legal/README.md step 1 and the plan no longer say there is no automatic check: the sign-up is closed in code, logins of the shared project meet the protection and the list', () => {
    const legal = read('doc/legal/README.md');
    const step1 = legal.slice(legal.indexOf('## ページを公開する手順'), legal.indexOf('\n2. ', legal.indexOf('## ページを公開する手順')));
    assert.match(step1, /アプリの登録は、コードで閉じています（`VITE_FEATURE_LEGAL_PAGES` が `true` になるまで。Phase 9）/);
    assert.match(step1, /Nexloom や P-School のアカウントではログインできるので、Vercel の保護と試験運用の名簿で守ります（手順書 2\.6・10\.1。手順書は \[\.\.\/guides\/first-launch\.ja\.md\]\(\.\.\/guides\/first-launch\.ja\.md\)）/);
    const plan = read('doc/brushup-2026/ai-access-plan.ja.md').split('\n').find((l) => l.startsWith('1. **公開の関門**'));
    assert.ok(plan);
    assert.match(plan, /アプリの登録は、そのあいだコードで閉じています（Phase 9。/);
    for (const [where, text] of [['doc/legal/README.md step 1', step1], ['ai-access-plan 公開の関門', plan]]) {
      assert.doesNotMatch(text, /自動の確かめはありません/, where);
      assert.doesNotMatch(text, /登録画面に/, `${where}: there is no sign-up screen while the flag is off`);
    }
  });
});
