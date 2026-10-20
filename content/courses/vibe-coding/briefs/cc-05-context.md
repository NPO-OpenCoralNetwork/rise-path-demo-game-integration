# Brief: vibe-coding/cc-05-context

第5回｜コンテキストを管理する — Claude Code course (cc-*), module 2 「頼み方と進め方」, lesson 5 of 11.
Draft only (`drafts/cc-05-context.lesson.json`), `courseId: "vibe-coding"` for preview, Japanese only, no `next`.

## 学習者 / Learner (必須)
- 誰が読むか / who: Claude Code を使い始めた開発者・学習者。他の AI コーディングツールの経験がある人も含む。
- すでに知っていること（前提） / prior knowledge: 第1回〜第4回（エージェントループ、最初のタスクとコミット、権限モードと `/rewind`、プランモードで探索→計画→実装→コミット、テストなどの実行できる検証）。ターミナルで `cd`・`ls` が使える。Git の commit の意味がわかる。
- 前のレッスン / previous lesson: 第4回｜検証を任せる：テスト・レビュー・説明。次は第6回｜CLAUDE.mdで前提を伝える（このレッスンの「いつも守らせたい指示はファイルへ」を受けて書き方を学ぶ）。第7回でサブエージェントを作る。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: analyze): セッションの失敗パターンを見分け、/clear・/compact・サブエージェントから対処を選べる
- o2 (bloom: understand): コンテキスト圧縮のあとに残るものと失われるものを説明できる
- o3 (bloom: apply): /context でコンテキストの使用量を確かめられる

(Objective texts are plain text in the reader, so they carry no code font.)

## 範囲 / Scope
- 扱う / in:
  - 公式の中心的な制約：コンテキストウィンドウはすぐ埋まり、埋まるほど性能が落ちる（前の指示を「忘れる」）。
  - `/context`（色分けしたマス目、種類ごとの内訳、読み込まれた CLAUDE.md と自動メモリ）。
  - `/clear`（関係のないタスクの間）、`/compact [焦点]`、自動のコンテキスト圧縮（古いツール出力から消し、必要なら要約）。
  - 圧縮のあとに残るもの（プロジェクト直下の CLAUDE.md・`paths:` のないルール・自動メモリ・プランモードの計画はディスクから読み直し、Claude が読んだり編集したりしたファイルは最近変更されたものから5つまで再読、`paths:` 付きルールとサブフォルダの CLAUDE.md は必要時に再読）と、失われうるもの（会話の中だけの指示）。対処：CLAUDE.md に書く、`/compact` の焦点、CLAUDE.md の圧縮指示。
  - 途中で編集した CLAUDE.md は次の `/clear`・`/compact`・再起動まで反映されない（pitfall）。
  - 公式の失敗パターンのうちコンテキストに関わる3つ：何でも入りのセッション → `/clear`、修正の繰り返し → 2回失敗したら `/clear` して最初の依頼を書き直す、終わらない探索 → 範囲を絞るかサブエージェント（要約だけ返る）。`/btw` は演習 p1 の解説で1文だけ。
  - セッションは毎回まっさら、`claude --continue` / `--resume` で開き直すと元のコンテキストのまま。
- 扱わない（別レッスン） / out: CLAUDE.md の書き方と置き場所（第6回）、サブエージェントの作成・フロントマター（第7回）、スキル本文の再注入・SessionStart フック（第7・8回）、`/autocompact`・1M コンテキスト・idle compaction・プロンプトキャッシュと料金、長いセッションの利用量（第10回）、`/rewind` の「Summarize from here」（第2回の範囲を超える詳細なので省略）。
- 学習者がよく持つ誤解 / likely misconceptions（report §6 と facts から）:
  1. 「長い会話を続けるほど文脈が増えて賢くなる」— 埋まるほど性能が落ちる。関係のない会話は雑音。
  2. 「前回の会話を覚えている／開き直せば空になる」— 新しいセッションはまっさら。`--continue`/`--resume` は同じ会話をそのまま開く。
  3. 「圧縮すると全部消える／全部残る」— 会話は要約、ファイルの指示はディスクから戻る。会話だけの指示は失われうる。
  4. 「強く言い直せば直る」— 修正を重ねると失敗したやり取りがたまる。2回でだめなら `/clear` して依頼を書き直す。
  5. 「Claude に聞けば使用量がわかる」— 測るのは `/context`。

