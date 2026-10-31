// @ts-check
/**
 * 事前チェック（preflight）の決まり: the rules the VM stack must pass before a deploy (Phase 9, owner
 * decision D2; doc/guides/first-launch.ja.md 13 章 lists every code, 14 章 every launch-record key).
 * Pure: no file, network or clock access (the caller passes the file texts, the host facts and `now`).
 * deploy/risepath-vm/scripts/preflight.sh runs it through scripts/deploy/preflight-vm.mjs in the api's
 * base image, offline and read-only. Built-ins only (the container mounts scripts/deploy alone).
 *
 * Value safety: a Finding holds a code, a level and only names (variable, launch-record key or
 * compose service names), one of the five file names, a line number, a whole number of GB or a
 * count. Rules read values but never copy one into a finding; formatFindings prints only catalog
 * text and fields that pass its filters (server/tests/deployPreflight.test.js T2a, T2b).
 *
 * The pilot list (V1 branch (a), V2, V3's list half, V4; PILOT_ACCOUNT_IDS in KNOWN_KEYS) reads
 * stack.env's PILOT_ACCOUNT_IDS the way server/middleware/pilotGate.js does (Phase 9 stage 3, D1).
 */
import { ERROR_KINDS, KEY_RE, entryMap, parseEnvText } from './env-parse.mjs';

/** @typedef {import('./env-parse.mjs').ParsedEnv} ParsedEnv */
/** @typedef {import('./env-parse.mjs').ProblemKind} ProblemKind */
/** The launch stages (「公開の段階」, LAUNCH_STAGE), in order. */
export const STAGES = Object.freeze(/** @type {const} */ (['setup', 'pilot', 'minors', 'public']));
/** @typedef {typeof STAGES[number]} Stage */
/** @typedef {'E' | 'W' | 'I'} Level */
/** @typedef {'prod' | 'ci'} Mode */

/** The env files the stack reads (deploy-stack.sh sources stack.env; Compose reads all four). */
export const ENV_FILES = Object.freeze(['stack.env', 'tunnel.env', 'mcp-public.env', 'billing.env']);
/** The owner's launch record (git-ignored, never sourced; launch-record.env.example). */
export const RECORD_FILE = 'launch-record.env';
/** The only file names a message can show. */
export const FILE_NAMES = Object.freeze([...ENV_FILES, RECORD_FILE]);
/** The deploy record postdeploy-check.sh writes after a green deploy (A13, F5); A15 when it cannot be read. */
export const DEPLOY_RECORD = '.deploy/last-green.json';

/** Compose profiles of docker-compose.yml and docker-compose.memanto.yml (pinned by T6). */
export const PROFILE_NAMES = Object.freeze(['tts', 'tunnel', 'byoa', 'memory', 'full']);
/** Each service and the profiles that start it; [] = always (pinned to the compose files by T6). */
export const SERVICE_PROFILES = Object.freeze(/** @type {Record<string, readonly string[]>} */ ({
  db: [],
  api: [],
  mcp: [],
  'kokoro-tts': ['tts', 'full'],
  'mcp-public': ['byoa'],
  hermes: ['full'],
  cloudflared: ['tunnel'],
  ollama: ['memory', 'full'],
  moorcheh: ['memory', 'full'],
  memanto: ['memory', 'full'],
}));

/**
 * Every `${NAME` that docker-compose.yml interpolates (pinned by T6). Compose fills each from the
 * deploy shell when stack.env does not set it, and the shell wins over --env-file (F11).
 */
export const COMPOSE_INTERPOLATED = Object.freeze([
  'ACCOUNT_DELETION_ENABLED', 'AI_ACCESS_DEV_AUDIENCE', 'API_SERVER_PORT', 'DATABASE_URL_PHASE1', 'GEMINI_ALLOWED',
  'GEMINI_API_KEY', 'HERMES_API_KEY', 'HERMES_API_URL', 'HERMES_GID', 'HERMES_UID', 'KOKORO_TTS_DEFAULT_VOICE_EN',
  'KOKORO_TTS_DEFAULT_VOICE_JA', 'KOKORO_TTS_URL', 'LEGAL_TERMS_REQUIRED', 'LLM_GUEST_AI', 'MCP_SSE_PORT',
  'MEMANTO_API_URL', 'MEMANTO_ENABLED', 'MEMANTO_MIN_CONFIDENCE_WRITE', 'MEMANTO_RECALL_LIMIT', 'MEMANTO_SECRET_KEY',
  'MEMANTO_SESSION_DURATION_HOURS', 'NODE_ENV', 'OPENROUTER_API_KEY', 'PHASE1_USER_ID', 'PORT', 'POSTGRES_DB',
  'POSTGRES_PASSWORD', 'POSTGRES_USER', 'RETENTION_AI_APP_RECORD_YEARS', 'RETENTION_AI_USAGE_DAYS',
  'RETENTION_DELETION_PROOF_YEARS', 'RETENTION_ENABLED', 'RETENTION_PROCESSING_DAYS', 'RISE_PATH_BRIDGE_TOKEN',
  'RISE_PATH_MCP_PROFILE', 'SAFETY_ALERT_WEBHOOK_URL', 'SAFETY_BLOCKS_BEFORE_PAUSE', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL', 'TRAINING_ENABLED', 'VITE_DEMO_MODE',
]);

/**
 * Names the stack's env files may hold (A6 warns about any other: a typo). A superset of every
 * assignment, commented or not, in the four *.example files and of COMPOSE_INTERPOLATED (T6), plus the
 * names a rule refuses on purpose, so A6 never doubles their message.
 */
export const KNOWN_KEYS = Object.freeze(new Set([
  ...COMPOSE_INTERPOLATED,
  // stack.env.example
  'AI_CAP_ALERT_WEBHOOK_URL', 'ANTHROPIC_API_KEY', 'API_SERVER_ENABLED', 'COMPOSE_PROFILES', 'GEMINI_ALLOWED',
  'LLM_ALLOWED_ORIGINS', 'LLM_GUEST_DAILY_PER_IP', 'LLM_GUEST_DAILY_TOTAL', 'LLM_MOCK_FALLBACK', 'LLM_PROVIDER',
  'LLM_TIMEOUT_MS', 'MEMANTO_API_PORT', 'MOORCHEH_EMBEDDING_MODEL', 'MOORCHEH_LLM_MODEL', 'ORIGIN_SECRET',
  'ORIGIN_SECRET_PREVIOUS', 'PG_CONNECT_TIMEOUT_MS', 'PG_POOL_MAX', 'PG_STATEMENT_TIMEOUT_MS', 'RISEPATH_STRICT_AUTH',
  'RP_LESSON_STORE', 'TRUST_PROXY', 'VITE_FEATURE_AGENT_CHAT',
  // tunnel.env.example, mcp-public.env.example
  'TUNNEL_TOKEN', 'SUPABASE_ANON_KEY', 'MCP_PUBLIC_RESOURCE_URL', 'MCP_ALLOWED_ORIGINS', 'APP_PUBLIC_URL',
  // billing.env.example
  'BILLING_ENABLED', 'BILLING_LIVE', 'BILLING_TEST_USER_IDS', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID', 'STRIPE_PRICE_IDS_ACCEPTED', 'BILLING_RETURN_ORIGIN', 'BILLING_TOS_URL',
  // names a rule refuses or reads (B4, C2, C5, C7, C8, C17)
  'RISE_PATH_PUBLIC_URL', 'GOOGLE_API_KEY', 'ANTHROPIC_BASE_URL', 'RISE_PATH_ACTIVE_SESSION_KEY',
  'HERMES_ACTIVE_SESSION_KEY', 'X_HERMES_SESSION_KEY', 'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'RP_LESSON_FS_WRITE',
  // the pilot list (stack.env.example, commented; V1-V4; server/middleware/pilotGate.js)
  'PILOT_ACCOUNT_IDS',
]));

/**
 * A pilot-list entry: the UUID pattern of server/utils/ids.js UUID_RE, repeated here because the
 * container mounts scripts/deploy alone (server/tests/pilotGate.test.js pins the two equal and runs
 * both over server/tests/fixtures/pilot-ids.json).
 */
export const PILOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PILOT_ACCOUNT_IDS as the api reads it (server/middleware/pilotGate.js readPilotList): unset or
 * blank = off; else comma-separated, each entry trimmed. `invalid` holds the 1-based positions of the
 * entries that are not UUIDs (the api ignores them; set with no valid id refuses everyone).
 * @param {string | undefined} raw
 * @returns {{ set: boolean, valid: number, invalid: number[] }}
 */
export function readPilotEntries(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { set: false, valid: 0, invalid: [] };
  let valid = 0;
  /** @type {number[]} */
  const invalid = [];
  raw.split(',').forEach((entry, index) => {
    if (PILOT_ID_RE.test(entry.trim())) valid += 1;
    else invalid.push(index + 1);
  });
  return { set: true, valid, invalid };
}
/** Families of names the examples document with a pattern (LLM_TASK_<TASK>, the daily caps). */
const KNOWN_KEY_PATTERNS = Object.freeze([/^LLM_TASK_[A-Z0-9_]+$/, /^AI_CAP_(?:USER|IP|GLOBAL|SUPPORTER_GLOBAL)_[A-Z0-9_]+$/]);
/** A name the env files may hold (A6). @param {string} name */
export const isKnownKey = (name) => KNOWN_KEYS.has(name) || KNOWN_KEY_PATTERNS.some((re) => re.test(name));

/**
 * The launch record's keys (TR3: the 18 a rule reads). `step` is the runbook step that produces it
 * (手順書 X.Y); runbook 14 章 has a row for each and launch-record.env.example a line.
 * @typedef {{ key: string, kind: 'stage' | 'date' | 'text' | 'keyid', step: string | null, rules: string[] }} Attestation
 * @type {readonly Attestation[]}
 */
export const ATTESTATIONS = Object.freeze([
  { key: 'LAUNCH_STAGE', kind: 'stage', step: '5.2', rules: ['A11', 'G5'] },
  { key: 'VERCEL_PROTECTION_ON', kind: 'date', step: '2.6', rules: ['V1'] },
  { key: 'VERCEL_PROTECTION_OFF', kind: 'date', step: '10.3', rules: ['V1', 'V3'] },
  { key: 'ALERT_WATCHER', kind: 'text', step: '3.6', rules: ['K4'] },
  { key: 'ALERT_CHECK', kind: 'text', step: '3.6', rules: ['K4'] },
  { key: 'BACKUP_LIFECYCLE', kind: 'date', step: '3.8', rules: ['R5'] },
  { key: 'BACKUP_KEY_COPY', kind: 'date', step: '6.4', rules: ['R4'] },
  { key: 'BACKUP_KEY_ID', kind: 'keyid', step: '6.4', rules: ['R4'] },
  { key: 'ALERT_TEST', kind: 'date', step: '9.4', rules: ['K5'] },
  { key: 'MAC_DEV_DB_SEPARATE', kind: 'date', step: '9.5', rules: ['M1'] },
  { key: 'SUPABASE_CURRENT_PASSWORD_ON', kind: 'date', step: '11.2', rules: ['G1'] },
  { key: 'PASSWORD_CHANGE_CHECK', kind: 'date', step: '11.2', rules: ['G1'] },
  { key: 'PROD_AMR_CHECK', kind: 'date', step: '11.2', rules: ['G1'] },
  { key: 'VERCEL_LEGAL_PAGES_ON', kind: 'date', step: '12.1', rules: ['G2', 'G3'] },
  { key: 'DECIDED_BYOA', kind: 'date', step: '12.3', rules: ['S2', 'V4'] },
  { key: 'DECIDED_MEMORY', kind: 'date', step: '12.3', rules: ['S3'] },
  { key: 'DECIDED_BILLING', kind: 'date', step: '12.3', rules: ['S4'] },
  { key: 'MINORS_POLICY_DECIDED', kind: 'date', step: null, rules: ['G5'] },
]);
const ATTESTATION_KEYS = new Set(ATTESTATIONS.map((a) => a.key));

