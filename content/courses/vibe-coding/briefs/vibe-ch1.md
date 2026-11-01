# Brief: vibe-coding/vibe-ch1

第1章｜人間が理解すべき最低ライン / Chapter 1 | Minimum Viable Knowledge — rework of the published lesson
`lessons/vibe-ch1.lesson.json` (author `human+claude-code`, 2026-10-18; migrated from
`data/curricula/vibe_coding/chapter1.ts`, export `VIBE_CHAPTER_1_DATA`, quiz `chapter1_quiz.ts`) under the grounded
authoring rules of PR #74 (plan 「出典と検索」). The draft is `drafts/vibe-ch1.lesson.json`. This lesson is the
exemplar that `author-lesson` names under "Read first" and that MCP `lesson-schema-get` returns (first section of each
role), so it should show every role and the source and analogy rules.

## 学習者 / Learner (必須)
- 誰が読むか / who: プログラミング経験のない初心者。AIに指示してアプリを作りたい人 / non-engineer beginners who want to build apps by instructing an AI.
- すでに知っていること（前提） / prior knowledge: 第0章（AIが実装を担い、人間はビジョンを示し、正しいかを判断する）。ブラウザでWebサイトやアプリを使った経験。チャットAIに文章で頼んだ経験。
- 前のレッスン / previous lesson: `vibe-ch0`（第0章｜この時代の前提を共有する）。次は `vibe-ch2`（AIと企画する）。Git の操作は第5章、Supabase は第7章、デプロイの実際は第8章。

## 到達目標 / Outcome (必須)
The three objectives keep their ids, text and Bloom levels (`server/tests/lessonSchema.test.js` pins 3 objectives).
- o1 (bloom: understand): フロントエンド・バックエンド・データベースの役割の違いを説明できる / Explain how the frontend, backend and database divide the work.
- o2 (bloom: apply): 変えたいものが UI か API かを見分けて、AIへの依頼を書き分けられる / Tell whether a change belongs to the UI or the API, and word your AI request to match.
- o3 (bloom: understand): デプロイと Git のコミットが何をしているかを説明できる / Explain what deployment and a Git commit actually do.

## 範囲 / Scope
- 扱う / in: 3つの部分の役割分担（フロントエンド・バックエンド・データベース）、UI と API と JSON、変える範囲を書いた依頼、デプロイの流れ（ビルド・転送・起動）、Git とコミット（頼む前にコミットする理由）、依頼をデータ側と画面側に分けて順に頼む例題と演習。
- 扱わない（別レッスン） / out: 個別の技術名（React、Node.js、PostgreSQL など。第4章・第7章）、Git の操作とプッシュ・リポジトリ（第5章）、デプロイ先のサービスと料金（第8章）、SQL・HTTP の詳細。旧版の定義にあった「プッシュ」「リバート」は、第1章の目標に要らず新しい用語を増やすため、定義から外した（戻せることは Git の本で裏づけて本文に書く）。
- 学習者がよく持つ誤解 / likely misconceptions:
  1. 「画面ができればアプリは完成で、データも残る」— 保存していないデータは再読み込みで消える。保存して取り出すのはサーバー側とデータベースの仕事（hook, q1, q6）。
  2. 「見た目の依頼でデータの問題も直る」— 見た目は UI、届くデータの中身は API。範囲を書いて頼む（q2, q5, q9）。
  3. 「自分のパソコンで動けば公開されている」「ビルドすれば使える」— デプロイはビルド・転送・起動の流れ（q7, q4）。
  4. 「AIツールの巻き戻しがあるからコミットは要らない」「コミットは変更のあとでよい」— 長く残す記録は Git。頼む前に動く状態をコミットする（q8, q3）。

## 形式 / Format
- 所要時間 / minutes: measured with `scripts/lessons/measure.mjs` after drafting (see the report). `course.json` lists 20.
- 難易度 / level: beginner（新しい用語ごとに、定義の前に日常のたとえ。1-1・1-2 はレストラン、1-3 は料理を店で出すまで、1-4 はゲームのセーブ）。
- ロケール / locales: jp → en（公開版と同じ2言語。en は jp から自然な英語で書く）
- 演習の題材 / practice task idea: 例題（1-5）は冒頭のタスク管理アプリの「タスクが消える」を直す依頼の組み立て。演習は転移として、読書記録アプリに「読み終えた日」を足して残す依頼を自分で書く。

## 制約 / Constraints
- ツールとバージョン / tools and versions: Git 2.56（git-scm.com の最新版、2026-09-28）。Claude Code は 2026-10-30 に読んだ公式ドキュメント。MDN は 2026-10-30 に読んだ版（各ページの最終更新日は facts に記録）。
- OS / environment: 問わない。第1章の時点では開発環境がないので、演習は依頼文を書くだけ（AIに送らなくてよい）。
- 使ってはいけないもの / avoid: 確かめられない効果（「精度が大きく上がる」など）、AIの振る舞いの断定、メニュー・ボタン・ショートカットの名前（このレッスンでは1つも名指ししない。再読み込みも目的として書く）、架空の URL・画像。

