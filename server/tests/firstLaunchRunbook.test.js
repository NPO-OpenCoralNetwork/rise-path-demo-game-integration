// @ts-check
// The first-launch runbook doc/guides/first-launch.ja.md (Phase 9; owner default: one new runbook). Design §9.2:
//   1. chapters はじめに, 1-18 and 付録 in order, and every step heading under its chapter;
//   2. a 13 章 row per code, its 表示 cell equal to the catalog's title (and its 直し方 cell to the fix);
//   3. a 14 章 row and a launch-record.env.example line per ATTESTATIONS key;
//   4. every script path and `npm run` name the runbook gives exists;
//   5. every step block has its lines and a 済んだ日 checkbox (stage 6: the in-progress banner is gone);
//   6. the deploy-order sentence (D11) in 11.3, and the four other runbooks link here;
//   7. です・ます; 8. the domain placeholder; 9. D8: no tracked file points development at production;
//   11. every 「手順書 X.Y」 and 「手順書 N 章」 in the runbook, the catalog, the scripts' messages and the
//      linked documents resolves to a heading (finding 17);
//   12. each step that runs the 事前チェック lists the warnings expected then, and they are the ones the
//      engine gives in that state.
// Stage 6 added #5-#9, #12, the documents' references (#11) and the chapter pins of 15-17 章.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CODES, ATTESTATIONS, INTERNAL_CODES, RULES, STAGES, checkStack } from '../../scripts/deploy/preflight-rules.mjs';
import { ALL_CODES as AFTER_CODES, DEPLOY_CODES, POSTDEPLOY_CODES } from '../../scripts/deploy/postdeploy-probe.mjs';
import { BASE_STACK, NOW, PILOT_ID, PILOT_ID_2, baseFacts, baseRecord, buildInput } from './helpers/preflightFixtures.js';
import { spawnSync } from 'node:child_process';
import { pilotStartupLines } from '../middleware/pilotGate.js';
import { VERCEL_RULES } from '../../scripts/deploy/vercel-env-rules.mjs';
import { ALL_CODES as BACKUP_ALL_CODES, BACKUP_CODES } from '../../scripts/deploy/backup-codes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNBOOK = 'doc/guides/first-launch.ja.md';
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const text = read(RUNBOOK);

