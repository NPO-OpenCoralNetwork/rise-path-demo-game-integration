/**
 * Old-reader and app-shell fixes (Phase 1 / P1-5).
 *
 * - A mermaid block without `chart` took the generated-lesson reader down (VibeDocView renders
 *   mermaid the same way).
 * - The shell did not match the page: the light Web track pages had the dark shell, the dark Vibe
 *   prologue and Sonic Lab pages had the light one, and the lower-case ViewState values
 *   ('programming_vibe', 'programming_ai') never matched the dark checks.
 * - Signing in from a shared link landed on the dashboard instead of the shared page (a waiting AI-app
 *   connection request still comes first).
 * - Reading or writing the language in localStorage threw where storage is blocked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMermaidSource } from '../../components/features/ai/mermaidSource.ts';
import { shellThemeForView } from '../../components/common/shellTheme.ts';
import { trackViewForPath, normalizePath, startsWithSegment } from '../../navigation/pathViews.ts';
import { authReturnTarget, isInAppPath, postSignInPath } from '../../navigation/authReturn.ts';
import { readStoredLanguage, writeStoredLanguage, LANGUAGE_STORAGE_KEY } from '../../context/languageStorage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The ViewState values, read from the enum so the tables below cannot use made-up names.
const VIEW_STATES = (() => {
    const src = read('types.ts');
    const start = src.indexOf('export enum ViewState {');
    const body = src.slice(start, src.indexOf('\n}', start));
    return new Set([...body.matchAll(/^\s*[A-Z0-9_]+ = '([^']+)'/gm)].map((m) => m[1]));
})();

const themeOf = (view) => {
    assert.ok(VIEW_STATES.has(view), `not a ViewState value: ${view}`);
    return shellThemeForView(view);
};

describe('resolveMermaidSource', () => {
    it('uses chart', () => {
        assert.equal(resolveMermaidSource({ chart: 'graph TD;A-->B' }), 'graph TD;A-->B');
    });

    it('returns null when there is nothing to draw (no guess from other fields)', () => {
        for (const block of [null, undefined, {}, { chart: '' }, { chart: '   ' }, { chart: 42 }, { code: 'graph TD;A-->B' }]) {
            assert.equal(resolveMermaidSource(block), null, JSON.stringify(block));
        }
    });

    it('both readers draw mermaid blocks from the resolved source and skip empty ones', () => {
        for (const file of ['components/features/ai/GeneratedDocView.tsx', 'components/features/programming/VibeDocView.tsx']) {
            const src = read(file);
            assert.match(src, /resolveMermaidSource\(block\)/, file);
            assert.doesNotMatch(src, /chart=\{block\.chart\}/, file);
        }
    });
});

describe('shellThemeForView', () => {
    it('gives the dark track views the dark shell, whatever their case', () => {
        for (const view of ['programming_vibe', 'programming_ai', 'PROGRAMMING', 'PROGRAMMING_PATH', 'VIBE_PROLOGUE',
            'VIBE_CHAPTER_1', 'PYTHON_COURSE', 'WEB_INSPECTOR', 'SONIC_LAB', 'SONIC_SYNTH']) {
            assert.equal(themeOf(view), 'vibe', view);
        }
    });

    it('keeps the Web track, the Vibe course page and other views light', () => {
        for (const view of ['programming_web', 'HTML_CSS_PATH', 'VIBE_PATH', 'claude_code', 'UNITY_AI_GAME_DEV',
            'DASHBOARD', 'LEARNING_HUB', 'LESSON']) {
            assert.equal(themeOf(view), 'default', view);
        }
    });

    it('gives art views the art shell, and Layout uses it', () => {
        assert.equal(themeOf('ART_MUSEUM'), 'art');
        assert.match(read('components/common/Layout.tsx'), /setTheme\(shellThemeForView\(/);
    });
});

describe('trackViewForPath: the shell matches each page', () => {
    // Each page's own background (the route components in App.tsx).
    const LIGHT = ['/programming', '/programming/web', '/programming/html-css', '/programming/html-css/course',
        '/vibe', '/vibe/chapter-3', '/vibe/not-a-chapter'];
    const DARK = ['/programming/ai', '/programming/python', '/programming/path', '/programming/html-css/part2',
        '/programming/web-inspector', '/vibe/prologue'];

    it('light pages get the light shell, dark pages the dark one', () => {
        for (const p of LIGHT) assert.equal(themeOf(trackViewForPath(p)), 'default', p);
        for (const p of DARK) assert.equal(themeOf(trackViewForPath(p)), 'vibe', p);
    });

    it('every /programming and /vibe route in App.tsx is in one of the lists', () => {
        const routes = [...read('App.tsx').matchAll(/<Route path="(\/(?:programming|vibe)[^"]*)"/g)].map((m) => m[1]);
        assert.ok(routes.length >= 10, `found ${routes.length} routes`);
        for (const route of routes) {
            const sample = route.replace(/:[A-Za-z]+/g, 'chapter-3');
            assert.ok(LIGHT.includes(sample) || DARK.includes(sample), `${route}: add it to LIGHT or DARK`);
        }
    });

    it('leaves other paths to the rest of getCurrentViewState', () => {
        for (const p of ['/', '/learn/vibe-coding/vibe-ch1', '/art', '/sonic', '/claude-code', '/library', '/programmingx', '/vibes']) {
            assert.equal(trackViewForPath(p), null, p);
        }
    });

    it('matches whole path segments only', () => {
        // /vibe/:chapter sends an unknown slug back to the light course page.
        assert.equal(themeOf(trackViewForPath('/vibe/prologuex')), 'default');
        assert.equal(startsWithSegment('/vibe/prologue/x', '/vibe/prologue'), true);
        assert.equal(startsWithSegment('/vibe/prologuex', '/vibe/prologue'), false);
        // viewPaths.ts imports the ViewState enum, which node cannot strip, so its use is checked in the source.
        const viewPaths = read('navigation/viewPaths.ts');
        assert.match(viewPaths, /import \{ normalizePath, startsWithSegment \} from '\.\/pathViews'/);
        assert.match(viewPaths, /export function pathToNavKey\(pathname: string\)[^{]*\{\s*const path = normalizePath\(pathname\);/);
    });

    it('treats a trailing slash like React Router does', () => {
        assert.equal(normalizePath('/vibe/'), '/vibe');
        assert.equal(normalizePath('/programming/web//'), '/programming/web');
        assert.equal(normalizePath('/'), '/');
        assert.equal(normalizePath('//'), '/');
        assert.equal(themeOf(trackViewForPath(normalizePath('/vibe/'))), 'default');
        assert.equal(themeOf(trackViewForPath(normalizePath('/programming/html-css/part2/'))), 'vibe');
    });

    it('App derives the view through these helpers, with no second copy of the track rules or of normalizePath', () => {
        const app = read('App.tsx');
        assert.match(app, /trackViewForPath\(normalizePath\(path\)\)/);
        assert.doesNotMatch(app, /path(?:\.startsWith\(| === )'\/(?:programming|vibe)/);
        assert.doesNotMatch(app, /const normalizePath =/);
    });
});

describe('authReturnTarget', () => {
    it('returns to the page the visitor was on, with its query and hash, when no target is given', () => {
        assert.equal(authReturnTarget(undefined, { pathname: '/learn/vibe-coding/vibe-ch3', search: '?s=2' }), '/learn/vibe-coding/vibe-ch3?s=2');
        assert.equal(authReturnTarget(undefined, { pathname: '/learn/vibe-coding/vibe-ch3', search: '', hash: '#s-intro' }), '/learn/vibe-coding/vibe-ch3#s-intro');
    });

    it('prefers an explicit target', () => {
        assert.equal(authReturnTarget('/learn/vibe-coding/vibe-ch1', { pathname: '/library' }), '/learn/vibe-coding/vibe-ch1');
        assert.equal(authReturnTarget('/learn/vibe-coding/vibe-ch1', { pathname: '/library' }, true), '/learn/vibe-coding/vibe-ch1');
    });

    it('leaves the return to a waiting AI-app connection request (postSignInTarget) instead of the current page', () => {
        assert.equal(authReturnTarget(undefined, { pathname: '/learn/vibe-coding/vibe-ch3' }, true), null);
        assert.equal(authReturnTarget(undefined, { pathname: '/learn/vibe-coding/vibe-ch3' }, false), '/learn/vibe-coding/vibe-ch3');
    });

    it('never stores the root (with or without a query) or a path that leaves the app', () => {
        assert.equal(authReturnTarget(undefined, { pathname: '/' }), null);
        assert.equal(authReturnTarget(undefined, { pathname: '/', search: '?ref=x' }), null);
        assert.equal(authReturnTarget(undefined, { pathname: '/', hash: '#top' }), null);
        for (const target of ['/?ref=x', '/#top', '//evil.example', '/\\evil.example', 'https://evil.example', '']) {
            assert.equal(authReturnTarget(target, { pathname: '/library' }), null, target);
        }
        assert.equal(isInAppPath('/ok'), true);
    });

    it('never stores a sign-in plumbing page or a hash that can carry tokens, as the implicit target', () => {
        for (const pathname of ['/auth/callback', '/auth/callback/', '/auth/confirm-pending', '/auth']) {
            assert.equal(authReturnTarget(undefined, { pathname, search: '?email=a%40b.example', hash: '#access_token=x' }), null, pathname);
        }
        assert.equal(
            authReturnTarget(undefined, { pathname: '/learn/claude-code/cc-05', search: '?s=1', hash: '#access_token=x&refresh_token=y' }),
            '/learn/claude-code/cc-05?s=1',
        );
        // /oauth/consent passes its own path explicitly (OAuthConsentView), so an explicit target is kept.
        assert.equal(authReturnTarget('/oauth/consent?authorization_id=abc', { pathname: '/oauth/consent' }), '/oauth/consent?authorization_id=abc');
    });

    it('App.openAuth uses it, and App keeps no second copy of the path check', () => {
        const app = read('App.tsx');
        assert.match(app, /consentWaiting = pendingConsentReturnPath\(readLocalStorage\(\)\)\s*!==\s*null/);
        assert.match(app, /authReturnTarget\(\s*returnTo,\s*location,\s*consentWaiting\s*\)/);
        assert.match(app, /from '\.\/navigation\/authReturn'/);
        assert.doesNotMatch(app, /const isInAppPath =/);
    });
});

describe('postSignInPath: where sign-in lands', () => {
    const CONSENT = '/oauth/consent?authorization_id=abc';

    it('the saved in-app path first, then a waiting AI-app connection request, then the dashboard', () => {
        assert.equal(postSignInPath('/learn/claude-code/cc-05#s-1', CONSENT), '/learn/claude-code/cc-05#s-1');
        assert.equal(postSignInPath(null, CONSENT), CONSENT);
        assert.equal(postSignInPath(null, null), '/');
    });

    it('ignores a saved path that leaves the app', () => {
        for (const saved of ['//evil.example', '/\\evil.example', 'https://evil.example', '']) {
            assert.equal(postSignInPath(saved, null), '/', saved);
            assert.equal(postSignInPath(saved, CONSENT), CONSENT, saved);
        }
    });

    it("App's postSignInTarget uses it with the consent request", () => {
        assert.match(read('App.tsx'), /return postSignInPath\(\s*saved,\s*pendingConsentReturnPath\(readLocalStorage\(\)\)\s*\)/);
    });
});

describe('language storage', () => {
    const memoryStorage = () => {
        const data = new Map();
        return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
    };
    const blocked = () => {
        throw new Error('SecurityError: storage is blocked');
    };

    it('reads and writes the stored language', () => {
        const storage = memoryStorage();
        assert.equal(readStoredLanguage(() => storage), 'en');
        writeStoredLanguage(() => storage, 'jp');
        assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), 'jp');
        assert.equal(readStoredLanguage(() => storage), 'jp');
    });

    it('falls back to English and never throws when storage is blocked', () => {
        assert.equal(readStoredLanguage(blocked), 'en');
        assert.doesNotThrow(() => writeStoredLanguage(blocked, 'jp'));
        const throwingStorage = { getItem: blocked, setItem: blocked };
        assert.equal(readStoredLanguage(() => throwingStorage), 'en');
        assert.doesNotThrow(() => writeStoredLanguage(() => throwingStorage, 'fr'));
    });

    it('LanguageContext only touches localStorage through these helpers', () => {
        const src = read('context/LanguageContext.tsx');
        assert.match(src, /readStoredLanguage\(/);
        assert.match(src, /writeStoredLanguage\(/);
        assert.doesNotMatch(src, /localStorage\.(getItem|setItem)/);
    });
});