## 形式 / Format
- 所要時間 / minutes: 19（読む部分 3,900字 ÷ 450 ≈ 8.7分〔本文 2,379字 + 表・定義・要点・図のキャプション 1,521字〕 + 問題13問 × 40秒 ≈ 8.7分 + 手を動かす演習1つ × 2分 = 19.3分）。本文は、markdown・callout・list と steps（title・md・expect・hint・troubleshoot）の文字数（空白とインライン記法を除く）。依頼文ブロックの title・expect・note とチェックリスト（計522字）は演習の2分に含めて数えない。含めても 20.5分で、20分の上限に収まる。演習の前半（p1〜p3）は問題として数え、演習の2分は後半の手を動かす部分だけ。
- 難易度 / level: intermediate
- ロケール / locales: jp のみ（英訳は公開先のコースが決まってから）
- 演習の題材 / practice task idea: 前半は3つのセッション（A 何でも入り、B 同じ作業が長く続く、C 範囲のない調査）を文章で読み、`/clear`・`/compact`・サブエージェントから対処を選ぶ。後半は練習用フォルダ（`cc-context-practice`、`git init`）で CLAUDE.md に1行のルールを書いてから起動し、会話だけの指示を1つ伝えて作業 → `/context` を3回（起動直後・作業後・圧縮後）→ 予想 → 焦点付き `/compact` → 何が残ったかを確かめる。チェックリストと解答例の表つき。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026年10月時点）。auto モードが対話セッションの既定（v2.1.283〜）なので、演習のファイル作成は確認なしで進む場合がある。
- OS / environment: macOS・Linux・WSL のターミナル（bash/zsh）。Windows PowerShell はエディターで CLAUDE.md を作る（troubleshoot に記載）。
- 使ってはいけないもの / avoid: 価格・トークン数の具体値、確かめていないコマンド出力の文言、`/compact` の内部仕様の推測。大事なリポジトリでの演習。破壊的なコマンド。

