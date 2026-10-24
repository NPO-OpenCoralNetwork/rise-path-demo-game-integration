/**
 * Front-end rules for the Phase 0.5 AI access pages: services/aiAccessRules.ts (error kinds,
 * birth month helpers, consent text version) and services/sharedDeviceData.ts (what logout clears
 * on a shared device).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_ACCESS_SETUP_PATH,
  AI_SAFETY_PATH,
  CONSENT_POLICY_VERSION,
  aiAccessErrorKind,
  isUserId,
  isValidBirthYm,
  splitBirthYm,
  toBirthYm,
  tokyoYearMonth,
} from '../../services/aiAccessRules.ts';
import { AI_LOCAL_KEYS, WRITING_DRAFT_PREFIX, clearSharedDeviceAiData } from '../../services/sharedDeviceData.ts';
import { ASSESSMENT_PROFILE_STORAGE_KEY } from '../../constants/assessment.ts';
import { CONSENT_POLICY_VERSION as SERVER_POLICY_VERSION } from '../../server/safety/access.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** In-memory Storage with the parts the module uses. */
function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('aiAccessErrorKind', () => {
  it('reads errorType or error_type on the error or its body', () => {
    assert.equal(aiAccessErrorKind({ errorType: 'age_required' }), 'age_required');
    assert.equal(aiAccessErrorKind({ error_type: 'guardian_consent_required' }), 'guardian_consent_required');
    assert.equal(aiAccessErrorKind({ body: { error_type: 'ai_paused_safety' } }), 'ai_paused_safety');
    assert.equal(aiAccessErrorKind({ body: { errorType: 'adults_only' } }), 'adults_only');
    const err = Object.assign(new Error('x'), { status: 401, errorType: 'sign_in_required' });
    assert.equal(aiAccessErrorKind(err), 'sign_in_required');
  });

  it('answers null for other errors and non-objects', () => {
    assert.equal(aiAccessErrorKind(null), null);
    assert.equal(aiAccessErrorKind('age_required'), null);
    assert.equal(aiAccessErrorKind(new Error('age_required')), null);
    assert.equal(aiAccessErrorKind({ errorType: 'content_blocked' }), null);
    assert.equal(aiAccessErrorKind({ errorType: 'daily_limit', body: { error_type: 'rate_limited' } }), null);
  });

  it('prefers a known kind in the body when the error itself has another type', () => {
    assert.equal(aiAccessErrorKind({ errorType: 'http_403', body: { error_type: 'age_required' } }), 'age_required');
  });
});

describe('birth month helpers', () => {
  const now = new Date('2026-10-22T03:00:00Z');

  it('formats and splits YYYY-MM', () => {
    assert.equal(toBirthYm(2014, 4), '2014-04');
    assert.deepEqual(splitBirthYm('2014-04'), { year: 2014, month: 4 });
    assert.equal(splitBirthYm('2014-4'), null);
    assert.equal(splitBirthYm(null), null);
  });

  it('accepts 1900-01 up to the current month in Japan time', () => {
    assert.equal(isValidBirthYm('1900-01', now), true);
    assert.equal(isValidBirthYm('1899-12', now), false);
    assert.equal(isValidBirthYm('2026-10', now), true);
    assert.equal(isValidBirthYm('2026-11', now), false);
    assert.equal(isValidBirthYm('2027-01', now), false);
    assert.equal(isValidBirthYm('2014-13', now), false);
    assert.equal(isValidBirthYm('2014-00', now), false);
  });

  it('uses the Japan-time month at a month boundary', () => {
    // 2026-10-31T16:00Z is 2026-11-01 01:00 in Tokyo.
    const boundary = new Date('2026-10-31T16:00:00Z');
    assert.deepEqual(tokyoYearMonth(boundary), { year: 2026, month: 11 });
    assert.equal(isValidBirthYm('2026-11', boundary), true);
  });
});

