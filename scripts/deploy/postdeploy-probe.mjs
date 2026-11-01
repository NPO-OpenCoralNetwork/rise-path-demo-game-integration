#!/usr/bin/env node
// @ts-check
/**
 * 事後の確かめ（postdeploy check）: what a deploy left running, at the strength of the CI stack (Phase 9;
 * doc/guides/first-launch.ja.md 13 章, codes DB0, DB1, P0-P16). deploy/risepath-vm/scripts/postdeploy-check.sh
 * runs it inside the api container, where 127.0.0.1 is loopback and passes the origin gate:
 *
 *   printf '%s' "<facts JSON>" | docker compose --env-file stack.env -f docker-compose.yml \
 *     exec -T api node scripts/deploy/postdeploy-probe.mjs --mode prod|ci
 *
 * The facts are what only the host can see (the active profiles, cloudflared's health, the boot unit,
 * the count of retention start-up lines in the api log). The probe asks the api, mcp and the kokoro
 * sidecar over the stack's network and prints codes, field names, counts and fixed Japanese text only:
 * never a response body, a log line or a setting's value.
 *
 * P4 asks the sidecar itself (http://kokoro-tts:8880/health), never /api/v2/tts/health: in strict
 * production that route answers 401 without a token (design N15, finding 21).
 *
 * Exit: 0 no error (warnings allowed), 10 at least one error, 11 could not check (P0: bad arguments or
 * facts). postdeploy-check.sh reads any other status (the container is not running, node crashed) as P0.
 * Built-ins and its siblings only (scripts/deploy is mounted alone by the 事前チェック; T9 holds every module here
 * to that).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Every profile docker-compose.yml has (the preflight's F1 list). Any other name, `unreadable` included
// (postdeploy-check.sh sends it for a COMPOSE_PROFILES line or value it cannot read), means the probe cannot
// tell whether P4 and P5 apply: P15.
import { PROFILE_NAMES } from './preflight-rules.mjs';

/** @typedef {'E' | 'W' | 'I'} Level */
/** @typedef {'prod' | 'ci'} Mode */
/**
 * A code's catalog entry. `level` is the level it is printed at; `names` the only words its {names} may show.
 * @typedef {{ code: string, level: Level, title: string, fix: string, names?: readonly string[] }} CodeText
 */

/**
 * Printed by deploy-stack.sh (bash) after db is healthy, before db:migrate; its lines equal this text. DB0: no
 * answer came (the db container or psql failed), so nothing is known about the encoding and nothing changed;
 * DB1: an answer that names another encoding. Only DB1 may lead to making the DB again, after a copy of the data.
 */
export const DEPLOY_CODES = Object.freeze(/** @type {readonly CodeText[]} */ ([
  {
    code: 'DB0', level: 'E',
    title: 'DB に文字コードをたずねましたが、答えがありませんでした（DB はまだ変わっていません）。',
    fix: '数分待ってから、`./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、`docker compose --env-file stack.env ps` で出た行をエージェントに見せます（DB は作り直しません）。',
  },
  {
    code: 'DB1', level: 'E',
    title: 'DB の文字コードが UTF8 ではありません（日本語の検索が動きません）。',
    fix: 'エージェントに相談します（作り直す前に、もう一度文字コードを確かめ、データの控えを取ります。手順書 16 章）。',
  },
]));

/** The answer did not come (refused, timed out, not JSON): one more word {names} may show. */
const NO_ANSWER = 'no-answer';

/**
 * The 事後の確かめ's codes. P0, P13 and P16 are printed by postdeploy-check.sh (bash), P5 also by deploy-stack.sh
 * when cloudflared stops the wait, the rest by this probe. P7, P9-P12 and P14 of the design were removed (Scope
 * guard TR10, TR6): their numbers stay unused. P15 and P16 came with review round 1 of Stage 2.
 */