## 資料 / Sources
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — checked 2026-10-20. Used for: "Most best practices are based on one constraint: Claude's context window fills up fast, and performance degrades as it fills."; forgetting earlier instructions; `/clear` between unrelated tasks; after two failed corrections `/clear` and a better initial prompt ("A clean session with a better prompt almost always outperforms a long session with accumulated corrections."); `/compact <instructions>`; compaction instruction in CLAUDE.md; `/btw`; "use subagents to investigate X"; the failure patterns (kitchen sink, correcting over and over, infinite exploration); `claude --continue` / `--resume`; "Run /context to confirm Claude loaded the file."
- `cc-context-window` — Explore the context window — https://code.claude.com/docs/en/context-window — Anthropic — checked 2026-10-20. Used for: the "What survives compaction" table; "Files Claude read or edited: Claude Code re-reads up to five, most recently modified first" (re-checked with WebFetch 2026-10-20); path-scoped rules and nested CLAUDE.md reload on demand; `/compact` with a focus keeps what you choose; `/context` shows a live breakdown by category with suggestions and which CLAUDE.md and auto memory files loaded; a lot loads before the first prompt.
- `cc-how-it-works` — How Claude Code works — https://code.claude.com/docs/en/how-claude-code-works — Anthropic — checked 2026-10-20. Used for: sessions start with a fresh context window; resume reopens the same conversation; automatic compaction clears older tool outputs first, then summarizes; requests and key code snippets are preserved, early detailed instructions may be lost; subagents work in their own context window and return a summary.
- `cc-memory` — How Claude remembers your project — https://code.claude.com/docs/en/memory — Anthropic — checked 2026-10-20. Used for: instructions lost after `/compact` → move them into CLAUDE.md; auto memory loads each session; rules with `paths:`.
- `cc-commands` — Commands — https://code.claude.com/docs/en/commands — Anthropic — checked 2026-10-20. Used for: `/clear` (empty context, old conversation resumable), `/compact [instructions]`, `/context` (colored grid), `/btw`.
- `cc-context-window-ja` — コンテキストウィンドウを探索する — https://code.claude.com/docs/ja/context-window — Anthropic — checked 2026-10-20. Used for: the Japanese link in `s3-fix` (page confirmed with WebFetch).
- (`cc-costs` was dropped in round 1 with block `s2-cost`; usage of long sessions is left to 第10回.)
- `cc-prompt-caching` — How Claude Code uses prompt caching — https://code.claude.com/docs/en/prompt-caching — Anthropic — checked 2026-10-20 (facts file practice-15). Used for: edits to the project-root CLAUDE.md mid-session load on the next `/clear`, `/compact` or restart.
- `cc-sub-agents` — Create custom subagents — https://code.claude.com/docs/en/sub-agents — Anthropic — checked 2026-10-20. Used for: subagents run in their own context window and return only a summary.
- Repository: `doc/brushup-2026/research/claude-code-curriculum.ja.md` §2.2, §2.4, §6, §7, §11; facts file `facts-cc-05-context.md` (verified 2026-10-20).

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：午後になると、朝の指示が効かなくなる | 長い会話で、会話だけで伝えた指示が効かなくなる | markdown (problem, 3 sentences + 予想の促し), quiz predict | `q0` → o2 (ungraded) |
| `5-1` | concept | 5-1. コンテキストは埋まるほど効きが落ちる | 入れ物はすぐ埋まり、埋まるほど性能が落ちる。`/context` で前後を比べて測る | markdown lead (版), definitions (セッション・コンテキストウィンドウ), markdown (制約, cite), markdown (`/context`, cite), quiz inline | `q1` → o3 (apply: ログを読ませる前後で比べる) |
| `5-2` | concept | 5-2. 区切るか、要約するか | 関係のない次の作業なら `/clear`、同じ作業を続けるなら `/compact 焦点`。自動でも圧縮される。開き直すと同じ会話 | markdown lead, definitions (コンテキスト圧縮), table (`/clear`・`/compact`・自動), markdown (焦点の例), markdown + code (`--continue`/`--resume`), quiz inline | `q2` → o1 (apply: ログイン修正とコミットのあと → README を英語に翻訳) |
| `5-3` | concept | 5-3. 圧縮のあとに残るもの、失われうるもの | 会話は要約、ファイルに書いた指示はディスクから戻る。残したい指示はファイルへ | markdown lead, definitions (CLAUDE.md・ルール・自動メモリ), diagram (圧縮の前 → 後), table (図にない2行：`paths:` 付きルールとサブフォルダの CLAUDE.md、読んだり編集したりしたファイル), markdown (対処 + 公式ドキュメント日本語版リンク), callout pitfall (途中編集の CLAUDE.md), quiz inline | `q3` → o2 (understand: 日本語コメントの指示が圧縮後に落ちた) |
| `5-4` | concept | 5-4. コンテキストに関わる3つの失敗パターン | 何でも入り・修正の繰り返し・終わらない探索を症状で見分け、対処を結ぶ | markdown lead, definitions (サブエージェント), table (パターン・症状・対処), markdown (要約だけ戻る), prompt (サブエージェントで調べる, note=要約を自分で確かめる) | — (quiz density: next section and practice) |
| `5-5` | example | 5-5. 例題：言い直しの続く会話を立て直す | 症状 → パターン → 対処 → 学んだこと → 書き直した最初の依頼 | markdown lead, list (セッションの流れ4行), steps worked example (5 steps with subgoals and why), prompt (書き直した依頼、テスト先行と原因の説明), quiz inline | `q4` → o1 (apply: 郵便番号の関数で、`/clear` 後の最初の依頼文を4つから選ぶ) |
| `practice` | practice | 演習：セッションを診断し、圧縮を試す | 前半：3つのセッションを診断（faded）。後半：練習用フォルダで `/context`×3 と焦点付き `/compact`、予想してから確かめる | markdown lead, quiz inline ×3 (hints), markdown (安全), code bash (`terminal`), steps (2), prompt A, steps (4, hint/troubleshoot), prompt B, checklist (6), table (解答の例：CLAUDE.md のルールと会話だけの指示の2行) | `p1` → o1 (A 何でも入り → `/clear`), `p2` → o1 (B 同じ作業 → `/compact` 焦点), `p3` → o1 (C 終わらない探索 → サブエージェント) |
| `check` | check | 理解度チェック | 全目標、転移問題を含む | quiz exam (5) | `e1` → o1 (transfer: フォームの入力チェック、修正の繰り返し), `e2` → o1 (transfer: 新しいプロジェクトの調査), `e3` → o2 (multi: 圧縮の直後にディスクから自動で読み直されるもの), `e4` → o2 (transfer: チームの CHANGELOG ルール), `e5` → o3 (CLAUDE.md が読まれていない？ → `/context`). (`e6` was removed in round 1: same scenario and options as `p2`.) |
| `summary` | summary | まとめ | 冒頭の場面の答え、4つの要点、振り返りと次の一歩 | markdown (冒頭の答え), summary (4), markdown (振り返り + 第6回), flashcards (8), askTutor (3) | — |

