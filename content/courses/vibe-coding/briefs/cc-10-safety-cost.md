# Brief: vibe-coding/cc-10-safety-cost

第10回｜安全とコストを管理する — module 4 「チームと自動化」, lesson 10 of 11 of the Claude Code course
(`doc/brushup-2026/research/claude-code-curriculum.ja.md` §7). Draft only; the course it is published in is the
owner's decision (report §7 「公開時の形」).

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を毎日の開発に使い始めた人。バイブコーディングコースの第3章（VS Code）・第5章（GitHub）程度の基礎がある人、または他の AI コーディングツールを使ったことがある開発者。
- すでに知っていること（前提） / prior knowledge: 第2回（権限モード、許可・確認・拒否ルール、`.claude/settings.json`、分類器）、第5回（コンテキスト、`/clear`・`/compact`）、第6回（CLAUDE.md は助言で強制ではない）、第7回（スキル、サブエージェント）、第8回（フック、MCP、プラグイン）、第9回（`claude -p` の自動実行）。ターミナルで `cd` と `ls` が使え、JSON の設定ファイルを編集できる。有料プランか Console のアカウントがある。
- 前のレッスン / previous lesson: `cc-09-parallel-automation`（第9回｜並列で進める・自動で回す）。次は `cc-11-capstone`（総合演習）で、この回の点検を自分のリポジトリに当てはめる。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: analyze): 危ない場面（信頼できないリポジトリ、外部の文章、強い権限）と、それぞれに合う対策を結びつけられる / Match risky situations (untrusted repositories, outside text, strong permissions) to the right safeguards.
- o2 (bloom: apply): 秘密情報のファイルを読ませない拒否ルール（deny）を書ける / Write deny rules that keep Claude from reading files that hold secrets.
- o3 (bloom: analyze): 想定外の使用量や請求の原因を特定できる / Find the cause of unexpected usage or an unexpected bill.

## 範囲 / Scope
- 扱う / in:
  - プロンプトインジェクションと、公式ドキュメント（Security）の5つの対策（承認前にコマンドを読む、信頼できない内容をそのまま流し込まない、重要なファイルの変更を確かめる、スクリプトやツールの実行は VM で、`/feedback` で報告）。auto モード（v2.1.283 からターミナルと VS Code の対話セッションの既定）でも分類器に見逃しがある（2026年3月の公式記事の検証で、行き過ぎた操作の17%）。
  - ワークスペースの信頼（許可ルールは承認まで効かない、拒否・確認ルールは承認前から効く、`--bare` なしの `claude -p` は確認なしでリポジトリのフックや `.mcp.json` のサーバーを使う）。信頼できないリポジトリには VM かクラウドセッション。`bypassPermissions` はネットにつながらないコンテナや VM だけ。
  - サンドボックス：既定オフ、`/sandbox`、macOS は Seatbelt、Linux・WSL2 は bubblewrap、ネイティブの Windows は対象外、守るのはシェルコマンドだけ。
  - 拒否ルール：`Read(./.env)`・`Read(./.env.*)`・`Read(./secrets/**)`（公式の例）、gitignore と同じパターン、置き場所（プロジェクトの `.claude/settings.json`）、`/permissions` での確認、効かない書き方（`Write(...)` のパスのルール、`.claudeignore`、先頭 `/` 1つ）、ホームからは `~/`・絶対パスは `//`、届かない経路（自分でファイルを開くスクリプト → サンドボックス）。
  - データの行き先（短く）：隔離しても送る中身は同じ。個人向け（Pro・Max）は学習への利用を本人が選ぶ、法人向け（Team・Enterprise・API）は既定で使われない、手元の `~/.claude/projects/` に会話の記録が平文で既定30日。保存期間と `/privacy-settings` は本文の字数の都合で扱わない。
  - コスト：`/usage`（別名 `/cost`・`/stats`）の金額は見積もりで請求書ではない。企業での平均は約13ドル／開発者・稼働日（参考値）。コツ（`/clear`、`/compact` はそれ自体が大きな要求、モデルとエフォート（effort：考える量の設定）、CLAUDE.md 200行以内、サブエージェント）。請求の落とし穴（`ANTHROPIC_API_KEY` を承認すると API の料金、`-p` では承認なしで使われる、`/status` で確かめる）。Pro・Max の利用上限は5時間のセッション上限と週の上限で、Claude のチャットと共有。料金は書かず、公式の料金ページへリンク。
