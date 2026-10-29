// The library of generated courses (the rework of #43 on main):
// - GET /api/v2/curricula sends total_lessons, and leaves out lesson drafts (risepath.lesson/v1,
//   previewed at /preview/) and generations still in progress (status draft_<stage>, listed by
//   GET /api/v2/ai/drafts) unless they already have content.
// - services/curriculumApi.ts: fetchGeneratedCourses throws a 401 with its status (the sign-in
//   ended) instead of answering an empty list; fetchGeneratedCourseById keeps the status.
// - services/generatedCourses.ts: the resume card sits at the top level of the resume answer, the
//   dashboard keeps only a generated course's id (a UUID), and isSignInRequired.
// - components/common/GeneratedCoursesSignInNotice.tsx: the sign-in ended; its button signs in
//   again without asking (logout reason 'reauth'). The four views that load generated courses show
//   it on a 401 (source checks).
// The front-end modules are bundled with esbuild (a Vite dependency) with their imports stubbed.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createApp } from '../../server.js';
import { setPoolForTests, resetPoolForTests } from '../db.js';
import { LESSON_UI_TEMPLATE_ID } from '../../tools/core/lessons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COURSE = 'aaaaaaaa-0000-4000-8000-000000000001';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
// Loaded inside the tests, so the other tests still run where the module does not exist yet.
const loadHelpers = () => import('../../services/generatedCourses.ts');

async function bundle(contents, stubs, env = {}) {
  const plugin = {
    name: 'stubs',
    setup(b) {
      for (const [name, { filter }] of Object.entries(stubs)) {
        b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
      }
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path].contents, loader: 'js', resolveDir: ROOT }));
    },
  };
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [plugin],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const loadCurriculumApi = () => bundle(
  "export { fetchGeneratedCourses, fetchGeneratedCourseById } from './services/curriculumApi';",
  {
    apiClient: { filter: /\/apiClient$/, contents: 'export const apiFetch = (path, init) => globalThis.__apiFetch(path, init);' },
    progressService: { filter: /\/progressService$/, contents: 'export const getCourseProgress = () => null;' },
  },
  { VITE_DEMO_MODE: 'false' },
);

