// Job training, front end (doc/brushup-2026/training-plan.ja.md D1, D5, §4.6, §4.8):
// - features.training (config/features.ts) is on only for VITE_FEATURE_TRAINING exactly "true".
// - components/routes/lazyRoutes.tsx imports the section only with the flag, and nothing outside
//   components/features/training/ imports it (or services/trainingApi.ts), whatever the form of the
//   import (relative, "@/", with ".ts"), so a flag-off build carries none of it; the marker the CI
//   grep looks for is in one front file only.
// - App.tsx routes /training/* in the Layout only with the flag (else "/"), not as a public path.
// - ci.yml greps the flag-off production build for the marker and the API path.
// - services/trainingApi.ts reads the server's answer (server/routes/training.js) and its refusals;
//   components/features/training/trainingModel.ts turns them into what the page shows.
// - TrainingView.tsx, rendered with a small hook runtime: guests send nothing, every state sits in
//   one status region, a retry gives focus that was lost to the title, an answer for another
//   learner and an aborted request never show.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { TRAINING_ROLES } from '../../tools/core/training.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MARKER = 'risepath-training-ui';
const SECTION = 'components/features/training';
const U1 = 'aaaaaaaa-2121-4000-8000-0000000000a1';
const U2 = 'aaaaaaaa-2121-4000-8000-0000000000b2';

const NOT_FRONT_ROOTS = /^(?:server|mcp-server|scripts|tools|deploy|hermes|public|doc|node_modules|dist[^/]*|\.[^/]+)\//;
const NOT_FRONT_FILES = /^(?:server\.js|test_[^/]*\.js)$|(?:^|\/)vite\.config\.[cm]?[jt]s$/;
const SOURCE = /\.(?:tsx?|jsx?|mjs)$/;

/** Tracked and new (not ignored) front source files; without git, the same filter over a walk. */
function frontFiles() {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let files;
  if (git.status === 0) {
    files = git.stdout.split('\n').filter(Boolean);
  } else {
    files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!NOT_FRONT_ROOTS.test(`${rel}/`)) walk(rel);
        } else files.push(rel);
      }
    };
    walk('');
  }
  return files.filter((f) => SOURCE.test(f) && !f.endsWith('.d.ts') && !NOT_FRONT_ROOTS.test(f) && !NOT_FRONT_FILES.test(f) && fs.existsSync(path.join(ROOT, f)));
}

/** Import specifiers as repo-relative module paths: relative ones resolved, the "@/" alias (vite.config.ts, tsconfig) taken off, a source extension dropped. */
function importsOf(file) {
  const { importedFiles } = ts.preProcessFile(read(file), true, true);
  return importedFiles.map(({ fileName }) => {
    let spec = fileName;
    if (spec.startsWith('.')) spec = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    else if (spec.startsWith('@/')) spec = spec.slice(2);
    return spec.replace(SOURCE, '');
  });
}

const inSection = (spec) => spec === SECTION || spec.startsWith(`${SECTION}/`);

async function loadFeatures(env) {
  const result = await build({
    stdin: { contents: "export { features } from './config/features';", resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': JSON.stringify(env) },
    logLevel: 'silent',
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).features;
}

describe('features.training (config/features.ts)', () => {
  it('is off when VITE_FEATURE_TRAINING is unset, on only for exactly "true"', async () => {
    assert.equal((await loadFeatures({})).training, false);
    assert.equal((await loadFeatures({ VITE_FEATURE_TRAINING: 'true' })).training, true);
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '', 'false']) {
      assert.equal((await loadFeatures({ VITE_FEATURE_TRAINING: value })).training, false, `"${value}"`);
    }
    assert.match(read('config/features.ts'), /\n {2}training: import\.meta\.env\.VITE_FEATURE_TRAINING === 'true',\n/);
    assert.match(read('vite-env.d.ts'), /readonly VITE_FEATURE_TRAINING\?: string;/);
  });
});