- 扱わない（別レッスン） / out: 権限モードとルールの基本（第2回）、フックで止める設定（第8回）、auto モードの `autoMode` 設定、管理設定（managed settings）、ZDR、sandbox の詳細設定（`allowedDomains`、`credentials`）、プランの価格、OpenTelemetry。
- 学習者がよく持つ誤解 / likely misconceptions (report §6 and the facts file):
  1. 「auto モードなら何をさせても安全」— 分類器にも見逃しがある。本番に関わる変更は人が見る（hook predict d, q1 c, exam e1 c）。
  2. 「CLAUDE.md に『〜するな』と書けば守られる」— CLAUDE.md は助言。止めるのは承認と拒否ルール（q1 d, s3-lead）。
  3. 「公開リポジトリや MCP サーバーは公式が安全を確かめている」— Anthropic は監査しない。信頼の確認は自分の判断（hook predict c, q2 d）。
  4. 「サンドボックスを入れれば全部守られる」— 守るのはシェルコマンドだけ（q2 b, e2 c）。
  5. 「拒否ルールを書けば、どんな経路でも読まれない」／「許可していなければ読まれない」／「`Write(...)` でも効く」「`.claudeignore` で守れる」「先頭 `/` 1つは絶対パス」「`./` でホームを指せる」（q3, e3, e4）。
  6. 「サブスクリプションなら課金の心配はない」— `ANTHROPIC_API_KEY` があると API の料金になる。上限はチャットと共有（q4, e5）。
  7. 「`/usage` の金額が請求額」「`/compact` をこまめにすれば節約になる」（e5 b, e6 a）。

## 形式 / Format
- 所要時間 / minutes: 17（measure.mjs: `cc-10-safety-cost.lesson.json: prose 1896 (budget 1,200–2,400) · read 2468 · practice reading 1072 · questions 11 · practice sections 1 · est 17.2 min (must be ≤ 20; estMinutes 17)`）
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（cc-* 共通の決定。英語版は公開するコースが決まってから）
- 演習の題材 / practice task idea: Max プランの「田中さん」の設定と習慣を点検する。`~/.claude/settings.json` の `bypassPermissions`、`~/.zshrc` の `ANTHROPIC_API_KEY`、毎晩の `claude -p`、知らないリポジトリを手元で開く習慣、`.env`・`secrets/` に拒否ルールなし、1日1セッション。新しい練習用フォルダー `cc-practice` でダミーの `.env` と `secrets/` に拒否ルールを書いて試し、先月届いた API の請求を説明する。模範解答は `practice-answer-rule`（JSON）と `practice-prompt-review.expect`（点検4項目と請求の説明）。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。auto モードがターミナルと VS Code の対話セッションの既定になったのは v2.1.283 から。
- OS / environment: macOS・Linux・WSL2 のターミナル。サンドボックスはネイティブの Windows では使えないことを本文で伝える。
- 使ってはいけないもの / avoid: 価格（料金ページへのリンクだけ）、本物の鍵や `.env` の値、破壊的なコマンド、大事なリポジトリでの演習、確かめていない UI の文言（`/status` や拒否時の表示の文言は書かない）。

