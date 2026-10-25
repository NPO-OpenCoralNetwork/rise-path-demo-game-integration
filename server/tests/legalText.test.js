// Phase 4 (design §2.2, §3, §8 legalText): the public legal texts.
// - scripts/legal/legalText.mjs publicLegalText(): banner and title gone, 根拠/作成メモ paragraphs
//   gone, fences resolved both ways (placeholders keep the numbering), fence errors with file:line,
//   links between the drafts rewritten, the sentinel first.
// - The committed content/legal/*.ja.md equal a fresh generation from the drafts (drift), and their
//   SHA-256 equals the pin in shared/legal/versions.js: any visible change of a draft fails here
//   until the version and hash are bumped (the forced bump).
// - Released versions and LEGAL_HISTORY entries have their archive file; ids match the pattern and
//   their document; requiresAcceptance is a boolean; acceptableLegalVersions; legalHeadingId.
// - scripts/legal/build-legal-text.mjs run(): --check, write, --archive on a temporary root.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGAL_CONDITIONS,
  LegalTextError,
  legalTextProblems,
  legalTextSentinel,
  publicLegalText,
} from '../../scripts/legal/legalText.mjs';
import { bumpMessage, nextLegalVersion, run as runBuild } from '../../scripts/legal/build-legal-text.mjs';
import {
  CONSENT_TEXTS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_NAMES,
  LEGAL_HISTORY,
  LEGAL_PINNED_HASHES,
  LEGAL_VERSION_PATTERN,
  acceptableLegalVersions,
  currentLegalVersions,
  documentsToAcceptAgain,
  isDraftLegalVersion,
  legalVersionDocument,
} from '../../shared/legal/versions.js';
import { legalHeadingId } from '../../shared/legal/headingId.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const OFF = { billing: false, byoa: false };
const ON = { billing: true, byoa: true };

const DRAFT = [
  '> **下書きです。公開前に専門家（弁護士など）の確認が必要です。**',
  '>',
  '> - 作成日: 2026-10-22',
  '',
  '# Rise Path 利用規約（下書き）',
  '',
  '本規約と[プライバシーポリシー](./privacy-policy.draft.ja.md)を読んでください。',
  '',
  '（根拠: 民法 第 548 条の 2。【要確認】）',
  '',
  '## 第 1 条（同意）',
  '',
  '1. 一つめ。',
  '<!-- legal:if billing -->',
  '2. 有料の項目。',
  '<!-- legal:else -->',
  '',
  '（2 は有料プランについての項目です。）',
  '',
  '<!-- legal:end -->',
  '3. 三つめ。',
  '',
  '（作成メモ：全角のコロンのメモ',
  '二行目もメモ）',
  '',
  '## 第 2 条（自分の AI）',
  '',
  '<!-- legal:if byoa -->',
  '',
  'つなぐ機能の本文。',
  '',
  '<!-- legal:end -->',
  '',
  '| 事業者 | 役割 |',
  '|---|---|',
  '| A | 一 |',
  '<!-- legal:if billing -->',
  '| Stripe | 決済 |',
  '<!-- legal:end -->',
  '',
  '下書きという言葉は本文にも出てきます。[規約](./terms-of-use.draft.ja.md)',
  '',
].join('\n');

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gen = (raw, include = OFF) => publicLegalText(raw, include, { document: 'terms', source: 'doc/legal/x.draft.ja.md' });