describe('keeping the training section out of a flag-off bundle', () => {
  it('lazyRoutes imports the page only with features.training', () => {
    assert.match(
      read('components/routes/lazyRoutes.tsx'),
      /export const TrainingRoute = lazy\(\s*\(\) => \(features\.training \? import\('\.\.\/features\/training\/TrainingView'\) : Promise\.resolve\(\{ default: \(\) => null \}\)\)\s*\);/,
    );
  });

  it('the import scan reads every form of an import: relative, "@/", with ".ts"', () => {
    const forms = ['../../services/trainingApi.ts', '@/services/trainingApi', '@/components/features/training/TrainingView.tsx', '../features/training'];
    const scanned = ts.preProcessFile(forms.map((f) => `import x from '${f}';`).join('\n'), true, true).importedFiles.map(({ fileName }) => fileName);
    assert.deepEqual(scanned, forms);
    const resolve = (file, spec) => {
      let s = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec.startsWith('@/') ? spec.slice(2) : spec;
      s = s.replace(SOURCE, '');
      return s;
    };
    assert.equal(resolve('components/common/Layout.tsx', forms[0]), 'services/trainingApi');
    assert.equal(resolve('components/common/Layout.tsx', forms[1]), 'services/trainingApi');
    assert.ok(inSection(resolve('App.tsx', forms[2])));
    assert.ok(inSection(resolve('components/routes/lazyRoutes.tsx', forms[3])));
  });

  it('nothing outside the section imports it or its API client, except that one lazy import', () => {
    const outside = [];
    const api = [];
    for (const file of frontFiles()) {
      if (inSection(file.replace(SOURCE, ''))) continue;
      for (const spec of importsOf(file)) {
        if (inSection(spec)) outside.push(file);
        if (spec === 'services/trainingApi') api.push(file);
      }
    }
    assert.deepEqual(outside, ['components/routes/lazyRoutes.tsx']);
    assert.deepEqual(api, []);
  });

  it('the CI marker is on the page root only, and not in index.html', () => {
    const holders = frontFiles().filter((file) => read(file).includes(MARKER));
    assert.deepEqual(holders, [`${SECTION}/TrainingView.tsx`]);
    assert.match(read(`${SECTION}/TrainingView.tsx`), /<div data-rp-section=\{TRAINING_UI_MARKER\} className=/);
    assert.ok(!read('index.html').includes(MARKER));
  });
});

describe('routes (App.tsx, types.ts, navigation/viewPaths.ts)', () => {
  const app = read('App.tsx');

  it('/training/* only with the flag, in the Layout block, not public', () => {
    const route = /<Route path="\/training\/\*" element=\{features\.training \? <TrainingRoute \/> : <Navigate to="\/" replace \/>\} \/>/g;
    assert.equal(app.match(route)?.length, 1);
    assert.match(app.slice(app.indexOf('<Layout currentView')), route);
    assert.doesNotMatch(/PUBLIC_PATHS = new Set\(\[([^\]]*)\]\)/.exec(app)[1], /training/);
    assert.match(app, /if \(path === '\/training' \|\| path\.startsWith\('\/training\/'\)\) return ViewState\.TRAINING;/);
    assert.match(read('types.ts'), /TRAINING = 'TRAINING'/);
    assert.match(read('navigation/viewPaths.ts'), /\[ViewState\.TRAINING\]: '\/training',/);
  });
});

describe('.github/workflows/ci.yml', () => {
  const ci = read('.github/workflows/ci.yml');
  const job = ci.slice(ci.indexOf('\n  build:\n'));

  it('greps the flag-off production build for the page marker and the API path, after the legal-text step', () => {
    const name = '- name: Fail if training code reached the bundle';
    assert.ok(job.includes(name));
    const step = job.slice(job.indexOf(name));
    const run = step.slice(0, step.indexOf('\n\n') === -1 ? undefined : step.indexOf('\n\n'));
    assert.match(run, new RegExp(`grep -rlF -e '${MARKER}' -e '/training/me' "\\$RUNNER_TEMP/dist"`));
    assert.match(read('services/trainingApi.ts'), /const PATH = '\/training\/me';/, 'the API path the grep looks for');
    assert.match(run, /exit 1/);
    assert.ok(job.indexOf('- name: Fail if draft legal text reached the bundle') < job.indexOf(name));
    assert.doesNotMatch(job, /VITE_FEATURE_TRAINING\s*:/, 'the build runs with the flag unset');
  });
});