## 資料 / Sources
All checked 2026-10-20 (facts file `facts-cc-10-safety-cost.md`, plus the official pages re-read for the deny-rule syntax).
- `cc-security` — Security — https://code.claude.com/docs/en/security — Anthropic (five practices, trust dialog, MCP not audited)
- `cc-permissions` — Configure permissions — https://code.claude.com/docs/en/permissions — Anthropic (Read/Edit patterns, gitignore syntax, `/path` anchoring, what deny rules don't reach, workspace trust, `-p`). Re-read 2026-10-20 for the round-1 fixes; the page says: "`//path` | Absolute path from filesystem root", "`~/path` | Path from home directory", "`/path` | Path relative to the settings source", "`path` or `./path` | Path relative to current directory"; "A deny rule such as `Read(/secrets/**)` in user settings blocks `~/.claude/secrets/**`, not a `secrets` directory in your project. To write a rule in user settings that applies inside every project, use a `//` absolute path or a `~/` home-relative path instead."; "Read and Edit deny rules apply to Claude's built-in file tools, to file commands Claude Code recognizes in Bash, such as `cat`, `head`, `tail`, `sed`, and `tee`, and to the targets of Bash redirections … They don't apply to … a Python or Node script that opens files itself."; "A `Read` deny rule also blocks the Edit and Write tools on the same path"; "If your project has a `.claudeignore` file, it has no effect".
- `cc-permission-modes` — Choose a permission mode — https://code.claude.com/docs/en/permission-modes — Anthropic (auto default v2.1.283 for interactive terminal and VS Code sessions, bypassPermissions only in isolated environments, start as root/sudo refused on Linux and macOS)
- `cc-sandboxing` — Configure the sandboxed Bash tool — https://code.claude.com/docs/en/sandboxing — Anthropic
- `cc-sandbox-environments` — Choose a sandbox environment — https://code.claude.com/docs/en/sandbox-environments — Anthropic (VM or cloud session for untrusted repos; isolation doesn't change what is sent)
- `cc-settings-reference` — Settings reference — https://code.claude.com/docs/en/settings-reference — Anthropic (paste-ready `permissions.deny` example with `Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)`; `cleanupPeriodDays`)
- `cc-data-usage` — Data usage — https://code.claude.com/docs/en/data-usage — Anthropic
- `cc-costs` — Manage costs effectively — https://code.claude.com/docs/en/costs — Anthropic ("lowering the effort level with `/effort`" for simpler tasks; "`/compact` … is itself a large request … `/clear` costs nothing")
- `cc-model-config` — Model configuration — https://code.claude.com/docs/en/model-config — Anthropic (effort: "lets the model decide whether and how much to think on each step … Lower effort is faster and cheaper")
- `cc-commands` — Commands — https://code.claude.com/docs/en/commands — Anthropic (`/usage` aliases, `/privacy-settings`)
- `cc-authentication` — Authentication — https://code.claude.com/docs/en/authentication — Anthropic (`ANTHROPIC_API_KEY` precedence, `-p`, `/status`)
- `auto-mode-eng` — How we built Claude Code auto mode — https://www.anthropic.com/engineering/claude-code-auto-mode — Anthropic (17% false negatives on real overeager actions, measured on the pipeline described in the March 2026 post)
- `cc-pro-max-help` — Use Claude Code with your Pro or Max plan — https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan — Anthropic (Claude Help Center) (five-hour and weekly limits, shared with Claude)
- `pricing` — Claude pricing — https://claude.com/pricing — Anthropic (linked, no prices in the lesson)
- Japanese pages linked in prose: https://code.claude.com/docs/ja/security

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：知らないリポジトリと、残ったAPIキー | 知らないリポジトリを clone し、`ANTHROPIC_API_KEY` が残ったまま「README のとおりに準備して」と頼もうとしている | markdown (3 scene sentences, API spelled out, + lead-in question), quiz predict (multi) | `q0` → o1 (ungraded) |
| `s1` | concept | 10-1. 外の文章に紛れた指示 | 外部の文章は指示になりうる。公式の5つの対策。auto モード（v2.1.283 からターミナルと VS Code の対話の既定）も万能ではない | markdown, definitions (プロンプトインジェクション), markdown (docs link, "Claude Code changes often"), list number (5 practices, VM glossed), callout warning (17%, dated to the March 2026 official post), quiz inline | `q1` → o1 (analyze: a web page proposes `curl … \| bash`) |
| `s2` | concept | 10-2. 知らないリポジトリと強い権限は、隔離する | 信頼の確認とサンドボックスの範囲を知り、知らないリポジトリと強い権限は隔離して使う | markdown, definitions (ワークスペースの信頼, サンドボックス), markdown (`/sandbox`, Seatbelt / bubblewrap, not native Windows, hooks and MCP outside), markdown (VM or cloud session, `claude -p` without `--bare`), diagram (layers: VM ⊃ Claude Code ⊃ sandbox around shell commands; 5 nodes, 2 subgraphs, stacked top to bottom for 390 px screens), table (2 columns: 場面と起きうること → 合う対策, 3 rows), quiz inline | `q2` → o1 (analyze: how to try an unknown repo) |
| `s3` | example | 10-3. 秘密情報を読ませない拒否ルールを書く | 拒否ルールのパスで秘密情報を守る（worked example: `config/secret.json` と `keys/`） | markdown, steps (4 subgoals with the why), code json `.claude/settings.json`, callout pitfall (`Write(...)`, `.claudeignore`; `~/` home, `//` absolute, single `/` is not absolute; scripts → sandbox), quiz inline | `q3` → o2 (apply: `certs/**`) |
| `s4` | concept | 10-4. データの行き先を知る | VMなどで隔離しても、Anthropicに送られる中身は変わらない。個人向けは会話をモデルの学習に使うかを選べる、法人向けは既定で使われない。手元に暗号化されない記録が30日 | markdown ×2 | — |
| `s5` | concept | 10-5. 使用量と請求の原因を突き止める | `/usage` は見積もり。約13ドル/日は参考値。症状から原因と対策をたどる（API キー、長いセッション、モデル・effort・CLAUDE.md・サブエージェント、共有の上限） | markdown, markdown (average, pricing link; a second paragraph with the table notes: `-p` uses `ANTHROPIC_API_KEY` without approval, `/clear` costs nothing while `/compact` is a large request, エフォート glossed on first use), table (2 columns: 症状と原因 → 確かめ方と対策, 4 rows), quiz inline | `q4` → o3 (analyze: limit reached after chat use) |
| `practice` | practice | 演習：田中さんの使い方を点検して直す | 点検 → 拒否ルールを書いて試す（s3 の形を `.env`・`secrets/` に当てはめる）→ 請求の理由を説明する | markdown (task; Tanaka's files are not to be copied), code json + code bash (Tanaka's files), list (habits), steps `p-audit`, steps `p-deny`, code bash (practice folder with dummies, one command per line), prompt claude-code (read test; explain why, try no other route), markdown + code json (model rule), steps `p-bill`, prompt claude-code (review; model answer in expect), checklist (4) | — |
| `check` | check | 理解度チェック | 3つの目標、すべて新しい場面 | quiz exam (6) | `e1` → o1 (Issue text into `claude -p`, transfer), `e2` → o1 (where bypassPermissions belongs), `e3` → o2 (apply, transfer: a user-settings rule for the home `.aws/` in every project → `Read(~/.aws/**)`), `e4` → o2 (a script still read `.env`), `e5` → o3 (API bill from a nightly `-p` script, transfer), `e6` → o3 (long session drains usage) |
| `summary` | summary | まとめ | 持ち帰る3点、次の一歩、復習 | summary (3), markdown (reflection question + next: 「第11回 総合演習｜自分のリポジトリにClaude Code環境をつくる」), flashcards (7), askTutor (3) | — |

