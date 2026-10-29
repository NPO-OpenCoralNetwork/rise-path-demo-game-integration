// Job training, front end (doc/brushup-2026/training-plan.ja.md D1, D5, §4.6, §4.8):
// - features.training (config/features.ts) is on only for VITE_FEATURE_TRAINING exactly "true".
// - components/routes/lazyRoutes.tsx imports the section only with the flag, and nothing outside
//   components/features/training/ imports it (or services/trainingApi.ts), so a flag-off build
//   carries none of it; the marker the CI grep looks for is in one front file only.
// - App.tsx routes /training/* in the Layout only with the flag (else "/"), not as a public path.
// - ci.yml greps the flag-off production build for the marker.
// - services/trainingApi.ts reads the server's answer (server/routes/training.js) and its refusals;
//   components/features/training/trainingModel.ts turns a refusal into what the page shows.
import { before, describe, it } from 'node:test';
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
const SECTION = 'components/features/training/';
const U1 = 'aaaaaaaa-2121-4000-8000-0000000000a1';

const NOT_FRONT_ROOTS = /^(?:server|mcp-server|scripts|tools|deploy|hermes|public|doc|node_modules|dist[^/]*|\.[^/]+)\//;
const NOT_FRONT_FILES = /^(?:server\.js|test_[^/]*\.js)$|(?:^|\/)vite\.config\.[cm]?[jt]s$/;
const SOURCE = /\.(?:tsx?|jsx?|mjs)$/;

/** Tracked and new (not ignored) front source files. */
function frontFiles() {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(git.status, 0, 'git ls-files');
  return git.stdout.split('\n').filter(Boolean)
    .filter((f) => SOURCE.test(f) && !f.endsWith('.d.ts') && !NOT_FRONT_ROOTS.test(f) && !NOT_FRONT_FILES.test(f) && fs.existsSync(path.join(ROOT, f)));
}

function importsOf(file) {
  const { importedFiles } = ts.preProcessFile(read(file), true, true);
  return importedFiles.map(({ fileName }) => (fileName.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), fileName)) : fileName));
}

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

  it('nothing outside the section imports it or its API client, except that one lazy import', () => {
    const outside = [];
    const api = [];
    for (const file of frontFiles()) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith(SECTION) && !file.startsWith(SECTION)) outside.push(file);
        if (/(?:^|\/)services\/trainingApi$/.test(spec) && !file.startsWith(SECTION)) api.push(file);
      }
    }
    assert.deepEqual(outside, ['components/routes/lazyRoutes.tsx']);
    assert.deepEqual(api, []);
  });

  it('the CI marker is on the page root only, and not in index.html', () => {
    const holders = frontFiles().filter((file) => read(file).includes(MARKER));
    assert.deepEqual(holders, [`${SECTION}TrainingView.tsx`]);
    assert.match(read(`${SECTION}TrainingView.tsx`), /<div data-rp-section=\{TRAINING_UI_MARKER\} className=/);
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

  it('greps the flag-off production build for the training marker, after the legal-text step', () => {
    const name = '- name: Fail if training code reached the bundle';
    assert.ok(job.includes(name));
    const step = job.slice(job.indexOf(name));
    const run = step.slice(0, step.indexOf('\n\n') === -1 ? undefined : step.indexOf('\n\n'));
    assert.match(run, new RegExp(`grep -rlF -e '${MARKER}' "\\$RUNNER_TEMP/dist"`));
    assert.match(run, /exit 1/);
    assert.ok(job.indexOf('- name: Fail if draft legal text reached the bundle') < job.indexOf(name));
    assert.doesNotMatch(job, /VITE_FEATURE_TRAINING\s*:/, 'the build runs with the flag unset');
  });
});