const supabaseStub = {
  name: 'supabase-stub',
  setup(b) {
    b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'supabase-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'supabase-stub' }, () => ({ contents: 'export const getSupabaseClient = () => null; export const isSupabaseConfigured = () => false;', loader: 'js' }));
  },
};

const ME = (cohorts, learnerId = U1.toUpperCase()) => ({ ok: true, learnerId, cohorts });
const respond = (status, body, { text = false } = {}) => {
  respond.calls = 0;
  globalThis.fetch = async (url, init) => {
    respond.calls += 1;
    respond.url = String(url);
    respond.method = init?.method;
    return new Response(text ? body : JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/html' : 'application/json' } });
  };
};
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

describe('services/trainingApi.ts and trainingModel.ts', () => {
  let mod = null;
  before(async () => {
    const result = await build({
      stdin: { contents: `export * from './services/trainingApi'; export { stateForAnswer, stateForFailure } from './${SECTION}/trainingModel';`, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [supabaseStub],
      logLevel: 'silent',
    });
    mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  });

  it('200: the learner id in lower case, the cohorts in the server\'s order; a role the page does not know keeps the cohort, role null', async () => {
    respond(200, ME([{ cohortId: 'c1', name: '2026年11月 Web', role: 'learner' }, { cohortId: 'c2', name: 'B', role: 'mentor' }, { cohortId: 'c3', name: 'C', role: 'staff' }]));
    const me = await mod.getTrainingMe();
    assert.equal(respond.url, '/api/v2/training/me');
    assert.equal(respond.method, 'GET');
    assert.deepEqual(me, { learnerId: U1, cohorts: [{ cohortId: 'c1', name: '2026年11月 Web', role: 'learner' }, { cohortId: 'c2', name: 'B', role: null }, { cohortId: 'c3', name: 'C', role: 'staff' }] });
    respond(200, ME([]));
    assert.deepEqual((await mod.getTrainingMe()).cohorts, []);
  });

  it('refusals carry status and error_type; an older server\'s HTML 404 has none; a malformed 200 is bad_response; the network is 0', async () => {
    respond(404, { error: 'Training is not offered here.', error_type: 'training_off' });
    await assert.rejects(mod.getTrainingMe(), (err) => err.status === 404 && err.errorType === 'training_off');
    respond(404, '<!DOCTYPE html><title>Error</title>', { text: true });
    await assert.rejects(mod.getTrainingMe(), (err) => err.status === 404 && err.errorType === undefined);
    respond(401, { error: 'Sign in', error_type: 'sign_in_required' });
    await assert.rejects(mod.getTrainingMe(), (err) => err.status === 401 && err.errorType === 'sign_in_required');
    respond(503, { ok: false, error: 'down', error_type: 'training_unavailable' });
    await assert.rejects(mod.getTrainingMe(), (err) => err.status === 503 && err.errorType === 'training_unavailable');
    for (const body of [{ ok: true, cohorts: [] }, { ok: true, learnerId: U1 }, ME([{ cohortId: 'c1', name: 'A' }]), ME([{ cohortId: '', name: 'A', role: 'learner' }]), ME('x')]) {
      respond(200, body);
      await assert.rejects(mod.getTrainingMe(), (err) => err.errorType === 'bad_response', JSON.stringify(body));
    }
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(mod.getTrainingMe(), (err) => err.status === 0 && err.errorType === 'network');
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await assert.rejects(mod.getTrainingMe(controller.signal), (err) => err.name === 'AbortError', 'an abort is not a network error');
  });

  it('the page state of an answer and of a refusal', () => {
    const me = { learnerId: U1, cohorts: [] };
    assert.deepEqual(mod.stateForAnswer(me, U1.toUpperCase()), { kind: 'ready', me });
    assert.deepEqual(mod.stateForAnswer(me, U2), { kind: 'error' }, 'never another learner\'s answer');
    const E = mod.TrainingApiError;
    assert.deepEqual(mod.stateForFailure(new E('x', 401, 'sign_in_required')), { kind: 'account' });
    assert.deepEqual(mod.stateForFailure(new E('x', 401, 'account_deleted')), { kind: 'deleted' }, 'no sign-in button: apiClient ends that session');
    assert.deepEqual(mod.stateForFailure(new E('x', 401)), { kind: 'signin' });
    assert.deepEqual(mod.stateForFailure(new E('x', 404, 'training_off')), { kind: 'off' });
    assert.deepEqual(mod.stateForFailure(new E('x', 404)), { kind: 'off' });
    for (const error of [new E('x', 503, 'training_unavailable'), new E('x', 500, 'training_failed'), new E('x', 429, 'rate_limited'), new E('x', 0, 'network'), new E('x', 200, 'bad_response'), new Error('x')]) {
      assert.deepEqual(mod.stateForFailure(error), { kind: 'error' }, String(error.status));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The page, bundled against a React stub whose hooks keep their state between renders (by call
// order) and run effects whose deps changed, as React does after a commit; function components
// are expanded into host elements. The API client and the model are the real modules.

const VIEW_STUBS = {
  react: `
    export const useState = (initial) => globalThis.__hooks.state(initial);
    export const useRef = (value) => globalThis.__hooks.ref(value);
    export const useEffect = (fn, deps) => globalThis.__hooks.effect(fn, deps);
    export default { useState, useRef, useEffect };
  `,
  'react/jsx-runtime': "export const jsx = (type, props, key) => ({ type, props, key }); export const jsxs = jsx; export const Fragment = 'Fragment';",
  'lucide-react': "export const CloudOff = 'CloudOff'; export const GraduationCap = 'GraduationCap'; export const LogIn = 'LogIn';",
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });",
  auth: 'export const useAuth = () => globalThis.__auth;',
  header: "export default function PageHeader(props) { if (props.titleRef) props.titleRef.current = globalThis.__title ?? null; return { type: 'h1', props: { children: props.title } }; }",
  empty: "export default function EmptyState(props) { return { type: 'EmptyState', props: { children: [props.title, props.action ?? null] } }; }",
  button: "export const Button = (props) => ({ type: 'button', props });",
};

function createHooks() {
  const slots = [];
  const effects = [];
  let pending = [];
  let i = 0;
  let e = 0;
  let dirty = false;
  return {
    begin() {
      i = 0;
      e = 0;
      pending = [];
    },
    state(initial) {
      const k = i++;
      if (!(k in slots)) slots[k] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[k];
      return [slot.value, (v) => {
        const next = typeof v === 'function' ? v(slot.value) : v;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          dirty = true;
        }
      }];
    },
    ref(value) {
      const k = i++;
      if (!(k in slots)) slots[k] = { current: value ?? null };
      return slots[k];
    },
    effect(fn, deps) {
      const k = e++;
      const prev = effects[k];
      if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps[j]))) pending.push({ k, fn, deps });
    },
    commit() {
      for (const { k, fn, deps } of pending) {
        effects[k]?.cleanup?.();
        const cleanup = fn();
        effects[k] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : null };
      }
    },
    unmount() {
      for (const effect of effects) effect?.cleanup?.();
    },
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  };
}

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
const textOf = (node) => walk(node).filter((t) => 'text' in t).map((t) => t.text).join('|');
const elementsOf = (node) => walk(node).filter((t) => 'el' in t).map((t) => t.el);

describe('components/features/training/TrainingView.tsx', () => {
  let View = null;
  const BODY = { tag: 'body' };
  before(async () => {
    const result = await build({
      stdin: { contents: `export { default } from './${SECTION}/TrainingView';`, resolveDir: ROOT, loader: 'tsx' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [supabaseStub, {
        name: 'view-stubs',
        setup(b) {
          const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'view-stub' }));
          stub(/^react$/, 'react');
          stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
          stub(/^lucide-react$/, 'lucide-react');
          stub(/context\/LanguageContext$/, 'language');
          stub(/context\/AuthContext$/, 'auth');
          stub(/ui\/PageHeader$/, 'header');
          stub(/ui\/EmptyState$/, 'empty');
          stub(/ui\/Button$/, 'button');
          b.onLoad({ filter: /.*/, namespace: 'view-stub' }, (args) => ({ contents: VIEW_STUBS[args.path], loader: 'js' }));
        },
      }],
      logLevel: 'silent',
    });
    View = (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)).default;
    globalThis.document = { body: BODY, activeElement: BODY };
  });
  after(() => {
    delete globalThis.document;
    delete globalThis.__hooks;
    delete globalThis.__auth;
    delete globalThis.__title;
  });

  /** Mounts the page; render() renders and commits until no state changes, then returns the expanded tree. */
  const mount = (auth) => {
    const hooks = createHooks();
    globalThis.__auth = auth;
    const render = async () => {
      for (let round = 0; round < 20; round += 1) {
        globalThis.__hooks = hooks;
        hooks.begin();
        const tree = View();
        hooks.commit();
        await new Promise((resolve) => setTimeout(resolve, 15));
        if (!hooks.takeDirty()) return expand(tree);
      }
      throw new Error('the page did not settle');
    };
    return { hooks, render };
  };
  const signedIn = (id = U1) => ({ user: { id, isGuest: false }, logout: async (options) => { (signedIn.logouts ??= []).push(options); return true; } });
  /** The one status region's text, after checking that the page root and the region are there. */
  const statusText = (tree) => {
    assert.equal(tree.props['data-rp-section'], MARKER);
    const regions = elementsOf(tree).filter((el) => el.props?.role === 'status');
    assert.equal(regions.length, 1, 'one status region');
    assert.equal(elementsOf(tree).filter((el) => el.props?.role === 'alert').length, 0);
    return textOf(regions[0]);
  };
  const button = (tree, label) => elementsOf(tree).find((el) => el.type === 'button' && textOf(el) === label);

  it('a guest, or nobody signed in: the sign-in line, and no request', async () => {
    for (const auth of [{ user: { id: 'guest-1', isGuest: true }, logout: async () => true }, { user: null, logout: async () => true }]) {
      respond(200, ME([]));
      const { render } = mount(auth);
      assert.equal(statusText(await render()), 'Rise Path のアカウントでログインすると、職業訓練の期が表示されます。');
      assert.equal(respond.calls, 0);
    }
  });

  it('signed in: loading, then the cohorts with their role; a role the page does not know shows no label', async () => {
    let release;
    globalThis.fetch = (url) => new Promise((resolve) => {
      release = () => resolve(new Response(JSON.stringify(ME([{ cohortId: 'c1', name: '2026年11月 Web', role: 'examiner' }, { cohortId: 'c2', name: '2027年1月 データ', role: 'mentor' }])), { status: 200 }));
      respond.url = String(url);
    });
    const { render } = mount(signedIn());
    assert.equal(statusText(await render()), '読み込んでいます…');
    assert.equal(respond.url, '/api/v2/training/me');
    release();
    const tree = await render();
    assert.equal(statusText(tree), '2026年11月 Web|確認用アカウント|2027年1月 データ');
    assert.deepEqual(elementsOf(tree).filter((el) => el.type === 'li').map((el) => el.props.className), ['rounded-card border border-line bg-surface p-5 shadow-1', 'rounded-card border border-line bg-surface p-5 shadow-1']);
  });

  it('refusals: 401 sign_in_required the sign-in line; another 401 a button that signs in again; 401 account_deleted a line without a button; 404 not offered', async () => {
    const cases = [
      [401, { error_type: 'sign_in_required' }, 'Rise Path のアカウントでログインすると、職業訓練の期が表示されます。'],
      [401, { error: 'Invalid or expired token' }, 'ログインを確認できませんでした。ログインし直すと、期が表示されます。|ログインし直す'],
      [401, { error_type: 'account_deleted' }, 'この Rise Path のアカウントは削除されています。'],
      [404, { error_type: 'training_off' }, 'ここでは、職業訓練を提供していません。'],
      [503, { error_type: 'training_unavailable' }, '期の情報を読み込めませんでした。|もう一度読み込む'],
    ];
    for (const [status, body, want] of cases) {
      respond(status, body);
      const auth = signedIn();
      const { render } = mount(auth);
      const tree = await render();
      assert.equal(statusText(tree), want, `${status} ${JSON.stringify(body)}`);
      if (want.endsWith('ログインし直す')) {
        signedIn.logouts = [];
        button(tree, 'ログインし直す').props.onClick();
        assert.deepEqual(signedIn.logouts, [{ reason: 'reauth' }]);
      }
    }
  });

  it('「もう一度読み込む」 reads again; focus that the button\'s leaving dropped goes to the title, focus elsewhere stays', async () => {
    for (const [active, wantFocus] of [[BODY, 1], [{ tag: 'a' }, 0]]) {
      respond(503, { error_type: 'training_unavailable' });
      const focused = [];
      globalThis.__title = { focus: (options) => focused.push(options) };
      const { render } = mount(signedIn());
      const failed = await render();
      assert.equal(respond.calls, 1);
      assert.deepEqual(focused, [], 'no focus move on arrival');
      respond(200, ME([{ cohortId: 'c1', name: 'A', role: 'learner' }]));
      globalThis.document.activeElement = active;
      button(failed, 'もう一度読み込む').props.onClick();
      assert.equal(statusText(await render()), 'A|受講者');
      assert.equal(respond.calls, 1, 'one more request');
      assert.deepEqual(focused, wantFocus ? [{ preventScroll: true }] : []);
      globalThis.document.activeElement = BODY;
    }
  });

  it('an answer for another learner is never shown', async () => {
    respond(200, ME([{ cohortId: 'c9', name: 'B の期', role: 'learner' }], U2));
    const { render } = mount(signedIn(U1));
    assert.equal(statusText(await render()), '期の情報を読み込めませんでした。|もう一度読み込む');
  });

  it('another account signs in while the request runs: that request is aborted and its answer never shows; the new learner\'s does', async () => {
    const pending = [];
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      pending.push({ resolve, signal: init.signal });
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const auth = signedIn(U1);
    const { hooks, render } = mount(auth);
    assert.equal(statusText(await render()), '読み込んでいます…');
    auth.user = { id: U2, isGuest: false };
    assert.equal(statusText(await render()), '読み込んでいます…');
    assert.equal(pending.length, 2);
    assert.equal(pending[0].signal.aborted, true, 'the first request was aborted');
    pending[0].resolve(new Response(JSON.stringify(ME([{ cohortId: 'c1', name: 'A の期', role: 'learner' }], U1)), { status: 200 }));
    pending[1].resolve(new Response(JSON.stringify(ME([{ cohortId: 'c2', name: 'B の期', role: 'staff' }], U2)), { status: 200 }));
    assert.equal(statusText(await render()), 'B の期|職員');
    hooks.unmount();
    assert.equal(pending[1].signal.aborted, true, 'unmounting aborts the request');
  });
});