/** The text of chapter `## <n>.` up to the next chapter. @param {string} n */
function chapter(n) {
  const start = text.search(new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(start >= 0, `## ${n}.`);
  const rest = text.slice(start + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Markdown table rows of a chapter: cells, trimmed (no cell holds a `|`). @param {string} body */
const rows = (body) => body.split('\n').filter((line) => /^\| /.test(line)).map((line) => line.slice(1, -1).split(' | ').map((c) => c.trim()));

const CHAPTERS = [
  'はじめに',
  '1. 決めたこと（2026-10-30）',
  '2. 始める前に',
  '3. アカウントと管理画面',
  '4. VM を作る',
  '5. 設定のファイルと事前チェック',
  '6. 最初のデプロイ（Tailscale だけ）と控え',
  '7. 公開の入り口（Cloudflare トンネル）',
  '8. テスト用のアカウント、Vercel、最初のサインイン',
  '9. ほかの人が入る前の確かめ',
  '10. 試験運用（スタッフと大人のテスターだけ）',
  '11. 一般の登録を開く前に',
  '12. 公開の日と、そのあと',
  '13. 事前チェックと確かめのコード',
  '14. 確かめの記録（launch-record.env）',
  '15. 秘密の値と、取り替え方',
  '16. 控えから戻すとき',
  '17. 困ったとき',
  '18. 本番の DB に触るとき（D8）',
  '付録 古い文書',
];
/** Steps per chapter (design §8.1, numbering fixed: 8.2 and 9.1 stay as pointers, TR12). */
const STEPS = { 2: 8, 3: 8, 4: 5, 5: 4, 6: 5, 7: 6, 8: 5, 9: 6, 10: 8, 11: 8, 12: 4, 16: 3 };

describe('first-launch.ja.md: chapters and steps (design §9.2 #1)', () => {
  it('has no in-progress banner: every step is written (stage 6; design §9.2 #5)', () => {
    assert.doesNotMatch(text, /作成中/);
  });
  it('has the chapters in order, each once', () => {
    const found = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(found, CHAPTERS);
  });
  it('has every step heading, numbered in order, under its own chapter and nowhere else', () => {
    const found = [...text.matchAll(/^### (\d+)\.(\d+) (.+)$/gm)].map((m) => [Number(m[1]), Number(m[2]), m[3].trim()]);
    const want = Object.entries(STEPS).flatMap(([c, n]) => Array.from({ length: n }, (_, i) => [Number(c), i + 1]));
    assert.deepEqual(found.map(([c, s]) => [c, s]), want);
    for (const [c, s, title] of found) {
      assert.ok(String(title).length > 0, `${c}.${s} has a title`);
      assert.match(chapter(String(c)), new RegExp(`^### ${c}\\.${s} `, 'm'), `${c}.${s} sits in chapter ${c}`);
    }
    assert.equal([...text.matchAll(/^### /gm)].length, found.length, 'no other ### heading');
  });
});

describe('first-launch.ja.md 13 章: every code the preflight, the deploy and the 事後の確かめ print (design §9.2 #2)', () => {
  const table = rows(chapter('13')).filter((r) => r[0] !== 'コード' && !/^-+$/.test(r[0]));
  it('has one row per code, in the catalog order (the preflight\'s, then DB1 and the P codes, then the Vercel build\'s VB codes, then the backup tools\' BK/JO/IB/DR/RS codes), and no other', () => {
    assert.deepEqual(table.map((r) => r[0]), [...ALL_CODES, ...AFTER_CODES, ...VERCEL_RULES.map((r) => r.code), ...BACKUP_ALL_CODES]);
  });
  it('shows each backup code\'s title and fix exactly as the backup scripts print them, its kind starting with its level (Phase 9 stage 5, D4)', () => {
    const byCode = new Map(table.map((r) => [r[0], r]));
    const WORD = { E: 'エラー', W: '注意' };
    for (const entry of BACKUP_CODES) {
      const row = /** @type {string[]} */ (byCode.get(entry.code));
      assert.equal(row.length, 5, `${entry.code}: コード | 種類 | 表示 | 説明 | 直し方`);
      assert.ok(row[1].startsWith(WORD[entry.level]), `${entry.code} (${entry.level}): ${row[1]}`);
      assert.equal(row[2], entry.title, `${entry.code}: 表示`);
      assert.ok(row[3], `${entry.code}: 説明`);
      assert.equal(row[4], entry.fix, `${entry.code}: 直し方`);
    }
    // Review round 2, finding 13: restore-drill.sh reports another key's set as DR4, so DR4's 説明 names the key id, DR1's not.
    assert.doesNotMatch(/** @type {string[]} */ (byCode.get('DR1'))[3], /key id/u);
    assert.match(/** @type {string[]} */ (byCode.get('DR4'))[3], /key id/u);
    assert.match(read('deploy/risepath-vm/scripts/restore-drill.sh'), /\[\[ "\$\{SET_KEY\}" == "\$\{KEY_ID\}" \]\] \|\| bk_fail DR4 /);
    const intro = /** @type {string} */ (chapter('13').split('\n').find((line) => line.startsWith('- BK・JO・IB・DR・RS で始まるコードは')));
    assert.ok(intro, 'the intro bullet for the backup codes');
    assert.match(intro, /IB・DR・RS は、直したら、同じコマンドをもう一度実行し、✅ の行が出れば直っています。/u, 'success sign of the commands the owner runs');
    // Review round 1 of Stage 5, finding 16: BK's check is `systemctl start`, which prints nothing when it works. Round 2,
    // finding 10: most BK fixes do not contain that command, so the sign says to run it after any fix, and that it takes minutes.
    assert.match(intro, /BK は、直したら `sudo systemctl start risepath-backup\.service` を実行します（数分かかり、そのあいだ何も出ません）。何も出さずに終われば直っています（`sudo journalctl -u risepath-backup -n 5` に「✅ 毎日の控えができました」の行が出ます。/u, 'BK\'s success sign');
    assert.doesNotMatch(intro, /直し方の `sudo systemctl start risepath-backup\.service`/u);
    assert.match(intro, /JO は、次の 1 時間のあとに `sudo journalctl -u risepath-backup-journal -n 5` に「✅ 削除の記録を控えました」の行が出れば直っています。/u, 'JO\'s success sign');
    assert.match(intro, /また出るときは、出た行をそのままエージェントに見せます/u, 'failure path');
    // Finding 19: the folder the relative commands run in is said once.
    assert.match(intro, /`cd \/opt\/risepath\/deploy\/risepath-vm` のあとで実行します/u);
    assert.match(intro, /「わけ」の行は、そのとき足りなかったものを、値を出さずに書いています/u);
  });
  it('shows each VB code\'s message exactly as the Vercel build prints it, with the kind of its level (Phase 9 stage 4, D5)', () => {
    const byCode = new Map(table.map((r) => [r[0], r]));
    for (const rule of VERCEL_RULES) {
      const row = /** @type {string[]} */ (byCode.get(rule.code));
      assert.equal(row.length, 5, `${rule.code}: コード | 種類 | 表示 | 説明 | 直し方`);
      assert.equal(row[1], rule.level === 'E' ? 'エラー（Vercel のビルドが止まります）' : '注意（Vercel のビルド）', `${rule.code}: 種類`);
      assert.equal(row[2], rule.message, `${rule.code}: 表示`);
      assert.ok(row[3] && row[4], `${rule.code}: 説明 and 直し方`);
    }
    assert.match(chapter('13'), /^- VB で始まるコードは、VM ではなく、Vercel のビルドが出します/m);
  });
  it('VB rows say what success looks like and leave the owner no open choice (stage 4 review round 1)', () => {
    const byCode = new Map(table.map((r) => [r[0], r]));
    const intro = /** @type {string} */ (chapter('13').split('\n').find((line) => line.startsWith('- VB で始まるコードは')));
    assert.match(intro, /Redeploy のビルドが最後まで進み.*ログにその VB の行が出なければ、直っています。また出るときは、出た行をそのままエージェントに見せます/u, 'success sign and failure path');
    assert.match(intro, /一般向けのアプリの Vercel のプロジェクトのためのもの/u);
    const vb2 = /** @type {string[]} */ (byCode.get('VB2'));
    assert.match(vb2[3], /一般向けのアプリの Vercel のプロジェクトのためのもの.*学校の版でだけ通す切り替えが要ります/u, 'VB2: the school build (training plan D8)');
    const vb8 = /** @type {string[]} */ (byCode.get('VB8'));
    assert.match(vb8[4], /^最初の公開では、Nexloom のログインを使いません。/u, 'VB8: the default is stated');
    assert.doesNotMatch(vb8[4], /決めていなければ/u);
    const vb11 = /** @type {string[]} */ (byCode.get('VB11'));
    assert.match(vb11[3], /VM の値と同じではありません.*403/u, 'VB11: a short value means the two differ');
    assert.match(vb11[4], /VM の stack\.env の `ORIGIN_SECRET` と同じ値を、Vercel の Production の `ORIGIN_SECRET` に入れ直し/u);
    assert.match(vb11[4], /値が漏れたかもしれないときだけ/u, 'rotation only for a possible leak');
  });
  it('shows each code\'s title and fix exactly as the scripts print them', () => {
    const byCode = new Map(table.map((r) => [r[0], r]));
    for (const entry of [...RULES, ...INTERNAL_CODES, ...DEPLOY_CODES, ...POSTDEPLOY_CODES]) {
      const row = /** @type {string[]} */ (byCode.get(entry.code));
      assert.equal(row.length, 5, `${entry.code}: コード | 種類 | 表示 | 説明 | 直し方`);
      assert.equal(row[2], entry.title, `${entry.code}: 表示`);
      assert.equal(row[4], entry.fix, `${entry.code}: 直し方`);
      assert.ok(row[1] && row[3], `${entry.code}: 種類 and 説明`);
    }
  });
  it('says each fixed-level code\'s kind (種類) as the catalog\'s level per stage, and that the internal codes stop the check', () => {
    const WORD = { E: 'エラー', W: '注意', I: 'お知らせ' };
    /** The catalog's level notation in the runbook's words ('–/W/E/E' → 'pilot は注意、minors からエラー'). @param {string} level */
    const kind = (level) => {
      const parts = level.split('/');
      if (parts.length === 1) return WORD[/** @type {'E' | 'W' | 'I'} */ (parts[0])];
      const out = [];
      for (let i = 0; i < parts.length;) {
        let j = i;
        while (j + 1 < parts.length && parts[j + 1] === parts[i]) j += 1;
        const word = WORD[/** @type {'E' | 'W' | 'I'} */ (parts[i])];
        if (word) out.push(j < parts.length - 1 ? `${STAGES[i]} は${word}` : i === parts.length - 1 ? `${STAGES[i]} で${word}` : `${STAGES[i]} から${word}`);
        i = j + 1;
      }
      return out.join('、');
    };
    const byCode = new Map(table.map((r) => [r[0], r]));
    for (const rule of RULES.filter((r) => r.level !== 'dyn')) {
      assert.equal(/** @type {string[]} */ (byCode.get(rule.code))[1], kind(rule.level), `${rule.code} (${rule.level})`);
    }
    for (const x of INTERNAL_CODES) assert.equal(/** @type {string[]} */ (byCode.get(x.code))[1], '実行できません（デプロイは止まります）', x.code);
    // DB1 and the P codes: the kind starts with the level the scripts print it at; P0 says the check could not run.
    for (const c of [...DEPLOY_CODES, ...POSTDEPLOY_CODES]) {
      const cell = /** @type {string[]} */ (byCode.get(c.code))[1];
      if (c.code === 'P0') assert.equal(cell, '実行できません（事後の確かめ）');
      else assert.ok(cell.startsWith(WORD[c.level]), `${c.code} (${c.level}): ${cell}`);
    }
  });
});

describe('first-launch.ja.md 14 章 and launch-record.env.example: every record key (design §9.2 #3)', () => {
  const example = read('deploy/risepath-vm/launch-record.env.example');
  it('has a 14 章 row per ATTESTATIONS key, in the catalog order', () => {
    const keys = rows(chapter('14')).map((r) => /^`([A-Z_]+)`$/.exec(r[0])?.[1]).filter(Boolean);
    assert.deepEqual(keys, ATTESTATIONS.map((a) => a.key));
  });
  it('names each key\'s producing step in its row (every key has one)', () => {
    const byKey = new Map(rows(chapter('14')).map((r) => [r[0].replace(/`/g, ''), r]));
    for (const a of ATTESTATIONS) {
      assert.ok(a.step, `${a.key}: ATTESTATIONS names the step that dates it (a key no step dates stops the deploy with nothing to do)`);
      assert.match(/** @type {string[]} */ (byKey.get(a.key))[2], new RegExp(`手順書 (?:[\\d.・]+・)?${a.step.replace('.', '\\.')}(?:・|$)`), a.key);
    }
  });
  // Review round 1 of Stage 6, finding 8: the step a key names has a 済んだ日 checkbox that names the key, and its
  // やること tells the owner to write it (a step before 5.2 is copied into the record by 5.2, which names it).
  it('the step each key names has a 済んだ日 checkbox naming the key, and its やること (or 5.2\'s copy) names the key', () => {
    const order = new Map(STEP_IDS.map((id, i) => [id, i]));
    const copyStep = stepPart(stepBody('5.2'), 'やること:');
    for (const a of ATTESTATIONS) {
      const body = stepBody(/** @type {string} */ (a.step));
      const box = body.split('\n').find((line) => line.startsWith('- [ ] 済んだ日:')) ?? '';
      const keys = /（[^（）]*launch-record\.env: ([^）]+)）/.exec(box)?.[1].split(/[、・,]\s*/).map((k) => k.trim()) ?? [];
      assert.ok(keys.includes(a.key), `${a.step}: the checkbox names ${a.key} (${box})`);
      const todo = stepPart(body, 'やること:');
      const before52 = /** @type {number} */ (order.get(/** @type {string} */ (a.step))) < /** @type {number} */ (order.get('5.2'));
      assert.ok(todo.includes(a.key) || (before52 && copyStep.includes(a.key)), `${a.step}: やること names ${a.key}${before52 ? ' (or 5.2 copies it)' : ''}`);
    }
  });
  it('the template has one line per key (LAUNCH_STAGE=setup, the rest empty), each after a Japanese comment', () => {
    const lines = example.split('\n');
    const assigned = lines.filter((l) => /^[A-Z_]+=/.test(l));
    assert.deepEqual(assigned.map((l) => l.split('=')[0]), ATTESTATIONS.map((a) => a.key));
    assert.deepEqual(assigned, ATTESTATIONS.map((a) => (a.key === 'LAUNCH_STAGE' ? 'LAUNCH_STAGE=setup' : `${a.key}=`)));
    for (const line of assigned) {
      const before = lines[lines.indexOf(line) - 1];
      assert.match(before, /^# .*[ぁ-んァ-ン一-龥]/, `${line}: a Japanese comment line above`);
    }
  });
  // Review round 3, finding 7: G5 stops the deploy at public as well as minors, and the usual path skips minors,
  // so every place the owner reads about MINORS_POLICY_DECIDED names each stage where G5 is an error.
  it('MINORS_POLICY_DECIDED: the 14 章 cell, the template comment and the 13 章 G5 説明 name every stage where G5 stops the deploy', () => {
    const stages = STAGES.filter((stage) => checkStack(buildInput(stage, { record: { MINORS_POLICY_DECIDED: '' } })).some((f) => f.code === 'G5' && f.level === 'E'));
    assert.deepEqual(stages, ['minors', 'public']);
    const cell = /** @type {string[]} */ (rows(chapter('14')).find((r) => r[0] === '`MINORS_POLICY_DECIDED`'))[3];
    const lines = example.split('\n');
    const comment = lines[lines.indexOf('MINORS_POLICY_DECIDED=') - 1];
    const g5 = /** @type {string[]} */ (rows(chapter('13')).find((r) => r[0] === 'G5'));
    for (const stage of stages) {
      for (const [where, words] of [['14 章', cell], ['template', comment], ['13 章 G5 種類', g5[1]], ['13 章 G5 説明', g5[3]]]) assert.ok(words.includes(stage), `${where}: ${stage} (${words})`);
    }
  });
  it('copied as is, the template is a valid record (no A3, A9, A10, A11, A12)', () => {
    const found = checkStack({ mode: 'prod', files: { 'stack.env': 'COMPOSE_PROFILES=tts\n', 'launch-record.env': example }, facts: baseFacts(), lastGreen: null, now: new Date('2026-11-01T00:00:00Z') });
    assert.deepEqual(found.filter((f) => ['A3', 'A9', 'A10', 'A11', 'A12', 'A13'].includes(f.code)), []);
  });
});

describe('first-launch.ja.md 10.1〜10.4: the pilot-list steps (Phase 9 stage 3; design §8.1 form, TR5, TR6, TR8, TR12)', () => {
  /** The body of step `### <id> ` up to the next heading. @param {string} id */
  const step = (id) => {
    const start = text.search(new RegExp(`^### ${id.replace('.', '\\.')} `, 'm'));
    assert.ok(start >= 0, id);
    const rest = text.slice(start);
    const end = rest.slice(4).search(/^#{2,3} /m);
    return end < 0 ? rest : rest.slice(0, end + 4);
  };
  /** A step's top-level line `- <label>` and its indented lines. @param {string} body @param {string} label */
  const part = (body, label) => {
    const lines = body.split('\n');
    const from = lines.findIndex((line) => line.startsWith(`- ${label}`));
    assert.ok(from >= 0, label);
    const to = lines.findIndex((line, i) => i > from && /^\S/.test(line));
    return lines.slice(from, to < 0 ? undefined : to).join('\n');
  };
  const LINES = ['[ ] 済んだ日:', 'だれが・どこで:', '先に済ませること:', 'やること:', 'うまくいったとき:', 'うまくいかないとき:', 'くわしく:'];
  const BEFORE = { '10.1': '9.6', '10.2': '10.1', '10.3': '10.2', '10.4': '10.3' };
  const view = read('components/common/PilotOnlyView.tsx');
  const jp = /jp: \{\s*\n\s*title: '([^']+)',\s*\n\s*body: '[^']+',\s*\n\s*signOut: '([^']+)'/.exec(view);
  assert.ok(jp, 'the notice copy (jp)');
  const [, NOTICE_TITLE, SIGN_OUT] = jp;
  const LOG_LINE = "`docker compose --env-file stack.env logs api | grep '\\[Pilot\\]'`";
  /** The VM folder every stack command runs in (10.1's step 2 starts there). */
  const CD = 'cd /opt/risepath/deploy/risepath-vm && ';
  const LOG_CMD = `\`${CD}${LOG_LINE.slice(1)}`;
  /** The landing page's sign-in button (jp), the first thing a signed-out visitor sees at `/`. */
  const landing = /jp: \{[\s\S]*?\n\s*signIn: '([^']+)'/.exec(read('components/common/ExperienceLandingView.tsx'));
  assert.ok(landing, 'the landing sign-in label (jp)');
  const LANDING_SIGN_IN = landing[1];
  /** The sidebar's sign-out (jp; components/common/Layout.tsx), for a browser still signed in from 8.5. */
  const sidebar = [...read('components/common/Layout.tsx').matchAll(/\blogOut: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(sidebar.length, 2, 'en and jp');
  const SIDEBAR_SIGN_OUT = sidebar[1];
  /**
   * Positions of `needles` found one after the other (each searched after the previous one); -1 when missing.
   * @param {string} body @param {string[]} needles
   */
  const inOrder = (body, needles) => {
    let from = 0;
    return needles.map((needle) => {
      const at = from < 0 ? -1 : body.indexOf(needle, from);
      from = at < 0 ? -1 : at + needle.length;
      return at;
    });
  };
  /** Two valid ids for pilotStartupLines. */
  const ID_A = `${'a'.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}`;
  const ID_B = `${'b'.repeat(8)}-bbbb-4bbb-8bbb-${'b'.repeat(12)}`;

  it('each has every step line once, in order, with the 済んだ日 checkbox (design §9.2 #5 for the steps written so far), and the order of 10 章', () => {
    for (const [id, before] of Object.entries(BEFORE)) {
      const body = step(id);
      const top = body.split('\n').filter((line) => line.startsWith('- '));
      assert.deepEqual(top.map((line) => LINES.findIndex((label) => line.startsWith(`- ${label}`))), LINES.map((_, i) => i), id);
      assert.match(part(body, '先に済ませること:'), new RegExp(`^- 先に済ませること: ${before.replace('.', '\\.')}$`), id);
      assert.match(part(body, 'やること:'), /\n {2}1\. /, `${id}: numbered`);
    }
  });
  it('です・ます: no line of 10 章 ends with だ。 or である。 (design §9.2 #7)', () => {
    for (const line of chapter('10').split('\n')) assert.ok(!/(?:だ|である)。$/.test(line), line);
  });
  it('one way only (TR5): no 「名簿を使わないとき」 branch, and the protection comes off only in 10.3, after the list is proven', () => {
    assert.doesNotMatch(text, /名簿を使わない/);
    assert.match(step('10.3'), /^- \[ \] 済んだ日: ＿＿＿＿（launch-record\.env: VERCEL_PROTECTION_OFF）$/m);
    assert.equal(ATTESTATIONS.find((a) => a.key === 'VERCEL_PROTECTION_OFF')?.step, '10.3');
  });
  it('10.1: who goes on the list and who stays off; the line in stack.env; its success sign is the api\'s startup line and 10.2 (TR6, TR12)', () => {
    const body = step('10.1');
    const todo = part(body, 'やること:');
    for (const who of ['自分（8.5', '安全の知らせを見る人と管理者', 'スタッフ', '8.1 の大人のテスト用']) assert.ok(todo.includes(who), who);
    assert.match(todo, /8\.1 のダミーと、18 歳未満のテスト用のアカウントは入れません/);
    assert.match(todo, /`PILOT_ACCOUNT_IDS=`/);
    assert.ok(todo.includes(LOG_LINE), 'the log check');
    const ok = part(body, 'うまくいったとき:');
    const on = pilotStartupLines({ PILOT_ACCOUNT_IDS: `${ID_A},${ID_B}` })[0];
    assert.equal(on, '[Pilot] on: 2 accounts');
    assert.ok(ok.includes(`「${on.replace('2', 'N')}」`), 'the startup line as server.js prints it');
    // Review round 1, finding 2: N counts different ids, not entries written (a pasted-twice id counts once).
    assert.equal(pilotStartupLines({ PILOT_ACCOUNT_IDS: `${ID_A},${ID_B},${ID_A.toUpperCase()}` })[0], on, 'the api counts an id written twice once');
    assert.match(ok, /N は名簿にある User UID の数です（同じ User UID を 2 回書いたときは、1 と数えます）/);
    assert.doesNotMatch(ok, /名簿に書いた人数/);
    assert.match(ok, /次の 10\.2 で確かめます/);
    const fail = part(body, 'うまくいかないとき:');
    for (const code of ['V2', 'A5']) {
      assert.ok(fail.includes(`「[${code}]」`), code);
      assert.ok(RULES.some((r) => r.code === code), code);
    }
    assert.ok(fail.includes(`「${pilotStartupLines({})[0]}」`), 'the off line');
    assert.match(fail, /5 で N が、入れたい人の数より少ないときは/);
  });
  it('10.2: signed out first; the dummy gets the page the app shows; sign out; the adult test account works; Vercel\'s protection stays on; a wrong id is fixed in 10.1\'s step 2', () => {
    const body = step('10.2');
    assert.match(part(body, 'だれが・どこで:'), /Vercel の保護はまだかけたままです/);
    const todo = part(body, 'やること:');
    // Review round 1, finding 7: the owner's browser is still signed in from 8.5, so `/` would show their own home.
    const order = inOrder(todo, [`左のメニューのいちばん下の「${SIDEBAR_SIGN_OUT}」を押して、先にログアウトします`, `「${LANDING_SIGN_IN}」を押し`, 'ダミーのアカウントでログイン', `「${SIGN_OUT}」`, `「${LANDING_SIGN_IN}」を押し`, '大人のテスト用のアカウントでログイン']);
    assert.ok(order.every((at) => at >= 0), `own sign-out, landing sign-in, dummy, sign out, landing sign-in, adult: ${order}`);
    assert.match(todo.split('\n').find((line) => line.startsWith('  1. ')) ?? '', /自分のアカウントでログインしたままのときは/);
    const ok = part(body, 'うまくいったとき:');
    assert.ok(ok.includes(`2 で「${NOTICE_TITLE}」`), 'the notice title as the app shows it, after the dummy\'s sign-in (step 2)');
    assert.match(ok, /4 では、ふだんのホームが出て/);
    const fail = part(body, 'うまくいかないとき:');
    assert.match(fail, /2 でダミーのアカウントでも使えてしまったら、ここで止めて、エージェントに見せます（Vercel の保護は外しません）/);
    // The id is fixed in stack.env (10.1 step 2), then 10.1 goes on from its ✓ check (step 3).
    assert.match(fail, /10\.1 の 2 で User UID を直し、10\.1 の 3 からもう一度します/);
    assert.match(fail, /自分の User UID は 8\.5/);
    assert.match(step('10.1'), /^ {2}2\. VM で `cd \/opt\/risepath\/deploy\/risepath-vm && nano stack\.env`/m, '10.1 step 2 is the stack.env edit');
    assert.match(step('10.1'), /^ {2}3\. GitHub の main/m, '10.1 step 3 is the ✓ check');
  });
  it('10.3: protection off, a private window, VERCEL_PROTECTION_OFF dated, the standalone preflight, then smoke:edge last (TR8, TR12); no tester before it', () => {
    const body = step('10.3');
    const todo = part(body, 'やること:');
    const order = ['「Standard Protection」', 'プライベートウィンドウ', 'VERCEL_PROTECTION_OFF=', './scripts/preflight.sh', 'npm run smoke:edge'].map((s) => todo.indexOf(s));
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `order ${order}`);
    const last = todo.split('\n').filter((line) => /^ {2}\d+\. /.test(line)).at(-1) ?? '';
    assert.match(last, /npm run smoke:edge/, 'smoke:edge is the last thing');
    // Review round 1, finding 6: where on the Mac, and what <domain> stands for.
    assert.match(last, /Mac のターミナルで、Rise Path のリポジトリのフォルダ（`package\.json` があるいちばん上のフォルダ）に `cd` で移り/);
    assert.match(last, /`<domain>` は 3\.1 で決めたドメインに置きかえます/);
    // Review round 1, finding 8: a signed-out visitor at / gets the landing page; the sign-in form is behind its button.
    const ok = part(body, 'うまくいったとき:');
    assert.ok(ok.includes(`2 で Rise Path のはじめのページ（右上に「${LANDING_SIGN_IN}」のボタンがあるページ）が出ます`), ok);
    assert.ok(ok.includes(`「${LANDING_SIGN_IN}」を押しても、「新規登録」はありません`), ok);
    assert.doesNotMatch(ok, /Rise Path のログインの画面が出ます/);
    const fail = part(body, 'うまくいかないとき:');
    assert.match(fail, /4 で「Missing script」/);
    assert.match(fail, /テスターは、ここまで済むまで足しません。/);
  });
  it('10.4: a tester\'s password in person or by phone; a deploy outside lesson time; N before and after; a leaving tester is asked first, taken off the list and deployed, N checked to go down, then the deletion (TR6)', () => {
    const body = step('10.4');
    const todo = part(body, 'やること:');
    assert.match(todo, /パスワードは、会って、または電話で伝えます（メールアドレスと同じメッセージでは送りません）/);
    assert.match(todo, /授業や学習の時間を避けます/);
    const items = todo.split('\n').filter((line) => /^ {2}\d+\. /.test(line));
    assert.ok(items[1].includes(LOG_CMD) && /N（いま名簿にある人数）を書き留めます/.test(items[1]), 'step 2: the count before the change');
    assert.match(items[4], /^ {2}5\. デプロイが済んだら、2 のコマンドをもう一度実行し、N を見ます。$/);
    // Review round 1, findings 1 and 10: the deletion waits for the api's own count to go down by one.
    const leaving = todo.slice(todo.indexOf('テスターが抜けるとき'));
    const order = ['消すかどうかを聞きます', '2 のとおりに N を書き留め', 'その User UID と、そのとなりのカンマを 1 つ消し', '4 のとおりにデプロイします', 'N が 1 つ減ったことを見ます', '減っていないときは、ここで止めて、記録は消さずに、エージェントに聞きます', 'N が減ったのを見てから', 'scripts/delete-account-data.mjs', '手順書 18 章'].map((s) => leaving.indexOf(s));
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `order ${order}: a deleted account still on the list would be re-opened by its next sign-in`);
    const ok = part(body, 'うまくいったとき:');
    assert.match(ok, /5 の N が、2 で書き留めた N より 1 つ多くなっています/);
    assert.ok(ok.includes(`6 で N が 1 つ減ります（その人がログインしても、「${NOTICE_TITLE}」のページが出ます）`), ok);
    const fail = part(body, 'うまくいかないとき:');
    assert.match(fail, /5 で N が増えないときは、4 で「==> Done」が出たかを見ます。出ていたら、その User UID が、もう名簿に入っていないかを見ます（同じ User UID は 1 と数えます）/);
    assert.match(fail, /6 で N が減らないときは、記録を消さずに、エージェントに聞きます/);
  });
  it('every command run in the VM folder is run there: the step went there first (`cd /opt/risepath/deploy/risepath-vm && …`), and a success or failure line carries its own cd (review round 1, finding 6)', () => {
    const IN_FOLDER = /^(?:nano (?:stack|launch-record)\.env|\.\/scripts\/|docker compose --env-file )/;
    const spans = (/** @type {string} */ s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    let checked = 0;
    for (const id of Object.keys(BEFORE)) {
      const body = step(id);
      let there = false;
      for (const item of part(body, 'やること:').split('\n').filter((line) => /^ {2}\d+\. /.test(line))) {
        for (const code of spans(item)) {
          if (code.startsWith(CD)) there = true;
          else if (IN_FOLDER.test(code)) {
            checked += 1;
            assert.ok(there, `${id}: \`${code}\` before the step went to the VM folder`);
          }
        }
      }
      for (const label of ['うまくいったとき:', 'うまくいかないとき:']) {
        for (const code of spans(part(body, label))) assert.ok(!IN_FOLDER.test(code), `${id} ${label} \`${code}\` without the cd`);
      }
    }
    assert.ok(checked >= 5, `the stack commands of 10.1, 10.3 and 10.4 were seen (${checked})`);
  });
  it('3.4 and 4.3, once written, say that :3100 (the SSE MCP) takes learner sign-ins the pilot list does not check (review round 1, finding 4; Stage 6 writes them)', () => {
    for (const id of ['3.4', '4.3']) {
      const body = step(id);
      if (!/^- やること:/m.test(body)) continue; // still a heading only
      assert.match(body, /3100[^\n]*名簿/, `${id}: 3100 carries learner sessions the list (PILOT_ACCOUNT_IDS) does not check`);
    }
  });
});

describe('first-launch.ja.md: what it names exists (design §9.2 #4)', () => {
  it('every script path is in the repository (from the root or from deploy/risepath-vm)', () => {
    const paths = [...new Set([...text.matchAll(/(?:deploy\/risepath-vm\/)?scripts\/[\w.-]+\.(?:sh|mjs)/g)].map((m) => m[0]))];
    assert.ok(paths.length > 0);
    for (const p of paths) {
      assert.ok(fs.existsSync(path.join(ROOT, p)) || fs.existsSync(path.join(ROOT, 'deploy/risepath-vm', p)), p);
    }
  });
  it('every npm run name is a package.json script', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    for (const m of text.matchAll(/npm run ([\w:.-]+)/g)) assert.ok(Object.hasOwn(scripts, m[1]), `npm run ${m[1]}`);
  });
});

describe('every 「手順書 X.Y」 and 「手順書 N 章」 resolves to a runbook heading (design §9.2 #11, finding 17)', () => {
  /** @param {string} source @param {string} where */
  const check = (source, where) => {
    let n = 0;
    for (const m of source.matchAll(/手順書 (\d+(?:\.\d+)?(?:[・〜]\d+(?:\.\d+)?)*)/g)) {
      for (const ref of m[1].split(/[・〜]/)) {
        n += 1;
        const re = ref.includes('.') ? new RegExp(`^### ${ref.replace('.', '\\.')} `, 'm') : new RegExp(`^## ${ref}\\. `, 'm');
        assert.match(text, re, `${where}: 手順書 ${ref}`);
      }
    }
    return n;
  };
  it('in the runbook itself', () => {
    assert.ok(check(text, RUNBOOK) > 0);
  });
  it('in the catalog (RULES, INTERNAL_CODES) and the ATTESTATIONS steps', () => {
    assert.ok(check([...RULES, ...INTERNAL_CODES].map((r) => `${r.title}\n${r.fix}`).join('\n'), 'catalog') > 0);
    for (const a of ATTESTATIONS) if (a.step) check(`手順書 ${a.step}`, a.key);
  });
  it('in the scripts\' messages (deploy/risepath-vm/scripts/*.sh, scripts/deploy/*.mjs, scripts/smoke-public-edge.mjs, scripts/send-test-alert.mjs, scripts/replay-deletions.mjs)', () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'deploy/risepath-vm/scripts')).filter((f) => f.endsWith('.sh')).map((f) => `deploy/risepath-vm/scripts/${f}`),
      ...fs.readdirSync(path.join(ROOT, 'scripts/deploy')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/deploy/${f}`),
      'scripts/smoke-public-edge.mjs',
      'scripts/send-test-alert.mjs',
      // Phase 9 stage 5: the replay's stop line (consent/grant rows) names 手順書 16.2.
      'scripts/replay-deletions.mjs',
    ];
    let n = 0;
    for (const f of files) if (fs.existsSync(path.join(ROOT, f))) n += check(read(f), f);
    assert.ok(n > 0);
    assert.ok(check(read('scripts/replay-deletions.mjs'), 'scripts/replay-deletions.mjs') > 0, 'the replay\'s messages are scanned');
  });
  it('in the files the owner edits on the VM (deploy/risepath-vm/*.env.example: the comments above each line)', () => {
    const files = fs.readdirSync(path.join(ROOT, 'deploy/risepath-vm')).filter((f) => f.endsWith('.env.example')).map((f) => `deploy/risepath-vm/${f}`);
    assert.ok(files.includes('deploy/risepath-vm/backup.env.example') && files.includes('deploy/risepath-vm/launch-record.env.example'), files.join(', '));
    let n = 0;
    for (const f of files) n += check(read(f), f);
    assert.ok(n > 0);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Stage 6: the step bodies, the documents that link here, and D8 (design §9.2 #5-#9, #11, #12; §8.3-§8.8).

/** The body of step `### <id> ` up to the next heading. @param {string} id */
function stepBody(id) {
  const start = text.search(new RegExp(`^### ${id.replace('.', '\\.')} `, 'm'));
  assert.ok(start >= 0, id);
  const rest = text.slice(start);
  const end = rest.slice(4).search(/^#{2,3} /m);
  return end < 0 ? rest : rest.slice(0, end + 4);
}
/** A step's top-level line `- <label>` and its indented lines. @param {string} body @param {string} label */
function stepPart(body, label) {
  const lines = body.split('\n');
  const from = lines.findIndex((line) => line.startsWith(`- ${label}`));
  assert.ok(from >= 0, label);
  const to = lines.findIndex((line, i) => i > from && /^\S/.test(line));
  return lines.slice(from, to < 0 ? undefined : to).join('\n');
}
const STEP_IDS = [...text.matchAll(/^### (\d+\.\d+) /gm)].map((m) => m[1]);
/** 8.2 and 9.1 were merged into or moved to other steps (TR12); their headings stay so numbers stay valid. */
const POINTERS = { '8.2': 'この手順は 8.4 にまとめました。ここでは何もしません。', '9.1': '外からの確かめ（`npm run smoke:edge`）は、Vercel の保護を外したあと（10.3 の最後）にします。ここでは何もしません。' };
const STEP_LINES = ['[ ] 済んだ日: ＿＿＿＿', 'だれが・どこで: ', '先に済ませること: ', 'やること:', 'うまくいったとき: ', 'うまくいかないとき: ', 'くわしく: '];
/** Text outside fenced code blocks. @param {string} body */
const prose = (body) => body.split(/^```[^\n]*$/m).filter((_, i) => i % 2 === 0).join('\n');

describe('first-launch.ja.md: every step block has its lines (design §9.2 #5)', () => {
  it('every step except the two pointers has the seven lines once, in order, and a numbered やること list', () => {
    assert.ok(STEP_IDS.length >= 70, `${STEP_IDS.length} steps`);
    for (const id of STEP_IDS) {
      const body = stepBody(id);
      if (Object.hasOwn(POINTERS, id)) {
        assert.ok(body.includes(POINTERS[id]), `${id}: the pointer sentence`);
        assert.doesNotMatch(body, /^- /m, `${id}: a pointer has no step lines`);
        continue;
      }
      const top = body.split('\n').filter((line) => line.startsWith('- '));
      assert.deepEqual(top.map((line) => STEP_LINES.findIndex((label) => line.startsWith(`- ${label}`))), STEP_LINES.map((_, i) => i), `${id}: ${top.map((l) => l.slice(0, 12)).join(' | ')}`);
      assert.match(stepPart(body, 'やること:'), /\n {2}1\. /, `${id}: numbered`);
      for (const label of ['だれが・どこで: ', '先に済ませること: ', 'うまくいったとき: ', 'うまくいかないとき: ', 'くわしく: ']) {
        assert.ok(stepPart(body, label).length > `- ${label}`.length + 1, `${id}: ${label} has text`);
      }
    }
  });
  it('「先に済ませること」 names only steps that exist and come earlier in the runbook (or 16 章 steps that point back)', () => {
    const order = new Map(STEP_IDS.map((id, i) => [id, i]));
    for (const id of STEP_IDS.filter((x) => !Object.hasOwn(POINTERS, x))) {
      // The steps it names come before any note in brackets (11.8 names itself and 12.1 in its note).
      const line = stepPart(stepBody(id), '先に済ませること: ').split('\n')[0].split('（')[0];
      for (const m of line.matchAll(/(?<![\d.])(\d{1,2}\.\d)(?:〜(\d{1,2}\.\d))?(?![\d.])/g)) {
        for (const ref of [m[1], m[2]].filter(Boolean)) {
          assert.ok(order.has(/** @type {string} */ (ref)), `${id}: 先に ${ref} exists`);
          assert.ok(/** @type {number} */ (order.get(/** @type {string} */ (ref))) < /** @type {number} */ (order.get(id)), `${id}: 先に ${ref} comes before it`);
        }
      }
    }
  });
});

describe('first-launch.ja.md: はじめに and 1 章 (design §8.1, §8.2)', () => {
  const intro = text.slice(text.indexOf('## はじめに'), text.indexOf('## 1. '));
  it('はじめに holds who does what, the record is not proof, no secret in chat, the VM folder, and the two standing rules', () => {
    for (const must of ['オーナー: ', 'エージェント（Claude Code など）: ', '弁護士: ', 'launch-record.env は、オーナーの記録です。証明ではありません。', 'チャット、issue、git に貼りません', '`cd /opt/risepath/deploy/risepath-vm`', '`COMPOSE_PROJECT_NAME=risepath-ci`']) {
      assert.ok(intro.includes(must), must);
    }
    assert.match(intro, /1\. \*\*デプロイの前に\*\*: GitHub の main で、いちばん上のコミットに緑の ✓ があることを見て、その 7 文字（例: `a1b2c3d`）を書き留めます。デプロイの途中に出る「==> デプロイするコミット: …」が同じ 7 文字であることを見ます。✓ がないときや、文字がちがうときは、そこで止めてエージェントに聞きます。/u);
    assert.match(intro, /2\. \*\*事前チェックの注意\*\*: .*「出てよい注意」.*いまは直しません/u);
    // The commit line the rule quotes is the one deploy-stack.sh prints.
    assert.match(read('deploy/risepath-vm/scripts/deploy-stack.sh'), /echo "==> デプロイするコミット: \$\(git /);
  });
  it('1 章 records D1-D8, the three defaults, and P9-Q1-Q6 with an answer or 未回答', () => {
    const rowsOf = rows(chapter('1'));
    const ids = rowsOf.map((r) => r[0]);
    for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', '既定 1', '既定 2', '既定 3']) {
      const row = rowsOf.find((r) => r[0] === d);
      assert.ok(row, d);
      assert.equal(row[1], '2026-10-30 オーナー', `${d}: decided by`);
    }
    for (let n = 1; n <= 6; n += 1) {
      const row = rowsOf.find((r) => r[0] === `P9-Q${n}`);
      assert.ok(row && row[3], `P9-Q${n} has an answer cell`);
    }
    assert.ok(ids.indexOf('D1') < ids.indexOf('D8'));
    // TR5: the pilot list is unconditional, recorded under D1 and as P9-Q1's answer.
    assert.match(/** @type {string[]} */ (rowsOf.find((r) => r[0] === 'D1'))[2], /試験運用の名簿（`PILOT_ACCOUNT_IDS`）/u);
    assert.match(/** @type {string[]} */ (rowsOf.find((r) => r[0] === 'P9-Q1'))[3], /^名簿を使います（D1 と D5 から決まりました/u);
  });
});

describe('first-launch.ja.md: です・ます and the domain (design §9.2 #7, #8)', () => {
  it('no line of the runbook ends with だ。 or である。', () => {
    for (const line of prose(text).split('\n')) assert.ok(!/(?:だ|である)。$/.test(line), line);
  });
  it('when 1 章 records a domain, no <domain> is left (skipped while it says 未定)', (t) => {
    const m = /^ドメイン: (.+)$/m.exec(chapter('1'));
    assert.ok(m, '1 章 has the domain line');
    if (m[1].trim() === '未定') {
      t.diagnostic('the domain is not decided yet');
      return;
    }
    assert.doesNotMatch(text, /<domain>/);
  });
});

describe('first-launch.ja.md: the deploy order (D11) and the documents that link here (design §9.2 #6, §8.3)', () => {
  const D11 = '法務の版を変えるプルリクエストをマージしたら、すぐに VM で `deploy-stack.sh` を実行します。Vercel はマージで先に新しい画面を出すので、VM が追いつくまで、新しい版には同意できません（409）。';
  it('11.3 holds the sentence verbatim, and only 11.3', () => {
    assert.ok(stepBody('11.3').includes(D11));
    assert.equal(text.split(D11).length - 1, 1);
  });
  it('the Vercel runbook, the legal README, the VM guide and the plan link to the runbook, and say 11.3 where they give the deploy order', () => {
    for (const rel of ['deploy/vercel/README.md', 'doc/legal/README.md', 'doc/guides/risepath_vm_deployment.md', 'doc/brushup-2026/ai-access-plan.ja.md', 'deploy/risepath-vm/README.md']) {
      assert.match(read(rel), /\]\((?:\.\.\/)*(?:\.\/)?(?:doc\/guides\/|guides\/)?first-launch\.ja\.md\)/, `${rel} links first-launch.ja.md`);
    }
    const legalReadme = read('doc/legal/README.md');
    const publish = legalReadme.slice(legalReadme.indexOf('## ページを公開する手順'));
    const legal = publish.split('\n').find((l) => l.startsWith('7. '));
    assert.match(legal ?? '', /\*\*すぐに\*\* VM で `deploy-stack\.sh`.*手順書 11\.3/u, 'legal README step 7');
    const vercel = read('deploy/vercel/README.md');
    assert.match(vercel, /マージしたら、すぐに VM で `deploy-stack\.sh` を実行する\*\*（順番の決まりは手順書 11\.3/u);
    assert.match(vercel, /マージしたら、すぐに VM で `deploy-stack\.sh` を流す（順番の決まりは手順書 11\.3）/u);
    const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
    assert.ok((plan.match(/手順書 11\.3/g) ?? []).length >= 4, 'the plan\'s four deploy-order places (D11)');
    assert.doesNotMatch(plan, /VM を先に更新するため、マージのあいだだけ Vercel の自動デプロイを止めるか/u);
  });
  it('step 0 of the Vercel runbook and §4.5 of the VM guide shrank to the runbook link (finding 22: their pinned lines stay)', () => {
    const step0 = read('deploy/vercel/README.md').split('\n').find((line) => line.startsWith('0. ')) ?? '';
    assert.match(step0, /^0\. 新しい VM から公開までの順番は \[doc\/guides\/first-launch\.ja\.md\]\(\.\.\/\.\.\/doc\/guides\/first-launch\.ja\.md\) にまとめた。下の手順 1〜17 は、その手順書から開く。/u);
    assert.doesNotMatch(step0, /この変更の PR/u, 'D3');
    const guide = read('doc/guides/risepath_vm_deployment.md');
    const s45 = guide.slice(guide.indexOf('### 4.5 '), guide.indexOf('\n---', guide.indexOf('### 4.5 ')));
    assert.match(s45.split('\n')[2], /^新しい VM から公開までの順番は \[手順書\]\(\.\/first-launch\.ja\.md\) の 4〜6 章/u);
    assert.match(s45, /`SUPABASE_URL` が `https:\/\/<project>\.supabase\.co` であることを見る（事前チェックも確かめる。手順書 5\.3）→ `bootstrap-vm\.sh`（2 回目）/u);
  });
  it('the contradictions of map §3 are gone (D1-D10, D12, D15, D16, D21, D24)', () => {
    const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
    const vercel = read('deploy/vercel/README.md');
    const byoa = read('doc/guides/byoa-setup.ja.md');
    assert.doesNotMatch(plan, /000–020/u, 'D1');
    assert.match(plan, /2026-10-30 に見たとき、ここに書いていた 10 件は、すべて閉じていました。ルールセットはすぐ作れます。/u, 'D2');
    assert.match(vercel, /Vercel のプロジェクト `rise-path` はもうあり、`main` への push ごとにデプロイしている（Git 連携。Production Branch は `main`）。手順書 2\.6 で/u, 'D4');
    assert.doesNotMatch(vercel, /ゾーンを待つあいだに import 済みなら/u, 'D4');
    assert.match(read('doc/guides/risepath_vm_deployment.md'), /GitHub での実行は動いている。必須のチェックにするルールセットだけが残っている/u, 'D5');
    assert.match(byoa, /（すでに動いている VM を更新するときだけ）.*新しい VM では最初のデプロイで 000–021 が当たっています。/u, 'D7');
    assert.match(vercel, /Cloudflare の読み取りの時間切れは 100〜125 秒ほど（未確認。/u, 'D8');
    assert.match(byoa, /Cloudflare の読み取りの時間切れは 100〜125 秒ほどです（未確認）。/u, 'D8');
    assert.doesNotMatch(byoa, /約 100 秒と言われています/u, 'D8');
    assert.match(vercel, /Site URL を変えると、ほかのアプリの認証メールのリンクも変わる。/u, 'D9');
    assert.match(vercel, /「Allow new users to sign up」は Nexloom・P-School と共有の設定で、切るとそれらのアプリの登録も止まる/u, 'D10');
    assert.match(plan, /\*\*読み上げ（TTS）\*\*: 本番（strict）ではログインが要ります.*1 回の文は 1,000 文字までです/u, 'D12');
    // Stage 4's notes: no current-state line may still say the TTS cache is never deleted (tools/core/kokoroTts.js prunes it).
    assert.doesNotMatch(plan, /読み上げ音声のキャッシュと生成した画像には、消す仕組みがありません/u, 'TTS cache retention (plan 4.4)');
    assert.match(plan, /読み上げ音声のキャッシュは、Phase 9 から、30 日を過ぎた音声を返さず、1 時間ほどで消します/u, 'TTS cache retention (plan 4.4)');
    assert.match(plan, /`GEMINI_API_KEY` と `GEMINI_ALLOWED` を両方とも空にします（`GOOGLE_API_KEY` も入れません）/u, 'D15');
    for (const [rel, body] of [['plan', plan], ['byoa-setup', byoa]]) {
      // The docs' own name is quoted where it is cited (「Supabase の文書では…」 and the 出典 line); every other use is the one name.
      const uses = body.split('\n').filter((line) => !/^\s*出典: /u.test(line)).join('\n').replace(/Supabase の文書では「Require current password when changing password」/gu, '');
      assert.doesNotMatch(uses, /Require current password when changing password/u, `D16: ${rel} uses one name`);
    }
    assert.match(read('deploy/risepath-vm/README.md'), /事前チェック（`preflight\.sh`）が確かめます（手順書 5\.3）/u, 'D21');
    assert.doesNotMatch(read('deploy/risepath-vm/README.md'), /`GEMINI_ALLOWED` が空かも見ます/u, 'D21');
    assert.match(vercel, /Production には、試験運用の名簿を確かめるまで Deployment Protection（範囲は All Deployments）をかけたままにする（手順書 2\.6）。外すのは手順書 10\.3。/u, 'D24');
  });
  it('the old documents carry the banner on their first line (D6), and secrets.inventory.template its header (D20)', () => {
    for (const rel of ['doc/guides/prod_readiness_plan.md', 'doc/guides/portable_deployment.md', 'Dockerfile', 'Procfile', 'docker-compose.yml', 'scripts/vm/postgres_risepath_bootstrap.sql']) {
      assert.match(read(rel).split('\n')[0], /^(?:> |# |-- )古い(?:計画|手順)です（[^）]+）。.*公開の手順は doc\/guides\/first-launch\.ja\.md です/u, rel);
    }
    assert.equal(read('secrets.inventory.template').split('\n')[0], '# 古い一覧です。今の一覧は doc/guides/first-launch.ja.md の 15 章と、事前チェックの名前の一覧（scripts/deploy/preflight-rules.mjs KNOWN_KEYS）です。');
    const appendix = text.slice(text.indexOf('## 付録 '));
    assert.ok(appendix.startsWith('## 付録 古い文書'));
    for (const rel of ['doc/guides/prod_readiness_plan.md', 'doc/guides/portable_deployment.md', 'scripts/vm/postgres_risepath_bootstrap.sql', 'secrets.inventory.template']) assert.ok(appendix.includes(`\`${rel}\``), `付録 names ${rel}`);
  });
});

/**
 * The .md, .mjs, .js, .sh and .sql files git tracks or would track: the index and the untracked files that .gitignore
 * does not exclude (git ls-files --cached --others --exclude-standard; a walk outside a checkout). Review round 2 of
 * Stage 6, finding 6: with the index alone, a new test file was out of the scan until it was committed, so the local
 * `npm test` before the commit passed and CI failed after it.
 * @param {string} [root]
 * @returns {string[]}
 */
function trackedTextFiles(root = ROOT) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.mjs', '*.js', '*.sh', '*.sql'], { cwd: root, encoding: 'utf8' });
  if (listed.status === 0 && listed.stdout) return [...new Set(listed.stdout.split('\0'))].filter((f) => f && fs.existsSync(path.join(root, f)));
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.artifacts'].includes(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(?:md|mjs|js|sh|sql)$/.test(entry.name)) out.push(rel);
    }
  };
  walk('');
  return out;
}

/** A listed file's text, or '' when it went away after the listing (another test's temporary file). @param {string} rel */
function readListed(rel) {
  try {
    return read(rel);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return '';
    throw err;
  }
}

/** The production database hosts as hosts (not the folder deploy/risepath-vm). */
const PROD_HOST = /(?<![\w.-])(?<!deploy\/)(?:risepath-vm|nexloom-gce)(?![\w-])/;
const NEVER = /使いません|使わない|never|not\b/;
/** The production database's port or service, said to be reachable over Tailscale (review round 1 of Stage 6, finding 3). */
const DB_PORT = /5432|(?<![\w-])db(?:（|・| \()/;
const DB_REACH = /Tailscale|今までどおり|これまでどおり/;
const DB_CLOSED = /だれにも開け|開けない|開けません|閉じ|never|not\b/;
/**
 * Files marked old (D6) and runbook 18 章 (its "do not" examples) are exempt, and the two tests whose fixtures are the
 * production URLs on purpose: this file (the scan's self-tests) and verifyEnv.test.js (env:check must warn on them;
 * review round 2 of Stage 6, finding 6).
 */
const D8_EXEMPT = new Set(['doc/guides/prod_readiness_plan.md', 'doc/guides/portable_deployment.md', 'scripts/vm/postgres_risepath_bootstrap.sql', 'server/tests/firstLaunchRunbook.test.js', 'server/tests/verifyEnv.test.js']);

/**
 * D8 findings in one file's text (design §9.2 #9).
 * @param {string} rel @param {string} body
 */
function d8Findings(rel, body) {
  /** @type {string[]} */
  const out = [];
  const scanned = rel === RUNBOOK ? body.replace(chapter('18'), '') : body;
  scanned.split('\n').forEach((line, i) => {
    const where = `${rel}:${i + 1}`;
    if (/@(?:risepath-vm|nexloom-gce):5432/.test(line)) out.push(`${where}: a production database URL`);
    if (/\.env\.local/.test(line) && PROD_HOST.test(line) && !NEVER.test(line)) out.push(`${where}: .env.local with a production host`);
    if (/db:migrate/.test(line) && /(?<![\w.-])(?<!deploy\/)risepath-vm(?![\w-])/.test(line)) out.push(`${where}: db:migrate on risepath-vm`);
    if (/Deployment Protection/.test(line) && /かけない/.test(line)) out.push(`${where}: no Deployment Protection`);
    if (DB_PORT.test(line) && DB_REACH.test(line) && !DB_CLOSED.test(line)) out.push(`${where}: the database reachable over Tailscale`);
  });
  return out;
}

describe('D8: no tracked file points development at production (design §7.2, §9.2 #9; findings 18, 27)', () => {
  it('no production database URL, no .env.local on a production host, no db:migrate on risepath-vm, no "no Deployment Protection"', () => {
    const files = trackedTextFiles().filter((f) => !D8_EXEMPT.has(f) && !f.startsWith('node_modules/'));
    assert.ok(files.length > 200, `${files.length} files`);
    assert.ok(files.includes(RUNBOOK) && files.includes('deploy/risepath-vm/scripts/bootstrap-vm.sh'));
    const found = files.flatMap((f) => d8Findings(f, readListed(f)));
    assert.deepEqual(found, []);
    // The new test files are scanned before they are committed (finding 6): the list holds untracked files too.
    for (const f of ['server/tests/verifyEnv.test.js', 'server/tests/restoreByHand.test.js']) assert.ok(trackedTextFiles().includes(f), f);
  });
  it('the file list holds the index and the untracked files .gitignore does not exclude (finding 6 of review round 2)', { skip: spawnSync('git', ['--version']).status === 0 ? false : 'needs git' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p9-d8-'));
    try {
      const git = (/** @type {string[]} */ ...args) => assert.equal(spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).status, 0, args.join(' '));
      git('init', '-q');
      fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.md\n');
      for (const f of ['tracked.md', 'new.test.js', 'ignored.md', 'note.txt']) fs.writeFileSync(path.join(dir, f), 'x\n');
      git('add', 'tracked.md', '.gitignore');
      assert.deepEqual(trackedTextFiles(dir).sort(), ['new.test.js', 'tracked.md']);
      // A production URL in a new, uncommitted file is found by the scan.
      fs.writeFileSync(path.join(dir, 'new.test.js'), "const url = 'postgresql://u:p@risepath-vm:5432/risepath';\n");
      assert.deepEqual(trackedTextFiles(dir).flatMap((f) => d8Findings(f, fs.readFileSync(path.join(dir, f), 'utf8'))), ['new.test.js:1: a production database URL']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the scan catches each pattern (a near miss passes: the folder deploy/risepath-vm, a never sentence)', () => {
    assert.equal(d8Findings('x.md', 'DATABASE_URL_PHASE1=postgresql://u:p@risepath-vm:5432/risepath').length, 1);
    assert.equal(d8Findings('x.md', 'Mac の `.env.local` を http://risepath-vm:3006 に向ける').length, 1);
    assert.equal(d8Findings('x.md', 'npm run db:migrate   # risepath-vm に当てる').length, 1);
    assert.equal(d8Findings('x.md', 'Production に Deployment Protection をかけない。').length, 1);
    assert.equal(d8Findings('x.md', '`.env.local` には `risepath-vm` も `nexloom-gce` も使いません。').length, 0);
    assert.equal(d8Findings('x.md', 'deploy/risepath-vm/scripts/deploy-stack.sh runs npm run db:migrate').length, 0);
    assert.equal(d8Findings('x.md', 'Mac の `.env.local` は本番の DB を使わない（deploy/risepath-vm/README.md）').length, 0);
    // The database said to be reachable over Tailscale as before (the three lines of finding 3), and the D8 wording.
    assert.equal(d8Findings('x.md', 'db（5432）・mcp（3100）・kokoro（8880）には、Tailscale から今までどおり届きます。').length, 1);
    assert.equal(d8Findings('x.md', 'db・mcp・kokoro（Hermes を有効にしたときは hermes も）への Tailscale 接続は今までどおり').length, 1);
    assert.equal(d8Findings('x.md', '[Mac / Tailscale]  risepath-vm の 5432（db）・3100（mcp）は今までどおり。').length, 1);
    assert.equal(d8Findings('x.md', '5432（db）は、Tailscale の ACL でもだれにも開けない（D8）。').length, 0);
    assert.equal(d8Findings('x.md', 'mcp（3100）には、Tailscale から今までどおり届きます。').length, 0);
  });
  it('runbook 18 章 gives the development database the VM\'s pinned image and keeps production on the VM', () => {
    const ch18 = chapter('18');
    const image = /image: (pgvector\/pgvector:\S+)/.exec(read('deploy/risepath-vm/docker-compose.yml'))?.[1];
    assert.ok(image && ch18.includes(image), 'the db image of docker-compose.yml');
    assert.match(ch18, /-p 127\.0\.0\.1:5433:5432/);
    assert.match(ch18, /`postgresql:\/\/risepath_app:<開発用のパスワード>@127\.0\.0\.1:5433\/risepath\?sslmode=disable`/);
    assert.match(ch18, /exec -T api node scripts\/delete-account-data\.mjs/);
    // Review round 1 of Stage 6, finding 15: the interactive session needs a terminal (no -T), or psql shows no prompt.
    // Review round 3, finding 2: risepath_app is the image's POSTGRES_USER (a superuser), and a typed `BEGIN READ ONLY;`
    // does not cover a one-shot -c, so both forms set default_transaction_read_only through PGOPTIONS (a write is an
    // error; real compose proof: SP/p9/build/s6r3/ro/readonly-proof.txt).
    const session = ch18.split('\n').find((line) => line.startsWith('- 読むだけの調べもの: ')) ?? '';
    const RO = "-e PGOPTIONS='-c default_transaction_read_only=on'";
    const forms = [...session.matchAll(/`(docker compose [^`]+)`/g)].map((m) => m[1]);
    assert.deepEqual(forms, [
      `docker compose --env-file stack.env exec ${RO} db psql -U risepath_app -d risepath`,
      `docker compose --env-file stack.env exec -T ${RO} db psql -U risepath_app -d risepath -c "…"`,
    ], 'the session (no -T) and the one-shot (-T, -c), both read-only');
    const psqls = [...ch18.matchAll(/exec ([^`]*?)\bdb psql/g)].map((m) => m[1]);
    assert.ok(psqls.length === 2 && psqls.every((flags) => flags.includes(RO)), 'no psql on the VM database without PGOPTIONS in 18 章');
    assert.match(session, /`risepath=#` が出ます/u, 'the prompt of a superuser');
    assert.match(session, /`PGOPTIONS` の部分を省きません/u);
    assert.doesNotMatch(ch18, /BEGIN READ ONLY/, 'one way only: the setting, not a statement to remember');
    assert.match(read('deploy/risepath-vm/docker-compose.yml'), /POSTGRES_USER: \$\{POSTGRES_USER\}/, 'risepath_app is the image\'s POSTGRES_USER');
  });
  it('the old tool that wrote the production URL to the Mac is gone (P9-Q4), and bootstrap-vm.sh prints no database URL', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'scripts/sync-db-url-from-vm.py')), false);
    const boot = read('deploy/risepath-vm/scripts/bootstrap-vm.sh');
    assert.doesNotMatch(boot, /postgresql:\/\//);
    assert.match(boot, /echo "Mac の \.env\.local は、開発用の DB を使います（doc\/guides\/first-launch\.ja\.md 18 章/u);
  });
});

describe('every 「手順書 X.Y」 in the documents that link the runbook resolves (design §9.2 #11 for §8.3)', () => {
  it('in the Vercel runbook, the VM README and guide, the legal README, the plan, the deletion guide and the D8 docs', () => {
    let n = 0;
    for (const rel of ['deploy/vercel/README.md', 'deploy/risepath-vm/README.md', 'doc/guides/risepath_vm_deployment.md', 'doc/legal/README.md', 'doc/legal/ai-data-inventory.ja.md', 'doc/brushup-2026/ai-access-plan.ja.md', 'doc/guides/account-deletion-operations.ja.md', 'doc/guides/env_local_setup_issue15.md', 'doc/system_design/database_topology.md', 'AGENTS.md']) {
      for (const m of read(rel).matchAll(/手順書 (\d+(?:\.\d+)?(?:[・〜]\d+(?:\.\d+)?)*)/g)) {
        for (const ref of m[1].split(/[・〜]/)) {
          n += 1;
          const re = ref.includes('.') ? new RegExp(`^### ${ref.replace('.', '\\.')} `, 'm') : new RegExp(`^## ${ref}\\. `, 'm');
          assert.match(text, re, `${rel}: 手順書 ${ref}`);
        }
      }
    }
    assert.ok(n >= 20, `${n} references`);
  });
});

/** The stack.env 5.1 writes: tts only, no edge values (7.4) and no deletion switch (11.2). */
const STACK_51 = { COMPOSE_PROFILES: 'tts', ORIGIN_SECRET: null, TRUST_PROXY: null, LLM_ALLOWED_ORIGINS: null, ACCOUNT_DELETION_ENABLED: null };
/** Runbook 16.3 step 6's writes, by the step that first wrote them (a new name there needs a group here). */
const RESTORE_GROUPS = { edge: ['ORIGIN_SECRET', 'TRUST_PROXY', 'LLM_ALLOWED_ORIGINS', 'COMPOSE_PROFILES'], list: ['PILOT_ACCOUNT_IDS'], deletion: ['ACCOUNT_DELETION_ENABLED'] };
/**
 * What runbook 16.3 step 6 writes back, read from its text: every `NAME=value` in backticks (a value the owner pastes
 * from the password manager becomes the fixtures' value), and whether it writes tunnel.env.
 */
function restoreWrites163() {
  const todo = stepPart(stepBody('16.3'), 'やること:');
  const six = todo.slice(todo.indexOf('\n  6. '), todo.indexOf('\n  7. '));
  assert.ok(six.length > 10, '16.3 step 6');
  const paste = { ORIGIN_SECRET: BASE_STACK.ORIGIN_SECRET, PILOT_ACCOUNT_IDS: PILOT_ID };
  /** @type {Record<string, string>} */
  const writes = {};
  for (const m of six.matchAll(/`([A-Z][A-Z0-9_]*)=([^`]*)`/g)) {
    const value = m[2] === '' ? paste[/** @type {keyof typeof paste} */ (m[1])] : m[2].replace('<domain>', 'example.org');
    assert.ok(value, `16.3 step 6: a value for ${m[1]}`);
    writes[m[1]] = value;
  }
  return { writes, tunnel: /tunnel\.env を作り/.test(six) };
}
/**
 * The stack after 16.3: the 5.1 stack.env, plus step 6's writes of the given groups (tunnel.env with the edge).
 * @param {(keyof typeof RESTORE_GROUPS)[]} groups
 */
function rebuilt163(groups) {
  const { writes, tunnel } = restoreWrites163();
  /** @type {Record<string, string | null>} */
  const stack = { ...STACK_51 };
  for (const g of groups) for (const name of RESTORE_GROUPS[g]) if (Object.hasOwn(writes, name)) stack[name] = writes[name];
  return { stack, tunnel: groups.includes('edge') && tunnel ? {} : null };
}

/**
 * The launch-record.env runbook 16.3 rebuilds, read from its text (review round 2 of Stage 6, findings 1 and 7). 14 章
 * copies the dates beside the checkboxes, so the copy starts as the lost VM's record with every value that is not a date
 * (ATTESTATIONS kind other than 'date') empty; what 16.3 steps 1, 2 and 7 say they write is all that fills it. A sentence
 * missing there leaves the fixture without the value, and the engine then stops the step it is needed for.
 * @param {Record<string, string>} lost the record the lost VM had
 */
function record163(lost) {
  const todo = stepPart(stepBody('16.3'), 'やること:');
  const step = (/** @type {number} */ n) => todo.slice(todo.indexOf(`\n  ${n}. `), todo.indexOf(`\n  ${n + 1}. `));
  assert.ok(step(1).includes('戻し終わるまで `LAUNCH_STAGE=setup` にします'), '16.3 step 1: setup until the restore is done');
  assert.ok(step(7).includes('`LAUNCH_STAGE` を、なくす前の段階に書き戻します'), '16.3 step 7: the stage back');
  /** @type {Record<string, string>} */
  const copied = Object.fromEntries(ATTESTATIONS.map((a) => [a.key, a.kind === 'date' ? (lost[a.key] ?? '') : '']));
  /** Steps 1-6 (5.3, 6.1 and the restore's RS0/RS11 run at setup). @type {Record<string, string>} */
  const rebuild = { ...copied, LAUNCH_STAGE: 'setup' };
  if (step(1).includes('`ALERT_WATCHER` と `ALERT_CHECK` には、3.6 で決めたこと（1 章の P9-Q3 の答え）を書きます')) {
    rebuild.ALERT_WATCHER = lost.ALERT_WATCHER;
    rebuild.ALERT_CHECK = lost.ALERT_CHECK;
  }
  if (step(1).includes('12.1 の `VERCEL_LEGAL_PAGES_ON` の日付は、7 まで空のままにします')) rebuild.VERCEL_LEGAL_PAGES_ON = '';
  /** From step 2 on: the key id of the imported key (the same key, so the same id as baseFacts()). @type {Record<string, string>} */
  const keyed = { ...rebuild };
  if (/鍵が戻ったら、`sudo \.\/scripts\/install-backup\.sh key-id` を実行し、出た 16 文字を、`nano launch-record\.env` で `BACKUP_KEY_ID` に書きます/u.test(step(2))) keyed.BACKUP_KEY_ID = baseFacts().backupKeyId;
  /** Step 7: the stage written back (and the legal pages' date, when 12.1 was done). @type {Record<string, string>} */
  const restored = { ...keyed, LAUNCH_STAGE: lost.LAUNCH_STAGE };
  if (step(7).includes('12.1 まで済んでいたときは、`VERCEL_LEGAL_PAGES_ON` にも、12.1 のチェックの横の日付を書き戻します')) restored.VERCEL_LEGAL_PAGES_ON = lost.VERCEL_LEGAL_PAGES_ON;
  return { rebuild, keyed, restored };
}
/** The record of a VM lost during the pilot (after 10.3, before 11.2) and of one lost after 12.1 (public). */
const LOST_PILOT = { ...baseRecord('pilot'), VERCEL_PROTECTION_OFF: '2026-11-01', SUPABASE_CURRENT_PASSWORD_ON: '', PASSWORD_CHANGE_CHECK: '', PROD_AMR_CHECK: '', MINORS_POLICY_DECIDED: '' };
const LOST_PUBLIC = baseRecord('public');

/**
 * The state of the stack at a runbook step that runs the 事前チェック (the facts and record as the steps
 * before it leave them), the engine's mode (standalone or from a deploy) and the stage.
 * @type {Record<string, { stage: string, mod: import('./helpers/preflightFixtures.js').Mod }>}
 */
const AT_STEP = (() => {
  const D = '2026-11-01';
  const later = { ALERT_TEST: '', MAC_DEV_DB_SEPARATE: '', BACKUP_KEY_COPY: '', BACKUP_KEY_ID: '', SUPABASE_CURRENT_PASSWORD_ON: '', PASSWORD_CHANGE_CHECK: '', PROD_AMR_CHECK: '', MINORS_POLICY_DECIDED: '' };
  const noBackup = { unitBackupTimer: 'disabled', backupTimersActive: false, backupKey: false, backupEnv: false, backupLastOk: '', drillLastOk: '', backupKeyId: '', backupAlert: '' };
  /** 5.1-5.3: no tunnel, no deploy yet, no backup; 2.6, 3.6 and 3.8 dated in 5.2. */
  const fresh = { stack: { ...STACK_51 }, tunnel: null, record: later, facts: { ...noBackup, unitStack: 'disabled', pgdataVolume: false, runningServices: [] }, lastGreen: null };
  /** 7.5: the tunnel, after 6.4/6.5 (backups and drill fresh, the key recorded). */
  const edge = { stack: { ACCOUNT_DELETION_ENABLED: null }, record: { ...later, BACKUP_KEY_COPY: D, BACKUP_KEY_ID: '0123456789abcdef' } };
  /** 9.6 on: 9.4 and 9.5 dated; deletion off until 11.2; the minors policy from 11.1. */
  const pilotRecord = { SUPABASE_CURRENT_PASSWORD_ON: '', PASSWORD_CHANGE_CHECK: '', PROD_AMR_CHECK: '', MINORS_POLICY_DECIDED: '' };
  const deploy = { from: 'deploy' };
  return {
    '5.3': { stage: 'setup', mod: fresh },
    '6.1': { stage: 'setup', mod: { ...fresh, facts: { ...fresh.facts, ...deploy } } },
    '7.5': { stage: 'setup', mod: { ...edge, facts: deploy } },
    '9.6': { stage: 'pilot', mod: { stack: { ACCOUNT_DELETION_ENABLED: null }, record: pilotRecord } },
    '10.1': { stage: 'pilot', mod: { stack: { ACCOUNT_DELETION_ENABLED: null, PILOT_ACCOUNT_IDS: PILOT_ID }, record: pilotRecord, facts: deploy } },
    '10.3': { stage: 'pilot', mod: { stack: { ACCOUNT_DELETION_ENABLED: null, PILOT_ACCOUNT_IDS: PILOT_ID }, record: { ...pilotRecord, VERCEL_PROTECTION_OFF: D } } },
    '10.4': { stage: 'pilot', mod: { stack: { ACCOUNT_DELETION_ENABLED: null, PILOT_ACCOUNT_IDS: `${PILOT_ID},${PILOT_ID_2}` }, record: { ...pilotRecord, VERCEL_PROTECTION_OFF: D }, facts: deploy } },
    '11.2': { stage: 'pilot', mod: { stack: { PILOT_ACCOUNT_IDS: PILOT_ID }, record: { VERCEL_PROTECTION_OFF: D, MINORS_POLICY_DECIDED: '' }, facts: deploy } },
    '11.3': { stage: 'pilot', mod: { stack: { PILOT_ACCOUNT_IDS: PILOT_ID }, record: { VERCEL_PROTECTION_OFF: D }, facts: deploy } },
    // 11.8: public written, the list line removed, so stack.env differs from the last green deploy's.
    '11.8': { stage: 'public', mod: { record: { VERCEL_LEGAL_PAGES_ON: '' }, lastGreen: { stackEnvSha256: 'b'.repeat(64) } } },
    '12.1': { stage: 'public', mod: { facts: deploy } },
    // 16.3 step 8: a VM lost during the pilot (after 10.3, before 11.2), rebuilt from 4 章〜6.3 (the 5.1 stack.env),
    // restored, backups and drill back, then step 6's writes as the text gives them, and the record as 16.3 rebuilds it
    // (dates copied; the key id, the watcher texts and the stage from what 16.3 says: review round 2, finding 7).
    '16.3': { stage: 'pilot', mod: { ...rebuilt163(['edge', 'list']), record: record163(LOST_PILOT).restored, facts: deploy } },
  };
})();

describe('the warnings each 事前チェック step expects are the ones the engine gives then (design §9.2 #12; finding 17)', () => {
  const RUNS = /`[^`]*(?:\.\/scripts\/preflight\.sh|\.\/scripts\/deploy-stack\.sh|\.\/bootstrap-vm\.sh)[^`]*`/;
  const runners = STEP_IDS.filter((id) => !Object.hasOwn(POINTERS, id) && RUNS.test(stepPart(stepBody(id), 'やること:')));
  /** The codes a step lists, or [] for 「出てよい注意はありません」. @param {string} id */
  const listed = (id) => {
    const ok = stepPart(stepBody(id), 'うまくいったとき: ');
    if (ok.includes('出てよい注意はありません')) return [];
    const m = /出てよい注意: ([A-Z]+\d+(?:・[A-Z]+\d+)*)[。（]/.exec(ok);
    assert.ok(m, `${id}: 「出てよい注意: …」 or 「出てよい注意はありません」`);
    assert.ok(ok.includes('いまは直しません'), `${id}: says not to fix them now`);
    return m[1].split('・');
  };
  it('every step that runs it names its expected warnings or says there are none, and has a state in AT_STEP', () => {
    assert.deepEqual(runners, Object.keys(AT_STEP), 'the steps that run the 事前チェック (a new one needs its state here)');
    for (const id of runners) listed(id);
  });
  for (const [id, { stage, mod }] of Object.entries(AT_STEP)) {
    it(`${id}: no error, and exactly the warnings and notes it lists (${stage})`, () => {
      const found = checkStack(buildInput(stage, mod));
      assert.deepEqual(found.filter((f) => f.level === 'E').map((f) => f.code), [], `${id}: the steps before it leave no error`);
      const engine = [...new Set(found.map((f) => f.code))].sort();
      const names = listed(id);
      const fromEngine = names.filter((c) => RULES.some((r) => r.code === c)).sort();
      assert.deepEqual(fromEngine, engine, `${id}: 出てよい注意 vs the engine`);
      for (const c of names.filter((x) => !fromEngine.includes(x))) {
        const after = POSTDEPLOY_CODES.find((p) => p.code === c);
        assert.ok(after && after.level !== 'E', `${id}: ${c} is a warning of the 事後の確かめ`);
        assert.equal(/** @type {any} */ (mod).facts?.from, 'deploy', `${id}: ${c} only where the step deploys`);
      }
    });
  }

  // Review round 1 of Stage 6, findings 1 and 11: a VM lost after 10.3 is rebuilt through 4 章〜6.3 (the 5.1 stack.env)
  // with the record copied back (14 章). Step 6 must write the edge values, the list and the deletion switch back.
  describe('16.3: the rebuilt VM (findings 1 and 11 of review round 1)', () => {
    const D = '2026-11-01';
    const deploy = { from: 'deploy' };
    const codes = (/** @type {string} */ stage, /** @type {import('./helpers/preflightFixtures.js').Mod} */ mod) => checkStack(buildInput(stage, mod)).map((f) => `${f.code}:${f.level}`);
    it('step 6 writes exactly the names of 7.4, 10.1 and 11.2, each with the value those steps give, and tunnel.env (7.3)', () => {
      const { writes, tunnel } = restoreWrites163();
      assert.deepEqual(Object.keys(writes).sort(), Object.values(RESTORE_GROUPS).flat().sort());
      assert.ok(tunnel, 'tunnel.env from the saved token');
      assert.equal(writes.COMPOSE_PROFILES, 'tts,tunnel');
      assert.equal(writes.TRUST_PROXY, '1');
      assert.equal(writes.ACCOUNT_DELETION_ENABLED, 'true');
      const s74 = stepPart(stepBody('7.4'), 'やること:');
      for (const line of ['`TRUST_PROXY=1`', '`LLM_ALLOWED_ORIGINS=https://app.<domain>`', '`COMPOSE_PROFILES=tts,tunnel`']) assert.ok(s74.includes(line) && stepBody('16.3').includes(line), line);
      assert.ok(stepPart(stepBody('11.2'), 'やること:').includes('`ACCOUNT_DELETION_ENABLED=true`'));
      // The values come from the password manager under the names the earlier steps gave them.
      const six = stepPart(stepBody('16.3'), 'やること:');
      for (const [step, name] of [['7.1', '「Rise Path トンネルのトークン」'], ['7.4', '「Rise Path ORIGIN_SECRET」'], ['10.1', '「Rise Path 試験運用の名簿」']]) {
        assert.ok(stepPart(stepBody(step), 'やること:').includes(name), `${step} saves ${name}`);
        assert.ok(six.includes(name), `16.3 pastes ${name}`);
      }
      assert.match(six, /新しく作らずに/, 'the ORIGIN_SECRET Vercel already has');
    });
    it('without step 6, the stage written back stops the deploy: V1 at pilot, G3 at public (the steps are needed)', () => {
      const pilot = codes('pilot', { stack: { ...STACK_51 }, tunnel: null, record: { VERCEL_PROTECTION_OFF: D }, facts: deploy });
      assert.ok(pilot.includes('V1:E'), pilot.join(' '));
      const pub = codes('public', { stack: { ...STACK_51 }, tunnel: null, facts: deploy });
      assert.ok(pub.includes('G3:E'), pub.join(' '));
    });
    it('a VM lost after 12.1 (public): step 6 without the list but with the deletion switch gives no finding', () => {
      assert.deepEqual(codes('public', { ...rebuilt163(['edge', 'deletion']), facts: deploy }), []);
    });
    it('step 1 names V1 (and M1 only when 9.5 was not copied) beside the warnings 5.3 and 6.1 expect, with the record copied after 10.3', () => {
      const body = stepBody('16.3');
      assert.match(body, /5\.3 と 6\.1 で、そこに書いた注意のほかに V1 も出ます。9\.5 の日付を写したときは、M1 は出ません。どれも、いまは直しません。/);
      assert.match(body, /保護はかけ直しません/);
      // V1's fix (13 章 and the preflight's line) no longer reads as "clear the date": only a real re-protection clears it.
      const v1 = /** @type {{ fix: string }} */ (RULES.find((r) => r.code === 'V1'));
      assert.match(v1.fix, /保護を外したあと（`VERCEL_PROTECTION_OFF` に日付があるとき）は、名簿を戻します（VM を作り直したときは手順書 16\.3）。日付を消すのは、Vercel で保護を本当にかけ直したときだけです。$/u);
      const noBackup = { unitBackupTimer: 'disabled', backupTimersActive: false, backupKey: false, backupEnv: false, backupLastOk: '', drillLastOk: '', backupKeyId: '', backupAlert: '' };
      /** @type {[string, { from?: string }][]} */
      const runs = [['5.3', {}], ['6.1', deploy]];
      for (const [id, facts] of runs) {
        const listedThere = (/出てよい注意: ([A-Z]+\d+(?:・[A-Z]+\d+)*)[。（]/.exec(stepPart(stepBody(id), 'うまくいったとき: '))?.[1] ?? '').split('・').filter((c) => RULES.some((r) => r.code === c));
        for (const mac of [D, '']) {
          const mod = { stack: { ...STACK_51 }, tunnel: null, record: { VERCEL_PROTECTION_OFF: D, MAC_DEV_DB_SEPARATE: mac }, facts: { ...noBackup, unitStack: 'disabled', pgdataVolume: false, runningServices: [], ...facts }, lastGreen: null };
          const found = checkStack(buildInput('setup', mod));
          assert.deepEqual(found.filter((f) => f.level === 'E').map((f) => f.code), [], `${id}: no error`);
          const expected = [...listedThere.filter((c) => c !== 'M1' || mac === ''), 'V1'].sort();
          assert.deepEqual([...new Set(found.map((f) => f.code))].sort(), expected, `${id} in 16.3 (MAC_DEV_DB_SEPARATE=${mac || 'empty'})`);
        }
      }
    });
    // Review round 2 of Stage 6, findings 1 and 7: the record is rebuilt from the checkbox dates (14 章). The values that
    // are not dates come only from what 16.3 says, and a VM lost after 12.1 must not carry the legal pages' date before
    // step 6 has written the deletion switch back (G3 is an error at any stage once that date is there).
    describe('the record 16.3 rebuilds (findings 1 and 7 of review round 2)', () => {
      const noBackup = { unitBackupTimer: 'disabled', backupTimersActive: false, backupKey: false, backupEnv: false, backupLastOk: '', drillLastOk: '', backupKeyId: '', backupAlert: '' };
      const fresh = (/** @type {Record<string, string>} */ record, /** @type {{ from?: 'standalone' | 'deploy' }} */ facts) => ({ stack: { ...STACK_51 }, tunnel: null, record, facts: { ...noBackup, unitStack: 'disabled', pgdataVolume: false, runningServices: [], ...facts }, lastGreen: null });
      /** After 6.1 and --import-key, before install-backup.sh (the restore's RS0 and RS11). */
      const restoring = (/** @type {Record<string, string>} */ record, /** @type {'standalone' | 'deploy'} */ from) => ({ stack: { ...STACK_51 }, tunnel: null, record, facts: { unitBackupTimer: 'disabled', backupTimersActive: false, backupLastOk: '', drillLastOk: '', backupKeyId: '', runningServices: ['db', 'api', 'mcp', 'kokoro-tts'], from } });
      const listedAt = (/** @type {string} */ id) => (/出てよい注意: ([A-Z]+\d+(?:・[A-Z]+\d+)*)[。（]/.exec(stepPart(stepBody(id), 'うまくいったとき: '))?.[1] ?? '').split('・').filter((c) => RULES.some((r) => r.code === c));
      const sorted = (/** @type {{ code: string }[]} */ found) => [...new Set(found.map((f) => f.code))].sort();
      for (const [label, lost, groups] of /** @type {[string, Record<string, string>, (keyof typeof RESTORE_GROUPS)[]][]} */ ([['lost during the pilot', LOST_PILOT, ['edge', 'list']], ['lost after 12.1 (public)', LOST_PUBLIC, ['edge', 'deletion']]])) {
        const { rebuild, keyed, restored } = record163(lost);
        it(`${label}: 5.3 and 6.1 of the rebuild give no error, only their listed warnings (M1 not: 9.5 copied) and V1`, () => {
          for (const [id, facts] of /** @type {[string, { from?: 'standalone' | 'deploy' }][]} */ ([['5.3', {}], ['6.1', { from: 'deploy' }]])) {
            const found = checkStack(buildInput('setup', fresh(rebuild, facts)));
            assert.deepEqual(found.filter((f) => f.level === 'E').map((f) => f.code), [], `${id}: no error`);
            assert.deepEqual(sorted(found), [...listedAt(id).filter((c) => c !== 'M1'), 'V1'].sort(), `${id}`);
          }
        });
        it(`${label}: the restore's RS0 and RS11 give no error and only the codes step 3 names`, () => {
          const named = /出る ([A-Z]+\d+(?:・[A-Z]+\d+)*) は、いまは直しません/.exec(stepPart(stepBody('16.3'), 'やること:'))?.[1].split('・') ?? [];
          for (const from of /** @type {const} */ (['standalone', 'deploy'])) {
            const found = checkStack(buildInput('setup', restoring(keyed, from)));
            assert.deepEqual(found.filter((f) => f.level === 'E').map((f) => f.code), [], `${from}: no error`);
            for (const f of found) assert.ok(named.includes(f.code), `${from}: ${f.code} is named in step 3`);
          }
        });
        it(`${label}: step 8 (the stage written back, the deploy) gives no finding, as 16.3 says`, () => {
          assert.ok(stepPart(stepBody('16.3'), 'うまくいったとき: ').includes('出てよい注意はありません'));
          const found = checkStack(buildInput(lost.LAUNCH_STAGE, { ...rebuilt163(groups), record: restored, facts: { from: 'deploy' } }));
          assert.deepEqual(found.map((f) => `${f.code}:${f.level}`), []);
          // After step 7 the record is the lost one again, value for value (the legal pages' date included).
          assert.deepEqual(restored, lost);
        });
      }
      it('the record copied as dates only stops the steps: G3 at 6.1 and RS0 (public), R4 at pilot, R4 and K4 at public', () => {
        const datesOnly = (/** @type {Record<string, string>} */ lost) => Object.fromEntries(ATTESTATIONS.map((a) => [a.key, a.kind === 'date' ? (lost[a.key] ?? '') : '']));
        const pub = { ...datesOnly(LOST_PUBLIC), LAUNCH_STAGE: 'setup' };
        assert.ok(codes('setup', fresh(pub, { from: 'deploy' })).includes('G3:E'), '6.1 with the legal pages\' date');
        assert.ok(codes('setup', restoring(pub, 'standalone')).includes('G3:E'), 'RS0 with the legal pages\' date');
        const pilot8 = codes('pilot', { ...rebuilt163(['edge', 'list']), record: { ...datesOnly(LOST_PILOT), LAUNCH_STAGE: 'pilot', ALERT_WATCHER: LOST_PILOT.ALERT_WATCHER, ALERT_CHECK: LOST_PILOT.ALERT_CHECK }, facts: deploy });
        assert.deepEqual(pilot8, ['R4:E'], 'pilot step 8 without the key id');
        const public8 = codes('public', { ...rebuilt163(['edge', 'deletion']), record: { ...datesOnly(LOST_PUBLIC), LAUNCH_STAGE: 'public' }, facts: deploy });
        assert.deepEqual(public8.sort(), ['K4:E', 'R4:E'], 'public step 8 without the key id and the watcher texts');
      });
      it('14 章 and 17 章 say where each value that is not a date comes from; 13 章\'s G3 and R4 fixes name 16.3', () => {
        const nonDates = ATTESTATIONS.filter((a) => a.kind !== 'date').map((a) => a.key);
        assert.deepEqual(nonDates.sort(), ['ALERT_CHECK', 'ALERT_WATCHER', 'BACKUP_KEY_ID', 'LAUNCH_STAGE']);
        const lost14 = chapter('14').split('\n').find((line) => line.includes('ファイルをなくしたとき')) ?? '';
        const lost17 = chapter('17').split('\n').find((line) => line.startsWith('- **launch-record.env をなくした**')) ?? '';
        for (const [where, line] of [['14 章', lost14], ['17 章', lost17]]) {
          for (const key of nonDates) assert.ok(line.includes(`\`${key}\``), `${where}: ${key}`);
          assert.ok(line.includes('1 章の P9-Q3 の答え'), `${where}: the watcher texts from P9-Q3`);
          assert.ok(line.includes('`sudo ./scripts/install-backup.sh key-id` で出る 16 文字'), `${where}: the key id`);
        }
        // 3.6 keeps its decision where 14 章 sends the owner (P9-Q3), not only on the VM.
        assert.ok(stepPart(stepBody('3.6'), 'やること:').includes('1 章の P9-Q3 の「答え」に書きます'));
        const fix = (/** @type {string} */ code) => /** @type {{ fix: string }} */ (RULES.find((r) => r.code === code)).fix;
        assert.match(fix('G3'), /手順書 16\.3）は、11\.2 はしなおしません。16\.3 の 7 より前なら、launch-record\.env の `VERCEL_LEGAL_PAGES_ON` を 7 まで空にします/u);
        assert.match(fix('R4'), /手順書 16\.3）は、`--new-key` はしません。16\.3 の 2 のとおりに、`sudo \.\/scripts\/install-backup\.sh key-id`/u);
        // 16.3's failure path names R4 and K4 with the step that writes each value.
        const bad = stepPart(stepBody('16.3'), 'うまくいかないとき: ');
        assert.ok(bad.includes('「[R4]」が出たら 2 の `BACKUP_KEY_ID`') && bad.includes('「[K4]」が出たら 1 の `ALERT_WATCHER` と `ALERT_CHECK`'));
      });
    });
    it('step 3: the restore\'s 事前チェック and deploy (RS0, RS11) give no error and only the codes step 3 names', () => {
      const named = /出る ([A-Z]+\d+(?:・[A-Z]+\d+)*) は、いまは直しません/.exec(stepPart(stepBody('16.3'), 'やること:'))?.[1].split('・') ?? [];
      assert.deepEqual(named, ['R1', 'V1', 'M1']);
      // After 6.1 (the volume and the boot unit) and --import-key (the key and backup.env), before install-backup.sh.
      const facts = { unitBackupTimer: 'disabled', backupTimersActive: false, backupLastOk: '', drillLastOk: '', backupKeyId: '', runningServices: ['db', 'api', 'mcp', 'kokoro-tts'] };
      for (const from of ['standalone', 'deploy']) {
        for (const mac of [D, '']) {
          const found = checkStack(buildInput('setup', { stack: { ...STACK_51 }, tunnel: null, record: { VERCEL_PROTECTION_OFF: D, MAC_DEV_DB_SEPARATE: mac }, facts: { ...facts, from: /** @type {'standalone' | 'deploy'} */ (from) } }));
          assert.deepEqual(found.filter((f) => f.level === 'E').map((f) => f.code), [], `${from}: no error`);
          for (const f of found) assert.ok(named.includes(f.code), `${from}: ${f.code} is named in step 3`);
        }
      }
    });
  });
});

