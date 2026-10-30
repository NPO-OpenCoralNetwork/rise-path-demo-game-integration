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
import { baseFacts, buildInput } from './helpers/preflightFixtures.js';

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

describe('first-launch.ja.md 13 章: every code the preflight prints (design §9.2 #2)', () => {
  const table = rows(chapter('13')).filter((r) => r[0] !== 'コード' && !/^-+$/.test(r[0]));
  it('has one row per code, in the catalog order, and no other', () => {
    assert.deepEqual(table.map((r) => r[0]), [...ALL_CODES]);
  });
  it('shows each code\'s title and fix exactly as the scripts print them', () => {
    const byCode = new Map(table.map((r) => [r[0], r]));
    for (const entry of [...RULES, ...INTERNAL_CODES]) {
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
  it('in the scripts\' messages (deploy/risepath-vm/scripts/*.sh, scripts/deploy/*.mjs, scripts/smoke-public-edge.mjs)', () => {
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'deploy/risepath-vm/scripts')).filter((f) => f.endsWith('.sh')).map((f) => `deploy/risepath-vm/scripts/${f}`),
      ...fs.readdirSync(path.join(ROOT, 'scripts/deploy')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/deploy/${f}`),
      'scripts/smoke-public-edge.mjs',
    ];
    let n = 0;
    for (const f of files) if (fs.existsSync(path.join(ROOT, f))) n += check(read(f), f);
    assert.ok(n > 0);
  });
});