## 資料 / Sources
What each source says that the lesson uses, with verbatim quotes: `reports/facts/vibe-ch1.facts.md`. Every page below
was read on 2026-10-30 (WebFetch).
- Repository first: `data/curricula/vibe_coding/chapter1.ts`, `chapter1_quiz.ts` (the original); the published
  `lessons/vibe-ch1.lesson.json`; `lessons/vibe-ch0.lesson.json`, `vibe-ch2.lesson.json`, `vibe-ch5.lesson.json`,
  `vibe-ch8.lesson.json` (neighbours); `briefs/vibe-ch2.md` (cc-best-practices, recorded 2026-10-19);
  `content/courses/claude-code/reports/facts/cc-01-first-session.facts.md` (quickstart: commit by asking),
  `cc-02-permissions.facts.md` (checkpoints are not a replacement for git), `cc-03-plan-first.facts.md` (specific
  prompts; champion kit "only change X"); `README.ja.md` (looked at for a real example; not used).
- `mdn-server-side` — Introduction to the server side — https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/First_steps/Introduction — MDN — 2026-10-30 — client-side code = appearance and behaviour; server-side code validates submitted data, stores and retrieves data with databases, sends data to the client; web servers wait for requests and reply.
- `mdn-client-storage` — Client-side storage — https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Client-side_APIs/Client-side_storage — MDN — 2026-10-30 — data not stored does not persist across page reloads; most websites store data on the server in a database.
- `mdn-network-requests` — Making network requests with JavaScript — https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Network_requests — MDN — 2026-10-30 — the page requests data from the server and updates itself; the data is often JSON.
- `mdn-json` — Working with JSON — https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/JSON — MDN — 2026-10-30 — JSON carries data from a server to a page; objects are written as `"key": value` pairs; arrays are allowed.
- `mdn-glossary-ui` — UI (Glossary) — https://developer.mozilla.org/en-US/docs/Glossary/UI — MDN — 2026-10-30 — UI = anything that facilitates interaction between a user and a machine (a webpage, a form, the front-end).
- `mdn-glossary-api` — API (Glossary) — https://developer.mozilla.org/en-US/docs/Glossary/API — MDN — 2026-10-30 — features and rules for interaction through software, as opposed to a human user interface; a contract.
- `mdn-glossary-json` — JSON (Glossary) — https://developer.mozilla.org/en-US/docs/Glossary/JSON — MDN — 2026-10-30 — a data-interchange format.
- `mdn-glossary-database` — Database (Glossary) — https://developer.mozilla.org/en-US/docs/Glossary/Database — MDN — 2026-10-30 — a storage system that collects organized data, easier to search.
- `mdn-glossary-server` — Server (Glossary) — https://developer.mozilla.org/en-US/docs/Glossary/Server — MDN — 2026-10-30 — software or hardware offering a service to a client.
- `mdn-publishing` — Publishing your website — https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website/Publishing_your_website — MDN — 2026-10-30 — put the site online so people can find it; hosting = space on a web server; transfer files to the server.
- `mdn-deployment` — Deploying our app — https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Client-side_tools/Deployment — MDN — 2026-10-30 — a production build (minimized files in `dist`, ready to upload to a server), then the site is served live.
- `mdn-express-intro` — Express/Node introduction — https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/Introduction — MDN — 2026-10-30 — the final block starts up the server on a port.
- `git-about-vc` — Pro Git 1.1 About Version Control — https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control — git-scm.com — 2026-10-30 — records changes so you can recall versions; revert the project to a previous state.
- `git-what-is-git` — Pro Git 1.3 What is Git? — https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F — git-scm.com — 2026-10-30 — each commit takes a picture (snapshot) of all files.
- `git-undoing` — Pro Git 2.4 Undoing Things — https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things — git-scm.com — 2026-10-30 — committed work can almost always be recovered; never-committed work likely never.
- `git-commit` — git-commit (Git 2.56 documentation) — https://git-scm.com/docs/git-commit — git-scm.com — 2026-10-30 — a commit records the changes with a log message describing them.
- `cc-quickstart` — Quickstart (Claude Code) — https://code.claude.com/docs/en/quickstart — Anthropic — 2026-10-30 — Git operations by asking in plain words, such as a commit with a descriptive message; break a complex task into steps: database table → API endpoint → webpage.
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — 2026-10-30 — a specific prompt saves a round of corrections; rewind and a new prompt.
- `cc-champion-kit` — Champion kit (Claude Code) — https://code.claude.com/docs/en/champion-kit — Anthropic — 2026-10-30 — "Keep edits surgical: … specify 'only change X.' Claude respects scope when scope is stated."
- `cc-checkpointing` — Checkpointing (Claude Code) — https://code.claude.com/docs/en/checkpointing — Anthropic — 2026-10-30 — undo changes that broke functionality; not a replacement for version control such as Git.

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：「アプリを作って」の中身 | 画面だけのアプリは、再読み込みでデータが消える | markdown (problem, 3 sentences + ask to predict), quiz predict (cite) | `q0` → o1 (ungraded) |
| `1-1` | concept | 1-1. フロントエンド・バックエンド・データベースの関係 | 3つの部分が分担して動く | markdown lead (ch0 recall), callout analogy (レストラン), definitions ×3, diagram (TD, 4 nodes), markdown (hook に戻る), quiz inline | `q1` → o1 (家計簿アプリ, new context) |
| `1-2` | concept | 1-2. UIとは何か、APIとは何か | 見た目は UI、届くデータは API。範囲を書いて頼む | markdown (scene), callout analogy (メニュー＝UI, 頼み方＝API, 書式＝JSON), definitions ×3, markdown + code (JSON), callout tip, prompt UI, prompt API, quiz inline, askTutor | `q2` → o2 (apply) |
| `1-3` | concept | 1-3. デプロイで何が起きているか | デプロイ＝ビルド → 転送 → 起動 | markdown, callout analogy (家で作ったお菓子を売り場で売るまで; round 1: the restaurant moved off the server side), definitions ×2, markdown, list (3 steps), quiz inline | `q7` → o3 (round 1: files sent but nobody can open the app → the launch step) |
| `1-4` | concept | 1-4. Gitのコミットで、戻れる場所を残す | 頼む前に動く状態をコミットする | markdown (why), callout analogy (セーブ), definitions ×2, markdown (戻せる・AIツールの巻き戻しとの違い), prompt (commit first), quiz inline | `q8` → o3 (apply) |
| `1-5` | example | 1-5. 例題：消えるタスクを残るようにする | 依頼をデータ側と画面側に分け、コミットしてから順に頼む | markdown, steps ×6 (cite), quiz inline (faded step) | `q9` → o2 (apply) |
| `practice` | practice | 演習：読書記録アプリの依頼を書き分ける | 同じ手順を新しいアプリで自分で書く | markdown (task, 5 min), steps ×3 (cite; hints folded: hint, then troubleshoot), checklist (6), prompt ×2 (model answer: data side, screen side with input) | — |
| `check` | check | 理解度チェック | 全目標、転移問題を含む | quiz exam (4) | `q6` → o1 (transfer: 予約アプリ), `q5` → o2 (transfer: 家計簿), `q4` → o3 (build on your own computer), `q3` → o3 (transfer: 友人の助言) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返り、次の一歩 | summary (4), markdown (reflection + next), flashcards (7), askTutor | — |