/** Levenshtein distance, stopping early above `max`. @param {string} a @param {string} b @param {number} max */
function editDistanceAtMost(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/**
 * An unknown record name that is a typo of a record key (A10 E): at most 2 letters away, case aside.
 * The typo would drop that record silently, and for VERCEL_PROTECTION_OFF or VERCEL_LEGAL_PAGES_ON a
 * dropped date turns a gate off (V1, G3).
 * @param {string} name
 */
export const isRecordKeyTypo = (name) => !ATTESTATION_KEYS.has(name) && ATTESTATIONS.some((a) => editDistanceAtMost(name.toUpperCase(), a.key, 2));

/** G5: keys required from a stage on that no other rule reads (TR3). @type {Record<string, Partial<Record<Stage, Level>>>} */
const STAGE_REQUIRED = { MINORS_POLICY_DECIDED: { minors: 'E', public: 'E' } };

/**
 * One rule of the catalog. `level` uses the design's notation: one letter for every stage, or
 * setup/pilot/minors/public separated by `/` with `–` for "not checked"; `dyn` when the rule computes
 * it (its comment says how). `ci`: run or skip in CI mode. `title` and `fix` are the only text a
 * finding prints; placeholders {names}, {file}, {line}, {gb}, {n}.
 * @typedef {{ code: string, group: string, level: string, ci: 'run' | 'skip', title: string, fix: string }} Rule
 * @type {readonly Rule[]}
 */
export const RULES = Object.freeze([
  // A. Files and parsing
  { code: 'A1', group: 'A', level: 'E', ci: 'run', title: 'stack.env がありません。', fix: '`cp stack.env.example stack.env && chmod 600 stack.env` を実行し、手順書 5.1 のとおりに書きます。' },
  { code: 'A2', group: 'A', level: 'E', ci: 'skip', title: 'CI 用のファイル（ダミーの値）が、VM の設定に入っています（{file}）', fix: '`deploy/risepath-vm/ci/` のファイルは VM では使いません。`stack.env.example` から作り直します。' },
  { code: 'A3', group: 'A', level: 'E', ci: 'run', title: '{file} の改行が Windows の形（CRLF）です。', fix: "VM で `sed -i 's/\\r$//' {file}` を実行します。" },
  // A4: W; E in launch-record.env for one of the 18 record keys (the last line wins, so a template's empty line under a
  // dated one would turn a gate off: review round 3, finding 1).
  { code: 'A4', group: 'A', level: 'dyn', ci: 'run', title: '{file} に同じ名前が 2 回あります（{names}）', fix: '1 つだけ残します（launch-record.env では、いまの状態に合う行を残し、テンプレの空の行や古い行を消します）。' },
  { code: 'A5', group: 'A', level: 'E', ci: 'run', title: '{file} の {names} の値に、記号（$、空白、引用符など）があります（シェルが値を書きかえるか、命令として実行します）', fix: "`openssl rand -hex 32` のような英数字だけの値にします。どうしても記号が要るときは、値を ' ' で囲みます。stack.env の `PILOT_ACCOUNT_IDS` のときは、空白を消し、User UID をカンマだけで区切ります（手順書 10.1）。" },
  { code: 'A6', group: 'A', level: 'W', ci: 'run', title: '知らない名前があります（打ちまちがいかもしれません）: {names}（{file}）', fix: '`{file}.example` とくらべて直すか、要らない行なら消します。' },
  // A7: W for a mode other than 600 or another owner; E when the file cannot be read at all (root-owned after `sudo cp`).
  { code: 'A7', group: 'A', level: 'dyn', ci: 'run', title: '{file} の権限が 600 でないか、持ち主がちがいます。', fix: '`chmod 600 {file}` を実行します。`Operation not permitted` と出たとき（sudo で作ったファイル）は、エージェントに相談します。' },
  { code: 'A8', group: 'A', level: 'E', ci: 'run', title: '{names} が、ちがうファイルに入っています（{file}）', fix: '`TUNNEL_TOKEN` は tunnel.env だけ、`STRIPE_`・`BILLING_` は billing.env だけに書きます。billing.env には、ほかに `AI_CAP_SUPPORTER_GLOBAL_` の名前だけを書けます。' },
  { code: 'A9', group: 'A', level: 'E', ci: 'run', title: '{file} の {line} 行目が読めません（「名前=値」の形ではありません）', fix: '`nano +{line} {file}` で開き、その行を直すか消します（値だけを貼った行かもしれません）。' },
  // A10: W; E when the unknown name is at most 2 letters (case aside) from a record key: a typo that drops a record
  // (`VERCEL_PROTECTON_OFF=<date>` would leave protection "on" for V1).
  { code: 'A10', group: 'A', level: 'dyn', ci: 'skip', title: 'launch-record.env に知らない名前があります（{names}）', fix: '手順書 14 章の表とくらべて直します。' },
  { code: 'A11', group: 'A', level: 'E', ci: 'skip', title: 'launch-record.env の {names} が読めません（日付は 2026-11-02 の形、段階は setup・pilot・minors・public）', fix: '手順書 14 章の書き方に直します。' },
  { code: 'A12', group: 'A', level: 'E', ci: 'skip', title: 'launch-record.env の {names} の日付が、今日より先です。', fix: '確かめをした日を書きます。' },
  // A13: W before the first green deploy and without tunnel; else E (finding 7).
  { code: 'A13', group: 'A', level: 'dyn', ci: 'skip', title: 'launch-record.env がありません。', fix: '`cp launch-record.env.example launch-record.env` を実行し、手順書のチェックの横に書いた日付を写します（手順書 14 章）。' },
  { code: 'A14', group: 'A', level: 'W', ci: 'run', title: '{file} の {names} の値に # があります（前に空白があると、そこから先が消えます）', fix: '英数字だけの値にします。' },
  // A15: the deploy record exists but the deploy user cannot read it (review round 3, finding 3); it still counts for A13.
  { code: 'A15', group: 'A', level: 'E', ci: 'skip', title: '最後に通ったデプロイの記録（.deploy/last-green.json）が読めません。', fix: '`ls -ld .deploy .deploy/last-green.json` を実行し、出た行をエージェントに見せます（sudo でデプロイしたあとなどに起こります）。' },
  // B. Required and exact values
  { code: 'B1', group: 'B', level: 'E', ci: 'run', title: 'まだテンプレの値か、空です（{names}）', fix: '`stack.env.example` のコメントと手順書 5.1 のとおりに作ります。`POSTGRES_PASSWORD` は最初の起動で固定されるので、いま決めます（`openssl rand -hex 24`）。' },
  { code: 'B2', group: 'B', level: 'E', ci: 'skip', title: '`ANTHROPIC_API_KEY` が空です（AI の機能が動きません）', fix: 'Anthropic のコンソールで、この VM 用の鍵を作って書きます（手順書 3.5）。' },
  { code: 'B3', group: 'B', level: 'E', ci: 'run', title: '本番の値ではありません（{names}）', fix: 'stack.env で `NODE_ENV=production`、`VITE_DEMO_MODE=false` にするか、その行を消します。' },
  { code: 'B4', group: 'B', level: 'E', ci: 'run', title: 'tunnel を使うのに、足りない値があります（{names}）', fix: '手順書 7.3〜7.4 のとおりに書くか、`COMPOSE_PROFILES` から tunnel を外します。' },
  { code: 'B5', group: 'B', level: 'E', ci: 'run', title: 'byoa に足りない値か、入れてはいけない値があります（{names}）', fix: '`doc/guides/byoa-setup.ja.md` のとおりに直すか、byoa を外します。' },
  { code: 'B6', group: 'B', level: 'E', ci: 'run', title: 'ポートの番号を変えています（{names}）', fix: 'stack.env のこの行を消します。' },
  { code: 'B7', group: 'B', level: 'W', ci: 'skip', title: '`COMPOSE_PROFILES` が stack.env にありません（再起動のとき、読み上げやトンネルが動かないことがあります）', fix: '`COMPOSE_PROFILES=tts`（手順書 7.4 のあとは `tts,tunnel`）を書きます。' },
  // C. Dangerous values (policy)
  { code: 'C1', group: 'C', level: 'E', ci: 'run', title: '`GEMINI_ALLOWED=true` になっています（18 歳未満が使うサービスでは Gemini を使いません）', fix: 'stack.env のこの行を消します。' },
  { code: 'C2', group: 'C', level: 'W', ci: 'run', title: 'Gemini の鍵が入っています: {names}（使われませんが、空にする決まりです）', fix: 'stack.env の、その値を空にします。' },
  { code: 'C3', group: 'C', level: 'E', ci: 'run', title: '`LLM_GUEST_AI=true` になっています（ログインしない人が、年齢の確かめなしで AI を使えます）', fix: 'stack.env のこの行を消します。' },
  { code: 'C4', group: 'C', level: 'E', ci: 'run', title: 'AI の行き先を、本番で使わない設定にしています（{names}）', fix: 'stack.env のこの行を消します。' },
  { code: 'C5', group: 'C', level: 'W', ci: 'run', title: '`ANTHROPIC_BASE_URL` が入っています（AI に送る文が、すべてそのアドレスに行きます）', fix: '決めた理由がなければ、stack.env のこの行を消します。' },
  { code: 'C6', group: 'C', level: 'E', ci: 'run', title: '学習者向けの VM で使わない設定があります（{names}）', fix: 'stack.env のこの行を消します。' },
  { code: 'C7', group: 'C', level: 'E', ci: 'run', title: '運用者用のセッションの値が入っています（{names}）', fix: 'stack.env のこの行を消します。' },
  { code: 'C8', group: 'C', level: 'E', ci: 'skip', title: 'デプロイの道具（Compose、Docker、git、シェル）の動きを変える名前があります: {names}（空の DB で動き出すか、ちがうプログラムが動くおそれがあります）', fix: 'stack.env のこの行を消します。' },
  { code: 'C9', group: 'C', level: 'E', ci: 'run', title: 'デプロイやテストの道具だけが使う名前があります（{names}）', fix: 'stack.env のこの行を消します（`RISEPATH_STRICT_AUTH` は `true` のときだけ書けます）。' },
  { code: 'C10', group: 'C', level: 'E', ci: 'run', title: '保存期間の設定が正しくありません: {names}（その削除が止まり、プライバシーポリシーの約束を守れません）', fix: 'stack.env のその行を消すか、`stack.env.example` の範囲の整数にします。' },
  // C11: E for TRUST_PROXY=true; W with tunnel and a value other than 1.
  { code: 'C11', group: 'C', level: 'dyn', ci: 'run', title: '`TRUST_PROXY` の値が正しくありません。', fix: '`true` は使いません。トンネルを使うときは `TRUST_PROXY=1` に、使わないときは stack.env のこの行を消します。' },
  { code: 'C12', group: 'C', level: 'W', ci: 'run', title: '`ORIGIN_SECRET_PREVIOUS` が残っています（取り替えが終わっていません）', fix: 'Vercel の値が新しくなったのを確かめてから、stack.env のこの行を消します（手順書 15 章）。' },
  { code: 'C13', group: 'C', level: 'W', ci: 'run', title: '使わない Hermes の値が、テンプレのまま入っています（{names}）', fix: 'stack.env の、その値を空にします。' },
  { code: 'C14', group: 'C', level: 'W', ci: 'run', title: '「ちょうど true」でないと動かない切り替えに、ちがう書き方があります: {names}（止まったままです）', fix: '使わないなら、その行（stack.env か billing.env）を消します。' },
  { code: 'C15', group: 'C', level: 'E', ci: 'run', title: '切り替えの値が読めません（{names}）', fix: '`true` か `false` にします。' },
  { code: 'C17', group: 'C', level: 'W', ci: 'run', title: '`RP_LESSON_FS_WRITE` が入っています。', fix: 'stack.env のこの行を消します。' },
  // D. Format and strength
  // D1: E, or W for another https host (a custom domain).
  { code: 'D1', group: 'D', level: 'dyn', ci: 'skip', title: '`SUPABASE_URL` が `https://<ref>.supabase.co` の形ではありません（{file}）', fix: 'Supabase の Project Settings → API の Project URL をそのまま書きます。' },
  { code: 'D2', group: 'D', level: 'E', ci: 'run', title: '`DATABASE_URL_PHASE1` が `POSTGRES_*` と合っていません（{names}）', fix: '`postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@db:5432/<POSTGRES_DB>` の形にします。' },
  { code: 'D3', group: 'D', level: 'E', ci: 'skip', title: '短すぎる値があります（{names}）', fix: '`openssl rand -hex 32` で作り直します（`POSTGRES_PASSWORD` は `-hex 24`。ただし最初の起動のあとの `POSTGRES_PASSWORD` は変えずに、エージェントに相談します）。' },
  { code: 'D4', group: 'D', level: 'E', ci: 'run', title: 'ちがう名前に、同じ値が入っています（{names}）', fix: 'それぞれ別に作ります。`POSTGRES_PASSWORD` は変えずに、ほかの名前の値を作り直します（最初の起動のあと DB のパスワードを変えるときは、エージェントに相談します）。' },
  { code: 'D6', group: 'D', level: 'E', ci: 'run', title: '`LLM_ALLOWED_ORIGINS` の書き方が正しくありません。', fix: '`https://app.<ドメイン>` の形にします。' },
  { code: 'D9', group: 'D', level: 'E', ci: 'run', title: '知らせの受け口が https ではありません: {names}（知らせが届きません）', fix: 'Slack の Incoming Webhook の URL（`https://hooks.slack.com/…`）を書きます。' },
  // E. Across files (E1-E4 read mcp-public.env and billing.env: deferred to the BYOA and billing enablement, TR4)
  { code: 'E5', group: 'E', level: 'E', ci: 'run', title: '`MEMANTO_SECRET_KEY` があるのに `MEMANTO_ENABLED=true` がありません。', fix: 'stack.env の `MEMANTO_SECRET_KEY` を空にします。' },
  // F. Profiles, host and checkout
  { code: 'F1', group: 'F', level: 'E', ci: 'run', title: '`COMPOSE_PROFILES` に知らない名前があります。', fix: '使えるのは tts・tunnel・byoa・memory です（最初の公開は tts と tunnel だけ）。' },
  { code: 'F3', group: 'F', level: 'W', ci: 'run', title: '使っていない機能のコンテナが動いたままです（{names}）', fix: '手順書 17 章の止め方で止めます。' },
  // F5: W, on a standalone run only.
  { code: 'F5', group: 'F', level: 'dyn', ci: 'skip', title: 'stack.env が、最後に通ったデプロイのあとで変わっています（再起動すると、確かめないまま使われます）', fix: '`./scripts/deploy-stack.sh` を実行します。' },
  // F6: E under 5 GB free, W under 10 GB.
  { code: 'F6', group: 'F', level: 'dyn', ci: 'run', title: 'ディスクの空きが少なくなっています（あと {gb} GB）', fix: '`docker system df` で大きいものを見て、エージェントに相談します。' },
  { code: 'F9', group: 'F', level: 'I', ci: 'run', title: '新しい DB です。`POSTGRES_PASSWORD` は、この最初の起動で固定されます。', fix: 'あとで `POSTGRES_PASSWORD` を変えないでください（変えるときは、エージェントに相談します）。' },
  { code: 'F11', group: 'F', level: 'E', ci: 'skip', title: 'このシェルの値が、デプロイに入ってしまいます（{names}）', fix: '表示された名前を `unset` で消してから（例: `unset LLM_GUEST_AI`）、もう一度デプロイします（使う値なら stack.env に書きます）。' },
  { code: 'F12', group: 'F', level: 'E', ci: 'skip', title: 'このシェルに、デプロイの道具（Compose、Docker）の動きを変える値があります（{names}。空の DB で動き出すか、ちがう Docker に入るおそれがあります）', fix: '表示された名前を `unset` で消してから（例: `unset COMPOSE_PROJECT_NAME`）、もう一度デプロイします（stack.env にも書きません）。' },
  // S. Optional services at the first launch (D3)
  { code: 'S1', group: 'S', level: 'E', ci: 'run', title: '`COMPOSE_PROFILES` に full（Hermes）があります（学習者には出さない決まりです）', fix: 'full を外します。' },
  { code: 'S2', group: 'S', level: 'E', ci: 'skip', title: 'AI アプリの接続（byoa）は、最初の公開では使いません。', fix: 'byoa を外します。使うと決めたら、`DECIDED_BYOA` に決めた日を書きます（手順書 12.3）。' },
  { code: 'S3', group: 'S', level: 'E', ci: 'skip', title: '学習の記憶（Memanto）は、最初の公開では使いません。', fix: '`COMPOSE_PROFILES` から memory を外し、stack.env の `MEMANTO_*` の行は `stack.env.example` のとおりにします（`MEMANTO_ENABLED=false`）。使うと決めたら、`DECIDED_MEMORY` に決めた日を書きます（手順書 12.3）。' },
  { code: 'S4', group: 'S', level: 'E', ci: 'skip', title: '有料プランは、最初の公開では止めておきます。', fix: 'billing.env の `BILLING_ENABLED` を空にし、本番の鍵（`_live_`）は入れません。使うと決めたら、`DECIDED_BILLING` に決めた日を書きます（手順書 12.3）。' },
  { code: 'S5', group: 'S', level: 'W', ci: 'skip', title: '読み上げ（tts）が `COMPOSE_PROFILES` にありません。', fix: 'tts を足します（最初の公開で使うと決めました）。' },
  { code: 'S6', group: 'S', level: '–/W/W/W', ci: 'skip', title: 'tunnel がないので、外から使えません。', fix: '手順書 7.4 のとおり `tts,tunnel` にします。' },
  // G, K, M, R, V. Order, stage and launch-record rules (all skip in CI mode)
  { code: 'G1', group: 'G', level: 'E', ci: 'skip', title: 'アカウントの削除を有効にする前の確かめが、記録にないか、順番がちがいます（{names}）', fix: 'Supabase の設定 → パスワードの変更の確かめ → 本番の amr の確かめ、の順に済ませて日付を書きます（手順書 11.2）。' },
  { code: 'G2', group: 'G', level: 'E', ci: 'skip', title: '同意の確かめ（`LEGAL_TERMS_REQUIRED`）を入れる前の記録がありません（{names}）', fix: '先に Vercel のフラグを入れて同意のページを確かめ、日付を書きます（手順書 12.3）。' },
  // G3: E at public, and at any stage once VERCEL_LEGAL_PAGES_ON is dated.
  { code: 'G3', group: 'G', level: 'dyn', ci: 'skip', title: '規約を公開するのに、ご本人の削除が止まっています。', fix: '手順書 11.2 を済ませ、`ACCOUNT_DELETION_ENABLED=true` にします。' },
  // G5: per key and stage (STAGE_REQUIRED).
  { code: 'G5', group: 'G', level: 'dyn', ci: 'skip', title: 'この段階に入る前の確かめが、記録にありません（{names}）', fix: '手順書 14 章の表でその確かめをして、日付を書きます。' },
  { code: 'K1', group: 'K', level: '–/W/E/E', ci: 'skip', title: '安全の知らせの受け口がありません。', fix: 'Slack の受け口の URL を stack.env の `AI_CAP_ALERT_WEBHOOK_URL` に書きます（手順書 3.6）。' },
  { code: 'K3', group: 'K', level: 'W', ci: 'skip', title: '知らせの受け口が Slack ではありません（{names}）', fix: 'Slack のチャンネルの Incoming Webhook にします。' },
  { code: 'K4', group: 'K', level: '–/W/E/E', ci: 'skip', title: '知らせを見る人と頻度が、記録にありません（{names}）', fix: 'launch-record.env に書きます（手順書 3.6）。' },
  { code: 'K5', group: 'K', level: '–/W/E/E', ci: 'skip', title: '試しの知らせが届いたことが、記録にありません。', fix: '手順書 9.4 のとおり試しの知らせを送り、届いたら launch-record.env の `ALERT_TEST` に日付を書きます。' },
  { code: 'M1', group: 'M', level: 'W/E/E/E', ci: 'skip', title: '開発用の Mac が本番の DB を使っていないことが、記録にありません。', fix: 'Mac の `.env.local` を開発用の DB にして、launch-record.env の `MAC_DEV_DB_SEPARATE` に日付を書きます（手順書 9.5）。' },
  { code: 'R1', group: 'R', level: 'W/E/E/E', ci: 'skip', title: '毎日の控え（バックアップ）が動いていません。', fix: '最初のデプロイのあとで、手順書 6.4 のとおりに入れます（最初のデプロイの前は、これで正しい状態です）。' },
  { code: 'R2', group: 'R', level: '–/W/W/W', ci: 'skip', title: '最後の控えが 36 時間より前か、失敗しています。', fix: '`sudo journalctl -u risepath-backup` を見て、エージェントに相談します（手順書 17 章）。' },
  // R3: setup not checked; pilot and minors E if never, W if older than 35 days; public E for both.
  { code: 'R3', group: 'R', level: 'dyn', ci: 'skip', title: '控えから戻す練習の記録がないか、35 日より前です。', fix: '`sudo ./scripts/restore-drill.sh` を実行します（手順書 16.1）。' },
  { code: 'R4', group: 'R', level: '–/E/E/E', ci: 'skip', title: '控えの鍵を VM の外にしまったことが、記録にないか、いまの鍵とちがいます（鍵がないと戻せません）', fix: '手順書 6.4 の鍵の手順をして、launch-record.env の `BACKUP_KEY_COPY` に日付を、`BACKUP_KEY_ID` に key id を書きます。' },
  { code: 'R5', group: 'R', level: '–/E/E/E', ci: 'skip', title: '控えを消す日数（バケットのライフサイクル）が、記録にありません。', fix: '手順書 3.8 のとおりに設定し、launch-record.env の `BACKUP_LIFECYCLE` に日付を書きます。' },
  { code: 'R6', group: 'R', level: '–/E/E/E', ci: 'skip', title: '控えが失敗したときの知らせの受け口がありません。', fix: 'stack.env の `AI_CAP_ALERT_WEBHOOK_URL` を書いてから、`sudo ./scripts/install-backup.sh` をもう一度実行します（手順書 6.4）。' },
  // R7 (the quarterly check-copy) was removed by the Scope guard (TR9b); its number stays unused. R8 (review round 1 of
  // Stage 5, finding 4): a restore that stopped before RS10 leaves both timers stopped but enabled, which R1 cannot see.
  { code: 'R8', group: 'R', level: 'W', ci: 'skip', title: '控えのタイマーが止まっています（入れてありますが、いまは動いていません）。', fix: '戻し（restore-db.sh）の途中でなければ、`sudo systemctl start risepath-backup.timer risepath-backup-journal.timer` で動かします。戻しの途中なら、エージェントと続きをします（手順書 16.2）。' },
  // R9 (review round 2 of Stage 5, finding 2): restore-db.sh's marker (/var/lib/risepath-backup/restore-in-progress) is
  // there: the database may be restored but not yet replayed, so a deploy must not serve it (E); the same restore command
  // run again calls the 事前チェック on its own at RS0, where it is only a warning.
  { code: 'R9', group: 'R', level: 'dyn', ci: 'skip', title: '本番の DB を戻している途中です（restore-db.sh が途中で止まっています）。', fix: 'デプロイはしません。エージェントと、同じ restore-db.sh のコマンドで続きをします（手順書 16.2）。' },
  // V1: setup W without tunnel, E with it; pilot and minors E; public not checked (V3). Passes with (a) a valid
  // pilot list in stack.env or (b) Vercel's protection still on (VERCEL_PROTECTION_ON dated, VERCEL_PROTECTION_OFF empty).
  { code: 'V1', group: 'V', level: 'dyn', ci: 'skip', title: '外から入れるのに、試験運用の参加者だけに絞れていません。', fix: 'Vercel の保護（All Deployments）をかけたままにする（launch-record.env の `VERCEL_PROTECTION_ON` に日付、`VERCEL_PROTECTION_OFF` は空。手順書 2.6）か、stack.env に試験運用の名簿 `PILOT_ACCOUNT_IDS` を入れます（手順書 10.1）。保護は、名簿を確かめてから外します（手順書 10.3）。' },
  // V2: an entry of the list that is not a UUID (the api ignores it; with no valid id it refuses everyone). {n}: its position.
  { code: 'V2', group: 'V', level: 'E', ci: 'skip', title: '試験運用の名簿 `PILOT_ACCOUNT_IDS` に、ID の形でないものがあります（{n} 個目）。', fix: 'Supabase の Authentication → Users の User UID（8-4-4-4-12 の形）だけを、空白を入れずにカンマで区切って書きます（手順書 10.1）。' },
  // V3 also holds the order rule VERCEL_PROTECTION_ON ≤ VERCEL_PROTECTION_OFF (design §2.4; below public, V1 refuses a dated OFF
  // unless the pilot list is valid).
  { code: 'V3', group: 'V', level: '–/–/–/E', ci: 'skip', title: '一般公開なのに、試験運用の名簿が残っているか、Vercel の保護を外した記録がないか、日付の順番がちがいます（{names}）', fix: '`PILOT_ACCOUNT_IDS` が出たときは、stack.env のその行を消します（手順書 11.8）。`VERCEL_PROTECTION_OFF` には、手順書 10.3 で保護を外した日を書きます（保護をかけた日と同じ日か、そのあとの日です）。' },
  // V4: the remote MCP (byoa) does not read the pilot list.
  { code: 'V4', group: 'V', level: 'E', ci: 'skip', title: 'AI アプリの接続（byoa）は、試験運用の名簿を確かめません（{names}）', fix: '名簿を使っているあいだは byoa を使いません。stack.env の `COMPOSE_PROFILES` から byoa を外し、launch-record.env の `DECIDED_BYOA` を空にします（手順書 12.3）。' },
]);

/**
 * Codes the check itself prints (preflight-vm.mjs and preflight.sh): it could not run. Exit 2, X0 3.
 * @type {readonly { code: string, title: string, fix: string }[]}
 */
export const INTERNAL_CODES = Object.freeze([
  { code: 'X0', title: '事前チェックの中でエラーが起きました（何も変えていません）。', fix: '出た行をそのままエージェントに見せます。' },
  { code: 'X1', title: '事前チェックを実行できません（Dockerfile に api の行がありません）', fix: '`git -C /opt/risepath status` を見て、エージェントに相談します。' },
  { code: 'X2', title: '事前チェックを実行できません（Docker で node のイメージを動かせません）', fix: 'VM に入り直して（SSH し直して）から、もう一度実行します。直らないときは、`docker info` で出た行をエージェントに見せます。' },
  { code: 'X3', title: 'CI モードは、CI の型のファイルでしか使えません。', fix: 'エージェントに相談します（VM では、いつも本番の決まりで確かめます）。' },
  { code: 'X4', title: '事前チェックへの指定が読めません（引数か、VM の情報）', fix: '`./scripts/preflight.sh` を、何も付けずに実行します。直らないときは、エージェントに相談します。' },
  { code: 'X5', title: '事前チェックは sudo なしで実行します（root では設定のファイルを読めず、リポジトリのファイルの持ち主も変わります）', fix: '`sudo` を付けずに、もう一度実行します。' },
]);

/** Every code a preflight script prints (runbook 13 章 has a row for each). */
export const ALL_CODES = Object.freeze([...RULES.map((r) => r.code), ...INTERNAL_CODES.map((x) => x.code)]);

const RULE_BY_CODE = new Map(RULES.map((r) => [r.code, r]));
const TEXT_BY_CODE = new Map([...RULES, ...INTERNAL_CODES].map((r) => [r.code, r]));

/**
 * The host facts preflight.sh collects (bash, outside the container; never an env value).
 * @typedef {{
 *   uid: number, gid: number, diskFreeKb: number, unitStack: string, unitBackupTimer: string,
 *   backupTimersActive: boolean, restoreInProgress: boolean, pgdataVolume: boolean, runningServices: string[], callerProfiles: string, callerExports: string[],
 *   backupKey: boolean, backupEnv: boolean, backupLastOk: string, backupLastFail: string, drillLastOk: string,
 *   backupKeyId: string, backupAlert: string, from: string
 * }} Facts
 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
/** @type {Record<keyof Facts, (v: unknown) => boolean>} */
const FACT_CHECKS = {
  uid: (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0,
  gid: (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0,
  diskFreeKb: (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0,
  unitStack: (v) => typeof v === 'string' && /^[a-z-]{0,32}$/.test(v),
  unitBackupTimer: (v) => typeof v === 'string' && /^[a-z-]{0,32}$/.test(v),
  backupTimersActive: (v) => typeof v === 'boolean',
  restoreInProgress: (v) => typeof v === 'boolean',
  pgdataVolume: (v) => typeof v === 'boolean',
  runningServices: (v) => Array.isArray(v) && v.length <= 64 && v.every((s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(s)),
  callerProfiles: (v) => typeof v === 'string' && /^[A-Za-z0-9._:+/ ,_-]{0,512}$/.test(v),
  callerExports: (v) => Array.isArray(v) && v.length <= 2000 && v.every((s) => typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s)),
  backupKey: (v) => typeof v === 'boolean',
  backupEnv: (v) => typeof v === 'boolean',
  backupLastOk: (v) => typeof v === 'string' && (v === '' || ISO_TIME.test(v)),
  backupLastFail: (v) => typeof v === 'string' && (v === '' || ISO_TIME.test(v)),
  drillLastOk: (v) => typeof v === 'string' && (v === '' || ISO_TIME.test(v)),
  backupKeyId: (v) => typeof v === 'string' && /^(?:[0-9a-f]{16})?$/.test(v),
  backupAlert: (v) => v === '' || v === 'true' || v === 'false',
  from: (v) => v === 'deploy' || v === 'standalone',
};
/** The facts' names, in the order preflight.sh writes them. */
export const FACT_KEYS = Object.freeze(/** @type {(keyof Facts)[]} */ (Object.keys(FACT_CHECKS)));

/**
 * Validates the facts JSON object (preflight-vm.mjs answers X4 when this is null): every key present
 * with its type, no other key.
 * @param {unknown} value
 * @returns {Facts | null}
 */
export function validateFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record);
  if (keys.length !== FACT_KEYS.length) return null;
  for (const key of keys) {
    const check = FACT_CHECKS[/** @type {keyof Facts} */ (key)];
    if (!check || !check(record[key])) return null;
  }
  return /** @type {Facts} */ (value);
}

// --- small readers -------------------------------------------------------------------------------

/** A value still holding a template placeholder (stack.env.example and its siblings). @param {string} v */
const isTemplate = (v) => /change-me|your-project|your-domain/i.test(v);
/** Set, non-empty and not a template. @param {string | undefined} v */
const isReal = (v) => typeof v === 'string' && v.trim() !== '' && !isTemplate(v);
/** True for a non-empty value. @param {string | undefined} v @returns {v is string} */
const isSet = (v) => typeof v === 'string' && v !== '';
/** deploy-stack.sh's Memanto test, exactly: set and not the template's value. @param {string | undefined} v */
const memantoReal = (v) => isSet(v) && v !== 'change-me-memanto-secret';
/**
 * The api's Memanto bridge as the server reads it (server/services/learnerMemoryBridge.js
 * isMemantoEnabled): off only for exactly `false`. Compose passes `${MEMANTO_ENABLED:-false}`, so an
 * empty or missing value is `false`; `1`, `TRUE`, `no` … leave the bridge on (S3).
 * @param {string | undefined} v
 */
const memantoBridgeOn = (v) => isSet(v) && v !== 'false';
/** The MEMANTO_API_URL Compose passes when stack.env leaves it empty (docker-compose.yml). */
const MEMANTO_DEFAULT_URL = 'http://memanto:8000';
/** A provider spec as server/llm/models.config.js parseProviderSpec reads it: the part before `:`, trimmed, lower case. @param {string} v */
const providerOf = (v) => v.trim().split(':')[0].trim().toLowerCase();

/**
 * C8: names that change the deploy's own tools. deploy-stack.sh runs `set -a; source stack.env`, so
 * every name reaches git, docker and its own re-run (`exec "${BASH}"`): the Compose project and files,
 * the Docker daemon and its config (DOCKER_*), git's commands (GIT_*), the shell (PATH, IFS, ENV,
 * BASH, BASH_*), the loader (LD_*), HOME (Docker's and git's config), bash's read-only variables
 * (sourcing stops on them) and the variables deploy-stack.sh sets before it sources the file.
 */
const DEPLOY_TOOL_NAMES = new Set([
  'COMPOSE_PROJECT_NAME', 'COMPOSE_FILE', 'PATH', 'IFS', 'ENV', 'HOME', 'BASH', 'BASHOPTS', 'SHELLOPTS', 'UID', 'EUID',
  'PPID', 'SCRIPT_DIR', 'STACK_DIR', 'REPO_ROOT',
]);
const DEPLOY_TOOL_PREFIX = /^(?:DOCKER_|COMPOSE_(?!PROFILES$)|BASH_|LD_|GIT_)/;
/** A name C8 refuses in stack.env. @param {string} name */
export const isDeployToolName = (name) => DEPLOY_TOOL_NAMES.has(name) || DEPLOY_TOOL_PREFIX.test(name);
/**
 * F12: the names among the deploy shell's exports that choose Compose's project and files or Docker's daemon
 * (review round 1 of Stage 2, finding 4). A stray `COMPOSE_PROJECT_NAME` deploys onto a new, empty pgdata
 * volume, `DOCKER_HOST` or `DOCKER_CONTEXT` onto another daemon; the host facts and F9 describe project
 * risepath on this daemon, so nothing else would notice. COMPOSE_PROFILES is the caller's list (F1, B7, the
 * effective profiles). GIT_* stays the caller's own: it can only change how the pull reaches the repository
 * (GIT_SSH_COMMAND), not where the stack runs, and C8 still refuses it in stack.env. PATH, HOME and the
 * other names of C8 are in every shell.
 */
const CALLER_TOOL_PREFIX = /^(?:DOCKER_|COMPOSE_(?!PROFILES$))/;

/** Names billing.env may hold (billing.env.example): the api reads it after stack.env, so any other name would override stack.env there (A8). */
const BILLING_FILE_KEY = /^(?:STRIPE_|BILLING_|AI_CAP_SUPPORTER_GLOBAL_[A-Z0-9_]+$)/;

/** server/utils/envSwitch.js readEnvSwitch, copied (the import fence forbids the import; T6 pins it). */
const SWITCH_ON = new Set(['true', '1', 'on', 'yes']);
const SWITCH_OFF = new Set(['', 'false', '0', 'off', 'no']);
/** @param {string | undefined} raw */
export function readSwitch(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (SWITCH_ON.has(value)) return { on: true, recognised: true };
  return { on: false, recognised: SWITCH_OFF.has(value) };
}

/** server/services/retention.js RETENTION_RULES (ranges), copied and pinned by T6. */
export const RETENTION_RANGES = Object.freeze({
  RETENTION_AI_USAGE_DAYS: [2, 400],
  RETENTION_PROCESSING_DAYS: [30, 3650],
  RETENTION_DELETION_PROOF_YEARS: [1, 10],
  RETENTION_AI_APP_RECORD_YEARS: [1, 10],
});

/** A real calendar date written YYYY-MM-DD. @param {string} v */
export function isCalendarDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** @param {string} v */
function httpsUrl(v) {
  try {
    const url = new URL(v);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The profiles the deploy passes to Compose (deploy-stack.sh): stack.env's COMPOSE_PROFILES when the
 * key is present, even empty (sourcing it overrides the caller's), else the caller's; plus memory when
 * MEMANTO_SECRET_KEY is set and not the template's. Spaces are dropped, as deploy-stack.sh's tests do.
 * @param {{ stackEnv: Map<string, string>, callerProfiles: string }} input
 * @returns {string[]}
 */
export function effectiveProfiles({ stackEnv, callerProfiles }) {
  const raw = stackEnv.has('COMPOSE_PROFILES') ? stackEnv.get('COMPOSE_PROFILES') ?? '' : callerProfiles;
  const list = raw.replace(/ /g, '').split(',').filter(Boolean);
  if (memantoReal(stackEnv.get('MEMANTO_SECRET_KEY')) && !list.includes('memory')) list.push('memory');
  return list;
}

/**
 * The record's values as the owner wrote them: everything after the first `=`, trimmed, with one pair
 * of surrounding quotes removed (the last line of a name wins, as in parseEnvText). The record is never
 * sourced, so a space does not end a value here: the text keys (`ALERT_WATCHER=事務局の当番（2 人）`)
 * are measured whole (A11's 80 characters, K4), and the dates and the key id are read the same way
 * (review round 2, finding 1): the shell-style parser reads `VERCEL_PROTECTION_OFF= 2026-11-05` as
 * empty, which V1 would take for "protection still on". LAUNCH_STAGE alone is read shell-style
 * (resolveStage), and any stage that reading cannot take, or has to guess at, is A11. A name written twice
 * is A4, an error for the 18 record keys (review round 3, finding 1).
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function recordValuesAsWritten(text) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const raw of text.split('\n')) {
    const m = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(raw.replace(/\r$/, ''));
    if (!m) continue;
    let value = m[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) value = value.slice(1, -1);
    map.set(m[1], value);
  }
  return map;
}

/**
 * Problems that make the parser guess at a stage line (its first word of `setup → pilot`, `setup pilot`,
 * `pilot;`, the rest of `"pilot`): such a stage is unreadable (A11), never its first word (review round 3,
 * finding 4). A `# memo` after the stage is fine, after a space or a tab (the record is never read by
 * Compose, so the `comment` kind does not matter here); CRLF is A3 for the whole file.
 */
/** @type {ReadonlySet<ProblemKind>} */
const STAGE_GUESS_KINDS = new Set(ERROR_KINDS.filter((kind) => kind !== 'crlf' && kind !== 'comment'));

/**
 * The stage the record says, or setup when the record is missing (A13), cannot be read by the deploy
 * user (A7) or its stage is unreadable (A11).
 * @param {string | undefined} recordText
 * @param {boolean} [fileUnreadable] the record exists but the deploy user cannot read it
 * @returns {{ stage: Stage, source: 'record' | 'missing' | 'file-unreadable' | 'unreadable' }}
 */
export function resolveStage(recordText, fileUnreadable = false) {
  if (recordText === undefined) return { stage: 'setup', source: fileUnreadable ? 'file-unreadable' : 'missing' };
  const parsed = parseEnvText(recordText);
  const entry = parsed.entries.filter((e) => e.key === 'LAUNCH_STAGE').at(-1);
  const guessed = entry !== undefined && parsed.problems.some((p) => p.line === entry.line && STAGE_GUESS_KINDS.has(p.kind));
  const stage = guessed ? undefined : STAGES.find((s) => s === entry?.value);
  return stage ? { stage, source: 'record' } : { stage: 'setup', source: 'unreadable' };
}

/**
 * CI mode's check of the file itself (preflight-vm.mjs answers X3 otherwise): besides being byte for byte
 * ci/stack.ci.env, the stack.env must carry the CI template's own dummy markers, so a template edited in
 * the checkout to equal a real stack.env cannot open CI mode. First line `# risepath-ci-env:`, no parser
 * problem, the CI project, Supabase at the auth stand-in with a `ci-dummy-` key, no model key, no secret
 * for the edge or Memanto, no profile: nothing real could run on it.
 * @param {string} text
 */
export function isCiDummyStack(text) {
  if (!text.startsWith('# risepath-ci-env:')) return false;
  const parsed = parseEnvText(text);
  if (parsed.problems.length > 0) return false;
  const env = entryMap(parsed.entries);
  const empty = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'HERMES_API_KEY', 'ORIGIN_SECRET', 'MEMANTO_SECRET_KEY', 'COMPOSE_PROFILES', 'TUNNEL_TOKEN'];
  return env.get('COMPOSE_PROJECT_NAME') === 'risepath-ci'
    && /^http:\/\/auth-stand-in(?::\d{1,5})?$/.test(env.get('SUPABASE_URL') ?? '')
    && /^ci-dummy-/.test(env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    && empty.every((k) => (env.get(k) ?? '') === '');
}

/**
 * The level of a fixed-level rule at a stage, or null when it is not checked there.
 * @param {string} code
 * @param {Stage} stage
 * @returns {Level | null}
 */
export function levelAt(code, stage) {
  const rule = RULE_BY_CODE.get(code);
  if (!rule || rule.level === 'dyn') return null;
  const parts = rule.level.split('/');
  const part = parts.length === 1 ? parts[0] : parts[STAGES.indexOf(stage)];
  return part === 'E' || part === 'W' || part === 'I' ? part : null;
}

// --- the check ---------------------------------------------------------------------------------

/**
 * @typedef {{ code: string, level: Level, file?: string, names?: string[], line?: number, gb?: number, n?: number }} Finding
 * @typedef {{
 *   mode: Mode,
 *   files: Partial<Record<string, string>>,
 *   stats?: Partial<Record<string, { mode: number, uid: number }>>,
 *   unreadable?: string[],
 *   facts: Facts,
 *   lastGreen?: { stackEnvSha256?: string } | null,
 *   stackEnvSha256?: string,
 *   now?: Date,
 * }} CheckInput
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Runs every rule that applies to the mode and the recorded stage.
 * @param {CheckInput} input
 * @returns {Finding[]}
 */
export function checkStack(input) {
  const { mode, facts } = input;
  const now = input.now ?? new Date();
  const ci = mode === 'ci';
  /** @type {Finding[]} */
  const findings = [];
  // Files that exist but the deploy user cannot read (root-owned after `sudo cp`): A7 as an error.
  const unreadable = FILE_NAMES.filter((name) => input.unreadable?.includes(name));
  if (input.files['stack.env'] === undefined) {
    return unreadable.includes('stack.env') ? unreadable.map((file) => ({ code: 'A7', level: 'E', file })) : [{ code: 'A1', level: 'E' }];
  }

  /** @type {Map<string, ParsedEnv>} */
  const parsed = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const maps = new Map();
  for (const name of FILE_NAMES) {
    const text = input.files[name];
    if (text === undefined) continue;
    const p = parseEnvText(text);
    parsed.set(name, p);
    maps.set(name, entryMap(p.entries));
  }
  const env = maps.get('stack.env') ?? new Map();
  const tunnel = maps.get('tunnel.env');
  const mcp = maps.get('mcp-public.env');
  const billing = maps.get('billing.env');
  // One reading of the stage for every rule and for A11 (an unreadable stage is never a silent setup).
  const stageInfo = resolveStage(input.files[RECORD_FILE], unreadable.includes(RECORD_FILE));
  const { stage } = stageInfo;
  const stageIndex = STAGES.indexOf(stage);
  const profiles = effectiveProfiles({ stackEnv: env, callerProfiles: facts.callerProfiles });
  const listed = (/** @type {string} */ p) => profiles.includes(p);
  // A deploy record the deploy user cannot read (A15) still says that a green deploy happened (A13 E).
  const deployRecordUnreadable = input.unreadable?.includes(DEPLOY_RECORD) === true;
  const lastGreenPresent = (input.lastGreen !== undefined && input.lastGreen !== null) || deployRecordUnreadable;

  /** Runs a rule's body when the mode and stage call for it; the body gets the stage level. */
  const rule = (/** @type {string} */ code, /** @type {(level: Level | null) => void} */ body) => {
    const r = RULE_BY_CODE.get(code);
    if (!r) throw new Error('unknown rule');
    if (ci && r.ci === 'skip') return;
    const level = levelAt(code, stage);
    if (r.level !== 'dyn' && level === null) return;
    body(level);
  };
  const add = (/** @type {Finding} */ f) => findings.push(f);
  /** @param {string[]} names */
  const uniq = (names) => [...new Set(names)];

  // Every record value as written (recordValuesAsWritten; finding 1 of review round 2: never the shell-style
  // reading, which turns `KEY= 2026-11-05` into an empty value). A date counts once it is a calendar date.
  const recordWritten = recordValuesAsWritten(input.files[RECORD_FILE] ?? '');
  const rec = (/** @type {string} */ key) => (recordWritten.get(key) ?? '').trim();
  const dated = (/** @type {string} */ key) => isCalendarDate(rec(key));
  // The text keys, whole: at most 80 characters, no control character.
  const recText = (/** @type {string} */ key) => recordWritten.get(key) ?? '';
  const textOk = (/** @type {string} */ v) => v.length <= 80 && !/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(v);
  const textSet = (/** @type {string} */ key) => {
    const v = recText(key);
    return v !== '' && textOk(v);
  };

  // A. Files and parsing ------------------------------------------------------------------------
  for (const file of unreadable) rule('A7', () => add({ code: 'A7', level: 'E', file }));
  for (const file of ENV_FILES) {
    const p = parsed.get(file);
    if (!p) continue;
    const text = input.files[file] ?? '';
    rule('A2', (level) => {
      const values = [...(maps.get(file)?.values() ?? [])];
      if (text.startsWith('# risepath-ci-env:') || values.some((v) => /^ci-(?:dummy|leak-sentinel)-/.test(v) || /:\/\/(?:[^@/\s]*@)?auth-stand-in(?:[:/]|$)/.test(v))) {
        add({ code: 'A2', level: level ?? 'E', file });
      }
    });
    rule('A3', (level) => {
      if (p.problems.some((x) => x.kind === 'crlf')) add({ code: 'A3', level: level ?? 'E', file });
    });
    rule('A4', (level) => {
      const names = uniq(p.problems.filter((x) => x.kind === 'duplicate' && x.key).map((x) => /** @type {string} */ (x.key)));
      if (names.length) add({ code: 'A4', level: level ?? 'W', file, names });
    });
    rule('A5', (level) => {
      const names = uniq(p.problems.filter((x) => x.key && x.kind !== 'crlf' && x.kind !== 'not-assignment' && ERROR_KINDS.includes(x.kind)).map((x) => /** @type {string} */ (x.key)));
      if (names.length) add({ code: 'A5', level: level ?? 'E', file, names });
    });
    rule('A7', (level) => {
      const st = input.stats?.[file];
      if (st && ((st.mode & 0o777) !== 0o600 || st.uid !== facts.uid)) add({ code: 'A7', level: 'W', file });
    });
    rule('A8', (level) => {
      const keys = [...(maps.get(file)?.keys() ?? [])];
      const names = keys.filter((k) => (k === 'TUNNEL_TOKEN' && file !== 'tunnel.env') || (/^(?:STRIPE|BILLING)_/.test(k) && file !== 'billing.env')
        || (file === 'billing.env' && !BILLING_FILE_KEY.test(k)));
      if (names.length) add({ code: 'A8', level: level ?? 'E', file, names });
    });
    rule('A9', (level) => {
      for (const x of p.problems) if (x.kind === 'not-assignment') add({ code: 'A9', level: level ?? 'E', file, line: x.line });
    });
    rule('A14', (level) => {
      const names = uniq(p.problems.filter((x) => x.kind === 'hash' && x.key).map((x) => /** @type {string} */ (x.key)));
      if (names.length) add({ code: 'A14', level: level ?? 'W', file, names });
    });
  }
  // The record is read by the engine only (never sourced): line form and dates, not shell syntax.
  const recordParsed = parsed.get(RECORD_FILE);
  if (recordParsed) {
    rule('A3', (level) => {
      if (recordParsed.problems.some((x) => x.kind === 'crlf')) add({ code: 'A3', level: level ?? 'E', file: RECORD_FILE });
    });
    rule('A9', (level) => {
      for (const x of recordParsed.problems) if (x.kind === 'not-assignment') add({ code: 'A9', level: level ?? 'E', file: RECORD_FILE, line: x.line });
    });
    // The last line of a name wins: a template's empty `VERCEL_PROTECTION_OFF=` under a dated line would read as
    // "protection on" (V1), a `LAUNCH_STAGE=setup` under `pilot` as setup. So a record key written twice stops the
    // deploy (review round 3, finding 1); any other name twice is a warning (A10 names it too).
    rule('A4', () => {
      const names = uniq(recordParsed.problems.filter((x) => x.kind === 'duplicate' && x.key).map((x) => /** @type {string} */ (x.key)));
      if (names.length) add({ code: 'A4', level: names.some((k) => ATTESTATION_KEYS.has(k)) ? 'E' : 'W', file: RECORD_FILE, names });
    });
    rule('A10', () => {
      const names = uniq(recordParsed.entries.map((e) => e.key).filter((k) => !ATTESTATION_KEYS.has(k)));
      if (names.length) add({ code: 'A10', level: names.some(isRecordKeyTypo) ? 'E' : 'W', names });
    });
    const latest = new Date(now.getTime() + DAY).toISOString().slice(0, 10);
    rule('A11', (level) => {
      /** @type {string[]} */
      const names = [];
      for (const a of ATTESTATIONS) {
        const v = a.kind === 'text' ? recText(a.key) : rec(a.key);
        if (a.kind === 'stage' && stageInfo.source !== 'record') names.push(a.key);
        else if (v === '') continue;
        else if (a.kind === 'date' && !isCalendarDate(v)) names.push(a.key);
        else if (a.kind === 'keyid' && !/^[0-9a-f]{16}$/.test(v)) names.push(a.key);
        else if (a.kind === 'text' && !textOk(v)) names.push(a.key);
      }
      if (names.length) add({ code: 'A11', level: level ?? 'E', names });
    });
    rule('A12', (level) => {
      const names = ATTESTATIONS.filter((a) => a.kind === 'date' && dated(a.key) && rec(a.key) > latest).map((a) => a.key);
      if (names.length) add({ code: 'A12', level: level ?? 'E', names });
    });
  } else if (!unreadable.includes(RECORD_FILE)) {
    rule('A13', () => add({ code: 'A13', level: !lastGreenPresent && !listed('tunnel') ? 'W' : 'E' }));
  }
  rule('A15', (level) => {
    if (deployRecordUnreadable) add({ code: 'A15', level: level ?? 'E' });
  });

  // B. Required and exact values ----------------------------------------------------------------
  rule('B1', (level) => {
    const names = ['POSTGRES_PASSWORD', 'DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RISE_PATH_BRIDGE_TOKEN'].filter((k) => !isReal(env.get(k)));
    if (names.length) add({ code: 'B1', level: level ?? 'E', names });
  });
  rule('B2', (level) => {
    if (!isReal(env.get('ANTHROPIC_API_KEY'))) add({ code: 'B2', level: level ?? 'E' });
  });
  rule('B3', (level) => {
    const names = [];
    if (isSet(env.get('NODE_ENV')) && env.get('NODE_ENV') !== 'production') names.push('NODE_ENV');
    if (isSet(env.get('VITE_DEMO_MODE')) && env.get('VITE_DEMO_MODE') !== 'false') names.push('VITE_DEMO_MODE');
    if (names.length) add({ code: 'B3', level: level ?? 'E', names });
  });
  rule('B4', (level) => {
    if (!listed('tunnel')) return;
    const names = [];
    if (!isSet(tunnel?.get('TUNNEL_TOKEN'))) names.push('TUNNEL_TOKEN');
    const origin = env.get('ORIGIN_SECRET') ?? '';
    if (origin.length < 32 || origin.startsWith('$') || isTemplate(origin)) names.push('ORIGIN_SECRET');
    if (!isSet(env.get('LLM_ALLOWED_ORIGINS'))) names.push('LLM_ALLOWED_ORIGINS');
    if (isSet(env.get('RISE_PATH_PUBLIC_URL'))) names.push('RISE_PATH_PUBLIC_URL');
    if (names.length) add({ code: 'B4', level: level ?? 'E', names });
  });
  rule('B5', (level) => {
    if (!listed('byoa')) return;
    const names = [];
    if (!listed('tunnel')) names.push('COMPOSE_PROFILES');
    const required = ['DATABASE_URL_PHASE1', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'MCP_PUBLIC_RESOURCE_URL'];
    if (!mcp) {
      names.push(...required);
    } else {
      names.push(...required.filter((k) => !isReal(mcp.get(k))));
      if (isTemplate(mcp.get('APP_PUBLIC_URL') ?? '')) names.push('APP_PUBLIC_URL');
      const forbidden = /^(?:RISE_PATH_BRIDGE_TOKEN|SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|GEMINI_|OPENROUTER_API_KEY|HERMES_|MEMANTO_|ORIGIN_SECRET|RISE_PATH_ACTIVE_SESSION_KEY|TUNNEL_TOKEN|POSTGRES_PASSWORD)/;
      names.push(...[...mcp.keys()].filter((k) => forbidden.test(k)));
      if (/^[A-Za-z]+:\/\/risepath_app[:@]/.test(mcp.get('DATABASE_URL_PHASE1') ?? '')) names.push('DATABASE_URL_PHASE1');
    }
    if (names.length) add({ code: 'B5', level: level ?? 'E', names: uniq(names) });
  });
  rule('B6', (level) => {
    const expected = { PORT: '3006', MCP_SSE_PORT: '3100', API_SERVER_PORT: '8642' };
    const names = Object.entries(expected).filter(([k, v]) => isSet(env.get(k)) && env.get(k) !== v).map(([k]) => k);
    if (names.length) add({ code: 'B6', level: level ?? 'E', names });
  });
  rule('B7', (level) => {
    if (!env.has('COMPOSE_PROFILES')) add({ code: 'B7', level: level ?? 'W' });
  });

  // C. Dangerous values ------------------------------------------------------------------------
  rule('C1', (level) => {
    if (env.get('GEMINI_ALLOWED') === 'true') add({ code: 'C1', level: level ?? 'E' });
  });
  rule('C2', (level) => {
    const names = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].filter((k) => isSet(env.get(k)));
    if (names.length) add({ code: 'C2', level: level ?? 'W', names });
  });
  rule('C3', (level) => {
    if (env.get('LLM_GUEST_AI') === 'true') add({ code: 'C3', level: level ?? 'E' });
  });
  rule('C4', (level) => {
    const names = [];
    const provider = env.get('LLM_PROVIDER') ?? '';
    if (provider.trim() !== '' && providerOf(provider) !== 'anthropic') names.push('LLM_PROVIDER');
    if (env.get('LLM_MOCK_FALLBACK') === 'true') names.push('LLM_MOCK_FALLBACK');
    for (const [k, v] of env) if (/^LLM_TASK_/.test(k) && v.trim() !== '' && providerOf(v) !== 'anthropic') names.push(k);
    if (names.length) add({ code: 'C4', level: level ?? 'E', names });
  });
  rule('C5', (level) => {
    if (isSet(env.get('ANTHROPIC_BASE_URL'))) add({ code: 'C5', level: level ?? 'W' });
  });
  rule('C6', (level) => {
    const names = ['AI_ACCESS_DEV_AUDIENCE', 'TRAINING_ENABLED', 'VITE_FEATURE_AGENT_CHAT'].filter((k) => isSet(env.get(k)));
    if (names.length) add({ code: 'C6', level: level ?? 'E', names });
  });
  rule('C7', (level) => {
    const names = ['RISE_PATH_ACTIVE_SESSION_KEY', 'HERMES_ACTIVE_SESSION_KEY', 'X_HERMES_SESSION_KEY'].filter((k) => isSet(env.get(k)));
    if (names.length) add({ code: 'C7', level: level ?? 'E', names });
  });
  rule('C8', (level) => {
    const names = [...env.keys()].filter(isDeployToolName);
    if (names.length) add({ code: 'C8', level: level ?? 'E', names });
  });
  rule('C9', (level) => {
    const names = [...env.keys()].filter((k) => (/^RISEPATH_/.test(k) && !(k === 'RISEPATH_STRICT_AUTH' && env.get(k) === 'true')) || /^E2E_/.test(k) || k === 'SMOKE_TARGET');
    if (names.length) add({ code: 'C9', level: level ?? 'E', names });
  });
  rule('C10', (level) => {
    const names = [];
    if (env.has('RETENTION_ENABLED') && !['', ...SWITCH_ON].includes((env.get('RETENTION_ENABLED') ?? '').trim().toLowerCase())) names.push('RETENTION_ENABLED');
    for (const [k, [min, max]] of Object.entries(RETENTION_RANGES)) {
      const v = (env.get(k) ?? '').trim();
      if (v === '') continue;
      const n = /^[0-9]{1,6}$/.test(v) ? Number(v) : Number.NaN;
      if (!(n >= min && n <= max)) names.push(k);
    }
    if (names.length) add({ code: 'C10', level: level ?? 'E', names });
  });
  rule('C11', () => {
    const v = env.get('TRUST_PROXY');
    if ((v ?? '').trim().toLowerCase() === 'true') add({ code: 'C11', level: 'E' });
    else if (listed('tunnel') && v !== '1') add({ code: 'C11', level: 'W' });
  });
  rule('C12', (level) => {
    if (isSet(env.get('ORIGIN_SECRET_PREVIOUS'))) add({ code: 'C12', level: level ?? 'W' });
  });
  rule('C13', (level) => {
    if (listed('full')) return;
    const names = ['HERMES_API_KEY', 'OPENROUTER_API_KEY'].filter((k) => isSet(env.get(k)) && /change-me/i.test(env.get(k) ?? ''));
    if (names.length) add({ code: 'C13', level: level ?? 'W', names });
  });
  rule('C14', (level) => {
    // Not MEMANTO_ENABLED: the server reads it the other way round (anything but `false` is on; S3).
    const switches = ['TRAINING_ENABLED', 'LLM_GUEST_AI', 'GEMINI_ALLOWED', 'VITE_FEATURE_AGENT_CHAT', 'BILLING_ENABLED', 'BILLING_LIVE'];
    const names = switches.filter((k) => {
      const v = env.get(k) ?? billing?.get(k);
      return v !== undefined && v !== 'true' && SWITCH_ON.has(v.trim().toLowerCase());
    });
    if (names.length) add({ code: 'C14', level: level ?? 'W', names });
  });
  rule('C15', (level) => {
    const names = ['ACCOUNT_DELETION_ENABLED', 'LEGAL_TERMS_REQUIRED'].filter((k) => env.has(k) && !readSwitch(env.get(k)).recognised);
    if (names.length) add({ code: 'C15', level: level ?? 'E', names });
  });
  rule('C17', (level) => {
    if (isSet(env.get('RP_LESSON_FS_WRITE'))) add({ code: 'C17', level: level ?? 'W' });
  });

  // D. Format and strength ---------------------------------------------------------------------
  rule('D1', () => {
    for (const [file, map] of /** @type {[string, Map<string, string> | undefined][]} */ ([['stack.env', env], ['mcp-public.env', mcp]])) {
      const v = map?.get('SUPABASE_URL') ?? '';
      if (!isReal(v) || /^https:\/\/[a-z0-9]{8,40}\.supabase\.co$/.test(v)) continue;
      add({ code: 'D1', level: httpsUrl(v) && !/\.supabase\.co$/i.test(httpsUrl(v)?.hostname ?? '') ? 'W' : 'E', file });
    }
  });
  rule('D2', (level) => {
    const v = env.get('DATABASE_URL_PHASE1') ?? '';
    if (!isReal(v)) return;
    /** @type {URL | null} */
    let url = null;
    try {
      url = new URL(v);
    } catch {
      url = null;
    }
    /** @type {string[]} */
    const names = [];
    if (!url || !/^postgres(?:ql)?:$/.test(url.protocol)) {
      names.push('DATABASE_URL_PHASE1');
    } else {
      let password = '';
      try {
        password = decodeURIComponent(url.password);
      } catch {
        password = url.password;
      }
      let user = '';
      try {
        user = decodeURIComponent(url.username);
      } catch {
        // A `%` typo in the user part: compared as written, so D2 names it instead of an exception (X0).
        user = url.username;
      }
      if (user !== (env.get('POSTGRES_USER') ?? '')) names.push('POSTGRES_USER');
      if (password !== (env.get('POSTGRES_PASSWORD') ?? '')) names.push('POSTGRES_PASSWORD');
      if (url.pathname.replace(/^\//, '') !== (env.get('POSTGRES_DB') ?? '')) names.push('POSTGRES_DB');
      if (url.hostname !== 'db' || (url.port !== '' && url.port !== '5432')) names.push('DATABASE_URL_PHASE1');
      if (names.length && !names.includes('DATABASE_URL_PHASE1')) names.unshift('DATABASE_URL_PHASE1');
    }
    if (names.length) add({ code: 'D2', level: level ?? 'E', names });
  });
  rule('D3', (level) => {
    /** @type {[string, number][]} */
    const minimum = [['POSTGRES_PASSWORD', 24], ['RISE_PATH_BRIDGE_TOKEN', 32], ['ORIGIN_SECRET', 32], ['MEMANTO_SECRET_KEY', 32]];
    const names = minimum.filter(([k, n]) => {
      const v = env.get(k);
      if (!isReal(v)) return false;
      if (k === 'MEMANTO_SECRET_KEY' && !memantoReal(v)) return false;
      return /** @type {string} */ (v).length < n;
    }).map(([k]) => k);
    if (names.length) add({ code: 'D3', level: level ?? 'E', names });
  });
  rule('D4', (level) => {
    const list = ['POSTGRES_PASSWORD', 'RISE_PATH_BRIDGE_TOKEN', 'ORIGIN_SECRET', 'ORIGIN_SECRET_PREVIOUS', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'MEMANTO_SECRET_KEY', 'HERMES_API_KEY', 'OPENROUTER_API_KEY'];
    /** @type {Map<string, string[]>} */
    const byValue = new Map();
    for (const k of list) {
      const v = env.get(k);
      if (!isReal(v)) continue;
      byValue.set(/** @type {string} */ (v), [...(byValue.get(/** @type {string} */ (v)) ?? []), k]);
    }
    const names = [...byValue.values()].filter((group) => group.length > 1).flat();
    if (names.length) add({ code: 'D4', level: level ?? 'E', names });
  });
  rule('D6', (level) => {
    const entries = (env.get('LLM_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const bad = entries.some((entry) => {
      const url = httpsUrl(entry);
      if (!url || url.origin !== entry) return true;
      return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i.test(url.hostname);
    });
    if (bad) add({ code: 'D6', level: level ?? 'E' });
  });
  rule('D9', (level) => {
    const names = ['SAFETY_ALERT_WEBHOOK_URL', 'AI_CAP_ALERT_WEBHOOK_URL'].filter((k) => isSet(env.get(k)) && !httpsUrl(env.get(k) ?? ''));
    if (names.length) add({ code: 'D9', level: level ?? 'E', names });
  });

  // E. Across files ------------------------------------------------------------------------------
  rule('E5', (level) => {
    if (memantoReal(env.get('MEMANTO_SECRET_KEY')) && env.get('MEMANTO_ENABLED') !== 'true') add({ code: 'E5', level: level ?? 'E' });
  });

  // F. Profiles, host and checkout -----------------------------------------------------------------
  rule('F1', (level) => {
    if (profiles.some((p) => !PROFILE_NAMES.includes(p))) add({ code: 'F1', level: level ?? 'E', names: ['COMPOSE_PROFILES'] });
  });
  rule('F3', (level) => {
    const names = uniq(facts.runningServices.filter((s) => {
      const of = SERVICE_PROFILES[s];
      return of !== undefined && of.length > 0 && !of.some((p) => listed(p));
    }));
    if (names.length) add({ code: 'F3', level: level ?? 'W', names });
  });
  rule('F5', () => {
    const recorded = input.lastGreen?.stackEnvSha256;
    if (facts.from === 'standalone' && typeof recorded === 'string' && recorded !== input.stackEnvSha256 && facts.unitStack === 'enabled') {
      add({ code: 'F5', level: 'W' });
    }
  });
  rule('F6', () => {
    const gb = Math.floor(facts.diskFreeKb / (1024 * 1024));
    if (facts.diskFreeKb < 5 * 1024 * 1024) add({ code: 'F6', level: 'E', gb });
    else if (facts.diskFreeKb < 10 * 1024 * 1024) add({ code: 'F6', level: 'W', gb });
  });
  rule('F9', (level) => {
    if (!facts.pgdataVolume) add({ code: 'F9', level: level ?? 'I' });
  });
  rule('F11', (level) => {
    const names = facts.callerExports.filter((k) => COMPOSE_INTERPOLATED.includes(k) && !env.has(k));
    if (names.length) add({ code: 'F11', level: level ?? 'E', names: uniq(names) });
  });
  rule('F12', (level) => {
    const names = facts.callerExports.filter((k) => CALLER_TOOL_PREFIX.test(k));
    if (names.length) add({ code: 'F12', level: level ?? 'E', names: uniq(names) });
  });

  // S. Optional services at the first launch (D3) -------------------------------------------------
  rule('S1', (level) => {
    if (listed('full')) add({ code: 'S1', level: level ?? 'E' });
  });
  rule('S2', (level) => {
    if (listed('byoa') && !dated('DECIDED_BYOA')) add({ code: 'S2', level: level ?? 'E' });
  });
  rule('S3', (level) => {
    const url = (env.get('MEMANTO_API_URL') ?? '').trim();
    const on = listed('memory') || memantoBridgeOn(env.get('MEMANTO_ENABLED')) || memantoReal(env.get('MEMANTO_SECRET_KEY'))
      || (url !== '' && url !== MEMANTO_DEFAULT_URL);
    if (on && !dated('DECIDED_MEMORY')) add({ code: 'S3', level: level ?? 'E' });
  });
  rule('S4', (level) => {
    if (!billing) return;
    const live = [...billing.values()].some((v) => /^(?:sk|rk|pk)_live_/.test(v));
    if (live || (billing.get('BILLING_ENABLED') === 'true' && !dated('DECIDED_BILLING'))) add({ code: 'S4', level: level ?? 'E' });
  });
  rule('S5', (level) => {
    if (!listed('tts')) add({ code: 'S5', level: level ?? 'W' });
  });
  rule('S6', (level) => {
    if (!listed('tunnel')) add({ code: 'S6', level: level ?? 'W' });
  });

  // G, K, M, R, V. Order, stage and record rules ------------------------------------------------------
  rule('G1', (level) => {
    if (!readSwitch(env.get('ACCOUNT_DELETION_ENABLED')).on) return;
    const keys = ['SUPABASE_CURRENT_PASSWORD_ON', 'PASSWORD_CHANGE_CHECK', 'PROD_AMR_CHECK'];
    const missing = keys.filter((k) => !dated(k));
    if (missing.length) {
      add({ code: 'G1', level: level ?? 'E', names: missing });
    } else if (rec(keys[0]) > rec(keys[1]) || rec(keys[0]) > rec(keys[2])) {
      add({ code: 'G1', level: level ?? 'E', names: keys });
    }
  });
  rule('G2', (level) => {
    if (readSwitch(env.get('LEGAL_TERMS_REQUIRED')).on && !dated('VERCEL_LEGAL_PAGES_ON')) add({ code: 'G2', level: level ?? 'E', names: ['VERCEL_LEGAL_PAGES_ON'] });
  });
  rule('G3', () => {
    if ((stage === 'public' || dated('VERCEL_LEGAL_PAGES_ON')) && !readSwitch(env.get('ACCOUNT_DELETION_ENABLED')).on) add({ code: 'G3', level: 'E' });
  });
  rule('G5', () => {
    for (const [key, levels] of Object.entries(STAGE_REQUIRED)) {
      const level = levels[stage];
      if (level && !dated(key)) add({ code: 'G5', level, names: [key] });
    }
  });
  rule('K1', (level) => {
    if (!['AI_CAP_ALERT_WEBHOOK_URL', 'SAFETY_ALERT_WEBHOOK_URL'].some((k) => httpsUrl(env.get(k) ?? ''))) add({ code: 'K1', level: level ?? 'W' });
  });
  rule('K3', (level) => {
    const names = ['AI_CAP_ALERT_WEBHOOK_URL', 'SAFETY_ALERT_WEBHOOK_URL'].filter((k) => {
      const url = httpsUrl(env.get(k) ?? '');
      return url !== null && url.hostname !== 'hooks.slack.com';
    });
    if (names.length) add({ code: 'K3', level: level ?? 'W', names });
  });
  rule('K4', (level) => {
    const names = ['ALERT_WATCHER', 'ALERT_CHECK'].filter((k) => !textSet(k));
    if (names.length) add({ code: 'K4', level: level ?? 'W', names });
  });
  rule('K5', (level) => {
    if (!dated('ALERT_TEST')) add({ code: 'K5', level: level ?? 'W' });
  });
  rule('M1', (level) => {
    if (!dated('MAC_DEV_DB_SEPARATE')) add({ code: 'M1', level: level ?? 'W' });
  });
  rule('R1', (level) => {
    if (facts.unitBackupTimer !== 'enabled' || !facts.backupKey || !facts.backupEnv) add({ code: 'R1', level: level ?? 'W' });
  });
  rule('R2', (level) => {
    const ok = facts.backupLastOk ? Date.parse(facts.backupLastOk) : Number.NaN;
    const fail = facts.backupLastFail ? Date.parse(facts.backupLastFail) : Number.NaN;
    if (!(now.getTime() - ok <= 36 * HOUR) || fail > ok) add({ code: 'R2', level: level ?? 'W' });
  });
  rule('R3', () => {
    if (stage === 'setup') return;
    const drill = facts.drillLastOk ? Date.parse(facts.drillLastOk) : Number.NaN;
    if (Number.isNaN(drill)) add({ code: 'R3', level: 'E' });
    else if (now.getTime() - drill > 35 * DAY) add({ code: 'R3', level: stage === 'public' ? 'E' : 'W' });
  });
  rule('R4', (level) => {
    const names = ['BACKUP_KEY_COPY', 'BACKUP_KEY_ID'].filter((k) => (k === 'BACKUP_KEY_ID' ? !/^[0-9a-f]{16}$/.test(rec(k)) : !dated(k)));
    if (!names.includes('BACKUP_KEY_ID') && facts.backupKeyId !== '' && rec('BACKUP_KEY_ID') !== facts.backupKeyId) names.push('BACKUP_KEY_ID');
    if (names.length) add({ code: 'R4', level: level ?? 'E', names });
  });
  rule('R5', (level) => {
    if (!dated('BACKUP_LIFECYCLE')) add({ code: 'R5', level: level ?? 'E' });
  });
  rule('R6', (level) => {
    if (facts.backupAlert === 'false') add({ code: 'R6', level: level ?? 'E' });
  });
  rule('R8', (level) => {
    if (facts.unitBackupTimer === 'enabled' && !facts.backupTimersActive) add({ code: 'R8', level: level ?? 'W' });
  });
  rule('R9', () => {
    if (facts.restoreInProgress) add({ code: 'R9', level: facts.from === 'deploy' ? 'E' : 'W' });
  });
  // The pilot list as the api reads it: stack.env only (the api's env_file; A8 keeps it out of billing.env).
  const pilot = readPilotEntries(env.get('PILOT_ACCOUNT_IDS'));
  rule('V1', () => {
    if (stage === 'public') return;
    // (a) a valid pilot list: set, and every entry a UUID (V2 names the others).
    const validList = pilot.set && pilot.invalid.length === 0;
    // (b) Vercel's protection still on.
    const protectedEdge = dated('VERCEL_PROTECTION_ON') && rec('VERCEL_PROTECTION_OFF') === '';
    if (validList || protectedEdge) return;
    add({ code: 'V1', level: stageIndex === 0 && !listed('tunnel') ? 'W' : 'E' });
  });
  rule('V2', (level) => {
    // One finding per entry that is not a UUID, by position (never the entry), at most 10.
    for (const n of pilot.invalid.slice(0, 10)) add({ code: 'V2', level: level ?? 'E', n });
  });
  rule('V3', (level) => {
    /** @type {string[]} */
    const names = [];
    if (pilot.set) names.push('PILOT_ACCOUNT_IDS');
    if (!dated('VERCEL_PROTECTION_OFF')) names.push('VERCEL_PROTECTION_OFF');
    else if (dated('VERCEL_PROTECTION_ON') && rec('VERCEL_PROTECTION_ON') > rec('VERCEL_PROTECTION_OFF')) names.push('VERCEL_PROTECTION_ON', 'VERCEL_PROTECTION_OFF');
    if (names.length) add({ code: 'V3', level: level ?? 'E', names });
  });
  rule('V4', (level) => {
    if (!pilot.set) return;
    /** @type {string[]} */
    const names = [];
    if (listed('byoa')) names.push('COMPOSE_PROFILES');
    if (dated('DECIDED_BYOA')) names.push('DECIDED_BYOA');
    if (names.length) add({ code: 'V4', level: level ?? 'E', names: [...names, 'PILOT_ACCOUNT_IDS'] });
  });

  // A6 last: a name another finding already names in that file is not also "unknown".
  rule('A6', (level) => {
    for (const file of ENV_FILES) {
      const p = parsed.get(file);
      if (!p) continue;
      const named = new Set(findings.filter((f) => f.file === undefined || f.file === file).flatMap((f) => f.names ?? []));
      const names = uniq(p.entries.map((e) => e.key).filter((k) => !isKnownKey(k) && !named.has(k)));
      if (names.length) add({ code: 'A6', level: level ?? 'W', file, names });
    }
  });
  return findings;
}

// --- output --------------------------------------------------------------------------------------

const NAME_OK = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Printed instead of a field that did not pass the filters. */
export const NAME_UNSHOWN = '（名前を表示できません）';
const LEVEL_ORDER = { E: 0, W: 1, I: 2 };
const LEVEL_MARK = { E: '❌', W: '⚠️', I: 'ℹ️' };

/**
 * A finding's text with its placeholders filled from fields that pass the filters only.
 * @param {string} template
 * @param {Finding} f
 */
function fill(template, f) {
  return template.replace(/\{(names|file|line|gb|n)\}/g, (_, field) => {
    if (field === 'names') {
      const names = Array.isArray(f.names) ? f.names : [];
      const shown = names.filter((n) => typeof n === 'string' && (NAME_OK.test(n) || ATTESTATION_KEYS.has(n) || Object.hasOwn(SERVICE_PROFILES, n)));
      if (shown.length === 0) return NAME_UNSHOWN;
      return shown.join('、') + (shown.length < names.length ? `、${NAME_UNSHOWN}` : '');
    }
    if (field === 'file') return typeof f.file === 'string' && FILE_NAMES.includes(f.file) ? f.file : NAME_UNSHOWN;
    const n = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (f))[field];
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? String(n) : NAME_UNSHOWN;
  });
}

/**
 * The report: a header, each finding (errors first) with its fix and the runbook pointer, a summary.
 * Prints only catalog text, the mode, the stage and counts.
 * @param {Finding[]} findings
 * @param {{ mode: Mode, stage: Stage, source?: 'record' | 'missing' | 'file-unreadable' | 'unreadable' }} options
 * @returns {string[]}
 */
export function formatFindings(findings, { mode, stage, source = 'record' }) {
  const lines = [];
  if (mode === 'ci') {
    lines.push('（CI モード: 本番だけの決まりを飛ばしています）');
    lines.push('==> 事前チェック（preflight.sh）: CI の決まり');
  } else {
    const from = {
      record: 'launch-record.env から',
      missing: 'launch-record.env がないので、setup として確かめます',
      'file-unreadable': 'launch-record.env が読めないので、setup として確かめます',
      unreadable: 'launch-record.env の LAUNCH_STAGE が読めないので、setup として確かめます',
    }[source];
    lines.push(`==> 事前チェック（preflight.sh）: 本番の決まり / 公開の段階 ${stage}（${from}）`);
  }
  const counts = { E: 0, W: 0, I: 0 };
  const sorted = findings
    .map((f, index) => ({ f, index, level: /** @type {Level} */ (f.level === 'W' || f.level === 'I' ? f.level : 'E') }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.index - b.index);
  for (const { f, level } of sorted) {
    counts[level] += 1;
    const known = typeof f.code === 'string' && TEXT_BY_CODE.has(f.code);
    const code = known ? f.code : 'X0';
    const text = /** @type {{ title: string, fix: string }} */ (TEXT_BY_CODE.get(code));
    lines.push(`${LEVEL_MARK[level]} [${code}] ${fill(text.title, f)}`);
    if (text.fix) lines.push(`   直し方: ${fill(text.fix, f)}`);
    lines.push(`   くわしく: 手順書 13 章の「${code}」`);
  }
  const tally = `エラー ${counts.E} 件、注意 ${counts.W} 件、お知らせ ${counts.I} 件`;
  lines.push(counts.E > 0
    ? `==> 事前チェック: ${tally}。エラーを直すまで、デプロイは止まります（何も変えていません）。`
    : `==> 事前チェック: ${tally}（何も変えていません）。`);
  return lines;
}
