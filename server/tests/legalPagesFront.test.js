// Phase 4 (design §2.3–§2.5, §8 legalPagesFront): the legal pages in the browser.
// - config/features.ts: features.legalPages is on only for VITE_FEATURE_LEGAL_PAGES exactly "true".
// - components/routes/lazyRoutes.tsx imports TermsPage / PrivacyPage only in dev builds or with the
//   flag (else LegalPagesOff), so a production build without the flag carries no legal text;
//   nothing else imports content/legal/, and nothing uses `features` as a whole object (that would
//   stop Rollup from folding the flag).
// - No front source holds the CI bundle markers; legalText.mjs (which does) is reached only from
//   LegalDocument, which only the two pages import.
// - The pages, rendered against a React stub whose jsx() returns { type, props } (react-markdown and
//   remark-gfm are the real ones): heading ids, a labelled focusable table region, the new-tab hint,
//   lang="ja", the EN notice, the draft banner, the footer; LegalPagesOff and its noindex meta.
// - App.tsx routes /terms and /privacy in both route blocks, PUBLIC_PATHS, ViewState, VIEW_PATHS.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { LEGAL_DOCUMENTS } from '../../shared/legal/versions.js';
import { legalTextProblems, problemCount } from '../../scripts/legal/legalText.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const CI_MARKERS = ['risepath-legal-text', '【要確認', '公開前に専門家', '（作成メモ:', '（根拠:'];

/** Roots and files that never reach the browser bundle: the API and MCP servers, scripts and
 *  tooling, deploy files, docs, `public/` (copied as is; the CI grep covers it) and build configs. */
const NOT_FRONT_ROOTS = /^(?:server|mcp-server|scripts|tools|deploy|hermes|public|doc|node_modules|dist[^/]*|\.[^/]+)\//;
const NOT_FRONT_FILES = /^(?:server\.js|test_[^/]*\.js)$|(?:^|\/)vite\.config\.[cm]?[jt]s$/;
const SOURCE = /\.(?:tsx?|jsx?|mjs)$/;

/**
 * Front source files (what Vite can bundle), repo-relative: every tracked or new (not ignored)
 * source file outside NOT_FRONT_ROOTS, so a new folder (data/, constants/, a sub-app …) is covered
 * without listing it here. Without git, the same filter over a walk of the checkout.
 */
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

/** Import specifiers of a file, resolved to repo-relative paths (packages and `?raw` kept as is). */
function importsOf(file) {
  const { importedFiles } = ts.preProcessFile(read(file), true, true);
  return importedFiles.map(({ fileName }) => {
    if (!fileName.startsWith('.')) return fileName;
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), fileName));
  });
}

async function load(contents, env = {}) {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    define: { 'import.meta.env': JSON.stringify(env) },
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

describe('features.legalPages (config/features.ts)', () => {
  const FEATURES = "export { features } from './config/features';";

  it('is off when VITE_FEATURE_LEGAL_PAGES is unset', async () => {
    assert.equal((await load(FEATURES, {})).features.legalPages, false);
  });

  it('is on only for exactly "true"', async () => {
    assert.equal((await load(FEATURES, { VITE_FEATURE_LEGAL_PAGES: 'true' })).features.legalPages, true);
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '', 'false']) {
      assert.equal((await load(FEATURES, { VITE_FEATURE_LEGAL_PAGES: value })).features.legalPages, false, `"${value}"`);
    }
  });

  it('is the exact expression next to billing', () => {
    assert.match(read('config/features.ts'), /\n {2}legalPages: import\.meta\.env\.VITE_FEATURE_LEGAL_PAGES === 'true',\n/);
  });
});