export const POSTDEPLOY_CODES = Object.freeze(/** @type {readonly CodeText[]} */ ([
  {
    code: 'P0', level: 'E',
    title: '事後の確かめを実行できません（sudo で実行したか、指定が読めないか、api のコンテナに入れません）。',
    fix: '`sudo` も何も付けずに `./scripts/postdeploy-check.sh` を実行します。また出るときは、`docker compose --env-file stack.env ps` で出た行をエージェントに見せます。',
  },
  {
    code: 'P1', level: 'E',
    title: 'api が本番の形で動いていません（{names}）。',
    fix: '数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。',
    names: ['ok', 'node_env', 'checks.strict_auth_mode', 'checks.production_data_mode', 'database.migrations.pending', NO_ANSWER],
  },
  {
    code: 'P2', level: 'E',
    title: 'MCP が DB につながっていません（{names}）。',
    fix: '数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。',
    names: ['db', NO_ANSWER],
  },
  {
    code: 'P3', level: 'E',
    title: 'AI の設定が本番の形ではありません（{names}）。',
    fix: '`./scripts/preflight.sh` で直し方を見ます。`providers.anthropic.configured` と出たときは、stack.env の `ANTHROPIC_API_KEY` を確かめます（手順書 3.5）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。',
    names: ['providers.anthropic.configured', 'providers.gemini.allowed', 'mock', 'forced_provider', NO_ANSWER],
  },
  {
    code: 'P4', level: 'E',
    title: '読み上げ（kokoro-tts）が答えません。',
    fix: '数分待ってから `./scripts/postdeploy-check.sh` をもう一度実行します。また出るときは、エージェントに相談します。',
  },
  {
    code: 'P5', level: 'E',
    title: '公開の入り口（cloudflared）が healthy ではありません。',
    fix: 'tunnel.env の `TUNNEL_TOKEN` と、Cloudflare の画面のトンネルの状態を確かめます（手順書 7.3）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。',
  },
  {
    code: 'P6', level: 'W',
    title: 'VM の起動のユニット（risepath-stack.service）が登録されていません。',
    fix: '最初のデプロイ（bootstrap-vm.sh の中）なら、このあと bootstrap-vm.sh が登録するので、このままで正しい状態です。それ以外なら、`./scripts/bootstrap-vm.sh` をもう一度、最後まで実行します（手順書 6.1）。',
  },
  {
    code: 'P8', level: 'W',
    title: 'api の記録に、保存期間の処理（Retention）が動き出した行がありません。',
    fix: '`./scripts/preflight.sh` で `RETENTION_` の名前を確かめます。デプロイのすぐあとでないときは、古い行が消えていることがあります（そのときは次のデプロイのあとに見ます）。',
  },
  {
    code: 'P13', level: 'I',
    title: '通ったデプロイを記録しました（.deploy/last-green.json）。',
    fix: '何もしません（次の事前チェックが、この記録を読みます）。',
  },
  {
    code: 'P15', level: 'E',
    title: 'どの機能を動かすか（`COMPOSE_PROFILES`）が読めないので、読み上げと公開の入り口を確かめられません。',
    fix: '`./scripts/preflight.sh` で直し方を見て、stack.env の `COMPOSE_PROFILES` の行を `COMPOSE_PROFILES=tts,tunnel` の形にします（手順書 7.4 の前は `COMPOSE_PROFILES=tts`）。直したら `./scripts/deploy-stack.sh` をもう一度実行します。また出るときは、出た行をエージェントに見せます（値は出ません）。',
  },
  {
    code: 'P16', level: 'E',
    title: 'デプロイの途中で stack.env が変わったので、通ったデプロイを記録しませんでした。',
    fix: '`./scripts/deploy-stack.sh` をもう一度実行します（終わるまで、stack.env は変えません）。',
  },
]));

/** Every code the deploy and the 事後の確かめ print, in the order of the runbook's 13 章 rows. */
export const ALL_CODES = Object.freeze([...DEPLOY_CODES, ...POSTDEPLOY_CODES].map((c) => c.code));

const TEXT_BY_CODE = new Map([...DEPLOY_CODES, ...POSTDEPLOY_CODES].map((c) => [c.code, c]));
const LEVEL_MARK = { E: '❌', W: '⚠️', I: 'ℹ️' };
const LEVEL_ORDER = { E: 0, W: 1, I: 2 };
/** Printed instead of a name that is not in its code's fixed list. */
export const NAME_UNSHOWN = '（名前を表示できません）';
const TIMEOUT_MS = 20_000;
/** Profiles that start the kokoro sidecar (docker-compose.yml: kokoro-tts). */
const KOKORO_PROFILES = Object.freeze(['tts', 'full']);

/**
 * The host facts postdeploy-check.sh sends.
 * @typedef {{ profiles: string, cloudflared: string, unitStack: string, retentionLines: number }} Facts
 */
/** @type {Record<keyof Facts, (v: unknown) => boolean>} */
const FACT_CHECKS = {
  profiles: (v) => typeof v === 'string' && /^[a-z0-9_,.-]{0,256}$/.test(v),
  cloudflared: (v) => typeof v === 'string' && /^[a-z]{0,16}$/.test(v),
  unitStack: (v) => typeof v === 'string' && /^[a-z-]{0,32}$/.test(v),
  retentionLines: (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0,
};

/**
 * The facts, or null when they are not exactly these four fields of these shapes.
 * @param {unknown} value
 * @returns {Facts | null}
 */
export function validateFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const want = Object.keys(FACT_CHECKS);
  if (keys.length !== want.length || !want.every((k) => keys.includes(k))) return null;
  for (const [key, ok] of Object.entries(FACT_CHECKS)) {
    if (!ok(/** @type {Record<string, unknown>} */ (value)[key])) return null;
  }
  return /** @type {Facts} */ (value);
}