describe('publicLegalText (scripts/legal/legalText.mjs)', () => {
  it('drops the banner and the title, puts the sentinel first and ends with one newline', () => {
    const out = gen(DRAFT);
    assert.equal(out.split('\n')[0], legalTextSentinel('terms', 'doc/legal/x.draft.ja.md'));
    assert.match(out.split('\n')[0], /^<!-- risepath-legal-text:terms generated from doc\/legal\/x\.draft\.ja\.md by scripts\/legal\/build-legal-text\.mjs; do not edit -->$/);
    assert.doesNotMatch(out, /公開前に専門家|作成日|^# /m);
    assert.ok(out.endsWith('。\n') || out.endsWith(')\n'));
    assert.ok(!out.endsWith('\n\n'));
    assert.doesNotMatch(out, /\n{3,}/);
  });

  it('drops 根拠 and 作成メモ paragraphs (half- and full-width colon, every line of the paragraph)', () => {
    const out = gen(DRAFT);
    assert.doesNotMatch(out, /根拠|作成メモ|二行目もメモ/);
    assert.deepEqual(legalTextProblems(out), []);
  });

  it('a note directly followed by a heading, list item, quote or table row is an error with file:line (never dropped silently)', () => {
    // Markdown (GitHub, the editor) shows such a line as its own block after the note paragraph.
    for (const next of ['## 第 2 条（b）', '- item', '2. two', '> quote', '| a | b |']) {
      assert.throws(
        () => publicLegalText(`# T（下書き）\n\n## 第 1 条（a）\n\n（根拠: 民法）\n${next}\n`, OFF, { document: 'terms', source: 'doc/legal/x.draft.ja.md' }),
        (e) => e instanceof LegalTextError && e.line === 6 && /^doc\/legal\/x\.draft\.ja\.md:6: /.test(e.message),
        next,
      );
    }
    // A fence line between the note and the heading is removed first: still an error.
    assert.throws(() => gen('# T\n\n（作成メモ: x）\n<!-- legal:if billing -->\n## 第 2 条（b）\n<!-- legal:end -->\n', ON), LegalTextError);
    // A plain second line still belongs to the note, and a blank line ends it.
    assert.equal(gen('# T\n\n（根拠: a）\n二行目もメモ\n\n## 第 2 条（b）\n'), `${legalTextSentinel('terms', 'doc/legal/x.draft.ja.md')}\n\n## 第 2 条（b）\n`);
  });

  it('resolves fences both ways; the placeholder paragraph keeps the numbering; table rows stay one table', () => {
    const off = gen(DRAFT, OFF);
    assert.match(off, /1\. 一つめ。\n\n（2 は有料プランについての項目です。）\n\n3\. 三つめ。/);
    assert.doesNotMatch(off, /有料の項目|つなぐ機能の本文|Stripe/);
    assert.match(off, /\| A \| 一 \|\n\n下書き/);
    const on = gen(DRAFT, ON);
    assert.match(on, /1\. 一つめ。\n2\. 有料の項目。\n3\. 三つめ。/, 'a tight list stays tight');
    assert.doesNotMatch(on, /（2 は有料プラン/);
    assert.match(on, /つなぐ機能の本文。/);
    assert.match(on, /\| A \| 一 \|\n\| Stripe \| 決済 \|/);
    for (const out of [off, on]) assert.doesNotMatch(out, /legal:/);
  });

  it('rewrites the links between the drafts and leaves other relative links for the guard', () => {
    const out = gen(DRAFT);
    assert.match(out, /\[プライバシーポリシー\]\(\/privacy\)/);
    assert.match(out, /\[規約\]\(\/terms\)/);
    const other = gen(DRAFT.replace('[規約](./terms-of-use.draft.ja.md)', '[一覧](./ai-data-inventory.ja.md)'));
    assert.deepEqual(legalTextProblems(other), [{ kind: 'relative_link', count: 1 }]);
  });

  it('strips a BOM and CRLF line ends (the same text either way)', () => {
    assert.equal(gen(`﻿${DRAFT.replace(/\n/g, '\r\n')}`), gen(DRAFT));
  });

  it('refuses a broken fence or title with the draft and the line number', () => {
    const lines = DRAFT.split('\n');
    const withLine = (i, value) => [...lines.slice(0, i), value, ...lines.slice(i)].join('\n');
    const cases = [
      [withLine(12, '<!-- legal:if sales -->'), /x\.draft\.ja\.md:13: unknown fence condition "sales"/],
      [withLine(12, '<!-- legal:else -->'), /x\.draft\.ja\.md:13: legal:else without legal:if/],
      [withLine(12, '<!-- legal:end -->'), /x\.draft\.ja\.md:13: legal:end without legal:if/],
      [withLine(14, '<!-- legal:if byoa -->'), /x\.draft\.ja\.md:15: fences cannot be nested/],
      [withLine(16, '<!-- legal:else -->'), /x\.draft\.ja\.md:17: a second legal:else/],
      [withLine(12, '<!-- legal:if  billing-->'), /x\.draft\.ja\.md:13: malformed fence line/],
      [DRAFT.replace('| Stripe | 決済 |\n<!-- legal:end -->', '| Stripe | 決済 |'), /x\.draft\.ja\.md:37: legal:if billing is never closed/],
      [DRAFT.replace('# Rise Path', 'Rise Path'), /expected exactly one "# " title line, found 0/],
      [`${DRAFT}\n# 二つめのタイトル\n`, /x\.draft\.ja\.md:\d+: expected exactly one "# " title line, found 2/],
    ];
    for (const [raw, message] of cases) {
      assert.throws(() => gen(raw), (error) => error instanceof LegalTextError && message.test(error.message), String(message));
    }
    assert.throws(() => publicLegalText(DRAFT, { billing: true }, { document: 'terms' }), /include\.byoa must be true or false/);
    assert.deepEqual([...LEGAL_CONDITIONS], ['billing', 'byoa']);
  });

  it('legalTextProblems finds every marker kind, not the ordinary word 下書き', () => {
    const text = '【要記入: 名前】【要記入】【要確認】（作成メモ: x）（根拠: y）公開前に専門家 <!-- legal:if billing --> legal:end [a](./b) [c](../d) 下書き';
    assert.deepEqual(legalTextProblems(text), [
      { kind: 'to_fill', count: 2 },
      { kind: 'to_check', count: 1 },
      { kind: 'note', count: 1 },
      { kind: 'basis', count: 1 },
      { kind: 'draft_banner', count: 1 },
      { kind: 'fence', count: 2 },
      { kind: 'relative_link', count: 2 },
    ]);
    assert.deepEqual(legalTextProblems('この下書きは、まだ公開していません。'), []);
  });
});

describe('the committed public texts (content/legal/*.ja.md)', () => {
  for (const name of LEGAL_DOCUMENT_NAMES) {
    const entry = LEGAL_DOCUMENTS[name];

    it(`${name}: equals a fresh generation from ${entry.source} (regenerate with node scripts/legal/build-legal-text.mjs)`, () => {
      const expected = publicLegalText(read(entry.source), entry.include, { document: name, source: entry.source });
      assert.equal(read(entry.generated), expected, `${entry.generated} is out of date with ${entry.source}: run node scripts/legal/build-legal-text.mjs`);
    });

    it(`${name}: its SHA-256 is the one pinned in shared/legal/versions.js (a visible change needs a new version)`, () => {
      const computed = sha256(fs.readFileSync(path.join(ROOT, entry.generated)));
      assert.equal(computed, entry.sha256, bumpMessage(name, entry, computed));
    });

    it(`${name}: today's draft shows neither billing nor BYOA parts, and both variants generate`, () => {
      const off = read(entry.generated);
      assert.doesNotMatch(off, /Stripe|サポータープラン|MCP/);
      assert.match(off, /この機能は、いまは提供していません。/);
      const on = publicLegalText(read(entry.source), ON, { document: name, source: entry.source });
      assert.match(on, /Stripe/);
      assert.match(on, /MCP/);
      for (const text of [off, on]) assert.doesNotMatch(text, /legal:(?:if|else|end)|公開前に専門家|（根拠|\]\(\.\.?\//);
    });
  }

  it('a version without billing and BYOA mentions neither, except in headings and the placeholders (round 1, issue 3)', () => {
    const placeholder = /^（\d+(?:〜\d+)? は(?:有料プラン|自分の AI をつなぐ機能)についての項目です。|^この機能は、いまは提供していません。/u;
    for (const name of LEGAL_DOCUMENT_NAMES) {
      const entry = LEGAL_DOCUMENTS[name];
      assert.deepEqual({ ...entry.include }, OFF, `${name}: today's version includes neither`);
      const hits = read(entry.generated)
        .split('\n')
        .filter((line) => !/^#{2,3} /.test(line) && !placeholder.test(line))
        // Open questions for the lawyer block a release anyway (check-legal-release.mjs).
        .map((line) => line.replace(/【要確認[^】]*】/gu, ''))
        .filter((line) => /有料|決済|カードの|Stripe|AI アプリ|つなぐ|MCP/u.test(line));
      assert.deepEqual(hits, [], `${name}: fence these lines (<!-- legal:if billing --> / byoa) in ${entry.source}`);
    }
    const privacy = read(LEGAL_DOCUMENTS.privacy.generated);
    assert.match(privacy, /10\. \*\*安全のための記録\*\*[^\n]*\n\n（11 は自分の AI をつなぐ機能についての項目です。[^\n]*）\n/u, 'privacy 2: the placeholder keeps 12 (billing) at its number');
  });

  it('the privacy policy names what the records kept after a deletion hold (round 1, issue 2; migration 018)', () => {
    const columns = (table) => {
      const sql = read('server/migrations/018_account_deletion_and_legal.sql');
      const body = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
      return [...body.slice(0, body.indexOf('\n);')).matchAll(/^ {2}([a-z_]+) +[a-z]/gm)].map((m) => m[1]);
    };
    // When one of these tables gains a column, say in privacy §8 (and 4.4-5, 7.5) what it keeps.
    assert.deepEqual(columns('account_deletions'), ['user_id', 'deleted_at', 'requested_by', 'reopened_at']);
    assert.match(read('server/migrations/018_account_deletion_and_legal.sql'), /requested_by text +NOT NULL CHECK \(requested_by IN \('self', 'staff', 'orphan'\)\)/);
    assert.deepEqual(columns('ai_app_provision_records'), ['user_id', 'client_id', 'client_name', 'first_seen_at', 'last_used_at', 'revoked_at', 'account_deleted_at']);
    assert.deepEqual(columns('account_consent_proofs'), ['consent_id', 'user_id', 'kind', 'policy_version', 'method', 'given_at', 'revoked_at', 'account_deleted_at']);
    const privacy = read(LEGAL_DOCUMENTS.privacy.generated);
    assert.match(privacy, /アカウントを削除した記録（アカウント ID、削除した日時、ご本人・スタッフ・定期の確認のどれで削除したか、同じログインであとでまた使い始めた日時）/u);
    assert.match(privacy, /利用規約に同意した記録（アカウント ID、同意した利用規約とプライバシーポリシーの版、日時）/u);
    assert.equal(privacy.split('アカウント ID と、同意の種類・同意文の版・方法・日時だけを 5 年').length - 1, 2, '7.5 and §8: the guardian consent proof');
    const on = publicLegalText(read(LEGAL_DOCUMENTS.privacy.source), ON, { document: 'privacy', source: LEGAL_DOCUMENTS.privacy.source });
    assert.equal(on.split('アカウント ID と、使ったことのある AI アプリの ID と名前、使い始めた日・最後に使った日・解除した日だけを 3 年').length - 1, 2, '4.4-5 and §8 (byoa versions)');
    // Safety events and report text stay after a deletion with user_id NULL (014 ON DELETE SET NULL).
    assert.match(read('server/migrations/014_minor_safeguards.sql'), /user_id +uuid +NULL REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
    assert.match(privacy, /アカウントを削除しても、安全のための記録と報告の文章は、アカウントとのつながりを外して/u, 'privacy §8: safety events keep user_id NULL after a deletion');
    assert.match(privacy, /当法人の DB に保存した情報は、アカウントを削除したときに消します（このあとに書いた、削除のあとも残すものを除きます）/u);
    // One tombstone per id (account_deletions' primary key is user_id): a second deletion replaces the first.
    assert.match(read('server/migrations/018_account_deletion_and_legal.sql'), /CREATE TABLE IF NOT EXISTS account_deletions \(\n {2}user_id +uuid +PRIMARY KEY,/);
    assert.match(privacy, /同じアカウント ID でもう一度削除したときは、アカウントを削除した記録は、最後に削除したときの分だけを残します/u);
  });

  it('the data inventory (the base of the policy and the lawyer review) has no stale Phase 4 line and no line-numbered compose pointer', () => {
    const inventory = read('doc/legal/ai-data-inventory.ja.md');
    assert.doesNotMatch(inventory, /アカウントごと消す機能はまだありません/u);
    assert.doesNotMatch(inventory, /docker-compose\.yml:\d/, 'name the compose service (`db`, `cloudflared`), not a line that moves');
    assert.doesNotMatch(inventory, /コース生成などのジョブ/u);
  });

  it('the privacy policy and the inventory say what Phase 5 keeps: XP and learning days survive a reset or a delete (O2) and go with the account', () => {
    const privacy = read(LEGAL_DOCUMENTS.privacy.generated);
    assert.match(privacy, /XP（経験値）の記録（どのレッスンやステージで、いつ、いくつ）と、学んだ日（日本時間の日付だけ）を当法人のサーバーに保存し/u);
    assert.match(privacy, /「このレッスンを最初からやり直す」で、1 つのレッスンの記録だけを、すべての端末から消すこともできます。/u);
    assert.match(privacy, /XP の記録と学んだ日の記録は、進み具合を消したりやり直したりしても残り、アカウントを削除するまで保存します。/u);
    // The logout question is promised only where the code asks (logoutGuard.ts): a "sign in again"
    // button (reason 'reauth') and an expired session never ask; their records stay all the same.
    assert.match(privacy, /ご自分でログアウトするときに、まだサーバーへ送れていない進み具合があれば画面でお知らせし、ログアウトするかを選んでいただきます（そのあいだは、まだログアウトしていません）。/u);
    assert.match(privacy, /もう一度ログインするためのボタン（「ログインし直す」など）を押したときや、ログインが切れたときは、おたずねしませんが、送れていない進み具合は上のとおり端末に残します。/u);
    assert.doesNotMatch(privacy, /。ログアウトのときに、まだサーバーへ送れていない進み具合があれば/u, 'not every logout asks');
    assert.doesNotMatch(privacy, /連続して学んだ日数などの表示に使います/u, 'the streak no longer comes from the history');
    const inventory = read('doc/legal/ai-data-inventory.ja.md');
    assert.match(inventory, /^\| XP・バッジ・学んだ日（Phase 5） \|/mu);
    assert.match(inventory, /\*\*AI アプリからは読めません\*\*/u);
    assert.match(inventory, /本人がログアウトするときに、まだサーバーへ送れていない記録があれば/u);
    assert.match(inventory, /ログインが切れたとき、Nexloom だけのログインでは聞きません。/u);
    // The three Phase 5 tables are all named (vmStackConfig.test.js pins that none is granted to the MCP role).
    for (const table of ['lesson_progress_lesson_resets', 'xp_awards', 'learning_days']) assert.ok(inventory.includes(`\`${table}\``), table);
  });

  it('the privacy policy names the processing records the code really writes (jobs: material indexing only)', () => {
    // POST /rag/index is the only jobs insert (type 'ingest'); the worker runs 'ingest' only.
    assert.match(read('server/jobWorker.js'), /'ingest'/);
    const privacy = read(LEGAL_DOCUMENTS.privacy.generated);
    assert.doesNotMatch(privacy, /コース生成などの処理/u);
    assert.match(privacy, /処理の記録（アップロードした教材を検索できるようにする処理の状態）は、\*\*1 年\*\*たったら消します/u);
  });

  it('terms 第 9 条 keeps its numbering without billing (1, the placeholder, then 12 with its sub-list)', () => {
    const terms = read(LEGAL_DOCUMENTS.terms.generated);
    assert.match(terms, /1\. 本サービスの基本の機能は、無料で提供します。[^\n]*\n\n（2〜11 は有料プランについての項目です。[^\n]*）\n\n12\. 当法人は、[^\n]*\n {4}- サーバーなどの点検や故障/);
    assert.match(read(LEGAL_DOCUMENTS.privacy.generated), /6\. 未成年の方を守るため[^\n]*\n\n（7 は有料プランについての項目です。[^\n]*）\n\n8\. /);
  });

  it('terms 第 10 条 3 describes the in-app deletion (Phase 4 text, finding 31)', () => {
    const terms = read(LEGAL_DOCUMENTS.terms.generated);
    assert.match(terms, /設定の「アカウントを削除する」から、Rise Path のデータをいつでも削除できます。削除はすぐに行い、元に戻せません。/);
    assert.doesNotMatch(terms, /アプリ内にアカウント削除の機能がない/);
    const privacy = read(LEGAL_DOCUMENTS.privacy.generated);
    assert.match(privacy, /当法人の DB に保存した情報は、アカウントを削除したときに消します（このあとに書いた、削除のあとも残すものを除きます）。/);
    assert.match(privacy, /\*\*30 日\*\*たったら消します/);
  });
});

describe('shared/legal/versions.js', () => {
  it('ids match the pattern and their document; drafts have no effective date, released ones carry it', () => {
    for (const name of LEGAL_DOCUMENT_NAMES) {
      const entry = LEGAL_DOCUMENTS[name];
      assert.match(entry.version, LEGAL_VERSION_PATTERN);
      assert.equal(legalVersionDocument(entry.version), name);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      if (isDraftLegalVersion(entry.version)) assert.equal(entry.effectiveDate, null);
      else assert.ok(entry.version.startsWith(`${name}-${entry.effectiveDate}`), `${entry.version} carries ${entry.effectiveDate}`);
      assert.deepEqual(Object.keys(entry.include).sort(), [...LEGAL_CONDITIONS].sort());
      for (const condition of LEGAL_CONDITIONS) assert.equal(typeof entry.include[condition], 'boolean');
    }
    for (const entry of LEGAL_HISTORY) {
      assert.equal(legalVersionDocument(entry.version), entry.document);
      assert.equal(isDraftLegalVersion(entry.version), false, 'history holds released versions only');
    }
    assert.deepEqual(currentLegalVersions(), { terms: LEGAL_DOCUMENTS.terms.version, privacy: LEGAL_DOCUMENTS.privacy.version });
    assert.equal(legalVersionDocument('terms-draft-2026-10-22.2'), 'terms');
    assert.equal(legalVersionDocument('privacy-2026-12-01'), 'privacy');
    for (const bad of ['terms-2026-1-01', 'other-2026-10-22', 'terms-draft-2026-10-22.123', 'terms-2026-10-22-x', null, 3]) {
      assert.equal(legalVersionDocument(bad), null, String(bad));
    }
  });

  it('every version id is pinned to its text in LEGAL_PINNED_HASHES (a version id names one text forever)', () => {
    for (const entry of [...LEGAL_DOCUMENT_NAMES.map((name) => LEGAL_DOCUMENTS[name]), ...LEGAL_HISTORY]) {
      assert.equal(LEGAL_PINNED_HASHES[entry.version], entry.sha256,
        `${entry.version} is pinned to another text (or not listed): give the new text a new version and add it to LEGAL_PINNED_HASHES`);
    }
    for (const [version, hash] of Object.entries(LEGAL_PINNED_HASHES)) {
      assert.match(version, LEGAL_VERSION_PATTERN, version);
      assert.match(hash, /^[0-9a-f]{64}$/, version);
    }
    assert.ok(Object.isFrozen(LEGAL_PINNED_HASHES));
  });

  it('requiresAcceptance is a boolean everywhere and at least one terms version requires it', () => {
    const all = [...Object.values(LEGAL_DOCUMENTS), ...LEGAL_HISTORY];
    for (const entry of all) assert.equal(typeof entry.requiresAcceptance, 'boolean', entry.version);
    const terms = [LEGAL_DOCUMENTS.terms, ...LEGAL_HISTORY.filter((e) => e.document === 'terms')];
    assert.ok(terms.some((e) => e.requiresAcceptance === true));
  });

  it('every released version (current or in LEGAL_HISTORY) has its archive file with the pinned hash', () => {
    const released = [
      ...LEGAL_DOCUMENT_NAMES.map((name) => LEGAL_DOCUMENTS[name]).filter((e) => !isDraftLegalVersion(e.version)),
      ...LEGAL_HISTORY,
    ];
    for (const entry of released) {
      const file = path.join(ROOT, `content/legal/archive/${entry.version}.ja.md`);
      assert.ok(fs.existsSync(file), `${entry.version} has its archive file`);
      assert.equal(sha256(fs.readFileSync(file)), entry.sha256, `${entry.version}: the archived text never changes`);
    }
    for (const [version, { file }] of Object.entries(CONSENT_TEXTS)) {
      assert.equal(file, `content/legal/archive/${version}.ja.md`);
    }
  });

  it('acceptableLegalVersions: from the newest version that requires acceptance up to the current one', () => {
    const doc = (version, requiresAcceptance) => ({ version, requiresAcceptance, sha256: 'x', effectiveDate: null, include: OFF, source: '', generated: '' });
    const documents = { terms: doc('terms-2027-04-01', false), privacy: doc('privacy-2027-04-01', false) };
    const history = [
      { document: 'terms', version: 'terms-2026-12-01', requiresAcceptance: true },
      { document: 'privacy', version: 'privacy-2026-12-01', requiresAcceptance: false },
      { document: 'terms', version: 'terms-2027-01-01', requiresAcceptance: false },
    ];
    assert.deepEqual(acceptableLegalVersions('terms', { documents, history }), ['terms-2026-12-01', 'terms-2027-01-01', 'terms-2027-04-01']);
    assert.equal(acceptableLegalVersions('privacy', { documents, history }), null, 'no privacy version ever required acceptance');
    const requiring = { ...documents, terms: doc('terms-2027-04-01', true) };
    assert.deepEqual(acceptableLegalVersions('terms', { documents: requiring, history }), ['terms-2027-04-01']);
    // Today: the current terms draft requires acceptance, privacy does not.
    assert.deepEqual(acceptableLegalVersions('terms'), [LEGAL_DOCUMENTS.terms.version]);
    assert.equal(acceptableLegalVersions('privacy'), null);
  });

  it('documentsToAcceptAgain: which documents the re-consent page names (a privacy version may need acceptance too)', () => {
    const doc = (version, requiresAcceptance) => ({ version, requiresAcceptance, sha256: 'x', effectiveDate: null, include: OFF, source: '', generated: '' });
    const history = [
      { document: 'terms', version: 'terms-2026-12-01', requiresAcceptance: true },
      { document: 'privacy', version: 'privacy-2026-12-01', requiresAcceptance: false },
    ];
    const last = { termsVersion: 'terms-2026-12-01', privacyVersion: 'privacy-2026-12-01', acceptedAt: null };
    const privacyBump = { terms: doc('terms-2026-12-01', true), privacy: doc('privacy-2027-04-01', true) };
    assert.deepEqual(documentsToAcceptAgain(last, { documents: privacyBump, history: history.filter((h) => h.document === 'privacy') }), ['privacy']);
    const termsBump = { terms: doc('terms-2027-04-01', true), privacy: doc('privacy-2026-12-01', false) };
    assert.deepEqual(documentsToAcceptAgain(last, { documents: termsBump, history: history.filter((h) => h.document === 'terms') }), ['terms']);
    const both = { terms: doc('terms-2027-04-01', true), privacy: doc('privacy-2027-04-01', true) };
    assert.deepEqual(documentsToAcceptAgain(last, { documents: both, history }), ['terms', 'privacy']);
    const editorial = { terms: doc('terms-2027-04-01', false), privacy: doc('privacy-2027-04-01', false) };
    assert.deepEqual(documentsToAcceptAgain(last, { documents: editorial, history }), []);
    assert.deepEqual(documentsToAcceptAgain(null, { documents: both, history }), [], 'no last acceptance: a first agreement');
    assert.deepEqual(documentsToAcceptAgain({ termsVersion: 'terms-draft-2026-10-01', privacyVersion: 'privacy-draft-2026-10-01', acceptedAt: null }), ['terms'], 'today: only terms can need it');
  });

  it('holds no legal text and none of the CI bundle markers', () => {
    const source = read('shared/legal/versions.js');
    for (const marker of ['risepath-legal-text', '【要確認', '公開前に専門家', '（作成メモ:', '（根拠:']) assert.ok(!source.includes(marker), marker);
  });
});

describe('legalHeadingId (shared/legal/headingId.js)', () => {
  it('第 N 条 → article-N, N.M → section-N-M, N. → section-N, else null', () => {
    assert.equal(legalHeadingId('第 1 条（本規約への同意）'), 'article-1');
    assert.equal(legalHeadingId('第10条（利用の停止）'), 'article-10');
    assert.equal(legalHeadingId('3. 利用目的'), 'section-3');
    assert.equal(legalHeadingId('4.4 自分の AI をつなぐ場合'), 'section-4-4');
    assert.equal(legalHeadingId('  8. 保存期間 '), 'section-8');
    assert.equal(legalHeadingId('10.'), 'section-10');
    for (const none of ['お問い合わせ', '2026 年', '4.4.1 細目', '1.5倍', '', null, undefined]) assert.equal(legalHeadingId(none), null, String(none));
  });

  it('gives the links the pages use (/privacy#section-3, #section-8) a target, every id once', () => {
    for (const name of LEGAL_DOCUMENT_NAMES) {
      const ids = read(LEGAL_DOCUMENTS[name].generated)
        .split('\n')
        .filter((line) => /^#{2,3} /.test(line))
        .map((line) => legalHeadingId(line.replace(/^#+ /, '')))
        .filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, `${name}: unique heading ids`);
      if (name === 'privacy') for (const id of ['section-3', 'section-8', 'section-4-4']) assert.ok(ids.includes(id), id);
      if (name === 'terms') for (const id of ['article-1', 'article-10', 'article-12']) assert.ok(ids.includes(id), id);
    }
  });
});

describe('scripts/legal/build-legal-text.mjs', () => {
  const make = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-legal-build-'));
    for (const name of LEGAL_DOCUMENT_NAMES) {
      const entry = LEGAL_DOCUMENTS[name];
      fs.mkdirSync(path.join(root, path.dirname(entry.source)), { recursive: true });
      fs.writeFileSync(path.join(root, entry.source), DRAFT.replace('利用規約', name));
    }
    const text = (name, include = OFF) => publicLegalText(DRAFT.replace('利用規約', name), include, { document: name, source: LEGAL_DOCUMENTS[name].source });
    const documents = (overrides = {}) => Object.fromEntries(LEGAL_DOCUMENT_NAMES.map((name) => [name, {
      ...LEGAL_DOCUMENTS[name],
      sha256: sha256(text(name)),
      ...(overrides[name] ?? {}),
    }]));
    return { root, text, documents };
  };
  const capture = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
  };
  /** The build with LEGAL_PINNED_HASHES of the given documents (their version ids pinned to their hashes). */
  const runPinned = (argv, deps) => runBuild(argv, {
    pinnedHashes: Object.fromEntries(Object.values(deps.documents ?? LEGAL_DOCUMENTS).map((entry) => [entry.version, entry.sha256])),
    ...deps,
  });

  it('--check fails while the files are missing, writing fixes it, --check then passes', () => {
    const { root, documents } = make();
    try {
      let io = capture();
      assert.equal(runPinned(['--check'], { root, documents: documents(), ...io }), 1);
      assert.match(io.lines.err.join('\n'), /content\/legal\/terms\.ja\.md is out of date/);
      assert.equal(fs.existsSync(path.join(root, 'content/legal/terms.ja.md')), false, '--check writes nothing');
      io = capture();
      assert.equal(runPinned([], { root, documents: documents(), ...io }), 0);
      assert.match(io.lines.out.join('\n'), /terms: wrote content\/legal\/terms\.ja\.md \(sha256 [0-9a-f]{64}\)/);
      io = capture();
      assert.equal(runPinned(['--check'], { root, documents: documents(), ...io }), 0);
      assert.match(io.lines.out.join('\n'), /is up to date/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a changed draft: write says which version and hash to pin, --check fails with the bump message', () => {
    const { root, documents } = make();
    try {
      runPinned([], { root, documents: documents(), ...capture() });
      const source = path.join(root, LEGAL_DOCUMENTS.terms.source);
      fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('一つめ。', '一つめ（直しました）。'));
      let io = capture();
      assert.equal(runPinned(['--check'], { root, documents: documents({ terms: { sha256: sha256('old') } }), ...io }), 1);
      const message = io.lines.err.join('\n');
      const next = escapeRegExp(nextLegalVersion(LEGAL_DOCUMENTS.terms.version));
      assert.match(message, new RegExp(`The public text of terms changed\\. Give it a new version in shared/legal/versions\\.js \\(a draft: ${next}; a released text: the new effective date\\), set sha256 to [0-9a-f]{64}, add the new version and sha256 to LEGAL_PINNED_HASHES, and decide requiresAcceptance\\.`));
      io = capture();
      assert.equal(runPinned([], { root, documents: documents({ terms: { sha256: sha256('old') } }), ...io }), 0);
      assert.match(io.lines.out.join('\n'), new RegExp(`terms: wrote [\\s\\S]*a draft: ${next}`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a reused version id with a new text: --check fails, naming LEGAL_PINNED_HASHES (on a database that holds the id, every acceptance would be 500 legal_version_conflict)', () => {
    // The owner edits the draft, rebuilds and copies only the printed sha256, keeping the old id.
    const reused = { ...LEGAL_DOCUMENTS, privacy: { ...LEGAL_DOCUMENTS.privacy, version: 'privacy-draft-2026-10-22.2' } };
    const io = capture();
    assert.equal(runBuild(['--check'], { documents: reused, ...io }), 1);
    assert.match(io.lines.err.join('\n'), /privacy: privacy-draft-2026-10-22\.2 names another text in LEGAL_PINNED_HASHES .*Give this text a new version \(a draft: privacy-draft-2026-10-22\.3\)/);
    const unlisted = { ...LEGAL_DOCUMENTS, privacy: { ...LEGAL_DOCUMENTS.privacy, version: 'privacy-draft-2026-10-22.9' } };
    const io2 = capture();
    assert.equal(runBuild(['--check'], { documents: unlisted, ...io2 }), 1);
    assert.match(io2.lines.err.join('\n'), /privacy-draft-2026-10-22\.9 is not in LEGAL_PINNED_HASHES/);
    assert.equal(runBuild(['--check'], { ...capture() }), 0, 'the committed state passes');
  });

  it('a fence error stops the build with file:line', () => {
    const { root, documents } = make();
    try {
      const source = path.join(root, LEGAL_DOCUMENTS.privacy.source);
      fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('<!-- legal:if byoa -->', '<!-- legal:if sales -->'));
      const io = capture();
      assert.equal(runPinned([], { root, documents: documents(), ...io }), 1);
      assert.match(io.lines.err.join('\n'), /doc\/legal\/privacy-policy\.draft\.ja\.md:\d+: unknown fence condition "sales"/);
      assert.equal(runPinned(['--bogus'], { root, documents: documents(), ...capture() }), 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('--archive skips drafts, writes a released text once and never overwrites another text', () => {
    const { root, text, documents } = make();
    try {
      const released = documents({ terms: { version: 'terms-2026-12-01', effectiveDate: '2026-12-01' } });
      runPinned([], { root, documents: released, ...capture() });
      let io = capture();
      assert.equal(runPinned(['--archive'], { root, documents: released, ...io }), 0);
      assert.match(io.lines.out.join('\n'), new RegExp(`privacy: ${escapeRegExp(LEGAL_DOCUMENTS.privacy.version)} is not released; drafts are not archived\\.`));
      const archived = path.join(root, 'content/legal/archive/terms-2026-12-01.ja.md');
      assert.equal(fs.readFileSync(archived, 'utf8'), text('terms'));
      io = capture();
      assert.equal(runPinned(['--archive'], { root, documents: released, ...io }), 0);
      assert.match(io.lines.out.join('\n'), /already archived/);
      fs.writeFileSync(archived, 'another text\n');
      io = capture();
      assert.equal(runPinned(['--archive'], { root, documents: released, ...io }), 1);
      assert.match(io.lines.err.join('\n'), /exists with another text; an archived text is never overwritten/);
      assert.equal(fs.readFileSync(archived, 'utf8'), 'another text\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('nextLegalVersion: the next .N for a draft, the new effective date for a released text', () => {
    assert.equal(nextLegalVersion('terms-draft-2026-10-22'), 'terms-draft-2026-10-22.2');
    assert.equal(nextLegalVersion('privacy-draft-2026-10-22.2'), 'privacy-draft-2026-10-22.3');
    assert.equal(nextLegalVersion('terms-2026-12-01'), 'terms-<new effective date YYYY-MM-DD>');
  });
});