describe('keeping the legal text out of a flag-off bundle', () => {
  it('scans every front root, not a fixed list (round 1, issue 7)', () => {
    const files = frontFiles();
    const roots = new Set(files.map((f) => (f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root)')));
    for (const root of ['components', 'services', 'context', 'config', 'navigation', 'hooks', 'shared', 'data', 'constants', 'content', 'ai-personal-insights-pro', 'ai-learning-diagnosis', '(root)']) {
      assert.ok(roots.has(root), `${root} is scanned`);
    }
    for (const file of ['App.tsx', 'index.tsx', 'types.ts', 'content/index.ts', 'components/features/legal/LegalDocument.tsx']) assert.ok(files.includes(file), file);
    assert.ok(!files.some((f) => /^(?:server|mcp-server|scripts|tools|deploy)\//.test(f) || f === 'server.js' || f.endsWith('vite.config.ts')), 'server-side code and build configs are not front code');
  });

  it('lazyRoutes imports TermsPage and PrivacyPage only in dev builds or with features.legalPages', () => {
    const lazyRoutes = read('components/routes/lazyRoutes.tsx');
    for (const [name, page] of [['TermsRoute', 'TermsPage'], ['PrivacyRoute', 'PrivacyPage']]) {
      const pattern = new RegExp(
        `export const ${name} = lazy\\(\\s*\\(\\) => \\(\\(import\\.meta\\.env\\.DEV \\|\\| features\\.legalPages\\) \\? import\\('\\.\\./features/legal/${page}'\\) : Promise\\.resolve\\(\\{ default: LegalPagesOff \\}\\)\\)\\s*\\);`,
      );
      assert.match(lazyRoutes, pattern, `${name} must import ${page} only behind the flag`);
    }
    assert.match(lazyRoutes, /^import \{ features \} from '\.\.\/\.\.\/config\/features';$/m);
    assert.match(lazyRoutes, /^import LegalPagesOff from '\.\.\/features\/legal\/LegalPagesOff';$/m);
  });

  it('lazyRoutes imports the re-consent page only with features.legalPages (stage 6), and nothing else imports it', () => {
    const lazyRoutes = read('components/routes/lazyRoutes.tsx');
    assert.match(
      lazyRoutes,
      /export const LegalConsentView = lazy\(\s*\(\) => \(features\.legalPages \? import\('\.\.\/legal\/LegalConsentView'\) : Promise\.resolve\(\{ default: \(\) => null \}\)\)\s*\);/,
      'the consent page must be imported only behind the flag',
    );
    const importers = [];
    for (const file of frontFiles()) {
      for (const spec of importsOf(file)) if (/(?:^|\/)legal\/LegalConsentView$/.test(spec)) importers.push(file);
    }
    assert.deepEqual(importers, ['components/routes/lazyRoutes.tsx']);
  });

  it('only TermsPage and PrivacyPage import content/legal/, and only the two routes import the pages', () => {
    const importers = { content: [], pages: [], document: [], legalText: [] };
    for (const file of frontFiles()) {
      for (const spec of importsOf(file)) {
        if (spec.includes('content/legal/')) importers.content.push(file);
        if (/features\/legal\/(?:TermsPage|PrivacyPage)$/.test(spec)) importers.pages.push(file);
        if (/features\/legal\/LegalDocument$/.test(spec)) importers.document.push(file);
        if (/scripts\/legal\/legalText\.mjs$/.test(spec)) importers.legalText.push(file);
      }
    }
    assert.deepEqual(importers.content.sort(), ['components/features/legal/PrivacyPage.tsx', 'components/features/legal/TermsPage.tsx']);
    assert.deepEqual(importers.pages, ['components/routes/lazyRoutes.tsx', 'components/routes/lazyRoutes.tsx']);
    assert.deepEqual(importers.document.sort(), ['components/features/legal/PrivacyPage.tsx', 'components/features/legal/TermsPage.tsx']);
    assert.deepEqual(importers.legalText, ['components/features/legal/LegalDocument.tsx'], 'the marker strings of legalText.mjs reach only the legal chunk');
    assert.match(read('components/features/legal/TermsPage.tsx'), /import termsText from '\.\.\/\.\.\/\.\.\/content\/legal\/terms\.ja\.md\?raw';/);
    assert.match(read('components/features/legal/PrivacyPage.tsx'), /import privacyText from '\.\.\/\.\.\/\.\.\/content\/legal\/privacy\.ja\.md\?raw';/);
  });

  it('nothing spreads, enumerates or indexes `features` (Rollup folds a flag only from plain reads)', () => {
    const offenders = [];
    for (const file of frontFiles()) {
      const code = stripComments(read(file));
      if (/\.\.\.\s*features\b/.test(code) || /Object\.(?:keys|values|entries|assign|freeze)\(\s*features\b/.test(code) || /\bfeatures\s*\[/.test(code) || /\{\s*\.\.\.features\s*\}/.test(code)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('no front source holds a CI bundle marker (the flag-off bundle grep would fail)', () => {
    const offenders = [];
    for (const file of frontFiles()) {
      const text = read(file);
      for (const marker of CI_MARKERS) if (text.includes(marker)) offenders.push(`${file}: ${marker}`);
    }
    assert.deepEqual(offenders, []);
  });
});

// ---------------------------------------------------------------------------------------------
// The pages, bundled against stubs (react-markdown, remark-gfm and the legal modules are real)

const ICONS = ['ExternalLink', 'FilePen'];
const REACT_STUB = `
  export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
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
  'react-router-dom': "export const Link = 'Link'; export const useLocation = () => ({ pathname: globalThis.__pathname ?? '/terms', hash: globalThis.__hash ?? '', search: '' });",
  'lucide-react': ICONS.map((name) => `export const ${name} = '${name}';`).join('\n'),
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'jp', selectedLanguage: globalThis.__language ?? 'jp', setLanguage() {} });",
  auth: 'export const useAuth = () => ({ isLoggedIn: globalThis.__loggedIn === true });',
  header: "export default 'PageHeader';",
  button: "export const Button = 'Button'; export const ButtonLink = 'ButtonLink'; export default 'Button';",
  shell: "export const PublicPageShell = 'PublicPageShell'; export default 'PublicPageShell';",
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
      stub(/ui\/PageHeader$/, 'header');
      stub(/ui\/Button$/, 'button');
      stub(/ui\/PublicPageShell$/, 'shell');
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: PAGE_STUBS[args.path], loader: 'js', resolveDir: ROOT }));
      // Vite's ?raw imports: the file as a string.
      b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
    },
  };
  const result = await build({
    stdin: {
      contents: [
        "export { LegalDocumentBody, legalBody, legalToc, formatEffectiveDate, default as LegalDocument } from './components/features/legal/LegalDocument';",
        "export { default as TermsPage } from './components/features/legal/TermsPage';",
        "export { default as PrivacyPage } from './components/features/legal/PrivacyPage';",
        "export { default as LegalPagesOff, LegalPagesOffBody, addNoIndexMeta } from './components/features/legal/LegalPagesOff';",
        "export { legalPageTitle, setPageTitle } from './components/features/legal/pageTitle';",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    // 'node' picks the DOM-free builds of the markdown packages (decode-named-character-reference).
    platform: 'node',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Calls the pages' own components until only host elements and stubs ('Link', …) are left. */
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
const textOf = (tokens) => tokens.filter((t) => 'text' in t).map((t) => t.text).join('');
const elementsOf = (tokens) => tokens.filter((t) => 'el' in t).map((t) => t.el);
const textOfElement = (el) => textOf(walk(el.props?.children));

function render(component, props, globals = {}) {
  Object.assign(globalThis, globals);
  try {
    return walk(expand(component(props)));
  } finally {
    for (const key of Object.keys(globals)) delete globalThis[key];
  }
}

describe('the legal pages (rendered)', () => {
  const privacyText = read(LEGAL_DOCUMENTS.privacy.generated);
  const termsText = read(LEGAL_DOCUMENTS.terms.generated);

  before(async () => {
    pages = await loadPages();
  });

  it('headings get stable ids and are focus targets; the TOC links them', () => {
    const tokens = render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'jp' });
    const els = elementsOf(tokens);
    const h2 = els.filter((el) => el.type === 'h2');
    const section3 = h2.find((el) => el.props.id === 'section-3');
    assert.ok(section3, '/privacy#section-3 has a target');
    assert.equal(textOfElement(section3), '3. 利用目的');
    assert.equal(section3.props.tabIndex, -1);
    assert.match(section3.props.className, /scroll-mt-6/);
    assert.ok(h2.some((el) => el.props.id === 'section-8'));
    assert.ok(els.some((el) => el.type === 'h3' && el.props.id === 'section-4-4'));
    const nav = els.find((el) => el.type === 'nav');
    assert.equal(nav.props['aria-label'], '目次');
    assert.match(nav.props.className, /print:hidden/);
    const toc = elementsOf(walk(nav.props.children)).filter((el) => el.type === 'Link').map((el) => el.props.to);
    assert.deepEqual(toc, Array.from({ length: 13 }, (_, i) => `#section-${i + 1}`));
    assert.equal(elementsOf(walk(nav.props.children)).find((el) => el.type === 'ol').props.lang, 'ja');
  });

  it('the text is one <article lang="ja"> named by the page title; raw HTML and the sentinel never render', () => {
    const tokens = render(pages.LegalDocumentBody, { document: 'terms', text: termsText, language: 'jp' });
    const els = elementsOf(tokens);
    const header = els.find((el) => el.type === 'PageHeader');
    assert.equal(header.props.title, '利用規約');
    assert.equal(header.props.eyebrow, `版 ${LEGAL_DOCUMENTS.terms.version}（下書き）`);
    const article = els.find((el) => el.type === 'article');
    assert.equal(article.props.lang, 'ja');
    assert.equal(article.props['aria-labelledby'], header.props.titleId);
    assert.doesNotMatch(textOf(tokens), /risepath-legal-text|<!--|legal:/);
    assert.ok(els.filter((el) => el.type === 'h2').some((el) => el.props.id === 'article-10'));
    // The sentinel line is removed before rendering (legalBody), and raw HTML is skipped, not shown.
    assert.equal(pages.legalBody(termsText), termsText.split('\n').slice(2).join('\n'));
    assert.ok(!pages.legalBody(termsText).includes('<!--'));
    const raw = render(pages.LegalDocumentBody, { document: 'terms', text: `${termsText}\n<div class="x">生の HTML</div>\n\n<script>alert(1)</script>\n`, language: 'jp' });
    assert.ok(!elementsOf(raw).some((el) => el.type === 'div' && el.props.class === 'x') && !elementsOf(raw).some((el) => el.type === 'script'));
    assert.doesNotMatch(textOf(raw), /<div|<script|生の HTML|alert/);
  });

  it('a table scrolls inside a labelled, focusable region', () => {
    const els = elementsOf(render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'jp' }));
    const regions = els.filter((el) => el.props?.role === 'region');
    assert.equal(regions.length, 3, 'the three tables of the privacy policy');
    for (const region of regions) {
      assert.equal(region.props['aria-label'], '表（横にスクロールできます）');
      assert.equal(region.props.tabIndex, 0);
      assert.match(region.props.className, /overflow-x-auto/);
      assert.match(region.props.className, /focus-visible:outline-focus/);
      assert.ok(elementsOf(walk(region.props.children)).some((el) => el.type === 'table'));
    }
    const en = elementsOf(render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'en' }));
    const region = en.find((el) => el.props?.role === 'region');
    assert.equal(region.props['aria-label'], 'Table (scrolls sideways)');
    // Inside <article lang="ja">: the English name is marked English, the table stays Japanese (WCAG 3.1.2).
    assert.equal(region.props.lang, 'en');
    assert.equal(elementsOf(walk(region.props.children)).find((el) => el.type === 'table').props.lang, 'ja');
    assert.equal(regions[0].props.lang, 'ja');
  });

  it('links: https in a new tab with the hint, /privacy through the router, anything else as text', () => {
    const els = elementsOf(render(pages.LegalDocumentBody, { document: 'terms', text: termsText, language: 'jp' }));
    const external = els.filter((el) => el.type === 'a');
    assert.ok(external.length >= 2, `${external.length} https links`);
    for (const a of external) {
      assert.match(a.props.href, /^https:\/\//);
      assert.equal(a.props.target, '_blank');
      assert.equal(a.props.rel, 'noopener noreferrer');
      assert.match(textOfElement(a), /（新しいタブで開きます）$/);
    }
    const en = elementsOf(render(pages.LegalDocumentBody, { document: 'terms', text: termsText, language: 'en' })).filter((el) => el.type === 'a');
    for (const a of en) {
      const hint = elementsOf(walk(a.props.children)).find((el) => el.type === 'span' && textOfElement(el) === '(opens in a new tab)');
      assert.ok(hint, a.props.href);
      assert.equal(hint.props.lang, 'en', 'the English hint is read with the English voice');
    }
    const internal = els.filter((el) => el.type === 'Link').map((el) => el.props.to);
    assert.ok(internal.includes('/privacy'), 'the link between the drafts goes through the router');
    const odd = elementsOf(render(pages.LegalDocumentBody, {
      document: 'terms',
      text: `${termsText}\n[a](javascript:alert(1)) [b](mailto:x@example.org) [c](http://example.org)\n`,
      language: 'jp',
    }));
    assert.ok(!odd.some((el) => el.type === 'a' && !/^https:\/\//.test(el.props.href ?? '')), 'only https links become anchors');
  });

  it('the numbering survives the hidden parts: 第 9 条 continues at 12', () => {
    const els = elementsOf(render(pages.LegalDocumentBody, { document: 'terms', text: termsText, language: 'jp' }));
    assert.ok(els.some((el) => el.type === 'ol' && el.props.start === 12));
  });

  it('English UI: the official-Japanese notice, English chrome, the text stays Japanese', () => {
    const tokens = render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'en' });
    const els = elementsOf(tokens);
    const notice = els.find((el) => el.type === 'p' && /This page is in Japanese/.test(textOfElement(el)));
    assert.ok(notice);
    assert.equal(textOfElement(notice), 'This page is in Japanese. The Japanese text is the official version; there is no reviewed English translation yet.');
    assert.match(notice.props.className, /print:hidden/);
    assert.equal(els.find((el) => el.type === 'PageHeader').props.title, 'Privacy Policy');
    assert.equal(els.find((el) => el.type === 'nav').props['aria-label'], 'Contents');
    assert.equal(els.find((el) => el.type === 'article').props.lang, 'ja');
    const jp = render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'jp' });
    assert.doesNotMatch(textOf(jp), /This page is in Japanese/);
  });

  it('a draft shows the development banner with the markers left; the footer names version and hash', () => {
    const problems = legalTextProblems(privacyText);
    const tokens = render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'jp' });
    const text = textOf(tokens);
    assert.ok(text.includes(`開発用の表示です。下書きで、まだ公開していません。残っている印: 要記入 ${problemCount(problems, 'to_fill')} か所・要確認 ${problemCount(problems, 'to_check')} か所`));
    const entry = LEGAL_DOCUMENTS.privacy;
    assert.ok(text.includes(`この文書の正式な版は日本語です。版: ${entry.version} ／ SHA-256 の先頭 12 文字: ${entry.sha256.slice(0, 12)}`));
    const en = textOf(render(pages.LegalDocumentBody, { document: 'privacy', text: privacyText, language: 'en' }));
    assert.match(en, /Development view\. This is a draft and is not published yet\. Markers left: \d+ to fill in, \d+ to check\./);
  });

  it('formatEffectiveDate: Japanese with spaces, English month names, null for anything else', () => {
    assert.equal(pages.formatEffectiveDate('2026-12-01', 'jp'), '2026 年 12 月 1 日');
    assert.equal(pages.formatEffectiveDate('2027-04-01', 'en'), 'April 1, 2027');
    assert.equal(pages.formatEffectiveDate(null, 'jp'), null);
    assert.equal(pages.formatEffectiveDate('2026-12', 'jp'), null);
  });

  it('TermsPage and PrivacyPage render the generated text: public frame signed out, none signed in', () => {
    const signedOut = elementsOf(render(pages.TermsPage, {}));
    assert.equal(signedOut[0].type, 'PublicPageShell');
    assert.ok(signedOut.some((el) => el.type === 'h2' && el.props.id === 'article-1'));
    const signedIn = elementsOf(render(pages.PrivacyPage, {}, { __loggedIn: true }));
    assert.equal(signedIn.some((el) => el.type === 'PublicPageShell'), false);
    assert.ok(signedIn.some((el) => el.type === 'h2' && el.props.id === 'section-3'));
  });

  it('LegalPagesOff: "being prepared" in both languages, links home and /ai-safety, no legal text', () => {
    const jp = render(pages.LegalPagesOffBody, { language: 'jp', document: 'privacy' });
    assert.ok(textOf(jp).includes('このページは準備中です。公開したら、ここに載せます。'));
    assert.equal(elementsOf(jp).find((el) => el.type === 'PageHeader').props.title, 'プライバシーポリシー');
    assert.deepEqual(elementsOf(jp).filter((el) => el.type === 'ButtonLink').map((el) => el.props.to), ['/', '/ai-safety']);
    const en = render(pages.LegalPagesOffBody, { language: 'en', document: 'terms' });
    assert.ok(textOf(en).includes('This page is being prepared. It will appear here once it is published.'));
    // The route component picks the document from the path and has the public frame signed out.
    const offPrivacy = elementsOf(render(pages.LegalPagesOff, {}, { __pathname: '/privacy' }));
    assert.equal(offPrivacy[0].type, 'PublicPageShell');
    assert.equal(offPrivacy.find((el) => el.type === 'PageHeader').props.title, 'プライバシーポリシー');
    const offTerms = elementsOf(render(pages.LegalPagesOff, {}, { __pathname: '/terms', __loggedIn: true }));
    assert.equal(offTerms.some((el) => el.type === 'PublicPageShell'), false);
    assert.equal(offTerms.find((el) => el.type === 'PageHeader').props.title, '利用規約');
    const source = read('components/features/legal/LegalPagesOff.tsx');
    assert.doesNotMatch(source, /content\/legal|shared\/legal|legalText/);
  });

  it('LegalPagesOff asks search engines not to index it while shown, and cleans up', () => {
    const head = { children: [], appendChild(node) { this.children.push(node); node.parent = this; } };
    const doc = {
      head,
      createElement: (tag) => ({
        tag,
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        remove() { this.parent.children = this.parent.children.filter((n) => n !== this); },
      }),
    };
    const cleanup = pages.addNoIndexMeta(doc);
    assert.equal(head.children.length, 1);
    assert.deepEqual({ tag: head.children[0].tag, ...head.children[0].attrs }, { tag: 'meta', name: 'robots', content: 'noindex' });
    cleanup();
    assert.equal(head.children.length, 0);
    assert.match(read('components/features/legal/LegalPagesOff.tsx'), /useEffect\(\(\) => \(typeof window === 'undefined' \? undefined : addNoIndexMeta\(window\.document\)\), \[\]\);/);
  });

  it('the tab title names the page while it is shown (WCAG 2.4.2), and the previous one comes back', () => {
    const doc = { title: 'Rise Path Learning' };
    const restore = pages.setPageTitle(doc, pages.legalPageTitle('利用規約'));
    assert.equal(doc.title, '利用規約 | Rise Path');
    restore();
    assert.equal(doc.title, 'Rise Path Learning');
    assert.equal(pages.legalPageTitle('Privacy Policy'), 'Privacy Policy | Rise Path');
    // Both page components set it from their localized title (and follow a language switch).
    const effect = /const title = copy\[language\]\.titles\[document\];\n(?:.*\n){0,2}  useEffect\(\(\) => \(typeof window === 'undefined' \? undefined : setPageTitle\(window\.document, legalPageTitle\(title\)\)\), \[title\]\);/;
    for (const file of ['LegalDocument.tsx', 'LegalPagesOff.tsx']) {
      const source = read(`components/features/legal/${file}`);
      assert.match(source, effect, `${file} sets the tab title`);
      assert.match(source, /^import \{ legalPageTitle, setPageTitle \} from '\.\/pageTitle';$/m);
    }
  });

  it('the hash scroll respects reduced motion and runs after the commit; component copy is EN + JP', () => {
    const source = read('components/features/legal/LegalDocument.tsx');
    assert.match(source, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
    assert.match(source, /behavior: reduce \? 'auto' : 'smooth'/);
    assert.match(source, /target\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /requestAnimationFrame\(\(\) => \{\s*focusLegalHeading\(id\);/);
    assert.match(source, /addEventListener\('hashchange'/);
    assert.match(source, /skipHtml/);
    for (const banned of [/\[#[0-9a-f]{3,8}\]/i, /rounded-\[/, /text-\[(?:9|10|11)px\]/, /text-slate-400/]) {
      for (const file of ['LegalDocument.tsx', 'LegalPagesOff.tsx', 'TermsPage.tsx', 'PrivacyPage.tsx']) {
        assert.doesNotMatch(read(`components/features/legal/${file}`), banned, `${file}: design tokens only`);
      }
    }
  });
});

describe('design tokens on every legal surface (Phase 8, S4: dark mode)', () => {
  // Wider than the four page files above: every component of the legal pages, the consent page and
  // its notice, and the public frame and page header around them. A palette colour (bg-white,
  // text-slate-…) stays the same in dark; tokens switch with [data-theme]. Also in phase8Front.test.js.
  const TOKEN_RULE = /\[#[0-9a-fA-F]{3,8}\]|rounded-\[|text-\[(9|10|11)px\]|text-slate-400/;
  const PALETTE_RULE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|decoration)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;
  const tsxIn = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.tsx')).map((f) => `${dir}/${f}`);

  it('components/features/legal, components/legal, PublicPageShell and PageHeader: no banned class, no palette colour', () => {
    const files = [
      ...tsxIn('components/features/legal'),
      ...tsxIn('components/legal'),
      'components/ui/PublicPageShell.tsx',
      'components/ui/PageHeader.tsx',
    ];
    for (const expected of ['components/features/legal/LegalDocument.tsx', 'components/features/legal/TermsPage.tsx',
      'components/features/legal/PrivacyPage.tsx', 'components/legal/LegalConsentView.tsx', 'components/legal/LegalNoticeBar.tsx']) {
      assert.ok(files.includes(expected), expected);
    }
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, TOKEN_RULE, `${file}: design tokens only`);
      assert.doesNotMatch(source, PALETTE_RULE, `${file}: a palette colour stays light in dark`);
    }
  });
});

describe('routes (App.tsx, types.ts, navigation/viewPaths.ts)', () => {
  const app = read('App.tsx');

  it('/terms and /privacy are public and routed in both blocks', () => {
    assert.match(app, /PUBLIC_PATHS = new Set\(\[[^\]]*'\/terms', '\/privacy'[^\]]*\]\)/);
    const publicBlock = app.slice(app.indexOf('(!isLoggedIn && publicPath) ?'), app.indexOf('<Layout currentView'));
    const layoutBlock = app.slice(app.indexOf('<Layout currentView'));
    for (const block of [publicBlock, layoutBlock]) {
      assert.match(block, /<Route path="\/terms" element=\{<TermsRoute \/>\} \/>/);
      assert.match(block, /<Route path="\/privacy" element=\{<PrivacyRoute \/>\} \/>/);
    }
    assert.match(app, /if \(normalizePath\(path\) === '\/terms'\) return ViewState\.LEGAL_TERMS;/);
    assert.match(app, /if \(normalizePath\(path\) === '\/privacy'\) return ViewState\.LEGAL_PRIVACY;/);
    // /settings/privacy keeps its own view (prefix check, later in the list).
    assert.match(app, /if \(path\.startsWith\('\/settings\/privacy'\)\) return ViewState\.SETTINGS_PRIVACY;/);
  });

  it('ViewState and VIEW_PATHS have both pages', () => {
    assert.match(read('types.ts'), /LEGAL_TERMS = 'LEGAL_TERMS'/);
    assert.match(read('types.ts'), /LEGAL_PRIVACY = 'LEGAL_PRIVACY'/);
    const viewPaths = read('navigation/viewPaths.ts');
    assert.match(viewPaths, /\[ViewState\.LEGAL_TERMS\]: '\/terms',/);
    assert.match(viewPaths, /\[ViewState\.LEGAL_PRIVACY\]: '\/privacy',/);
  });
});