Contract check: hook ≤ 3 sentences of problem + predict; 5 segments (4 concept + 1 example), each with an inline quiz
(5 of 6 content sections; practice has the checklist); ≤ 3 new terms per segment (1-1: フロントエンド・バックエンド・データベース /
1-2: UI・API・JSON / 1-3: デプロイ・ビルド / 1-4: Git・コミット / 1-5: none); each segment's terms follow an everyday
analogy that says what maps to what; worked example (1-5 steps, 6 steps with subgoal titles and the why) → practice
(same steps, new app, hint ladder, model answer, checklist) → exam with transfer items; every objective has inline and
exam questions; summary 4 points after the exam; 7 flashcards; no images; no menu, button, screen or shortcut named.

Ids: every id of the published lesson is kept (sections `hook`, `1-1`–`1-4`, `check`, `summary`; all blocks; questions
`q0`–`q5` with their option ids; cards `card-frontend`, `card-backend`, `card-api`, `card-deploy`, `card-commit`).
New: sections `1-5`, `practice`; blocks `s2-analogy`, `s3-analogy`, `s3-defs`, `s3-flow`, `s3-check`, `s4-analogy`,
`s4-tools`, `s4-check`, `ex-*`, `practice-*`, `summary-next`, `summary-ask`; questions `q6`–`q9`; cards `card-database`,
`card-ui-api`. Questions rewritten because they quizzed the analogy: `q1` (レストランのどこがバックエンド？) and `q3`
(なぜタイムマシン？). Option order (round 1): the options of each question are in an order that puts the keys at
different positions (① ① ② ② ③ ③ ③ ④ ④ ④ over the 10 questions), and no key is longer than its longest distractor
in either locale; option ids and answers are unchanged.

## Assumptions
- Session started by another Claude Code session for the owner; the outline was not shown for a check-in (the owner's
  brief for this task fixed the scope), so the outline above was used as is.
- The three objectives stay as published (ids, wording, Bloom) so `lessonSchema.test.js` keeps 3 objectives. Round 1
  removed only the spaces around UI, API and Git in o2 and o3 (notation rule, ja-editor).
- Running example: a task app (タスク管理アプリ) as in the published hook; the practice uses a reading-log app
  (読書記録アプリ); the exam uses a reservation app and a household-budget app. All are invented teaching scenarios.
- Claude Code docs back the prompting advice (scope, commit first, step-by-step). The course is tool-agnostic, so the
  lesson says "AI" for advice that is about how to write a request, and names Claude Code where a statement is about
  that tool (its rewind feature).
- MDN is used as the official documentation of the web platform; Pro Git and the git-scm.com reference as Git's.
