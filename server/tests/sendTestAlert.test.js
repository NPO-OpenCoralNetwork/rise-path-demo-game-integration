// @ts-check
// 試しの知らせ (scripts/send-test-alert.mjs; Phase 9, owner decision D7, design §7.1): the URL is chosen as
// the safety events choose it (SAFETY_ALERT_WEBHOOK_URL, else AI_CAP_ALERT_WEBHOOK_URL; https only), one
// fixed line goes out with `text` and `content` through dailyCaps.js postAlert, and the URL (a bearer
// secret) is never printed, whatever happens.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TEST_ALERT_LINE, sendTestAlert } from '../../scripts/send-test-alert.mjs';
import { createSafetyEvents } from '../safety/events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Runs sendTestAlert with a fake fetch.
 * @param {Record<string, string | undefined>} env
 * @param {(url: string, init: RequestInit) => Promise<Response>} [answer]
 */
async function run(env, answer = async () => new Response('ok', { status: 200 })) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  /** @type {string[]} */
  const out = [];
  const fetchImpl = /** @type {typeof fetch} */ (async (/** @type {any} */ url, /** @type {any} */ init) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  });
  const status = await sendTestAlert({ env, fetchImpl, write: (line) => out.push(line) });
  return { status, calls, out: out.join('\n') };
}

const secretUrl = (/** @type {string} */ tag) => `https://hooks.slack.com/services/T0/B0/${tag}${crypto.randomBytes(8).toString('hex')}`;
// Review round 1 of Stage 2, finding 9: the api reads the URL from its own environment, fixed at the last deploy,
// so the not-set line says to deploy after writing stack.env; a refused or failed post says what to look at.
const NOT_SET = '受け口が設定されていません（api に AI_CAP_ALERT_WEBHOOK_URL が入っていません）。stack.env に書き（手順書 3.6・5.1）、`./scripts/deploy-stack.sh` を実行してから、もう一度送ります。';
const HINT = 'Slack の Incoming Webhook の URL を見直すか、この行をエージェントに見せます。';

describe('send-test-alert.mjs', () => {
  it('posts the fixed line once, with text and content, to AI_CAP_ALERT_WEBHOOK_URL; prints 送りました and never the URL', async () => {
    const url = secretUrl('cap');
    const r = await run({ AI_CAP_ALERT_WEBHOOK_URL: url });
    assert.equal(r.status, 0);
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, url);
    assert.equal(r.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(r.calls[0].init.body)), { text: TEST_ALERT_LINE, content: TEST_ALERT_LINE });
    assert.match(r.out, /^送りました（AI_CAP_ALERT_WEBHOOK_URL の受け口へ）。/);
    assert.ok(!r.out.includes(url) && !r.out.includes('hooks.slack.com'));
    assert.match(TEST_ALERT_LINE, /^【Rise Path】安全の知らせのテストです。.*ALERT_TEST/);
  });

  it('chooses the URL as the safety events do: SAFETY_ALERT_WEBHOOK_URL when it is set (not blank), else AI_CAP_ALERT_WEBHOOK_URL', async () => {
    const safety = secretUrl('safety');
    const cap = secretUrl('cap');
    /** @type {[Record<string, string>, string][]} */
    const table = [
      [{ SAFETY_ALERT_WEBHOOK_URL: safety, AI_CAP_ALERT_WEBHOOK_URL: cap }, safety],
      [{ SAFETY_ALERT_WEBHOOK_URL: '  ', AI_CAP_ALERT_WEBHOOK_URL: cap }, cap],
      [{ SAFETY_ALERT_WEBHOOK_URL: ` ${safety} `, AI_CAP_ALERT_WEBHOOK_URL: cap }, safety],
    ];
    for (const [env, want] of table) {
      const r = await run(env);
      assert.deepEqual(r.calls.map((c) => c.url), [want], JSON.stringify(Object.keys(env)));
      // The same choice as server/safety/events.js makes for a real safety event.
      /** @type {string[]} */
      const posted = [];
      const events = createSafetyEvents({ env, getPool: () => null, logger: { warn() {}, error() {}, info() {} },
        fetch: /** @type {typeof fetch} */ (async (/** @type {any} */ url) => { posted.push(String(url)); return new Response('ok'); }) });
      await events.record({ kind: 'support_shown', surface: 'tutor', userId: null, category: 'self_harm' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(posted, [want], 'a real safety event posts to the same URL');
    }
  });

  it('refuses http and a value that is not a URL, naming the variable only; nothing is sent', async () => {
    for (const [name, value] of [['AI_CAP_ALERT_WEBHOOK_URL', 'http://hooks.slack.com/services/T0/B0/SECRETPART'], ['SAFETY_ALERT_WEBHOOK_URL', 'http://127.0.0.1:9/SECRETPART'], ['AI_CAP_ALERT_WEBHOOK_URL', 'not a url SECRETPART']]) {
      const r = await run({ [name]: value });
      assert.equal(r.status, 1);
      assert.deepEqual(r.calls, []);
      assert.equal(r.out, `送れませんでした（${name} が https:// の URL ではありません）。stack.env の値を直し（手順書 5.1）、\`./scripts/deploy-stack.sh\` を実行してから、もう一度送ります。`);
      assert.ok(!r.out.includes('SECRETPART'));
    }
  });

  it('nothing set: 受け口が設定されていません, nothing sent', async () => {
    for (const env of [{}, { AI_CAP_ALERT_WEBHOOK_URL: '' }, { AI_CAP_ALERT_WEBHOOK_URL: '   ', SAFETY_ALERT_WEBHOOK_URL: '' }]) {
      const r = await run(env);
      assert.equal(r.status, 1);
      assert.deepEqual(r.calls, []);
      assert.equal(r.out, NOT_SET);
    }
  });

  it('a refused or failed post: 送れませんでした with the status or the error code only, never the URL', async () => {
    const url = secretUrl('fail');
    const refused = await run({ AI_CAP_ALERT_WEBHOOK_URL: url }, async () => new Response(`no_service ${url}`, { status: 404 }));
    assert.equal(refused.status, 1);
    assert.equal(refused.out, `送れませんでした（HTTP 404）。${HINT}`);
    const failed = await run({ AI_CAP_ALERT_WEBHOOK_URL: url }, async () => {
      throw Object.assign(new TypeError(`fetch failed for ${url}`), { cause: { code: 'ENOTFOUND', message: url } });
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.out, `送れませんでした（ENOTFOUND）。${HINT}`);
    const odd = await run({ AI_CAP_ALERT_WEBHOOK_URL: url }, async () => { throw new Error(url); });
    assert.equal(odd.out, `送れませんでした（Error）。${HINT}`);
    for (const r of [refused, failed, odd]) assert.ok(!r.out.includes(url) && !r.out.includes('hooks.slack.com'), r.out);
  });

  it('as a process (in the api image the env holds stack.env): exit 1 and the not-set line without a URL', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/send-test-alert.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30_000 });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, `${NOT_SET}\n`);
  });
});