describe('services/trainingApi.ts and trainingModel.ts', () => {
  let mod = null;
  before(async () => {
    const result = await build({
      stdin: { contents: `export * from './services/trainingApi'; export { stateForFailure } from './${SECTION}trainingModel';`, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'import.meta.env': '{"PROD":true}' },
      plugins: [{
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'supabase', namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const getSupabaseClient = () => null; export const isSupabaseConfigured = () => false;', loader: 'js' }));
        },
      }],
      logLevel: 'silent',
    });
    mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  });

  const respond = (status, body, { text = false } = {}) => {
    globalThis.fetch = async (url, init) => {
      respond.url = String(url);
      respond.method = init?.method;
      return new Response(text ? body : JSON.stringify(body), { status, headers: { 'Content-Type': text ? 'text/html' : 'application/json' } });
    };
  };
  const ME = (cohorts) => ({ ok: true, learnerId: U1.toUpperCase(), cohorts });

  it('200: the learner id in lower case, the cohorts in the server\'s order; a cohort with an unknown role is left out', async () => {
    respond(200, ME([{ cohortId: 'c1', name: '2026年11月 Web', role: 'learner' }, { cohortId: 'c2', name: 'B', role: 'mentor' }, { cohortId: 'c3', name: 'C', role: 'staff' }]));
    const me = await mod.getTrainingMe();
    assert.equal(respond.url, '/api/v2/training/me');
    assert.equal(respond.method, 'GET');
    assert.deepEqual(me, { learnerId: U1, cohorts: [{ cohortId: 'c1', name: '2026年11月 Web', role: 'learner' }, { cohortId: 'c3', name: 'C', role: 'staff' }] });
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

  it('the page state of a refusal: sign-in prompts for 401, "not offered" for 404, else an error with retry', () => {
    const E = mod.TrainingApiError;
    assert.deepEqual(mod.stateForFailure(new E('x', 401, 'sign_in_required')), { kind: 'account' });
    assert.deepEqual(mod.stateForFailure(new E('x', 401, 'account_deleted')), { kind: 'signin' });
    assert.deepEqual(mod.stateForFailure(new E('x', 401)), { kind: 'signin' });
    assert.deepEqual(mod.stateForFailure(new E('x', 404, 'training_off')), { kind: 'off' });
    assert.deepEqual(mod.stateForFailure(new E('x', 404)), { kind: 'off' });
    for (const error of [new E('x', 503, 'training_unavailable'), new E('x', 500, 'training_failed'), new E('x', 429, 'rate_limited'), new E('x', 0, 'network'), new E('x', 200, 'bad_response'), new Error('x')]) {
      assert.deepEqual(mod.stateForFailure(error), { kind: 'error' }, String(error.status));
    }
  });
});

describe('the page\'s text and tokens', () => {
  const view = read(`${SECTION}TrainingView.tsx`);

  it('a label for every role of tools/core/training.js in both languages; the API client knows the same roles', () => {
    const roles = [...view.matchAll(/roles: \{ (.*?) \} as Record<TrainingRole, string>/g)].map((m) => m[1]);
    assert.equal(roles.length, 2, 'en and jp');
    for (const line of roles) assert.deepEqual([...line.matchAll(/(\w+): '/g)].map((m) => m[1]), [...TRAINING_ROLES], line);
    assert.match(read('services/trainingApi.ts'), new RegExp(`const ROLES: readonly string\\[\\] = \\[${TRAINING_ROLES.map((r) => `'${r}'`).join(', ')}\\];`));
    assert.match(read('services/trainingApi.ts'), new RegExp(`export type TrainingRole = ${TRAINING_ROLES.map((r) => `'${r}'`).join(' \\| ')};`));
  });

  it('design tokens only; both languages; no AI tutor on the page (D6)', () => {
    for (const file of [`${SECTION}TrainingView.tsx`, `${SECTION}trainingModel.ts`, 'services/trainingApi.ts']) {
      assert.doesNotMatch(read(file), /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/, file);
    }
    assert.match(view, /const copy = \{\n {2}en: \{[\s\S]*\n {2}jp: \{/);
    assert.doesNotMatch(view, /from '[^']*(?:Tutor|LessonReader|llmApi|agentChat)[^']*'|askTutor/);
  });
});