Contract check: hook = 3-sentence problem + predict; 5 segments (4 concept + 1 example), one idea each; new terms per segment ≤ 3.
Recalled from earlier lessons (re-defined briefly so the glossary is complete): セッション・コンテキストウィンドウ・CLAUDE.md・自動メモリ
(第1回), サブエージェント (第4回), プランモード (第3回). New here: コンテキスト圧縮 (5-2), ルール (5-3).
Body (round 1, same method as above: markdown, callouts, lists and steps with hints and troubleshooting): **2,379** JP
characters (budget 2,400); tables, definitions, summary points and the diagram caption add 1,521. Inline quiz density: 5 of 6
content sections (5-4 has none; 5-3 and 5-5 around it do). Answer positions of the 12 single-choice questions: 3 each in
positions 1–4 (e3, multi, at 2 and 4).
Worked example (5-5 steps) → faded diagnosis (practice A) → hands-on (practice B) → exam. Every objective has an inline and an
exam question (o1: q2, q4, p1–p3, e1, e2; o2: q3, e3, e4; o3: q1, e5). Comprehension habits: predict before `/compact`
(practice step), ask Claude to explain the cause (5-5 prompt), check one file of a subagent summary yourself (5-4 note).
One diagram (state change in compaction), no images.

## Assumptions
- Headless run: the outline above was used without a check-in.
- Terms already defined in the parallel drafts of 第1回 (セッション、コンテキストウィンドウ、CLAUDE.md、自動メモリ) and 第4回
  (サブエージェント) get a short recall definition here, marked （第1回）／（第4回）, so the lesson also reads on its own.
- `/btw` is named once, in the explanation of practice question p1 (moved out of `s4-why` in round 1 to keep 5-4 within three
  new terms); the `/compact` focus is shown in `s2-focus`. `/rewind`'s 「Summarize from here」, `/autocompact`, idle compaction and
  the 1M window are left out to keep the load down.
- The recent-files row of `s3-table` follows the official page word for word (en: "Files Claude read or edited — re-reads up to
  five, most recently modified first"; ja: 「Claude が読み込んだまたは編集したファイル — 最大 5 つ … 最近変更されたものが最初」), so the
  row says 「Claudeが読んだり編集したりしたファイル／最近変更されたものから順に、5つまで読み直される」. The 5,000-token path-reference
  detail is left out.
- Failure-pattern names in Japanese (何でも入りのセッション・修正の繰り返し・終わらない探索) are this lesson's own translations with the
  official English names in （）; the official Japanese docs may word them differently.
- The practice uses a visible CLAUDE.md rule (every HTML `<title>` starts with 「練習：」) and a visible chat-only instruction (a 「変更したファイル：」 line) so
  the learner can observe what survives. Whether the chat-only instruction survives depends on the summary; the lesson says so
  instead of promising either result.
- The `/compact` focus in the practice is written in Japanese; the official examples are in English, but the focus is free text.
- estMinutes 19 from the formula (see Format): reading includes tables, definitions and summary points, not flashcards,
  quizzes, prompt blocks or the checklist; 13 questions; one practice task (the hands-on half).
- Japanese and Latin letters or digits are written without a space (style guide §3); the half-width space around inline code
  is kept everywhere, and in plain-text fields (checklist, askTutor, objectives) command names such as /context keep the same
  spacing. Prompt bodies and code are unchanged.
