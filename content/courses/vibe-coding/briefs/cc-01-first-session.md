# Brief: vibe-coding/cc-01-first-session

第1回｜最初のタスクを任せる — the first lesson of the planned Claude Code course
(`doc/brushup-2026/research/claude-code-curriculum.ja.md` §7, module 1 「はじめる」, lesson 1 of 11).
Drafted in `content/courses/vibe-coding/drafts/` because the preview needs a `course.json`; where the
course is published (new `claude-code` course or a vibe-coding module) is the owner's decision.

## 学習者 / Learner (必須)
- 誰が読むか / who: VS Code を使ったことがあり、Git のコミットの意味がわかる人（バイブコーディング第3章・第5章の程度）。Claude Code は初めて。チャットAIにコードを貼って相談した経験はある。
- すでに知っていること（前提） / prior knowledge: ターミナルで `cd` と `ls` が使える。`git init`・`git commit`・`git config` の意味がわかる（第5章）。チャットAIとエディタの補完を使ったことがある。
- 前のレッスン / previous lesson: なし（コースの第1回）。次は「第2回｜任せる範囲を決める：権限モードと巻き戻し」。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: understand): チャットや補完とエージェントループの違いを説明できる
- o2 (bloom: apply): 状況に合うサーフェス（ターミナルCLI・IDE拡張・デスクトップアプリ・クラウドセッション）を選べる
- o3 (bloom: apply): Claude Codeを入れて起動し、質問 → 小さな変更 → 差分の確認 → コミットの流れで最初のセッションを実行できる

## 範囲 / Scope
- 扱う / in: エージェントループとツール（チャット・補完との比較）、4つのサーフェスの選び方（同じエンジン）、
  必要なもの（有料プランか Console アカウント、無料プランは不可、OS・メモリ）、ネイティブインストーラーと
  `claude --version`、Node.js は npm の経路だけで必要、作業フォルダで `claude` を起動、セッションは毎回まっさらな
  コンテキストで始まる（引き継ぐのは CLAUDE.md・自動メモリ・開き直した会話だけ。名前だけ）、公式クイックスタートの順
  （質問 → 小さな変更 → Git）、`/diff` で差分を見てからコミット、変更を説明させる習慣、v2.1.283 から auto モードで
  始まること（名前と影響だけ）。
- 扱わない（別レッスン） / out: 権限モードの選び方と `/rewind`（第2回）、計画させる進め方（第3回）、検証の任せ方
  （第4回）、`/context`・`/compact`（第5回）、CLAUDE.md の書き方と `/init`（第6回）、Homebrew・WinGet・apt の
  インストール、リリースチャネル、Remote Control・モバイル・Dispatch、料金の金額（ページへのリンクもしない）。
- 学習者がよく持つ誤解 / likely misconceptions (report §6):
  1. 「チャットや補完と同じ。聞いたら答えが返るだけ」→ ツールで調べ、変更し、確かめるループで動く（q0, q1, q5）。
  2. 「前回の会話を覚えている」→ 毎回まっさら。引き継ぐのは CLAUDE.md・自動メモリ・開き直した会話だけ（q3, q5-d）。
  3. 「Node.js がないと使えない」→ 推奨のネイティブインストーラーには不要（pitfall `install-node`, q7）。
  4. 「無料プランでも使える」→ 有料プランか Console アカウントが必要（q7）。
  5. 「完了しました、と言えば完了」→ 差分を自分で見て、説明できる変更だけコミットする（q4, q9）。

## 形式 / Format
- 所要時間 / minutes: 17（本文 2,400 字 + 依頼文・ヒント・チェックリスト・カード 1,407 字 = 3,807 字を 450 字/分で 8.5 分、
  問題 10 問 × 40 秒で 6.7 分、演習 1 つで 2 分、計 17.1 分）。本文だけで数えると 14.0 分。実際の演習は 15 分ほどかかります。
- 難易度 / level: beginner
- ロケール / locales: jp only（英語版は公開先が決まってから）
- 演習の題材 / practice task idea: 新しい練習用フォルダ `cc-practice`（`git init` 済み）で、Claude に hello world の
  ページを作らせて出発点としてコミットし、何をするプロジェクトかを聞き、小さな変更を1つ頼み、予想してから `/diff`
  を見て、変更を説明させ、コミットする。チェックリストつき。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Claude Code v2.1.304（2026-10-20 時点）。auto モードが最初のモードになったのは
  v2.1.283 から。VS Code 拡張の要件（1.94.0 以上）は本文から外した（予算のため。出典は残す）。
- OS / environment: macOS 13.0 以上、Windows 10 1809 以上、Ubuntu 20.04 以上など。メモリ 4GB 以上。Windows は PowerShell の
  インストールコマンドを示す。演習のコマンドは `&&` を使わず1行ずつ（Windows PowerShell 5.1 でも動くように）。