Contract check: hook = 3 scene sentences + a lead-in question + predict; 5 segments (s1–s5), ≤ 3 new terms each (s1: プロンプトインジェクション, VM
glossed in the list; s2: ワークスペースの信頼, サンドボックス, クラウドセッション recalled from 第1回 and glossed;
s3: none, 拒否ルール recalled from 第2回; s4: none; s5: 利用上限, glossed in the table, and エフォート, glossed in s5-md2 just before it); content sections s1, s2, s3,
s5 have an inline quiz (4 of 6 content sections, never 3 in a row without one); worked example (s3 steps with subgoals
and the why) before practice; practice with checklist, hints (and troubleshoot on `p-deny`, `p-bill`), model answers
(rule JSON, review prompt expect); exam covers o1–o3 twice each, with transfer items (e1, e5); every objective also has
an inline question; summary 3 points; 7 flashcards. One diagram (structure: which layer covers what). No images.

Body length: the course-wide measure (`measure.mjs`, see the Format line) gives prose 1,896 (budget 1,200–2,400)
and est 17.2 min after the mobile-fit fixes.

## Assumptions
- Headless run: the outline above was used as is.
- Prerequisite titles use the fixed course titles: 「第2回｜任せる範囲を決める：権限モードと巻き戻し」、
  「第5回｜コンテキストを管理する」、「第8回｜フックで守らせ、MCPでつなぐ」、「第9回｜並列で進める・自動で回す」.