const answer = (status, body = {}) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('GET /api/v2/curricula (the library list)', () => {
  const ENV_KEYS = ['NODE_ENV', 'RISEPATH_STRICT_AUTH', 'VITE_DEMO_MODE', 'DATABASE_URL_PHASE1', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS'];
  const saved = {};
  let queries;
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = 'development'; // the dev fallback learner, so no token is needed
    queries = [];
    resetPoolForTests();
    setPoolForTests({
      query: async (text, params) => {
        queries.push({ text, params });
        return /from curricula/i.test(text) ? { rowCount: 1, rows: [{ id: COURSE, title: 'Course', total_lessons: 7 }] } : { rowCount: 0, rows: [] };
      },
      connect: async () => { throw new Error('no client in this test'); },
      on() {},
    });
  });
  afterEach(() => {
    resetPoolForTests();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('sends total_lessons and leaves out lesson drafts and generations still in progress', async () => {
    const app = await createApp({ serveStatic: false });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/curricula`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).curricula[0].total_lessons, 7);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    const list = queries.find((q) => /from curricula/i.test(q.text));
    assert.ok(list, 'the list query ran');
    const select = list.text.slice(0, list.text.search(/\bfrom curricula\b/i));
    assert.match(select, /\btotal_lessons\b/, 'total_lessons is selected');
    assert.match(list.text, /ui_template_id is distinct from \$4/, 'lesson drafts are left out');
    assert.equal(list.params[3], LESSON_UI_TEMPLATE_ID);
    assert.match(list.text, /not starts_with\(coalesce\(status, ''\), 'draft_'\) or current_version_id is not null/, 'generations in progress are left out until they have content');
  });
});

describe('services/curriculumApi.ts', () => {
  afterEach(() => {
    delete globalThis.__apiFetch;
  });

  it('fetchGeneratedCourses throws a 401 with its status; any other failure is an empty list', async () => {
    const api = await loadCurriculumApi();
    globalThis.__apiFetch = answer(401, { error: 'Authentication required' });
    await assert.rejects(api.fetchGeneratedCourses(), (error) => error.status === 401);
    for (const failure of [answer(500, { error: 'Failed to load curricula' }), answer(503), async () => { throw new TypeError('Failed to fetch'); }]) {
      globalThis.__apiFetch = failure;
      assert.deepEqual(await api.fetchGeneratedCourses(), []);
    }
  });

  it('fetchGeneratedCourses reads the lesson count from total_lessons', async () => {
    const api = await loadCurriculumApi();
    globalThis.__apiFetch = answer(200, { ok: true, curricula: [{ id: COURSE, title: 'Course', total_lessons: 7 }] });
    const [course] = await api.fetchGeneratedCourses();
    assert.equal(course.id, COURSE);
    assert.equal(course.totalLessons, 7);
  });

  it("fetchGeneratedCourseById keeps a failed answer's status", async () => {
    const api = await loadCurriculumApi();
    for (const status of [401, 404, 500]) {
      globalThis.__apiFetch = answer(status, { error: 'x' });
      await assert.rejects(api.fetchGeneratedCourseById(COURSE), (error) => error.status === status, String(status));
    }
  });
});

describe('services/generatedCourses.ts', () => {
  it('parseResumeCard reads the card at the top level of the resume answer', async () => {
    const { parseResumeCard } = await loadHelpers();
    const card = { type: 'gentle_return', message: 'おかえりなさい', gap_days: 9 };
    assert.deepEqual(parseResumeCard({ ok: true, ...card }), card);
    for (const payload of [null, 'x', { ok: true }, { ok: false, ...card }, { resume_card: card }, { ok: true, type: 'other', message: 'm' }, { ok: true, type: 'continue' }]) {
      assert.equal(parseResumeCard(payload), null, JSON.stringify(payload));
    }
  });

  it('activeCurriculumId keeps only the id of a generated course (a UUID)', async () => {
    const { activeCurriculumId } = await loadHelpers();
    assert.equal(activeCurriculumId(COURSE), COURSE);
    assert.equal(activeCurriculumId(COURSE.toUpperCase()), COURSE.toUpperCase());
    for (const stored of [null, undefined, '', 'demo-art-001', `${COURSE}x`, ` ${COURSE}`]) {
      assert.equal(activeCurriculumId(stored), undefined, String(stored));
    }
  });

  it('isSignInRequired is true for a 401 only', async () => {
    const { isSignInRequired } = await loadHelpers();
    assert.equal(isSignInRequired(Object.assign(new Error('x'), { status: 401 })), true);
    for (const error of [null, undefined, new Error('x'), { status: 403 }, { status: '401' }]) {
      assert.equal(isSignInRequired(error), false, JSON.stringify(error));
    }
  });
});

describe('components/common/GeneratedCoursesSignInNotice.tsx', () => {
  const REACT_STUB = `
    export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    export const useEffect = () => {};
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    export const forwardRef = (fn) => fn;
    export default { useState, useEffect, useMemo, useCallback, forwardRef };
  `;
  const loadNotice = () => bundle("export { default } from './components/common/GeneratedCoursesSignInNotice';", {
    react: { filter: /^react$/, contents: REACT_STUB },
    jsx: { filter: /^react\/jsx-runtime$/, contents: "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';" },
    icons: { filter: /^lucide-react$/, contents: "export const LogIn = 'LogIn';" },
    language: { filter: /context\/LanguageContext$/, contents: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp' });" },
    auth: {
      filter: /context\/AuthContext$/,
      contents: 'export const useAuth = () => ({ logout: async (options) => { globalThis.__logout.push(options); return true; } });',
    },
    button: { filter: /ui\/Button$/, contents: "export const Button = 'Button'; export default 'Button';" },
  });

  /** Calls the components until only host elements and stubs are left. */
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (node && typeof node === 'object' && 'type' in node) {
      if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
      return { type: node.type, props: { ...node.props, children: expand(node.props?.children) } };
    }
    return node;
  };
  const collect = (node, out = { text: [], elements: [] }) => {
    if (Array.isArray(node)) node.forEach((child) => collect(child, out));
    else if (node && typeof node === 'object' && 'type' in node) {
      out.elements.push(node);
      collect(node.props?.children, out);
    } else if (typeof node === 'string' || typeof node === 'number') out.text.push(String(node));
    return out;
  };

  it('says the sign-in ended and signs in again without a question', async () => {
    const { default: Notice } = await loadNotice();
    const cases = [
      ['jp', '生成したコースを読み込めませんでした', 'ログインが切れています', 'もう一度ログインする'],
      ['en', 'Your generated courses could not be loaded', 'Your sign-in has ended', 'Sign in again'],
    ];
    for (const [language, title, body, action] of cases) {
      globalThis.__language = language;
      globalThis.__logout = [];
      try {
        const { text, elements } = collect(expand(Notice({})));
        assert.equal(elements[0].props.role, 'alert', language);
        assert.ok(text.includes(title), `${language}: ${text.join(' | ')}`);
        assert.ok(text.some((line) => line.includes(body)), `${language}: ${text.join(' | ')}`);
        const button = elements.find((element) => element.type === 'Button');
        assert.ok(button, language);
        assert.deepEqual(collect(button.props.children).text, [action], language);
        button.props.onClick();
        assert.deepEqual(globalThis.__logout, [{ reason: 'reauth' }], language);
      } finally {
        delete globalThis.__language;
        delete globalThis.__logout;
      }
    }
  });
});

describe('the views that load generated courses', () => {
  it('show the sign-in notice on a 401', () => {
    for (const file of [
      'components/features/dashboard/CourseList.tsx',
      'components/features/dashboard/profile/ProfileGeneratedView.tsx',
      'components/wrappers/GeneratedCourseViewWrapper.tsx',
      'components/wrappers/GeneratedLessonViewWrapper.tsx',
    ]) {
      const text = read(file);
      assert.match(text, /isSignInRequired\((error|err)\)/, file);
      assert.match(text, /<GeneratedCoursesSignInNotice\b/, file);
    }
  });

  it('the course page reads the resume card at the top level; the dashboard keeps only a generated course id', () => {
    const wrapper = read('components/wrappers/GeneratedCourseViewWrapper.tsx');
    assert.match(wrapper, /parseResumeCard<ResumeCardData>\(data\)/);
    assert.doesNotMatch(wrapper, /resume_card/);
    const dashboard = read('components/features/dashboard/MissionControlDashboard.tsx');
    assert.match(dashboard, /activeCurriculumId\(window\.localStorage\.getItem\('active_curriculum_id'\)\)/);
  });
});
