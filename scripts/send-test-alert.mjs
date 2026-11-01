#!/usr/bin/env node
// @ts-check
/**
 * 試しの知らせ: one fixed test line to the safety-alert webhook (Phase 9, owner decision D7; doc/guides/
 * first-launch.ja.md 手順書 9.4). Run on the VM, inside the api container, which holds stack.env's values as
 * of the last deploy (a container's environment is fixed when it is made: a value written to stack.env after
 * that reaches it only through `./scripts/deploy-stack.sh`, so every message that sends the owner to stack.env
 * also says to deploy):
 *
 *   docker compose --env-file stack.env exec -T api node scripts/send-test-alert.mjs
 *
 * The URL is chosen as the safety events choose it (server/safety/events.js): SAFETY_ALERT_WEBHOOK_URL when
 * it is set, else AI_CAP_ALERT_WEBHOOK_URL, https only (parseAlertWebhook); the line goes out through the
 * same postAlert (Slack reads `text`, Discord `content`). An incoming-webhook URL is a bearer secret: it is
 * never printed. Prints 「送りました」, 「受け口が設定されていません」 or 「送れませんでした（<reason>）」, where
 * the reason is a variable name, an HTTP status or an error code, each with the next step. Exit 0 only when
 * the webhook took the line.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAlertWebhook, postAlert } from '../server/middleware/dailyCaps.js';

/** The next step after a value in stack.env changed: the api sees it only after a deploy. */
const AFTER_EDIT = '`./scripts/deploy-stack.sh` を実行してから、もう一度送ります。';

/** The only text that is sent. */
export const TEST_ALERT_LINE = '【Rise Path】安全の知らせのテストです。届いたら、launch-record.env の ALERT_TEST に今日の日付を書いてください。';

/**
 * Sends the test line and returns the exit code.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, write?: (line: string) => void }} [options]
 * @returns {Promise<number>}
 */
export async function sendTestAlert({ env = process.env, fetchImpl = globalThis.fetch, write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const name = env.SAFETY_ALERT_WEBHOOK_URL?.trim() ? 'SAFETY_ALERT_WEBHOOK_URL' : 'AI_CAP_ALERT_WEBHOOK_URL';
  const raw = env[name]?.trim() ?? '';
  if (!raw) {
    write(`受け口が設定されていません（api に AI_CAP_ALERT_WEBHOOK_URL が入っていません）。stack.env に書き（手順書 3.6・5.1）、${AFTER_EDIT}`);
    return 1;
  }
  const url = parseAlertWebhook(raw, { name, httpsOnly: true });
  if (typeof url === 'string') {
    // The reason names the variable only (parseAlertWebhook never quotes the URL).
    write(`送れませんでした（${name} が https:// の URL ではありません）。stack.env の値を直し（手順書 5.1）、${AFTER_EDIT}`);
    return 1;
  }
  /** @type {string[]} */
  const warnings = [];
  await postAlert(url.href, TEST_ALERT_LINE, fetchImpl, { warn: (line) => warnings.push(String(line)) });
  if (warnings.length === 0) {
    write(`送りました（${name} の受け口へ）。Slack のチャンネルに届いたかを見ます。`);
    return 0;
  }
  // postAlert's warnings carry a status or an error code, never the URL.
  const status = /answered (\d{3})/.exec(warnings[0])?.[1];
  const code = /failed \(([A-Za-z0-9_]{1,40})\)/.exec(warnings[0])?.[1];
  write(`送れませんでした（${status ? `HTTP ${status}` : code ?? 'unknown error'}）。Slack の Incoming Webhook の URL を見直すか、この行をエージェントに見せます。`);
  return 1;
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  process.exitCode = await sendTestAlert();
}