describe('contract values', () => {
  it('shows the same consent text version as the server records', () => {
    assert.equal(CONSENT_POLICY_VERSION, SERVER_POLICY_VERSION);
    assert.equal(CONSENT_POLICY_VERSION, 'guardian-ai-2026-10');
  });

  it('routes the setup page and the public guide', () => {
    assert.equal(AI_ACCESS_SETUP_PATH, '/settings/ai-access');
    assert.equal(AI_SAFETY_PATH, '/ai-safety');
    const viewPaths = read('navigation/viewPaths.ts');
    assert.match(viewPaths, /'\/settings\/ai-access'/);
    assert.match(viewPaths, /'\/settings\/admin\/safety'/);
    assert.match(viewPaths, /'\/ai-safety'/);
    // Public when signed out, like /aidj (and Phase 3's /legal/commerce, billingFront.test.js, and
    // Phase 4's /account/deleted, accountDeletionFront.test.js).
    assert.match(read('App.tsx'), /PUBLIC_PATHS = new Set\(\['\/aidj', '\/ai-safety', '\/legal\/commerce', '\/account\/deleted'\]\)/);
  });

  it('validates user ids for the admin lookup', () => {
    assert.equal(isUserId('00000000-0000-0000-0000-000000000001'), true);
    assert.equal(isUserId(' 1A2B3C4D-0000-4000-8000-000000000001 '), true);
    assert.equal(isUserId('1a2b3c4d'), false);
    assert.equal(isUserId('not-a-uuid'), false);
  });
});

describe('clearSharedDeviceAiData', () => {
  it('names the keys the app really writes', () => {
    assert.ok(AI_LOCAL_KEYS.includes(ASSESSMENT_PROFILE_STORAGE_KEY));
    assert.match(read('components/lesson/useTutorStream.ts'), /TUTOR_CARDS_KEY = 'rp:tutorCards'/);
    assert.ok(AI_LOCAL_KEYS.includes('rp:tutorCards'));
    assert.match(read('components/wrappers/GeneratedCourseViewWrapper.tsx'), /'active_curriculum_id'/);
    assert.match(read('components/common/LessonView.tsx'), new RegExp(`\`${WRITING_DRAFT_PREFIX}\\$\\{`));
    assert.match(read('context/AuthContext.tsx'), /clearSharedDeviceAiData\(\{ keepDrafts: user\?\.isGuest === true \}\)/);
  });

  it('removes AI answers and writing drafts, and keeps everything else', () => {
    const local = memoryStorage({
      'rp:tutorCards': '[]',
      'personalized.profile.v1': '{}',
      learner_profile_id: 'p1',
      active_curriculum_id: 'c1',
      'risepath:language': 'jp',
      'rp:reader-settings': '{}',
    });
    const session = memoryStorage({ 'rp:writingDraft:course-a': 'text', 'rp:writingDraft:default': 'x', 'rp:returnTo': '/learn' });
    clearSharedDeviceAiData({ local, session });
    assert.deepEqual([...local.map.keys()].sort(), ['risepath:language', 'rp:reader-settings']);
    assert.deepEqual([...session.map.keys()], ['rp:returnTo']);
  });

  it('keeps writing drafts when a guest signs out to sign in', () => {
    const local = memoryStorage({ 'rp:tutorCards': '[]' });
    const session = memoryStorage({ 'rp:writingDraft:course-a': 'text' });
    clearSharedDeviceAiData({ keepDrafts: true, local, session });
    assert.equal(local.map.size, 0);
    assert.equal(session.map.size, 1);
  });

  it('does not throw when storage is blocked or missing', () => {
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
    assert.doesNotThrow(() => clearSharedDeviceAiData({ local: throwing, session: throwing }));
    assert.doesNotThrow(() => clearSharedDeviceAiData({ local: null, session: null }));
  });
});

describe('support lines', () => {
  it('lists only the numbers checked on the official pages', () => {
    const text = read('components/safety/SupportLines.tsx');
    for (const tel of ['0120078310', '0120997777', '0120007110', "tel: '189'", 'https://talkme.jp/']) {
      assert.ok(text.includes(tel), `missing ${tel}`);
    }
    for (const source of [
      'https://www.mext.go.jp/a_menu/shotou/seitoshidou/06112210.htm',
      'https://childline.or.jp/tel/',
      'https://www.moj.go.jp/JINKEN/jinken112.html',
      'https://kodomoshien.cfa.go.jp/no-gyakutai/189/',
    ]) {
      assert.ok(text.includes(source), `missing source ${source}`);
    }
  });
});
