// @ts-check
// The first-launch runbook doc/guides/first-launch.ja.md (Phase 9; owner default: one new runbook). From
// Phase 9 stage 1 it has every chapter and step heading, 13 章 (every code the preflight prints) and 14 章
// (every launch-record key); the step bodies follow in a later stage. Design §9.2 items 1-4 and 11:
//   1. chapters はじめに, 1-18 and 付録 in order, and every step heading under its chapter;
//   2. a 13 章 row per code, its 表示 cell equal to the catalog's title (and its 直し方 cell to the fix);
//   3. a 14 章 row and a launch-record.env.example line per ATTESTATIONS key;
//   4. every script path and `npm run` name the runbook gives exists;
//   11. every 「手順書 X.Y」 and 「手順書 N 章」 in the runbook, the catalog and the scripts' messages
//      resolves to a heading (finding 17).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CODES, ATTESTATIONS, INTERNAL_CODES, RULES, STAGES, checkStack } from '../../scripts/deploy/preflight-rules.mjs';
import { ALL_CODES as AFTER_CODES, DEPLOY_CODES, POSTDEPLOY_CODES } from '../../scripts/deploy/postdeploy-probe.mjs';
import { baseFacts, buildInput } from './helpers/preflightFixtures.js';
import { pilotStartupLines } from '../middleware/pilotGate.js';

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
  it('starts with the in-progress banner (until the step bodies are written)', () => {
    assert.match(text.split('\n').slice(0, 4).join('\n'), /この手順書は作成中です（Phase 9）/);
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
  it('has one row per code, in the catalog order (the preflight\'s, then DB1 and the P codes), and no other', () => {
    assert.deepEqual(table.map((r) => r[0]), [...ALL_CODES, ...AFTER_CODES]);
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
  it('names each key\'s producing step in its row', () => {
    const byKey = new Map(rows(chapter('14')).map((r) => [r[0].replace(/`/g, ''), r]));
    for (const a of ATTESTATIONS) {
      if (a.step) assert.match(/** @type {string[]} */ (byKey.get(a.key))[2], new RegExp(`手順書 (?:[\\d.・]+・)?${a.step.replace('.', '\\.')}(?:・|$)`), a.key);
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

  it('the banner names them as written', () => {
    assert.match(text.split('\n').slice(0, 4).join('\n'), /10\.1〜10\.4（試験運用の名簿）/);
  });
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
  it('in the scripts\' messages (deploy/risepath-vm/scripts/*.sh, scripts/deploy/*.mjs, scripts/smoke-public-edge.mjs, scripts/send-test-alert.mjs)', () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'deploy/risepath-vm/scripts')).filter((f) => f.endsWith('.sh')).map((f) => `deploy/risepath-vm/scripts/${f}`),
      ...fs.readdirSync(path.join(ROOT, 'scripts/deploy')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/deploy/${f}`),
      'scripts/smoke-public-edge.mjs',
      'scripts/send-test-alert.mjs',
    ];
    let n = 0;
    for (const f of files) if (fs.existsSync(path.join(ROOT, f))) n += check(read(f), f);
    assert.ok(n > 0);
  });
});