- クラウドセッション is assumed to be introduced in 第1回 (entry points). It is glossed once here, so the lesson
  also reads on its own.
- The version line 「2026年10月時点（Claude Code v2.1.304）」 is in the subtitle, so it costs no body text.
- Deny-rule syntax follows the official paste-ready example (`Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)`).
  The lesson does not claim more about how deep `./`-anchored patterns match than the docs state.
- Body budget: model answers live in `prompt.expect` and code blocks, which the measurement used for earlier
  vibe-coding lessons does not count as body text.
- The callout scopes the auto default to 「ターミナルとVS Codeの対話セッション」 as the docs do (Desktop and cloud
  sessions are separate; HIPAA-configured organisations start in Manual, not mentioned). The 17% figure is dated to
  the March 2026 engineering post, which measured an earlier classifier pipeline; the lesson does not claim it for
  today's classifier.
- Fact-audit fixes (2026-10-20): `claude -p` is said to run the repository's hooks and `.mcp.json` servers without
  asking (not "settings": allow rules are not used in `-p`); the project `.claude/settings.json` reaches teammates
  once committed; the deny-rule check expects Read tool and `cat` reads to be refused (not "Claude cannot read
  it"); the root/sudo refusal is scoped to starting `bypassPermissions` on Linux and macOS.
- Round-1 fixes: the hook now spells out API in a third scene sentence, followed by the lead-in question
  「何が起こりうるでしょうか。」. The permissions page (re-read 2026-10-20) supports the original e3 key and the
  `cat`/`head` and Edit/Write claims, but e3 now tests `~/` (taught in s3-pitfall) and e4 and q3 no longer rely on the
  untaught claims. Option arrays are ordered so the correct answers spread over positions 1–4 (3/2/2/3).
- Mobile fit (visual QA, 390 px): both tables have 2 columns (s2-table: 場面と起きうること / 合う対策; s5-table:
  症状と原因 / 確かめ方と対策). The s5 asides (`-p` and the API key, `/clear` versus `/compact`, the エフォート gloss)
  moved into the second paragraph of `s5-md2`, which now also cites `cc-authentication` and `cc-model-config`. The
  `bypassPermissions` cell reads 「オフラインのコンテナかVMだけで使う」 (the docs: "without internet access").
- The diagram (`s2-layers`) has short labels and stacks the file-tool node below the sandbox box (`E ~~~ D`), so no two
  nodes sit side by side; 「拒否・確認・分類器」, 「OSが制限」 and 「子プロセス」 moved to the alt text, and the caption is
  in です・ます. Rendered with the reader's mermaid settings (15 px labels, padding 12) in a standalone page, it is
  329 px wide, so it shows at 96 % in the 316 px column of a 390 px screen. The arrow from 外部の文章 still crosses the
  VM box title on every width (mermaid centres the title).
- Code blocks fit the mobile column: the worked example uses `config/secret.json` (was `config/credentials.json`),
  Tanaka's `~/.zshrc` value is 「（副業用のキー）」, and the practice folder runs one command per line.
- `s2-isolate` says 「`--bare` なしの `claude -p`」, as 第9回 does (cross-lesson facts, item 8).
