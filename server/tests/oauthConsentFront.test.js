/**
 * Front-end rules for the Phase 1 agent-connection pages (services/oauthConsentRules.ts):
 * the pending authorization kept across sign-in, who may approve, how the return address is
 * described, and how Rise Path's records merge with Supabase's grants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OAUTH_CONSENT_PATH,
  OAUTH_PENDING_KEY,
  OAUTH_PENDING_TTL_MS,
  authorizationIdFromSearch,
  claimsToBeRisePath,
  CLIENT_NAME_MAX,
  clearPendingAuthorization,
  confirmRevocationWith,
  consentEligibility,
  consentPathFor,
  describeRedirect,
  displayHost,
  isAuthorizationId,
  isPendingFresh,
  isSafeRedirectUrl,
  mergeConnectedApps,
  pendingConsentReturnPath,
  pendingRemainingMs,
  readPendingAuthorization,
  revocationClientName,
  revokeConnectedAppWith,
  savePendingAuthorization,
} from '../../services/oauthConsentRules.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const T0 = Date.UTC(2026, 9, 23, 3, 0, 0);

describe('authorization ids', () => {
  it('accepts Supabase-style ids and refuses anything that could change the URL path', () => {
    assert.equal(isAuthorizationId(ID), true);
    for (const bad of ['', 'short', '../../user', 'a/b/c/d/e/f/g', 'abc def ghi', 'x'.repeat(129), null, 42]) {
      assert.equal(isAuthorizationId(bad), false, String(bad));
    }
  });

  it('reads the id from the query string', () => {
    assert.equal(authorizationIdFromSearch(`?authorization_id=${ID}`), ID);
    assert.equal(authorizationIdFromSearch('?authorization_id=..%2F..%2Fuser'), null);
    assert.equal(authorizationIdFromSearch(''), null);
    assert.equal(consentPathFor(ID), `${OAUTH_CONSENT_PATH}?authorization_id=${ID}`);
  });
});

describe('pending authorization (localStorage, 10 minutes)', () => {
  it('keeps the first time it saw an id and expires after the TTL', () => {
    const storage = memoryStorage();
    const first = savePendingAuthorization(storage, ID, T0);
    assert.deepEqual(first, { id: ID, savedAt: T0 });
    // Reopening the same link later keeps the original time.
    const again = savePendingAuthorization(storage, ID, T0 + 5 * 60_000);
    assert.equal(again.savedAt, T0);
    assert.equal(isPendingFresh(again, T0 + OAUTH_PENDING_TTL_MS - 1), true);
    assert.equal(isPendingFresh(again, T0 + OAUTH_PENDING_TTL_MS), false);
    assert.equal(pendingRemainingMs(again, T0 + 4 * 60_000), 6 * 60_000);
    assert.equal(pendingRemainingMs(again, T0 + 11 * 60_000), 0);
  });

  it('replaces the entry for a new id', () => {
    const storage = memoryStorage();
    savePendingAuthorization(storage, ID, T0);
    const other = 'Zz' + ID.slice(2);
    assert.deepEqual(savePendingAuthorization(storage, other, T0 + 60_000), { id: other, savedAt: T0 + 60_000 });
  });

  it('returns to the consent page after sign-in only while the request is open', () => {
    const storage = memoryStorage();
    assert.equal(pendingConsentReturnPath(storage, T0), null);
    savePendingAuthorization(storage, ID, T0);
    assert.equal(pendingConsentReturnPath(storage, T0 + 60_000), consentPathFor(ID));
    assert.equal(pendingConsentReturnPath(storage, T0 + OAUTH_PENDING_TTL_MS + 1), null);
    clearPendingAuthorization(storage);
    assert.equal(storage.getItem(OAUTH_PENDING_KEY), null);
  });

  it('drops malformed entries and survives blocked storage', () => {
    const storage = memoryStorage({ [OAUTH_PENDING_KEY]: JSON.stringify({ id: '../x', savedAt: T0 }) });
    assert.equal(readPendingAuthorization(storage), null);
    assert.equal(storage.getItem(OAUTH_PENDING_KEY), null);
    assert.equal(readPendingAuthorization(memoryStorage({ [OAUTH_PENDING_KEY]: '{not json' })), null);
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    assert.equal(readPendingAuthorization(throwing), null);
    assert.deepEqual(savePendingAuthorization(throwing, ID, T0), { id: ID, savedAt: T0 });
    assert.equal(pendingConsentReturnPath(null, T0), null);
  });

  it('a clock moved backwards does not keep a request open', () => {
    assert.equal(isPendingFresh({ id: ID, savedAt: T0 }, T0 - 1), false);
  });
});

describe('who may approve', () => {
  const base = { birthYm: '1990-01', consent: null, ageEditable: false };
  it('only an adult whose AI access is ready', () => {
    assert.equal(consentEligibility({ ...base, status: 'ready', audience: 'adult' }), 'allowed');
    assert.equal(consentEligibility({ ...base, status: 'ready', audience: 'minor' }), 'minor');
    assert.equal(consentEligibility({ ...base, status: 'needs_guardian_consent', audience: 'minor' }), 'minor');
    assert.equal(consentEligibility({ ...base, status: 'paused', audience: 'minor' }), 'minor');
    assert.equal(consentEligibility({ ...base, status: 'paused', audience: 'adult' }), 'paused');
    assert.equal(consentEligibility({ ...base, birthYm: null, status: 'needs_age', audience: null }), 'needs_age');
    assert.equal(consentEligibility({ ...base, status: 'ready', audience: null }), 'unavailable');
    assert.equal(consentEligibility(null), 'unavailable');
  });
});

describe('return address', () => {
  it('describes where the browser goes back to', () => {
    assert.deepEqual(describeRedirect('https://claude.ai/api/mcp/auth_callback'), { kind: 'known', host: 'claude.ai' });
    assert.deepEqual(describeRedirect('https://chatgpt.com/connector_platform_oauth_redirect'), { kind: 'known', host: 'chatgpt.com' });
    assert.deepEqual(describeRedirect('https://evil.example/cb'), { kind: 'web', host: 'evil.example' });
    assert.deepEqual(describeRedirect('https://claude.ai.evil.example/cb'), { kind: 'web', host: 'claude.ai.evil.example' });
    assert.deepEqual(describeRedirect('http://localhost:33418/callback'), { kind: 'loopback', host: 'localhost:33418' });
    assert.deepEqual(describeRedirect('http://127.0.0.1:8976/cb'), { kind: 'loopback', host: '127.0.0.1:8976' });
    assert.deepEqual(describeRedirect('http://[::1]:9000/cb'), { kind: 'loopback', host: '[::1]:9000' });
    assert.deepEqual(describeRedirect('http://agent.example/cb'), { kind: 'insecure', host: 'agent.example' });
    assert.deepEqual(describeRedirect('cursor://anysphere.cursor-mcp/oauth/callback'), { kind: 'app', host: 'cursor' });
    assert.deepEqual(describeRedirect(undefined), { kind: 'missing', host: null });
    assert.deepEqual(describeRedirect('javascript:alert(1)'), { kind: 'invalid', host: null });
    assert.deepEqual(describeRedirect('not a url'), { kind: 'invalid', host: null });
  });

  it('never follows script or data URLs', () => {
    assert.equal(isSafeRedirectUrl('https://claude.ai/cb?code=x&state=y'), true);
    assert.equal(isSafeRedirectUrl('http://localhost:1234/cb?code=x'), true);
    assert.equal(isSafeRedirectUrl('cursor://x/cb?code=1'), true);
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'vbscript:x', '', null, '/relative']) {
      assert.equal(isSafeRedirectUrl(bad), false, String(bad));
    }
  });

  it('shows only the host of an app website, and flags names that claim to be Rise Path', () => {
    assert.equal(displayHost('https://www.example.com/path?q=1'), 'www.example.com');
    assert.equal(displayHost('javascript:alert(1)'), null);
    assert.equal(claimsToBeRisePath('Rise Path Official'), true);
    assert.equal(claimsToBeRisePath('rise-path helper'), true);
    assert.equal(claimsToBeRisePath('ライズ・パス'), true);
    assert.equal(claimsToBeRisePath('Claude Code'), false);
  });
});

describe('connected apps merge', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';

  it('joins our records with Supabase grants and puts connected apps first', () => {
    const apps = mergeConnectedApps(
      [
        { clientId: A, clientName: 'Old name', firstSeenAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-20T00:00:00Z', revokedAt: null },
        { clientId: B, clientName: 'Codex', firstSeenAt: '2026-10-02T00:00:00Z', lastUsedAt: '2026-10-22T00:00:00Z', revokedAt: '2026-10-22T01:00:00Z' },
      ],
      [
        { client: { id: A.toUpperCase(), name: 'Claude Code', uri: 'https://claude.com/code' }, granted_at: '2026-10-01T00:00:00Z' },
        { client: { id: C, name: 'ChatGPT', uri: 'javascript:alert(1)' }, granted_at: '2026-10-21T00:00:00Z' },
      ],
    );
    assert.deepEqual(apps.map((a) => [a.clientId, a.name, a.active, a.hasGrant]), [
      [C, 'ChatGPT', true, true],
      [A, 'Claude Code', true, true],
      [B, 'Codex', false, false],
    ]);
    assert.equal(apps[1].uriHost, 'claude.com');
    assert.equal(apps[0].uriHost, null);
  });

  it('a grant older than our revocation is an unfinished disconnect; a newer one is a new consent', () => {
    const record = { clientId: A, clientName: 'X', firstSeenAt: null, lastUsedAt: null, revokedAt: '2026-10-22T00:00:00Z' };
    const [unfinished] = mergeConnectedApps([record], [{ client: { id: A }, granted_at: '2026-10-21T00:00:00Z' }]);
    assert.equal(unfinished.hasGrant, true);
    assert.equal(unfinished.active, false);
    const [renewed] = mergeConnectedApps([record], [{ client: { id: A }, granted_at: '2026-10-23T00:00:00Z' }]);
    assert.equal(renewed.active, true);
  });

  it('when grants could not be read, unrevoked records stay revocable', () => {
    const apps = mergeConnectedApps(
      [
        { clientId: A, clientName: 'X', firstSeenAt: null, lastUsedAt: null, revokedAt: null },
        { clientId: B, clientName: 'Y', firstSeenAt: null, lastUsedAt: null, revokedAt: '2026-10-22T00:00:00Z' },
      ],
      [],
      false,
    );
    assert.deepEqual(apps.map((a) => [a.clientId, a.active, a.hasGrant]), [[A, true, true], [B, false, false]]);
  });

  it('when grants could not be read, an app used after its revocation stays revocable', () => {
    const [app] = mergeConnectedApps(
      [{ clientId: C, clientName: 'Z', firstSeenAt: null, lastUsedAt: '2026-10-22T02:00:00Z', revokedAt: '2026-10-22T00:00:00Z' }],
      [],
      false,
    );
    assert.equal(app.hasGrant, true);
    assert.equal(app.active, false);
  });

  it('a disconnected app keeps the name our record saved at revocation', () => {
    const [app] = mergeConnectedApps(
      [{ clientId: A, clientName: '  Claude Code  ', firstSeenAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-20T00:00:00Z', revokedAt: '2026-10-22T00:00:00Z' }],
      [],
    );
    assert.equal(app.name, 'Claude Code');
    assert.equal(app.hasGrant, false);
    // A blank Supabase name falls back to our record; blank everywhere is no name.
    const [blank] = mergeConnectedApps([{ clientId: A, clientName: 'Codex', firstSeenAt: null, lastUsedAt: null, revokedAt: null }], [{ client: { id: A, name: '   ' } }]);
    assert.equal(blank.name, 'Codex');
    const [none] = mergeConnectedApps([{ clientId: A, clientName: ' ', firstSeenAt: null, lastUsedAt: null, revokedAt: '2026-10-22T00:00:00Z' }], []);
    assert.equal(none.name, null);
  });

  it('an app revoked before it ever called Rise Path shows no use dates', () => {
    const at = '2026-10-22T00:00:00.123Z';
    // An older row: the revoke API inserted it, so both dates are the column defaults (= revoked_at).
    const [defaults] = mergeConnectedApps([{ clientId: A, clientName: null, firstSeenAt: at, lastUsedAt: at, revokedAt: at }], []);
    assert.equal(defaults.firstSeenAt, null);
    assert.equal(defaults.lastUsedAt, null);
    // The server sends null for a never-used app.
    const [nulls] = mergeConnectedApps([{ clientId: A, clientName: null, firstSeenAt: null, lastUsedAt: null, revokedAt: at }], []);
    assert.equal(nulls.firstSeenAt, null);
    assert.equal(nulls.lastUsedAt, null);
    // A used app keeps its dates, even when it was used exactly once.
    const [used] = mergeConnectedApps(
      [{ clientId: A, clientName: null, firstSeenAt: '2026-10-21T00:00:00Z', lastUsedAt: '2026-10-21T00:00:00Z', revokedAt: at }],
      [],
    );
    assert.equal(used.firstSeenAt, '2026-10-21T00:00:00Z');
    assert.equal(used.lastUsedAt, '2026-10-21T00:00:00Z');
  });
});

describe('disconnecting an app', () => {
  const A = '11111111-1111-4111-8111-111111111111';

  function harness({ grant = true, failPosts = [] } = {}) {
    const calls = [];
    let post = 0;
    return {
      calls,
      deps: {
        postRevoke: async (clientId, clientName) => {
          post += 1;
          calls.push(['post', clientId, clientName]);
          if (failPosts.includes(post)) throw new Error('down');
        },
        revokeGrant:
          grant === null
            ? null
            : async (clientId) => {
                calls.push(['revokeGrant', clientId]);
                if (grant === 'throw') throw new Error('down');
                return grant;
              },
      },
    };
  }

  it('writes revoked_at again after revokeGrant, so a token refreshed in between is refused too', async () => {
    const { calls, deps } = harness();
    const result = await revokeConnectedAppWith({ clientId: A, name: 'Claude Code' }, deps);
    assert.deepEqual(result, { supabaseRevoked: true, confirmed: true });
    assert.deepEqual(calls, [
      ['post', A, 'Claude Code'],
      ['revokeGrant', A],
      ['post', A, 'Claude Code'],
    ]);
  });

  it('does not write again when revokeGrant failed (the pending state keeps a retry)', async () => {
    for (const grant of [false, 'throw', null]) {
      const { calls, deps } = harness({ grant });
      const result = await revokeConnectedAppWith({ clientId: A, name: null }, deps);
      assert.deepEqual(result, { supabaseRevoked: false, confirmed: false }, String(grant));
      assert.equal(calls.filter((c) => c[0] === 'post').length, 1, String(grant));
    }
  });

  it('throws, and leaves Supabase alone, when the first write fails', async () => {
    const { calls, deps } = harness({ failPosts: [1] });
    await assert.rejects(revokeConnectedAppWith({ clientId: A }, deps), /down/);
    assert.deepEqual(calls, [['post', A, null]]);
  });

  it('retries the second write once and reports when it still fails', async () => {
    const once = harness({ failPosts: [2] });
    assert.deepEqual(await revokeConnectedAppWith({ clientId: A }, once.deps), { supabaseRevoked: true, confirmed: true });
    assert.equal(once.calls.filter((c) => c[0] === 'post').length, 3);

    const twice = harness({ failPosts: [2, 3] });
    assert.deepEqual(await revokeConnectedAppWith({ clientId: A }, twice.deps), { supabaseRevoked: true, confirmed: false });
    assert.equal(await confirmRevocationWith({ clientId: A }, twice.deps.postRevoke), true);
  });

  it('sends a trimmed, capped app name, or none', () => {
    assert.equal(revocationClientName('  Codex  '), 'Codex');
    assert.equal(revocationClientName('x'.repeat(CLIENT_NAME_MAX + 50)).length, CLIENT_NAME_MAX);
    assert.equal(revocationClientName('   '), null);
    assert.equal(revocationClientName(null), null);
    assert.equal(revocationClientName(42), null);
  });
});

describe('wiring', () => {
  it('the consent page sits outside the Layout and sign-in comes back to it', () => {
    const app = read('App.tsx');
    assert.match(app, /consentPath \? \(/);
    assert.match(app, /<OAuthConsentView onSignIn=\{openAuth\} \/>/);
    assert.match(app, /pendingConsentReturnPath\(readLocalStorage\(\)\)/);
    assert.match(app, /path="\/settings\/connected-apps"/);
  });

  it('approve and deny never let auth-js navigate by itself', () => {
    const api = read('services/oauthConsentApi.ts');
    assert.equal((api.match(/skipBrowserRedirect: true/g) || []).length, 2);
    assert.doesNotMatch(read('components/features/oauth/OAuthConsentView.tsx'), /logo_uri|<img/);
  });

  it('the inline age form survives StrictMode (no cleanup-only mounted effect)', () => {
    const view = read('components/features/oauth/OAuthConsentView.tsx');
    assert.doesNotMatch(view, /useEffect\(\(\) => \(\) =>/, 'a cleanup-only effect leaves the flag false after the dev remount');
    assert.match(view, /useEffect\(\(\) => \{\s*mounted\.current = true;\s*return \(\) => \{\s*mounted\.current = false;/);
  });

  it('only a minor sees the adults-only heading; paused and unavailable say their own reason', () => {
    const view = read('components/features/oauth/OAuthConsentView.tsx');
    const refusals = [...view.matchAll(/<Refusal heading=\{t\.(\w+)\} text=\{t\.(\w+)\} \/>/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(refusals, ['adultOnly:minorBody', 'pausedHeading:pausedBody', 'unavailableHeading:unavailableBody']);
    assert.equal((view.match(/pausedHeading: '/g) || []).length, 2, 'EN and JP');
    assert.equal((view.match(/unavailableHeading: '/g) || []).length, 2, 'EN and JP');
    assert.doesNotMatch(view, /pausedHeading: '[^']*18/);
  });

  it('the connected-apps page names the progress write the consent page lists', () => {
    const view = read('components/features/settings/ConnectedAppsView.tsx');
    assert.match(view, /add journal entries and record finished lessons/);
    assert.match(view, /終えたレッスンを記録/);
  });

  it('both pages say an app reads the lessons and progress, checks quiz answers as the learner\'s attempts and marks lessons read', () => {
    const consent = read('components/features/oauth/OAuthConsentView.tsx');
    assert.match(consent, /'The lessons of Rise Path courses, without the quiz answers'/);
    assert.match(consent, /'Rise Path のコースのレッスン（クイズの答えは除く）'/);
    assert.match(consent, /Your progress in each lesson \(sections read, quiz results\)/);
    assert.match(consent, /レッスンごとの進み具合（読んだセクション、クイズの結果）/);
    assert.match(consent, /'Check your quiz answers\. Each check is saved as your own attempt'/);
    assert.match(consent, /クイズの答えを確かめる（確かめるたびに、あなた自身の解答として記録されます）/);
    assert.match(consent, /'Mark the lesson sections you worked through as read'/);
    assert.match(consent, /読み終えたと記録する/);
    const apps = read('components/features/settings/ConnectedAppsView.tsx');
    assert.match(apps, /can read Rise Path lessons, your learning progress and journal\. It can check your quiz answers \(each check is saved as your own attempt\), mark lessons read/);
    assert.match(apps, /Rise Path のレッスンと、学習の進み具合やジャーナルを読めます。クイズの答えを確かめたり（確かめるたびに、あなた自身の解答として記録されます）、レッスンを読み終えたと記録したり/);
  });

  it('Phase 6: both pages name the review tools by what the server does (the app is told when to show an answer; results are permanent)', () => {
    const consent = read('components/features/oauth/OAuthConsentView.tsx');
    const items = (key) => [...consent.matchAll(new RegExp(`${key}: \\[([\\s\\S]*?)\\],`, 'g'))].map((m) => m[1]);
    const [readEn, readJp] = items('readItems');
    const [writeEn, writeJp] = items('writeItems');
    assert.match(readEn, /'Your review cards due today, their answers when the app asks, and when each card comes back \(the app is told to show an answer only after you try\)'/);
    assert.match(readJp, /'今日の復習カードとその答え、次に出る日（答えは、あなたが答えたあとに見せるよう、アプリに伝えています）'/);
    assert.match(writeEn, /'Record how you did on a review card \("Again" or "Got it"\)\. Each result is saved as your own and cannot be undone'/);
    assert.match(writeJp, /'復習カードの結果（「もう一度」か「覚えた」）を記録する（記録するたびに、あなた自身の結果として残り、取り消せません）'/);
    // Worded by what the server does: it cannot enforce the order, so no page promises it.
    assert.doesNotMatch(consent, /never (shows|sees) (the|an) answer before|答える前には(見せません|渡しません)/);
    const apps = read('components/features/settings/ConnectedAppsView.tsx');
    assert.match(apps, /mark lessons read, run your daily review cards, add journal entries and record finished lessons\./);
    assert.match(apps, /レッスンを読み終えたと記録したり、今日の復習カードを進めたり、ジャーナルに記録を追加したり/);
  });

  it('disconnecting goes through the tested sequence and sends the app name', () => {
    const api = read('services/connectedAppsApi.ts');
    assert.match(api, /return revokeConnectedAppWith\(target, \{/);
    assert.match(api, /body: JSON\.stringify\(clientName \? \{ clientName \} : \{\}\)/);
    const view = read('components/features/settings/ConnectedAppsView.tsx');
    assert.match(view, /revokeConnectedApp\(\{ clientId: app\.clientId, name: app\.name \}\)/);
  });

  it('the connected-apps page: no name caption without a name, "Not used yet" for any app, focus to the notice', () => {
    const view = read('components/features/settings/ConnectedAppsView.tsx');
    assert.match(view, /\{app\.name && <p[^>]*>\{t\.nameNote\}<\/p>\}/);
    assert.match(view, /\[t\.lastUsed, date\(app\.lastUsedAt\) \?\? t\.never\]/);
    assert.match(view, /<p ref=\{noticeRef\} tabIndex=\{-1\} role="status"/);
    assert.match(view, /focusNoticeAfterLoad\.current = true;\s*void load\(\);/);
    assert.match(view, /noticeRef\.current\?\.focus\(\)/);
  });

  it('no page promises that disconnecting is immediate', () => {
    for (const file of ['components/features/settings/ConnectedAppsView.tsx', 'components/features/oauth/OAuthConsentView.tsx']) {
      const text = read(file);
      assert.doesNotMatch(text, /at once|immediately|すぐに|ただちに|直ちに/, file);
    }
    const apps = read('components/features/settings/ConnectedAppsView.tsx');
    const consent = read('components/features/oauth/OAuthConsentView.tsx');
    for (const text of [apps, consent]) {
      assert.match(text, /[Ww]ithin a few seconds/);
      assert.match(text, /数秒以内/);
    }
  });

  it('the consent page says the app gets the account sign-in power, next to Allow', () => {
    const view = read('components/features/oauth/OAuthConsentView.tsx');
    assert.equal((view.match(/trustBody:/g) || []).length, 2, 'EN and JP');
    assert.match(view, /same power as your own, so allow only apps you trust/);
    assert.match(view, /信頼できるアプリだけを許可してください/);
    assert.match(view, /onClick=\{\(\) => void run\('allow'\)\} aria-describedby=\{`\$\{titleId\}-trust`\}/);
  });
});