/**
 * A finding: a code, its level and only names from the code's fixed list.
 * @typedef {{ code: string, level: Level, names?: string[] }} Finding
 */

/**
 * GET a JSON answer. `status` 0 and `body` null when nothing usable came back.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @returns {Promise<{ status: number, body: any }>}
 */
async function getJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * The checks. The endpoints are the stack's own (inside the api container); tests pass loopback servers.
 * @param {{ mode: Mode, facts: Facts, fetchImpl?: typeof fetch,
 *   endpoints?: { api: string, mcp: string, kokoro: string } }} input
 * @returns {Promise<Finding[]>}
 */
export async function probe({ mode, facts, fetchImpl = fetch, endpoints = defaultEndpoints(process.env) }) {
  /** @type {Finding[]} */
  const findings = [];
  const profiles = facts.profiles.split(',').filter(Boolean);
  const prod = mode === 'prod';

  // P1: the api's own health, as scripts/ci/stack.sh health reads it (CI strength).
  const health = await getJson(fetchImpl, `${endpoints.api}/api/v2/health`);
  if (!health.body || typeof health.body !== 'object') {
    findings.push({ code: 'P1', level: 'E', names: [NO_ANSWER] });
  } else {
    const h = health.body;
    const wrong = [];
    if (h.ok !== true) wrong.push('ok');
    if (h.node_env !== 'production') wrong.push('node_env');
    if (h.checks?.strict_auth_mode !== true) wrong.push('checks.strict_auth_mode');
    if (h.checks?.production_data_mode !== true) wrong.push('checks.production_data_mode');
    if (h.database?.migrations?.pending !== 0) wrong.push('database.migrations.pending');
    if (wrong.length > 0) findings.push({ code: 'P1', level: 'E', names: wrong });
  }

  // P2: mcp answers 200 either way; its body says whether the database answered.
  const mcp = await getJson(fetchImpl, `${endpoints.mcp}/health`);
  if (!mcp.body || typeof mcp.body !== 'object') findings.push({ code: 'P2', level: 'E', names: [NO_ANSWER] });
  else if (mcp.body.db !== 'connected') findings.push({ code: 'P2', level: 'E', names: ['db'] });

  // P3: the AI settings (server/llm/index.js status()). The model key only in production: the CI stack has none.
  // LLM_PROVIDER=anthropic is allowed (preflight C4), so a forced provider may be anthropic and nothing else.
  const llm = await getJson(fetchImpl, `${endpoints.api}/api/v2/llm/status`);
  if (llm.status !== 200 || !llm.body || typeof llm.body !== 'object') {
    findings.push({ code: 'P3', level: 'E', names: [NO_ANSWER] });
  } else {
    const s = llm.body;
    const wrong = [];
    if (prod && s.providers?.anthropic?.configured !== true) wrong.push('providers.anthropic.configured');
    if (s.providers?.gemini?.allowed !== false) wrong.push('providers.gemini.allowed');
    if (s.mock !== false) wrong.push('mock');
    if (!(s.forced_provider === null || s.forced_provider === 'anthropic')) wrong.push('forced_provider');
    if (wrong.length > 0) findings.push({ code: 'P3', level: 'E', names: wrong });
  }

  // P15: a profile list the check cannot read fails closed, instead of skipping P4 and P5 without a word.
  if (profiles.some((p) => !PROFILE_NAMES.includes(p))) findings.push({ code: 'P15', level: 'E' });

  // P4: the kokoro sidecar itself, when a profile that starts it is active.
  if (profiles.some((p) => KOKORO_PROFILES.includes(p))) {
    const kokoro = await getJson(fetchImpl, `${endpoints.kokoro}/health`);
    if (kokoro.status !== 200 || kokoro.body?.status !== 'ok') findings.push({ code: 'P4', level: 'E' });
  }

  // P5, P6: host facts, production only (the CI stack has no tunnel and no boot unit).
  if (prod && profiles.includes('tunnel') && facts.cloudflared !== 'healthy') findings.push({ code: 'P5', level: 'E' });
  if (prod && facts.unitStack !== 'enabled') findings.push({ code: 'P6', level: 'W' });

  // P8: the api's start-up line `[Retention] on, hourly: …` (server/services/retention.js), counted on the host.
  if (facts.retentionLines < 1) findings.push({ code: 'P8', level: 'W' });
  return findings;
}

/**
 * The stack's endpoints from inside the api container (scripts/smoke-vm-stack.mjs --target container).
 * @param {Record<string, string | undefined>} env
 */