describe('the page\'s text and tokens', () => {
  const view = read(`${SECTION}/TrainingView.tsx`);

  it('a label for every role of tools/core/training.js in both languages; the API client knows the same roles', () => {
    const roles = [...view.matchAll(/roles: \{ (.*?) \} as Record<TrainingRole, string>/g)].map((m) => m[1]);
    assert.equal(roles.length, 2, 'en and jp');
    for (const line of roles) assert.deepEqual([...line.matchAll(/(\w+): '/g)].map((m) => m[1]), [...TRAINING_ROLES], line);
    assert.match(read('services/trainingApi.ts'), new RegExp(`const ROLES: readonly string\\[\\] = \\[${TRAINING_ROLES.map((r) => `'${r}'`).join(', ')}\\];`));
    assert.match(read('services/trainingApi.ts'), new RegExp(`export type TrainingRole = ${TRAINING_ROLES.map((r) => `'${r}'`).join(' \\| ')};`));
  });

  it('design tokens only; both languages; the Japanese rules; no AI tutor on the page (D6)', () => {
    for (const file of [`${SECTION}/TrainingView.tsx`, `${SECTION}/trainingModel.ts`, 'services/trainingApi.ts']) {
      assert.doesNotMatch(read(file), /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/, file);
    }
    const en = view.slice(view.indexOf('\n  en: {'), view.indexOf('\n  jp: {'));
    const jp = view.slice(view.indexOf('\n  jp: {'), view.indexOf('\n} as const;'));
    const keys = (block) => [...block.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]);
    assert.deepEqual(keys(en), keys(jp), 'the same keys in en and jp');
    assert.ok(keys(jp).length >= 10);
    assert.doesNotMatch(jp, /簡単です|誰でも/);
    assert.doesNotMatch(view, /from '[^']*(?:Tutor|LessonReader|llmApi|agentChat)[^']*'|askTutor/);
  });
});