- 使ってはいけないもの / avoid: 料金の数字、確かめていないキー操作やコマンド、プレビュー段階の機能を必須手順にすること、
  大切なリポジトリでの演習、破壊的なコマンド。

## 資料 / Sources
All checked 2026-10-20 (facts file `facts-cc-01-first-session.md`, plus WebFetch of the quickstart (en/ja), commands,
interactive-mode and Japanese glossary pages).
- `cc-overview` — Claude Code overview — https://code.claude.com/docs/en/overview — same engine on every surface; repo CLAUDE.md and settings work everywhere.
- `cc-setup` — Advanced setup — https://code.claude.com/docs/en/setup — native installer commands, auto-update, system requirements, Node.js 22+ only for npm, Free plan excluded.
- `cc-quickstart` — Quickstart — https://code.claude.com/docs/en/quickstart — account types (Console = pre-paid API credits), `claude --version` prints a version followed by `(Claude Code)`, login on first use, "reads your project files as needed", step order (question → small change → Git), "If it asks before making the change, select Yes", `claude -c` / `-r`.
- `cc-how-it-works` — How Claude Code works — https://code.claude.com/docs/en/how-claude-code-works — agentic loop, tools, fresh context per session, "fix the failing tests" example, Esc and queued corrections.
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — "Unlike a chatbot that answers questions and waits…".
- `cc-glossary` — Glossary — https://code.claude.com/docs/en/glossary — definitions of agentic loop, tool, surface, cloud session, session, context window, auto memory, CLAUDE.md; auto mode is the built-in starting mode from v2.1.283.
- `cc-vs-code` — Use Claude Code in VS Code — https://code.claude.com/docs/en/vs-code — extension bundles its CLI.
- `cc-jetbrains` — JetBrains IDEs — https://code.claude.com/docs/en/jetbrains — plugin needs the CLI installed separately.
- `cc-desktop` — Desktop application — https://code.claude.com/docs/en/desktop — Code tab, no terminal, paid subscription.
- `cc-cloud` — Use Claude Code in the cloud — https://code.claude.com/docs/en/claude-code-on-the-web — clones the GitHub remote, push first, keeps running with the laptop closed.
- `cc-memory` — How Claude remembers your project — https://code.claude.com/docs/en/memory — only CLAUDE.md and auto memory carry over.
- `cc-commands` — Commands — https://code.claude.com/docs/en/commands — `/diff` reviews the changes in the working tree, including Claude's edits.
- `cc-terminal-guide` — Terminal guide for new users — https://code.claude.com/docs/en/terminal-guide — first task "a simple webpage that says hello world", open it by double-clicking.
- `ai-skills-rct` — How AI assistance impacts the formation of coding skills (2026-01-29) — https://www.anthropic.com/research/AI-assistance-coding-skills — learners who asked the AI for explanations kept high quiz scores (report §6).
- Prose links (not sources): https://code.claude.com/docs/ja/setup, https://code.claude.com/docs/ja/troubleshoot-install (linked from the Japanese quickstart).
- Repository: `content/courses/vibe-coding/lessons/vibe-ch3.lesson.json` (VS Code), `vibe-ch5.lesson.json` (`git config`, commit), `vibe-ch2.lesson.json` (JSON shapes).

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：貼り付けずに聞いてみる | チャットでは貼って写す。Claude Code は貼らずに聞ける | markdown lead (3 sentences), quiz predict (cite quickstart) | `q0` → o1 (ungraded; distractors: chat, completion, memory) |
| `loop` | concept | 1-1. チャット・補完・エージェントループ | Claude Code はツールで調べ、変更し、確かめるループで動く | markdown lead, table (chat / completion / Claude Code), definitions (エージェントループ・ツール), diagram (loop, 5 nodes, TD), quiz inline | `q1` → o1 (new situation: a script that fails with an error) |
| `surfaces` | concept | 1-2. どこで使うか：4つのサーフェス | 場面でサーフェスを選ぶ。エンジンは同じ | markdown lead, definitions (サーフェス with IDE spelled out・クラウドセッション・CLAUDE.md), table (4 surfaces × 場面 × 知っておくこと; CLI spelled out), markdown (same engine), quiz inline | `q2` → o2 (apply: unpushed commits + laptop closed → push, then a cloud session) |
| `install` | concept | 1-3. インストールして、確かめる | 必要なものをそろえ、ネイティブインストーラーで入れて `claude --version` で確かめる | markdown lead (version date + Japanese docs link), list check (plan, OS, RAM), markdown (Console account defined + recommended installer), code bash, code powershell, markdown, code bash, callout pitfall (Node.js) | — (assessed in exam `q7`; `session` follows with a quiz, so no 3 content sections run without one) |
| `session` | concept | 1-4. 起動して、セッションを始める | 新しいセッションはまっさら。引き継ぐのは3つだけ | markdown lead (`cd` + `claude`, login), definitions (セッション・コンテキストウィンドウ・自動メモリ), markdown, list (3 carry-over routes), quiz inline | `q3` → o3 (new day, "continue with yesterday's colours") |
| `first-session` | example | 1-5. 例題：質問から1コミットまで | 質問 → 小さな変更 → 差分 → 説明 → コミット | markdown lead (quickstart order), definitions (差分), steps worked example (5 steps ①–⑤ with why + expect), code diff (the lines step ③ shows), callout info (auto mode from v2.1.283), callout tip (explanation habit, RCT), quiz inline | `q4` → o3 (apply: "完了しました" before committing) |
| `practice` | practice | 演習：練習用フォルダで1コミットまで | 1-5 を自分の手で、faded（同じ①–⑤のラベル） | markdown task, code bash (`claude --version`, `mkdir`, `cd`, `git init`, `claude`), steps (6, hint → troubleshoot ladder), prompt (page, `{{見出しの言葉}}`), prompt (explain the diff, `{{確かめたいこと}}`, model answer in `expect`), checklist (6 success criteria) | — |
| `check` | check | 理解度チェック | 全目標、転移問題を含む | quiz exam (5) | `q5` → o1 (colleague: "just smarter autocomplete?"), `q6` → o2 (transfer: colleague new to the terminal, folder not on GitHub, Pro plan), `q7` → o3 (transfer: Windows, Free plan, Node.js), `q8` → o3 (advise a colleague about to ask for a big feature), `q9` → o3 (analyze: an unrequested file in `/diff`) |
| `summary` | summary | まとめ | 持ち帰る5点、振り返り、次の一歩 | summary (5), markdown (reflection question + next: 第2回), flashcards (7), askTutor (3) | — |