export function defaultEndpoints(env) {
  const apiPort = /^\d{1,5}$/.test(env.PORT ?? '') ? env.PORT : '3006';
  const mcpPort = /^\d{1,5}$/.test(env.MCP_SSE_PORT ?? '') ? env.MCP_SSE_PORT : '3100';
  return { api: `http://127.0.0.1:${apiPort}`, mcp: `http://mcp:${mcpPort}`, kokoro: 'http://kokoro-tts:8880' };
}

/**
 * A finding's title with {names} filled only from its code's fixed list.
 * @param {CodeText} text
 * @param {Finding} f
 */
function fill(text, f) {
  return text.title.replace('{names}', () => {
    const names = Array.isArray(f.names) ? f.names : [];
    const shown = names.filter((n) => typeof n === 'string' && (text.names ?? []).includes(n));
    if (shown.length === 0) return NAME_UNSHOWN;
    return shown.join('、') + (shown.length < names.length ? `、${NAME_UNSHOWN}` : '');
  });
}

/**
 * The three lines of one code (the shape the 事前チェック prints).
 * @param {string} code
 * @param {Finding} [f]
 * @returns {string[]}
 */
export function codeLines(code, f = { code, level: 'E' }) {
  const text = TEXT_BY_CODE.get(code) ?? /** @type {CodeText} */ (TEXT_BY_CODE.get('P0'));
  const level = f.level === 'W' || f.level === 'I' ? f.level : 'E';
  return [`${LEVEL_MARK[level]} [${text.code}] ${fill(text, f)}`, `   直し方: ${text.fix}`, `   くわしく: 手順書 13 章の「${text.code}」`];
}

/**
 * The report: a header, the findings (errors first), the checks that ran and a summary.
 * @param {Finding[]} findings
 * @param {{ mode: Mode, facts: Facts }} options
 * @returns {string[]}
 */
export function formatFindings(findings, { mode, facts }) {
  const lines = mode === 'ci'
    ? ['（CI モード: 本番だけの確かめを飛ばしています）', '==> 事後の確かめ（postdeploy-check.sh）: CI の確かめ']
    : ['==> 事後の確かめ（postdeploy-check.sh）: 本番の確かめ'];
  const counts = { E: 0, W: 0, I: 0 };
  const sorted = findings
    .map((f, index) => ({ f, index, level: /** @type {Level} */ (f.level === 'W' || f.level === 'I' ? f.level : 'E') }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.index - b.index);
  for (const { f, level } of sorted) {
    counts[level] += 1;
    lines.push(...codeLines(TEXT_BY_CODE.has(f.code) ? f.code : 'P0', { ...f, level }));
  }
  lines.push(`==> 確かめたコード: ${ranCodes(mode, facts).join('、')}`);
  lines.push(`==> 事後の確かめ: エラー ${counts.E} 件、注意 ${counts.W} 件。`);
  return lines;
}

/**
 * The codes a run checks in this mode with these facts (P13 is bash's, after a run without errors).
 * @param {Mode} mode
 * @param {Facts} facts
 */
export function ranCodes(mode, facts) {
  const profiles = facts.profiles.split(',').filter(Boolean);
  const codes = ['P1', 'P2', 'P3'];
  if (profiles.some((p) => KOKORO_PROFILES.includes(p))) codes.push('P4');
  if (mode === 'prod' && profiles.includes('tunnel')) codes.push('P5');
  if (mode === 'prod') codes.push('P6');
  codes.push('P8');
  return codes;
}

/**
 * Runs the probe and returns the exit code (0, 10 errors, 11 could not check).
 * @param {{ argv: string[], stdinText: string, write: (line: string) => void, fetchImpl?: typeof fetch,
 *   endpoints?: { api: string, mcp: string, kokoro: string } }} io
 * @returns {Promise<number>}
 */
export async function runCli({ argv, stdinText, write, fetchImpl, endpoints }) {
  const mode = argv.length === 2 && argv[0] === '--mode' && (argv[1] === 'prod' || argv[1] === 'ci') ? argv[1] : null;
  /** @type {unknown} */
  let raw = null;
  try {
    raw = JSON.parse(stdinText);
  } catch {
    raw = null;
  }
  const facts = validateFacts(raw);
  if (!mode || !facts) {
    codeLines('P0').forEach(write);
    return 11;
  }
  try {
    const findings = await probe({ mode, facts, fetchImpl, endpoints });
    formatFindings(findings, { mode, facts }).forEach(write);
    return findings.some((f) => f.level === 'E') ? 10 : 0;
  } catch {
    // Never the message: it could quote an answer.
    codeLines('P0').forEach(write);
    return 11;
  }
}

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  let stdinText = '';
  try {
    stdinText = fs.readFileSync(0, 'utf8');
  } catch {
    stdinText = '';
  }
  process.exitCode = await runCli({ argv: process.argv.slice(2), stdinText, write: (line) => process.stdout.write(`${line}\n`) });
}