describe('first-launch.ja.md 15〜17 章 (design §8.7, §8.1 16 章 and 17 章)', () => {
  it('15 章: one row per secret of §8.7 after TR13 (no bypass secret), each with where, how, who, when and how to rotate', () => {
    const table = rows(chapter('15')).filter((r) => r[0] !== '秘密の値' && !/^-+$/.test(r[0]));
    for (const must of ['`POSTGRES_PASSWORD`', '`SUPABASE_SERVICE_ROLE_KEY`', '`RISE_PATH_BRIDGE_TOKEN`', '`ANTHROPIC_API_KEY`', '`ORIGIN_SECRET`', '`TUNNEL_TOKEN`', '`AI_CAP_ALERT_WEBHOOK_URL`', '控えの鍵', '`VITE_SUPABASE_ANON_KEY`', 'アカウント']) {
      const row = table.find((r) => r[0].includes(must));
      assert.ok(row, must);
      assert.equal(row.length, 6, `${must}: 6 cells`);
    }
    assert.doesNotMatch(chapter('15'), /Bypass|バイパス|SMOKE_VERCEL_BYPASS/u, 'TR13');
    assert.match(chapter('15'), /`SMOKE_BEARER`（`npm run smoke:edge` の任意のトークン）は、今までどおり使わなくてもかまいません/u);
  });
  it('16 章: the drill, the real restore in tmux with the agent (RS5 → --current-db-lost, a reboot → the same command), and the rebuilt VM\'s order', () => {
    assert.match(stepBody('16.1'), /sudo \.\/scripts\/restore-drill\.sh/);
    // Review round 1 of Stage 6, finding 4: the drill's schedule keeps R3 quiet. R3 counts 35 days from the last drill; the
    // first Monday of a month is 35 days after the previous one about five times a year, so the runbook says every 4 weeks.
    assert.doesNotMatch(text, /毎月の最初の月曜日/u);
    for (const [id, line] of [['16.1', stepPart(stepBody('16.1'), 'やること:')], ['12.4', stepPart(stepBody('12.4'), 'やること:')]]) {
      assert.match(line, /4 週間ごと/u, `${id}: every 4 weeks`);
      assert.match(line, /35 日をこえると、事前チェックが R3 を出し、public ではデプロイが止まります/u, `${id}: names R3`);
    }
    const hours = (/** @type {number} */ h) => new Date(NOW.getTime() - h * 3600_000).toISOString();
    const r3 = (/** @type {string} */ drillLastOk) => checkStack(buildInput('public', { facts: { drillLastOk } })).filter((f) => f.code === 'R3');
    assert.deepEqual(r3(hours(28 * 24 + 23)), [], 'four weeks and a later hour: no R3');
    assert.deepEqual(r3(hours(35 * 24 + 1)).map((f) => f.level), ['E'], 'more than 35 days: R3 stops a public deploy');
    const r = stepBody('16.2');
    for (const must of ['tmux new -s restore', 'tmux attach -t restore', 'sudo ./scripts/restore-db.sh --from newest --yes-replace-production-database', '`--with-uploads`', '`--current-db-lost`', 'RS5 で止まったときは `--current-db-lost` を付けます', 'R9', 'エージェント']) {
      assert.ok(r.includes(must), `16.2: ${must}`);
    }
    // Design §8.1 16.2: what the command does, in order: the RS codes as restore-db.sh runs them (the catalog's order,
    // no RS9: TR9d), and the two yes questions at RS4 and RS8.
    const orderLine = r.split('\n').find((line) => line.includes('コマンドは、次の順に進みます')) ?? '';
    const rsInOrder = [...orderLine.slice(0, orderLine.indexOf('途中で 2 回')).matchAll(/（(RS\d+)[。）]/g)].map((m) => m[1]);
    assert.deepEqual(rsInOrder, BACKUP_ALL_CODES.filter((c) => c.startsWith('RS')), '16.2 names every RS step once, in order');
    assert.match(r, /1 回目（RS4 の終わり。.*2 回目（RS8）/u);
    // 16.3 (review round 1 of Stage 6, findings 1 and 11): the old machine off Tailscale (3.4), the rebuilt VM at setup, the
    // key (after IB2's first stop), the restore, the timers, the drill, then the values backups do not hold (tunnel.env,
    // the edge, the list, the deletion switch), the stage written back, a deploy, and the edge checks.
    const order = ['3.4 の 1 のとおりに', '4 章から 6.3 までで', '6.4 の `--new-key` と 6.5 はしません', 'LAUNCH_STAGE=setup', '「[IB2]」', 'install-backup.sh --import-key` を実行して、パスワード管理の鍵を貼ります', 'restore-db.sh --from newest --yes-replace-production-database --with-uploads', 'sudo ./scripts/install-backup.sh` を何も付けずに', 'restore-drill.sh', 'tunnel.env を作り', '`ORIGIN_SECRET=`', '`PILOT_ACCOUNT_IDS=`', '`ACCOUNT_DELETION_ENABLED=true`', '`LAUNCH_STAGE` を、なくす前の段階に書き戻し', '`./scripts/deploy-stack.sh`', '7.6 をし', '`npm run smoke:edge`', '10.2 の 1〜4'].map((x) => stepBody('16.3').indexOf(x));
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `16.3 order ${order}`);
    assert.match(read('deploy/risepath-vm/scripts/install-backup.sh'), /if \[\[ ! -f "\$\{BK_ENV\}" \]\]; then\n\s+install -m 600 "\$\{STACK_DIR\}\/backup\.env\.example" "\$\{BK_ENV\}"\n\s+bk_fail IB2 /, 'a new VM stops at IB2 first, whatever the flag');
    // 4.1 creates the VM with the backup service account, so IB4 passes on the rebuilt VM; 4.5 needs 3.4.
    assert.match(stepPart(stepBody('4.5'), '先に済ませること: '), /3\.4/);
    // The success lines quote what the scripts print.
    assert.ok(read('deploy/risepath-vm/scripts/install-backup.sh').includes('echo "✅ 鍵を戻しました（key id ${id}）。"'));
    assert.ok(read('deploy/risepath-vm/scripts/restore-drill.sh').includes('✅ 戻す練習は成功しました（'));
    assert.ok(read('deploy/risepath-vm/scripts/restore-db.sh').includes('この VM には、控えのタイマーがまだありません（手順書 16.3 では正しい状態です）'));
  });
  it('17 章: a row for every check number `npm run smoke:edge` can fail (stage 2 finding 11), and the entries the stages left', () => {
    const src = read('scripts/smoke-public-edge.mjs');
    const labels = new Set([...src.matchAll(/[`'](\d{1,2}[ab]?)\. (?:GET|POST|PUBLIC|API)/g)].map((m) => m[1]));
    assert.match(src, /`3\$\{attempt === 1 \? 'a' : 'b'\}\. /, 'check 3 is 3a and 3b');
    labels.add('3a');
    labels.add('3b');
    const table = rows(chapter('17')).filter((r) => r[0] !== '番号' && !/^-+$/.test(r[0]));
    const order = (/** @type {string} */ x) => parseInt(x, 10) * 10 + (x.endsWith('b') ? 2 : x.endsWith('a') ? 1 : 0);
    assert.deepEqual(table.map((r) => r[0]), [...labels].sort((a, b) => order(a) - order(b)));
    for (const r of table) assert.ok(r[1] && r[2], `smoke ${r[0]}: わけ and すること`);
    const ch17 = chapter('17');
    for (const must of ['**直したはずなのに、事前チェックが止める**', '`git -C /opt/risepath pull --ff-only`', '**「503 auth_unavailable」が出る**', '**「403 pilot_only」', '**cloudflared が unhealthy**', '❌ 待っていた部品が healthy になりませんでした（Rise Path は、もう新しい版に入れ替わっています）。', '**「控えが 36 時間できていません」の知らせが来た**', '（R8）', '**VM を再起動したら、Rise Path が動かない**', '**launch-record.env をなくした**', '`sudo journalctl -u risepath-backup -n 50`']) {
      assert.ok(ch17.includes(must), `17 章: ${must}`);
    }
    assert.ok(read('deploy/risepath-vm/scripts/deploy-stack.sh').includes('echo "❌ 待っていた部品が healthy になりませんでした（Rise Path は、もう新しい版に入れ替わっています）。"'));
  });
  it('9.4 and 6.4 quote what their scripts print', () => {
    assert.ok(stepBody('9.4').includes('「受け口が設定されていません」') && read('scripts/send-test-alert.mjs').includes('受け口が設定されていません（'));
    assert.match(stepBody('9.4'), /`\.\/scripts\/deploy-stack\.sh` を実行してから.*もう一度 1 をします/u, 'stage 2 note: deploy before sending again');
    const b = stepBody('6.4');
    for (const must of ['sudo ./scripts/install-backup.sh --new-key', 'sudo nano /etc/risepath-backup/backup.env', 'sudo cat /etc/risepath-backup/backup.key', '「Rise Path 控えの鍵」', '`clear`', 'install-backup.sh check-copy', 'install-backup.sh key-id', '`BACKUP_KEY_ID`', '`BACKUP_KEY_COPY`', '16.3']) {
      assert.ok(b.includes(must), `6.4: ${must}`);
    }
    const script = read('deploy/risepath-vm/scripts/install-backup.sh');
    assert.ok(script.includes('echo "✅ 最初の控えができました（$(du -h'), 'the first backup line');
    assert.ok(script.includes('echo "✅ 控えの鍵は合っています（key id ${vm_id}）。"'), 'the check-copy line');
  });
});

describe('the other documents Stage 6 writes (design §8.3 VM README, §8.6 AGENTS.md, §8.8 lawyer sheet)', () => {
  it('the lawyer sheet holds the five backup and retention questions of TR11, and the numbers it states are the code\'s', () => {
    const legal = read('doc/legal/README.md');
    const start = legal.indexOf('## 弁護士に確かめること（Phase 9）');
    assert.ok(start > 0);
    const sheet = legal.slice(start, legal.indexOf('\n## ', start + 1));
    const items = sheet.split('\n').filter((line) => line.startsWith('- [ ] '));
    assert.deepEqual(items.map((line) => /^- \[ \] (\d)\. /.exec(line)?.[1]), ['1', '2', '3', '4', '5']);
    assert.match(items[0], /\*\*30 日\*\*（削除のあとに Google が残す期間を入れて、最大 37 日）/u);
    // Review round 1 of Stage 6, findings 7 and 13: what the journal holds (every column backup.sh exports) and how long
    // one record stays (each hourly object holds the last 40 days and lives 30 days + about 7 of soft delete: 77).
    assert.match(items[1], /直近の「控えの日数 \+ 10 日」（いまは 40 日）のぶん/u);
    assert.match(items[1], /1 つの削除の記録は、最大でおよそ 77 日、バケットに残ります/u);
    assert.match(items[1], /削除の記録を残す期間（最大でおよそ 77 日）でよいですか/u);
    assert.equal(30 + 10 + 30 + 7, 77, 'retention + 10 (one object\'s window) + the lifecycle + soft delete');
    const COLUMN_WORDS = { kind: '種類（', user_id: 'アカウント ID', time: '日時', requested_by: 'だれが求めたか（ご本人、スタッフ、ログインが消えたアカウントの整理）', reopened_at: '同じログインでまた使い始めた日時', course_slug: 'コース', lesson_id: 'レッスンの ID', ref_id: '保護者の同意の ID、AI アプリの client ID' };
    const header = /BK_JOURNAL_HEADER='([^']+)'/.exec(read('deploy/risepath-vm/scripts/backup-common.sh'))?.[1].split(',') ?? [];
    assert.deepEqual(header, Object.keys(COLUMN_WORDS), 'the journal\'s columns');
    for (const [col, words] of Object.entries(COLUMN_WORDS)) assert.ok(items[1].includes(words), `item 2 names ${col}: ${words}`);
    const kinds = [...read('deploy/risepath-vm/scripts/backup.sh').matchAll(/SELECT '([a-z]+)'(?: AS kind)?, user_id::text/g)].map((m) => m[1]);
    assert.deepEqual(kinds, ['account', 'progress', 'lesson', 'consent', 'grant']);
    assert.ok(items[1].includes('種類（アカウントの削除、学習の記録の消去、1 つのレッスンのやり直し、保護者の同意の取り消し、AI アプリの接続の取り消し）'), 'the five kinds');
    assert.match(read('server/migrations/018_account_deletion_and_legal.sql'), /requested_by text\s+NOT NULL CHECK \(requested_by IN \('self', 'staff', 'orphan'\)\)/);
    assert.doesNotMatch(items[1], /日時だけ/u);
    assert.match(items[1], /保護者の同意の取り消しと AI アプリの接続の取り消しの記録があるときは、この版では、作業する人が手でやり直します/u, 'TR9a');
    assert.match(items[3], /外国にある第三者/u);
    assert.match(items[4], /読み上げの音声は、30 日を過ぎると学習者に返さず、1 時間ほどで消します（デプロイのたびにすべて消えます）/u);
    // The numbers come from the code: the bucket's default retention, the journal window, the TTS cache age.
    assert.match(read('deploy/risepath-vm/backup.env.example'), /^BACKUP_RETENTION_DAYS=30$/m);
    assert.match(read('deploy/risepath-vm/scripts/backup.sh'), /days=\$\(\(\$\(bk_days BACKUP_RETENTION_DAYS 30\) \+ 10\)\)/, 'the journal window');
    assert.match(read('tools/core/kokoroTts.js'), /TTS_CACHE_LIMITS = Object\.freeze\(\{ maxAgeDays: 30,/);
    assert.match(sheet, /計画の 13\.5/u, 'items 7 and 8 went to plan 13.5');
  });
  it('AGENTS.md names the VM checks, the Phase 9 code and the two new rules, within its 80 lines', () => {
    const agents = read('AGENTS.md');
    const lines = agents.trimEnd().split('\n');
    assert.ok(lines.length <= 80, `${lines.length} lines`);
    const at = (/** @type {string} */ prefix) => lines.findIndex((line) => line.startsWith(prefix));
    assert.equal(at('- VM checks: '), at('- MCP: ') + 1, 'after the MCP line');
    assert.match(lines[at('- VM checks: ')], /`deploy\/risepath-vm\/scripts\/preflight\.sh` \(事前チェック; `deploy-stack\.sh` runs it before sourcing `stack\.env`; never as root; rules `scripts\/deploy\/preflight-rules\.mjs`, built-ins only\) and `postdeploy-check\.sh`; backups `backup\.sh` \+ systemd timers; runbook `doc\/guides\/first-launch\.ja\.md`/);
    // Stage 2's notes: agents deploy from a plain login shell, never with the CI's project name exported (F12).
    assert.match(lines[at('- VM checks: ')], /On the VM, deploy from a plain login shell: never export the CI's `COMPOSE_PROJECT_NAME=risepath-ci` there \(F12\)\./);
    assert.ok(RULES.some((r) => r.code === 'F12'), 'F12 is a preflight rule');
    const p9 = lines[at('- Phase 9: ')];
    for (const must of ['`VITE_FEATURE_LEGAL_PAGES=true`', '`PILOT_ACCOUNT_IDS`', '`server/middleware/pilotGate.js`', '`deploy/risepath-vm/launch-record.env`', '1,000 characters', '`tools/core/kokoroTts.js`', 'stops on consent or grant rows', '`scripts/replay-deletions.mjs`']) assert.ok(p9.includes(must), must);
    assert.ok(at("- Don't point a development `.env.local` at the production database") > at("## Don'ts"));
    assert.ok(at("- Don't print an env value from a deploy or check script; names and codes only.") > at("## Don'ts"));
    assert.match(lines[at('- `e2e.yml`')], /as a non-root user in the docker group \(the preflight refuses root, X5\)/);
  });
  it('the VM README links the runbook first, says the Mac uses a development database, and has the 事前チェック and 控え paragraphs', () => {
    const readme = read('deploy/risepath-vm/README.md');
    assert.match(readme.split('\n')[2], /^新しい VM から公開までの手順: \[`doc\/guides\/first-launch\.ja\.md`\]/u);
    assert.match(readme, /^\| Mac \| `npm run dev` と、Mac の中だけで動く開発用の DB/mu);
    assert.match(readme, /^### 3\. Mac の `\.env\.local`（開発用の DB）$/mu);
    const preflight = readme.slice(readme.indexOf('## 事前チェックと事後の確かめ（Phase 9）'), readme.indexOf('## 控え（バックアップ、Phase 9）'));
    for (const must of ['./scripts/preflight.sh', '**sudo は付けません**', '`./scripts/postdeploy-check.sh`', '13 章', '14 章', '`COMPOSE_PROJECT_NAME=risepath-ci`']) assert.ok(preflight.includes(must), must);
    const backup = readme.slice(readme.indexOf('## 控え（バックアップ、Phase 9）'), readme.indexOf('## CI での予行（Phase 7）'));
    for (const must of ['`sudo ./scripts/install-backup.sh --new-key`', '`sudo ./scripts/restore-drill.sh`', '`sudo ./scripts/restore-db.sh`', '6.4', '16.1', '16.2']) assert.ok(backup.includes(must), must);
    // The two anchors the file table links resolve to these headings (GitHub's slug: punctuation dropped).
    assert.ok(readme.includes('(#事前チェックと事後の確かめphase-9)') && readme.includes('(#控えバックアップphase-9)'));
  });
});

describe('review round 1 of Stage 6: the owner can follow each step as written (findings 6, 12, 14, 16)', () => {
  it('5.1: the values are pasted as they are (URLs and keys keep : / - _), without space, quotes, $ or #; the engine agrees', () => {
    const todo = stepPart(stepBody('5.1'), 'やること:');
    assert.doesNotMatch(todo, /英数字だけ/u, 'a URL or a key cannot be letters and digits only');
    assert.match(todo, /値に空白、引用符（`'` や `"`）、`\$`、`#` は入れません（入っていると、5\.3 で A5 か A14 が出ます）。URL や鍵は、そのまま貼ります/u);
    // What 5.1 asks for passes as written: the webhook URL, the database URL and the key (BASE_STACK has them).
    const found = checkStack(buildInput('setup', { stack: { AI_CAP_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T0/B0/x', DATABASE_URL_PHASE1: `${BASE_STACK.DATABASE_URL_PHASE1}?sslmode=disable`, ANTHROPIC_API_KEY: 'sk-ant-api03-ab_cd-EF' } }));
    assert.deepEqual(found.filter((f) => ['A5', 'A14'].includes(f.code)), []);
    for (const [bad, code] of [['x y', 'A5'], ["'x", 'A5'], ['x$y', 'A5'], ['x#y', 'A14']]) {
      assert.ok(checkStack(buildInput('setup', { stack: { KOKORO_TTS_DEFAULT_VOICE_EN: bad } })).some((f) => f.code === code), `${bad} → ${code}`);
    }
  });
  it('11.1 says where (the Mac checkout and a pull request); 9.5 runs its checks in the repository\'s top folder', () => {
    assert.match(stepPart(stepBody('11.1'), 'だれが・どこで: '), /弁護士、オーナー、エージェント（Mac のリポジトリと、プルリクエスト）/u);
    const todo = stepPart(stepBody('9.5'), 'やること:');
    assert.ok(todo.includes("Mac のリポジトリのいちばん上のフォルダ（`.env.local` があるフォルダ）で、`grep -n -E 'risepath-vm|nexloom-gce|@100\\.' .env.local | grep -o -E '^[0-9]+:[A-Z0-9_]*'`"));
    assert.match(todo, /同じフォルダで `npm run env:check` を実行し/u);
  });
  it('the Vercel runbook runs smoke:edge only after runbook 10.3 takes the protection off (step 13, step 17, the checklist)', () => {
    const vercel = read('deploy/vercel/README.md');
    const note = '保護（All Deployments）をかけているあいだは通らない。手順書 10.3 で保護を外したあとに流す';
    for (const where of ['    - 手順 15 のビルド確認と、手順 17 の `npm run smoke:edge` は', '17. 下の「確認チェックリスト」をすべて通す。', '- [ ] `npm run smoke:edge` の必須チェックがすべて通る']) {
      const line = vercel.split('\n').find((l) => l.startsWith(where)) ?? '';
      assert.ok(line.includes(note), `${where.trim()}: ${note}`);
    }
    assert.match(stepBody('9.1'), /10\.3 の最後/u);
  });
  // Finding 17: AGENTS.md forbids a local checkout path in commits; the rewritten local setup guide had one.
  it('no tracked text file names a home-relative checkout of this repository (finding 17)', () => {
    const CHECKOUT = /~\/[^\s`'"]*rise-path-demo-game-integration/;
    const found = trackedTextFiles().filter((f) => !f.startsWith('node_modules/') && f !== 'server/tests/firstLaunchRunbook.test.js' && CHECKOUT.test(readListed(f)));
    assert.deepEqual(found, []);
    assert.ok(CHECKOUT.test('cd ~/Works/personal/rise-path-demo-game-integration') && !CHECKOUT.test('cd <リポジトリのフォルダ>'));
    assert.match(read('doc/guides/env_local_setup_issue15.md'), /^cd <リポジトリのフォルダ>$/m);
  });
  it('10.1 keeps the list in the password manager, 10.4 keeps it current, and 11.8, 12.1 and 16.3 take it from there', () => {
    const name = '「Rise Path 試験運用の名簿」';
    assert.match(stepPart(stepBody('10.1'), 'やること:'), /同じ 1 行を、パスワード管理にも「Rise Path 試験運用の名簿」としてしまいます（VM をなくしたとき、16\.3 で戻します）/u);
    for (const id of ['10.4', '11.8', '16.3']) assert.ok(stepPart(stepBody(id), 'やること:').includes(name), `${id}: ${name}`);
    assert.ok(stepPart(stepBody('12.1'), 'うまくいかないとき: ').includes(name), `12.1: ${name}`);
  });
});

describe('review round 2 of Stage 6: what the owner sees matches what the scripts print, and every pointer has the detail (findings 4/8, 5, 9, 10, 11)', () => {
  const vmReadme = read('deploy/risepath-vm/README.md');
  const vmGuide = read('doc/guides/risepath_vm_deployment.md');
  const smoke = read('scripts/smoke-vm-stack.mjs');
  const SMOKE_63 = 'npm run smoke:vm -- --base http://risepath-vm:3006 --mcp http://risepath-vm:3100';
  it('6.3: success is the script\'s last line; the ⚠️ lines of the parts the Mac does not check and the ℹ️ front-end line are expected (findings 4, 8)', () => {
    const body = stepBody('6.3');
    assert.ok(stepPart(body, 'やること:').includes(`\`${SMOKE_63}\``));
    assert.doesNotMatch(body, /すべての行に ✅/u);
    assert.match(smoke, /console\.log\(ok \? '\\n✅ VM stack smoke passed' : '\\n❌ VM stack smoke failed'\);/);
    assert.ok(stepPart(body, 'うまくいったとき: ').startsWith('- うまくいったとき: 最後に「✅ VM stack smoke passed」が出ます。'));
    assert.ok(stepPart(body, 'うまくいかないとき: ').startsWith('- うまくいかないとき: 最後が「❌ VM stack smoke failed」のときは、❌ の行をエージェントに見せます'));
    // The three parts named as expected ⚠️ are the ones the Mac run checks on the Mac's own 127.0.0.1 (6.3 passes no
    // --kokoro, --hermes or --memanto) and prints ⚠️ for when unreachable unless required; the front end is ℹ️.
    const hostPreset = smoke.slice(smoke.lastIndexOf('return {', smoke.indexOf('function parseArgs')));
    for (const [part, flag, preset] of [['Kokoro', '--kokoro', "kokoro: 'http://127.0.0.1:8880'"], ['Hermes', '--hermes', 'hermes: `http://127.0.0.1:${hermesPort}`'], ['Memanto', '--memanto', 'memanto: `http://127.0.0.1:${memantoHostPort}`']]) {
      assert.ok(hostPreset.includes(preset), `${part}: the host preset is the Mac's own 127.0.0.1`);
      assert.ok(!SMOKE_63.includes(flag), `6.3 passes no ${flag}`);
      assert.match(smoke, new RegExp(`console\\.log\\(\`⚠️  \\$\\{msg\\} \\(`), `${part}: ⚠️ when unreachable`);
      assert.ok(stepPart(body, 'うまくいったとき: ').includes(part), `6.3 names ${part}`);
    }
    assert.ok(smoke.includes("console.log('ℹ️  Front end /claude-code skipped (API does not serve dist/)');"));
    assert.ok(stepPart(body, 'うまくいったとき: ').includes('Front end の ℹ️ の行'));
    // deploy-stack.sh checks Kokoro from inside the api container (the reason 6.3 gives).
    assert.match(read('deploy/risepath-vm/scripts/deploy-stack.sh'), /SMOKE_FLAGS\+=\(--require-kokoro\)/);
  });
  it('the VM README gives 6.3\'s command and says the same about the ⚠️ lines and 8642 (finding 10)', () => {
    const manual = vmReadme.slice(vmReadme.indexOf('### 4. 手動でスタック操作（VM 上）'), vmReadme.indexOf('### 5. 管理者にする'));
    assert.ok(manual.includes(`\n${SMOKE_63}\n`), 'the same command as 6.3');
    assert.doesNotMatch(manual, /--kokoro http:\/\/risepath-vm:8880/, '8880 is closed to everyone (手順書 3.4)');
    assert.doesNotMatch(manual, /# Hermes を有効にしたときだけ、最後に --hermes/u);
    assert.ok(manual.includes('Hermes を有効にし、ACL で 8642 を名前を決めた管理者に開けたときだけ、最後に `--hermes http://risepath-vm:8642` を足します'));
    assert.ok(manual.includes('最後に「✅ VM stack smoke passed」が出れば通っています'));
    assert.ok(stepPart(stepBody('3.4'), 'やること:').includes('8642（Hermes）と 8880（読み上げ）は開けません'));
  });
  it('the VM README\'s quick start 1 (runbook 4.1\'s くわしく) creates the VM with the backup service account (finding 10)', () => {
    const q1 = vmReadme.slice(vmReadme.indexOf('### 1. GCP で VM 作成（Mac から）'), vmReadme.indexOf('### 2. VM に SSH して初回 bootstrap'));
    const runs = q1.split('\n').filter((line) => line.includes('./provision-gce.sh'));
    assert.ok(runs.length >= 2, runs.join('\n'));
    for (const line of runs) assert.match(line, /BACKUP_SA_EMAIL=<手順書 3\.8 のアドレス> \.\/provision-gce\.sh/u, line);
    assert.ok(q1.includes('IB4'), 'what happens without it');
    assert.ok(stepPart(stepBody('4.1'), 'やること:').includes('`BACKUP_SA_EMAIL=<3.8 のアドレス> ./provision-gce.sh`'));
    assert.match(stepPart(stepBody('4.1'), 'くわしく: '), /クイックスタートの 1/u);
  });
  it('3.8, 4.2 and 8.1 point at documents that hold their detail, not plan 13 章 (finding 9)', () => {
    for (const id of ['3.8', '4.2', '8.1']) assert.doesNotMatch(stepBody(id), /計画の 13 章/u, id);
    const backup = vmReadme.slice(vmReadme.indexOf('## 控え（バックアップ、Phase 9）'), vmReadme.indexOf('### 戻しが RS8 で止まったとき'));
    const line = (/** @type {string} */ start) => backup.split('\n').find((l) => l.startsWith(start)) ?? '';
    const bucket = line('- バケットとサービスアカウント（手順書 3.8）: ');
    const snapshot = line('- ディスクのスナップショット（手順書 4.2）: ');
    // The README line holds what 3.8 and 4.2 ask for, so the owner and the agent can match the console's screens to it.
    const s38 = stepPart(stepBody('3.8'), 'やること:');
    for (const words of ['`risepath-backup`', '`asia-northeast1`', 'Standard', 'uniform bucket-level access', '公開アクセスの防止を強制', 'バージョニングなし', 'Storage Object Creator', 'Storage Object Viewer', '30 日より古いオブジェクトを削除する', '`BACKUP_RETENTION_DAYS`']) {
      assert.ok(s38.includes(words), `3.8: ${words}`);
      assert.ok(bucket.includes(words), `README: ${words}`);
    }
    assert.ok(bucket.includes('`roles/storage.objectCreator`') && bucket.includes('`roles/storage.objectViewer`'));
    assert.ok(snapshot.includes('スナップショットのスケジュールを付けません') && stepPart(stepBody('4.2'), 'やること:').includes('スナップショットのスケジュールが付いていないこと'));
    assert.ok(stepPart(stepBody('3.8'), 'うまくいかないとき: ').includes('[VM の README の「控え（バックアップ、Phase 9）」](../../deploy/risepath-vm/README.md)の「バケットとサービスアカウント」の行'));
    assert.ok(stepPart(stepBody('4.2'), 'くわしく: ').includes('[VM の README の「控え（バックアップ、Phase 9）」](../../deploy/risepath-vm/README.md)の「ディスクのスナップショット」の行'));
    const k81 = stepPart(stepBody('8.1'), 'くわしく: ');
    assert.ok(k81.includes('9.2・10.1・10.2・11.2') && k81.includes('[../../deploy/vercel/README.md](../../deploy/vercel/README.md) の「確認チェックリスト」'));
    assert.match(read('deploy/vercel/README.md'), /^## 確認チェックリスト/m);
    assert.ok(read('deploy/vercel/README.md').includes('テスト用のアカウントを 2 つ（18 歳以上と 18 歳未満）使う'));
  });
  it('the old data\'s dump leaves no copy on the Mac: VM guide §5 and runbook 5.4 delete it after the row count (finding 5)', () => {
    const s5 = vmGuide.slice(vmGuide.indexOf('## 5. `nexloom-gce` からの移行'), vmGuide.indexOf('## 6. '));
    const at = (/** @type {string} */ x) => s5.indexOf(x);
    assert.ok(at('-Fc -f risepath.dump') > 0, 'the dump is made on the Mac');
    assert.ok(at('< ~/risepath.dump') > 0 && at('rm ~/risepath.dump') > at('< ~/risepath.dump'), 'the VM copy is deleted after the restore');
    assert.ok(at('\nrm risepath.dump\n') > at('rm ~/risepath.dump'), 'the Mac copy is deleted too');
    assert.ok(s5.includes('# Mac: 戻した DB の行の数が旧 DB と同じことを確かめたら（手順書 5.4）、Mac の写しも消す。'));
    const todo = stepPart(stepBody('5.4'), 'やること:');
    assert.ok(todo.includes('`rm risepath.dump`') && todo.indexOf('`rm risepath.dump`') > todo.indexOf('行の数が同じことを確かめたら'));
    assert.ok(stepPart(stepBody('5.4'), 'うまくいったとき: ').includes('Mac にも VM にも `risepath.dump` が残っていません'));
    assert.ok(stepPart(stepBody('5.4'), 'うまくいかないとき: ').includes('空の DB で始めるときも、Mac と VM の `risepath.dump` を消します'));
  });
  it('VM guide §5\'s cutover checks the new VM with the VM\'s checks, not env:check (localhost on the Mac) (finding 11)', () => {
    const item = vmGuide.split('\n').find((l) => l.startsWith('1. 新 VM を確かめる: ')) ?? '';
    assert.ok(item.includes('`./scripts/postdeploy-check.sh`') && item.includes(`\`${SMOKE_63}\``) && item.includes('手順書 6.2・6.3'), item);
    assert.doesNotMatch(vmGuide, /新 VM でスモーク（`npm run env:check -- --api`/u);
    assert.match(read('scripts/verify-env.mjs'), /const base = 'http:\/\/localhost:3006'/, 'env:check --api calls the Mac\'s own API');
  });
});

describe('review round 3 of Stage 6: the pilot keeps the routine work, and each failure path has a way back (findings 4-11, 13)', () => {
  const failure = (/** @type {string} */ id) => stepPart(stepBody(id), 'うまくいかないとき: ');
  // Finding 4: the pilot is the first launch with real testers' data, so 12.4 (weekly logs, the 4-weekly drill, the
  // monthly orphan list, rotation, a red nightly run) starts with it, not after 12.1. Without the drill, 11.8 stops on R3.
  it('12.4 starts with the pilot (finding 4): not after 12.1, named in 10 章, kept while waiting for the lawyer', () => {
    const before = stepPart(stepBody('12.4'), '先に済ませること: ');
    assert.match(before, /^- 先に済ませること: 6\.5（12\.1 を待たずに、試験運用のあいだもします）$/u);
    const intro = chapter('10').split('\n### ')[0];
    assert.match(intro, /試験運用を始めたら、12\.4 のふだんの作業（毎週のログ、4 週間ごとの戻す練習など）も始めます。/u);
    assert.doesNotMatch(text, /12 章へは進みません/u);
    assert.match(failure('11.1'), /12\.1〜12\.3 へは進みません。12\.4 のふだんの作業は続けます/u);
  });
  it('9.6 and 11.8 send R3 to the drill (16.1); the engine gives R3 there when the last drill is older than 35 days (finding 4)', () => {
    const DAY = 24 * 3600_000;
    const old = new Date(NOW.getTime() - 40 * DAY).toISOString();
    const at = (/** @type {string} */ id) => {
      const { stage, mod } = AT_STEP[id];
      return checkStack(buildInput(stage, { ...mod, facts: { .../** @type {any} */ (mod).facts, drillLastOk: old } })).filter((f) => f.code === 'R3').map((f) => f.level);
    };
    assert.deepEqual(at('9.6'), ['W'], '9.6 (pilot): a warning it does not list');
    assert.deepEqual(at('11.8'), ['E'], '11.8 (public): an error');
    for (const id of ['9.6', '11.8']) {
      assert.match(failure(id), /R3 なら 16\.1 の戻す練習をします/u, `${id}: R3 → 16.1`);
      assert.match(failure(id), /launch-record\.env の名前が出たら、14 章で済ませます。ほかのコードは 13 章で見ます。/u, `${id}: names → 14 章, codes → 13 章`);
      assert.match(stepPart(stepBody(id), 'くわしく: '), /16\.1/u);
    }
    assert.match(failure('9.6'), /エラーか、R3 の注意が出たら/u, '9.6 lists no warning, so R3 as a warning is handled too');
    // R3 is not a launch-record name: 13 章 says the VM records the drill itself.
    assert.ok(!ATTESTATIONS.some((a) => a.key.includes('DRILL')));
  });
  // Finding 5: a Vercel build that cannot be fixed the same day must not leave the VM at public without the list.
  it('12.1: a build that cannot be fixed today puts 11.8\'s two lines back (finding 5)', () => {
    assert.match(failure('12.1'), /2 のビルドを今日のうちに直せないときは、11\.8 の「うまくいかないとき」のとおりに、`LAUNCH_STAGE=pilot` と `PILOT_ACCOUNT_IDS` の行を元に戻します（3 と 4 はまだしていないので、それだけで元どおりです。/u);
    assert.match(failure('11.8'), /`LAUNCH_STAGE=pilot` と `PILOT_ACCOUNT_IDS` の行を元に戻してから直します/u);
    const todo = stepPart(stepBody('12.1'), 'やること:');
    assert.ok(todo.indexOf('Redeploy') < todo.indexOf('VERCEL_LEGAL_PAGES_ON') && todo.indexOf('VERCEL_LEGAL_PAGES_ON') < todo.indexOf('deploy-stack.sh'), 'the build (2) comes before the record (3) and the deploy (4)');
  });
  // Finding 6: smoke:edge cannot pass while Vercel protection is on (Vercel README), so 16.3 runs it only after 10.3.
  it('16.3 step 9 runs smoke:edge only when 10.3 was done (finding 6)', () => {
    const nine = stepPart(stepBody('16.3'), 'やること:').split('\n').find((l) => l.startsWith('  9. ')) ?? '';
    assert.match(nine, /^ {2}9\. 7\.4 まで済んでいたときは、7\.6 をします。10\.3 まで済んでいたとき（Vercel の保護を外したあと）は、Mac で 10\.3 の 4（`npm run smoke:edge`）もします（保護をかけたままのときは流しません。/u);
    assert.match(stepPart(stepBody('16.3'), 'うまくいったとき: '), /`npm run smoke:edge`（10\.3 まで済んでいたときだけ）は「0 failed」/u);
    assert.ok(read('deploy/vercel/README.md').includes('保護（All Deployments）をかけているあいだは通らない。手順書 10.3 で保護を外したあとに流す'));
  });
  // Finding 7: the grep flags any line naming a production host, not only the database URL.
  it('9.5 says who works where (the VM for step 4) and what to do with a flagged line that is not the database (finding 7)', () => {
    assert.match(stepPart(stepBody('9.5'), 'だれが・どこで: '), /開発に使う Mac と、VM（SSH。4 だけ）/u);
    assert.match(stepPart(stepBody('9.5'), 'やること:'), /4\. VM で `cd \/opt\/risepath\/deploy\/risepath-vm && nano launch-record\.env` を実行し/u);
    const bad = failure('9.5');
    assert.match(bad, /`DATABASE_URL_PHASE1` の行は、開発用の DB（18 章）に直します。ほかの名前の行（`HERMES_API_URL`、`MEMANTO_URL`、`KOKORO_TTS_URL` など、前の手順で書いた VM の部品のアドレス）は、その行を消すか、エージェントと一緒に `127\.0\.0\.1` の値にします。/u);
    assert.doesNotMatch(bad, /その名前の行（名前が出ないときは、その番号の行）を、開発用の DB に直して/u);
  });
  // Finding 8: a value must exist before nano opens (one terminal), and what openssl printed is cleared (as in 7.4).
  it('every step that makes a value with openssl makes it before nano, keeps it in the password manager and clears the screen (finding 8)', () => {
    const makers = STEP_IDS.filter((id) => !Object.hasOwn(POINTERS, id) && stepPart(stepBody(id), 'やること:').includes('openssl rand'));
    assert.deepEqual(makers, ['5.1', '7.4']);
    for (const id of makers) {
      const todo = stepPart(stepBody(id), 'やること:');
      const lastOpenssl = todo.lastIndexOf('openssl rand');
      assert.ok(lastOpenssl < todo.indexOf('nano stack.env'), `${id}: openssl before nano`);
      assert.ok(todo.indexOf('`clear`') > todo.indexOf('nano stack.env'), `${id}: clear after nano`);
      assert.ok(todo.slice(0, todo.indexOf('nano stack.env')).includes('パスワード管理'), `${id}: kept in the password manager first`);
    }
    const s51 = stepPart(stepBody('5.1'), 'やること:');
    for (const name of ['「Rise Path POSTGRES_PASSWORD」', '「Rise Path RISE_PATH_BRIDGE_TOKEN」']) assert.equal(s51.split(name).length, 3, `5.1 saves and pastes ${name}`);
    assert.match(s51, /`DATABASE_URL_PHASE1` の中のパスワードの場所（`risepath_app:` と `@db` のあいだ）/u);
    assert.match(read('deploy/risepath-vm/stack.env.example'), /^DATABASE_URL_PHASE1=postgresql:\/\/risepath_app:change-me@db:5432\/risepath$/m, 'the place 5.1 names');
    // 15 章: stack.env and the password manager are the only places.
    assert.match(chapter('15'), /秘密の値は、表の「しまう場所」とパスワード管理だけに置きます/u);
  });
  // Finding 9: install-backup.sh ends with 6.4's list; on a rebuilt VM none of it applies.
  it('16.3 step 4 says not to follow the list install-backup.sh prints for 6.4 (finding 9)', () => {
    const four = stepPart(stepBody('16.3'), 'やること:').split('\n').find((l) => l.startsWith('  4. ')) ?? '';
    assert.match(four, /最後に出る「次にすること」の 1〜5 は、ここではしません（1〜3: 鍵は、パスワード管理から戻したものです。鍵を画面に出さず、`BACKUP_KEY_COPY` は 6\.4 の日付のままにします。/u);
    const script = read('deploy/risepath-vm/scripts/install-backup.sh');
    const list = script.slice(script.indexOf("echo '次にすること（手順書 6.4・6.5。"));
    assert.deepEqual([...list.matchAll(/^echo ['"] {2}(\d)\. /gm)].map((m) => m[1]), ['1', '2', '3', '4', '5'], 'the list has the five items 16.3 names');
    assert.ok(list.includes('sudo cat /etc/risepath-backup/backup.key') && list.includes('BACKUP_KEY_COPY に今日の日付'), 'the items 16.3 must skip');
    assert.match(stepPart(stepBody('6.4'), 'やること:'), /秘密の値を画面に出すのは、この 1 回だけです/u);
  });
  // Finding 10: the design's P9-Q5 recommendation and the step that stops the public launch on it.
  it('P9-Q5 says what happens before the public launch, and 11.8 waits for that fix (finding 10)', () => {
    const q5 = rows(chapter('1')).find((r) => r[0] === 'P9-Q5');
    assert.ok(q5);
    assert.match(q5[2], /一般公開の前には、Rise Path のサーバーが匿名のセッションを断るコードを足します（名簿を外すと、断るものがなくなるためです。\[計画の 13\.5\]\(\.\.\/brushup-2026\/ai-access-plan\.ja\.md\)。手順書 11\.8）/u);
    assert.match(stepPart(stepBody('11.8'), '先に済ませること: '), /1 章の P9-Q5 で、匿名のログインを止められなかったときは、計画の 13\.5 の「匿名のセッションを断るコード」が main に入っていること（エージェントに聞きます。入っていなければ、ここで止まり、試験運用を続けます）/u);
    const plan = read('doc/brushup-2026/ai-access-plan.ja.md');
    const s135 = plan.slice(plan.indexOf('### 13.5 '), plan.indexOf('\n## ', plan.indexOf('### 13.5 ')));
    assert.match(s135, /共有の Supabase で匿名のログインを止められないとき（手順書 1 章の P9-Q5）、一般公開の前に、Rise Path のサーバーが匿名のセッションを断るコードを足します。/u);
  });
  // Finding 11: what db:migrate from .env.local targets, outside the §7.2 table test #9 covers line by line.
  it('the usage guide, the migrations README and .env.example say db:migrate from .env.local is the development database (finding 11)', () => {
    const usage = read('doc/guides/usage_guide.md');
    const s3 = usage.slice(usage.indexOf('### 3. データベースマイグレーション'), usage.indexOf('### 4. '));
    assert.doesNotMatch(s3, /データ DB は \*\*専用 VM/u);
    assert.ok(s3.indexOf('この開発用の DB に当たります') < s3.indexOf('npm run db:migrate\n'), 'said before the commands');
    assert.match(s3, /Mac から本番に `npm run db:migrate` はしません（D8）。/u);
    assert.match(s3, /本番のデータ DB は、専用 VM `risepath-vm` の Postgres `risepath` です（Supabase Auth は別）。その migration は、VM の `deploy\/risepath-vm\/scripts\/deploy-stack\.sh` が当てます。/u);
    const mig = read('server/migrations/README.md');
    const run = mig.slice(mig.indexOf('## 実行'), mig.indexOf('## チェーン'));
    assert.ok(run.indexOf('開発用の DB（`127.0.0.1:5433`。') < run.indexOf('npm run db:migrate\n'), 'said before the commands');
    assert.match(run, /Mac から本番には流しません（D8）。\n\n本番（`risepath-vm`）は、下の段落のとおり `deploy-stack.sh` が当てます。/u);
    assert.match(mig, /^> 本番の適用先: .*`deploy\/risepath-vm\/scripts\/deploy-stack\.sh` が当てます/mu);
    const example = read('.env.example');
    assert.doesNotMatch(example, /points at the VM database/);
    assert.match(example, /# PostgreSQL Database\. On a development machine: the local development database\n# \(doc\/guides\/first-launch\.ja\.md chapter 18; 127\.0\.0\.1:5433\), never the VM \(production\) database\.\nDATABASE_URL_PHASE1=/);
  });
  // Finding 13: `<…>` typed as is is a shell redirect.
  it('はじめに says to replace every `<…>`, brackets included (finding 13)', () => {
    const intro = text.slice(text.indexOf('## はじめに'), text.indexOf('## 1. '));
    assert.match(intro, /^- コマンドの中の `<…>`（例: `<プロジェクトの ID>`、`<開発用のパスワード>`）は、自分の値に置きかえます。`<` と `>` も消します/mu);
    assert.ok(text.includes('`<プロジェクトの ID>`') && text.includes('<開発用のパスワード>'), 'the examples are placeholders the runbook uses');
  });
});