Contract check: hook 3 sentences + predict; 5 segments (4 concept + 1 example), one idea each; new terms per segment:
loop 2 (エージェントループ・ツール), surfaces 3 (サーフェス・クラウドセッション・CLAUDE.md), install 1 (ネイティブインストーラー),
session 3 (セッション・コンテキストウィンドウ・自動メモリ), example 2 (差分・権限モード, the latter named only and
deferred to 第2回). Inline quizzes in 4 of 6 content sections (practice counts as content), never 3 in a row without one.
Every objective has an inline and an exam question. Worked example (5 steps with the why) → faded practice (same ①–⑤
labels, hints) → exam. Every wrong option has ≤ 2-sentence feedback naming the misconception. No images.

Body length (prose, definitions, table cells, steps md and expect, summary points, diagram description; the method of
`reports/vibe-ch2.md`): **2,400** JP characters (budget 1,200–2,400). Prompt text, model answers, hints, troubleshoot,
checklist and cards add 1,407.

## Assumptions
- Headless run: the outline was not checked in with a person.
- Course placement: drafted as `courseId: "vibe-coding"` with no `next`, per the shared authoring guide.
- The practice folder is created with `mkdir cc-practice`, `cd cc-practice`, `git init` on separate lines, because
  Windows PowerShell 5.1 does not accept `&&`. It assumes Git is installed and `git config` user name/email are set
  (バイブコーディング第5章); a troubleshoot line points there.
- The practice commits Claude's first page before the "real" change, so that `/diff` shows only the learner's change.
- Worked example scenario (a hello world page, add today's date under the heading) is an invented teaching example;
  the expected outputs describe what a learner will typically see, not a recorded transcript.
- The first change may run without a permission prompt (auto mode, v2.1.283+), so step ② says "if asked, read it, then
  choose Yes" (the quickstart wording) and a callout explains why the diff check matters. Permission modes themselves
  are left to 第2回.
- The comprehension-habit callout states only what report §6 says about the RCT (learners who asked for explanations
  kept high scores), without the percentages.
- Desktop app and cloud session plan details (which Team/Enterprise seats) are left out of the body; the table says
  only "有料プランが必要" for Desktop. Cloud-session availability is cited to `cc-cloud`.
- `/powerup` and asking Claude Code about itself were left out for the body budget; they could go in a later lesson.
- Round-1 fixes: 「Consoleアカウント」 is defined from the quickstart wording ("API access with pre-paid credits") as
  「APIの料金を前払いして使うアカウント」, without the reviewer's 「開発者向け」, which the source does not say.
- The diff in `example-diff` is an invented teaching example; it matches the model answer in `practice-prompt-explain`
  and is labelled as an example, not as the `/diff` screen.
- o3 now names installing and starting Claude Code, so that `q3` (fresh context) and `q7` (plan, installer, Node.js)
  assess what o3 says. The round-1 fixes already force a full re-review (objective o2's spacing and most blocks changed).
- The reader does not shuffle options, so the correct options sit at positions 1–4 across the lesson
  (q0 2, q1 3, q2 4, q3 3, q4 4, q5 1, q6 3, q7 4, q8 2, q9 1).
