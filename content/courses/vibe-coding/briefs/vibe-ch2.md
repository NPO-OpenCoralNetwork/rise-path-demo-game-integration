# Brief: vibe-coding/vibe-ch2

第2章｜AIと企画する力を身につける / Chapter 2 | Planning with AI — rework of the machine-migrated
chapter (`data/curricula/vibe_coding/chapter2.ts`, export `VIBE_CHAPTER_2_DATA`; no chapter2 quiz file exists).

## 学習者 / Learner (必須)
- 誰が読むか / who: プログラミング経験のない初心者。AIに指示してアプリを作りたい人 / non-engineer beginners who want to build apps by instructing an AI.
- すでに知っていること（前提） / prior knowledge: 第0章（人間の役割は「ビジョンを示す・体験を設計する・正しいかを判断する」、AIは実装を担う）、第1章（フロントエンド・バックエンド・データベース、UIとAPIを分けて頼む、Gitのコミット）。チャットAI（ChatGPT、Claude など）に文章で質問した経験がある。
- 前のレッスン / previous lesson: `vibe-ch1`（第1章｜人間が理解すべき最低ライン）。次は `vibe-ch3`（VS Code の準備）、その次の第4章でAIに画面を作ってもらう。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o1 (bloom: apply): ぼんやりしたアイデアを、AIに質問してもらう依頼文に書き換え、壁打ちに使える / Rewrite a vague idea as a request for the AI to interview you, and use it to talk the idea through. (Review round 3: 「依頼文（壁打ち）に書き換えて使える」 made the request look like it is called 壁打ち.)
- o2 (bloom: analyze): アイデアの中から「目的」と「機能」を見分け、機能の奥にある目的を聞き出せる / Tell goals from features and dig out the goal behind a feature.
- o3 (bloom: evaluate): 機能の候補をMoSCoW（Must / Should / Could / Won't）で分け、最初の版（MVP）に入れる範囲を判断できる / Sort candidate features with MoSCoW and judge what goes into the first version (MVP). (Review round 1: 「選んで理由を言える」→「判断できる」, the verb the graded items test.)
- o4 (bloom: create): 目的・使う人・機能の優先順位・画面の流れ・扱うデータ・やらないことを1枚にまとめた企画書を、AIと作って直せる / Build and revise a one-page plan with an AI.

## 範囲 / Scope
- 扱う / in: 壁打ち（AIに質問してもらう）、目的と機能の区別（「なぜ？」と聞き返す）、MVP と MoSCoW、1枚企画書（PRD の小さな版）の項目、画面の流れとデータを言葉で書くこと、企画書を AI に渡して直すこと。
- 扱わない（別レッスン） / out: 技術選定（React / Supabase などは第4章・第7章）、データベース設計の詳細（ER図・主キー・リレーションの記法は第7章）、デザインの用語集（旧 2-4「デザイン・ボキャブラリー」は企画の範囲外で、出典で確かめられないため削除）、実際のコード生成。
- 学習者がよく持つ誤解 / likely misconceptions:
  1. 「AIに丸投げすれば企画もできる」— AIは意図を推測できても頭の中は読めない。足りない情報はそれらしく補われ、違う問題を解くものができる。→ AIに質問してもらい、決めるのは人間。
  2. 「要件は細かいほど良い／最初から完璧に書く」— 企画書は「何を・なぜ」を決める1枚。技術の細部はまだ決めなくてよく、作って試してから直す。
  3. 「ほしい機能は全部入れる」— 機能が増えるほど確かめる量も壊れる場所も増える。最初は目的を確かめられる最小の版（MVP）にし、やらないこと（Won't）を書く。
  4. 「目的と機能の混同」—「グラフがほしい」は手段。「月の途中で食費の使いすぎに気づける」が目的。

## 形式 / Format
- 所要時間 / minutes: 30（読む 約6分 + 問題11問 約7分 + 演習 約15分）。course.json の estMinutes と同じ。
- 難易度 / level: beginner
- ロケール / locales: jp → en
- 演習の題材 / practice task idea: 自分の作りたいアプリ（思いつかなければ「サークルの出欠確認アプリ」）で、AIと1枚企画書を作る。依頼文は `prompt` ブロック（`{{変数}}` 付き）、模範解答は `expect` に入れる。

## 制約 / Constraints
- ツールとバージョン / tools and versions: 特定のチャットAIに依存しない（`target: "any"`）。キー操作・画面・料金には触れない。
- OS / environment: ブラウザで使えるチャットAIならどれでもよい。
- 使ってはいけないもの / avoid: 確かめられない数字（「n倍速い」など）、AIの出力傾向についての断定（旧 2-4 の表）、架空の URL・画像。

## 資料 / Sources
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — checked 2026-10-19.
  Used for: "Claude can infer intent, but it can't read your mind."; "Letting Claude jump straight to coding can produce code that solves the wrong problem."; "for larger features have Claude interview you and write a spec"; useful specs "state what is out of scope".
- `ries-mvp` — Minimum Viable Product: a guide (2009-08-03) — https://www.startuplessonslearned.com/2009/08/minimum-viable-product-guide.html — Eric Ries, Startup Lessons Learned — checked 2026-10-19.
  Used for: MVP = "that version of a new product which allows a team to collect the maximum amount of validated learning about customers with the least effort."
- `abc-moscow` — What is MoSCoW Prioritization? — https://www.agilebusiness.org/resource/what-is-moscow-prioritization/ — Agile Business Consortium — checked 2026-10-19.
  Used for: Must Have / Should Have / Could Have / Won't Have this time and their definitions (Won't = agreed not to be delivered in this timeframe).
- Repository: `data/curricula/vibe_coding/chapter2.ts` (original), `content/courses/vibe-coding/lessons/vibe-ch0.lesson.json`, `vibe-ch1.lesson.json`, `vibe-ch3.lesson.json`, `course.json`.

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：「家計簿アプリを作って」の落とし穴 | 「作って」だけだと、AIは自分の困りごとを知らないまま作る | markdown (problem, 3 sentences), quiz predict | `q0` → o2 (ungraded) |
| `2-1` | concept | 2-1. 「作って」の前に「質問して」 | コードを頼む前に、AIに質問してもらい考えを言葉にする（壁打ち） | markdown lead (ch0 recall), callout analogy, definitions (壁打ち), markdown (why, cite), prompt (interview, `{{作りたいアプリ}}`), quiz inline | `q1` → o1 (apply, new context: 散歩記録アプリ) |
| `2-2` | concept | 2-2. 「作りたい」を目的と機能に分ける | 機能は手段。「なぜ？」と聞き返して目的を1文にする | markdown, definitions (目的・機能), table (機能 → 奥の目的), markdown (目的の型), quiz inline | `q2` → o2 (analyze, new context: 習い事の送迎当番; round 1 moved it off the practice topic) |
| `2-5` (kept id; shown 3rd) | concept | 2-3. 最初に作る範囲を決める | 目的を確かめられる最小の版から作り、やらないことを決める | markdown lead, definitions (MVP・MoSCoW, cite), table MoSCoW × 家計簿 (cite), callout tip (Must の見分け方), quiz inline | `q3` → o3 (evaluate, new context: 読書記録) |
| `2-3` (kept id; shown 4th) | example | 2-4. 1枚企画書にまとめる | 決めたことを1枚に並べ、AIに渡して読み返す | markdown, definitions (1枚企画書), steps worked example (6 steps, 家計簿), diagram 画面の流れ, prompt (plan, model plan in `expect`), quiz inline | `q4` → o4 (Won't を空にすると？) |
| `practice` | practice | 演習：自分のアイデアで1枚企画書を作る | 例題と同じ手順を自分の題材で（足場を外す） | markdown (task, time), steps (6, hint + troubleshoot; round 2 added `p-ideas`), prompt (learner's own MoSCoW sort reviewed by the AI, model answer in `expect`), checklist (6 criteria) | — |
| `check` | check | 理解度チェック | 全目標の確認、転移問題を含む | quiz exam (6) | `q5` → o1 (transfer: 料理教室), `q6` → o2, `q7` → o3 (transfer: 水やり記録), `q8` → o4, `q10` → o4 (flawed plan → revise; transfer: 英単語アプリ), `q9` → o4 (試して直す, evaluate) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返り、次の一歩 | summary (4), markdown (reflection + next: ch3/ch4), flashcards (6), askTutor | — |

Contract check: hook ≤ 3 sentences + predict; 4 segments, each with an inline quiz (density 4/5 content sections);
≤ 3 new terms per segment (2-1: 壁打ち / 2-2: 目的・機能 / 2-5: MVP・MoSCoW / 2-3: 1枚企画書); worked example
(2-3 steps) → faded practice (same steps, own topic, hints) → exam; every objective has an inline and an exam
question; summary 4 points; 6 flashcards; no images.

Kept ids from the migration: sections `2-1`, `2-2`, `2-3`, `2-5`; blocks `s1-b1`, `s1-b2`, `s1-b4`, `s1-b5`,
`s2-b1`, `s2-b3`, `s2-b4`, `s3-b1`, `s5-b1`, `s5-b2`, `s5-b3`. Dropped: section `2-4` (design vocabulary) and blocks
`s1-b3` (role prompting callout; the claim that a role raises answer quality is not needed for this lesson's
objectives), `s2-b2` (deliverables callout, folded into the plan items), `s3-b2`/`s3-b3` (1:N list and ER diagram,
too technical before ch7), `s4-*`.

## Assumptions
- Headless run: nobody answered the outline check-in, so the outline above was used as is.
- estMinutes stays 30 to match `course.json` and the original chapter, although the contract suggests 8–20 minutes;
  about half of the time is the hands-on practice with a real chat AI. The owner may split the practice off.
- The learner can use some chat AI in a browser; prompts are tool-agnostic (`target: "any"`).
- Running example: a household budget app (家計簿アプリ) to notice food overspending mid-month; practice fallback:
  a club attendance app (サークルの出欠確認アプリ). Both are invented teaching scenarios, not real products.
- MoSCoW is taught with all four buckets as in the Agile Business Consortium definition (the original chapter used
  Must/Should/Won't only).
- Tech stack (React, Tailwind, Supabase in the old PRD prompt) is left out of the plan: choosing it is not a
  planning-stage decision for this learner, and ch4/ch7 introduce it.

## Review round 1

Reviewers: `pedagogy-reviewer` (mean 3.23, revise, 3 must-fix) and `ja-editor` (mean 3.25, revise, 12 must-fix).
Saved as `reports/vibe-ch2.pedagogy-reviewer.review.json` and `reports/vibe-ch2.ja-editor.review.json`.
`check-review.mjs` before fixes: **REVISE, exit 1**. Every criterion was ≥ 3, but the merged mean (lowest score per criterion) was 3.15 < 3.3,
and 15 must-fix items were open.

What was flagged, and what changed:

| # | Criterion / block | Flagged | Change |
|---|---|---|---|
| 1 | active / all quizzes | Answer key only a/b (b,b,b,a,a,b,a,a,a,a); correct option often the longest; reader keeps authored order | Options reordered, ids re-lettered in display order (new questions, quizQuestions: 0 in migratedFrom). Key now q0 c, q1 d, q2 c, q3 b, q4 d, q5 a, q6 c, q7 b, q8 d, q10 a, q9 b. Correct options shortened so none is uniquely the longest (q1, q4, q5, q8, q9). |
| 2 | align / check-quiz | q9 tagged `create`; 「直す」 of o4 and 「理由を言える」 of o3 not assessed | q9 → `evaluate`. New exam item `q10` (o4, evaluate): a flawed plan (a Must that doesn't serve the goal + empty Won't) → choose the revision. o3 reworded to 「…範囲を判断できる」 (contract's evaluate verb), which is what q3/q7 test; the practice still asks for a reason per placement. |
| 3 | practice / p-revise | Step ⑤ had no hint, troubleshoot or sample revision | Added hint (compare with the checklist item by item) and troubleshoot with a sample follow-up request (where / why / how in one sentence). |
| 4 | a11y_l10n / whole lesson | Half-width spaces between JP and Latin words (MoSCoW, Must, Won't, PRD, Claude Code, VS Code …) | Removed in every jp string (objectives, tables, steps, prompts, glossary, cards). Kept: `Must / Should / Could` between Latin words, prompt variable names, list markers (`1. 目的`) and section numbering (`2-1. `, as in vibe-ch1). |
| 5 | voice / s1-b5 | 「引き出してもらう」 had no object | 「答えを出してもらうのではなく、考えを引き出してもらうと、作りたいものがはっきりします。」 |
| 6 | voice / s2-b1 | 「アプリにしてほしいことの形」 hard to parse | 「アプリへの注文の形」 (EN "orders for the app"). |
| 7 | prior / q4 explanation | Unintroduced 「Claude Code」「仕様書」, 「としています」 | 「AnthropicのAIツール、Claude Codeの公式ガイドにも同じ考え方があります。役に立つ仕様書（企画書のような文書）には、範囲外のことを書くと説明されています。」 (split in two to stay ≤ 60 chars per sentence). |
| 8 | voice / q4 option c | Two sentences, not parallel | 「やらないことは人間用のメモなので、何も変わらない」 |
| 9 | voice / q7 option b | Verb ending, 「SNS投稿」 vs 「SNSへの投稿」 | 「記録と通知、写真での種類判定、SNSへの投稿」 |
| 10 | voice / q7 | 「お知らせ」 vs lesson-wide 「通知」 | 「通知」 in options and explanation. |
| 11 | voice / q8-b feedback | 「技術の選び方は…決めなくて」 | 「使う技術は、企画の段階ではまだ決めなくて大丈夫です。」 (the option is now `a` after reordering). |
| 12 | a11y_l10n / s2-goal EN | "better than" changed the meaning | "may be enough, without an elaborate chart." |
| 13 | a11y_l10n / s2-table EN | "Stop gaps … from forgetting" | "Avoid gaps in the record when I forget to log" |
| 14 | a11y_l10n / q4 EN | "the most useful specs" | "useful specs state what is out of scope". Note: the source (re-fetched 2026-10-19) actually reads "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, …", so both wordings are supported; the weaker one keeps JP and EN identical. |
| 15 | a11y_l10n / q8 EN | "won't-list" ≠ glossary | Correct option (now `d`) shortened in JP to 「目的からやらないことまでが、1枚で読み取れるか確かめる」 (length cue, #1); EN follows it: "Check that everything from the goal to what you won't build reads clearly on one page". |

Also done (niceToHave and the gaps behind the 3-scores):
- EN term for 壁打ち: "Sparring" → "Talking it through" (o1, s1-defs, glossary, s1-b4 title, ex-goal, q1, summary, card).
- miscon: 「最初から完璧に書く」 is now corrected in the body (s3-b1: 「企画書は最初から完璧でなくてよく、作って試してから直していきます。」).
  Strawman distractors replaced with real beliefs: q1 b/c (collect every feature; let the AI decide the plan), q4 a/b
  (the AI reads your intent; listing Musts is enough), q6 b (build the calendar right away). q0 options now all have feedback.
- worked: every example step states its why (ex-ideas, ex-moscow, ex-screens, ex-data, ex-review).
- visual: s2-b4 caption states the takeaway 「Mustだけなら、最初の版の画面は2つで足りる」; description shortened.
- practice: the MoSCoW prompt's variable hints now show the worked example's budget-app values, not q2's answer;
  the club-app goal moved into the model answer (`expect`); q2 uses a new context (送迎当番) so no exam/inline answer
  doubles as practice scaffolding.
- prior: 「（MVP）」 removed from the 2-3 section title (MVP is defined in s5-defs); PRD glossed in s3-defs.
- voice: pc-must ends 「〜機能になっている」; MVP definition softened to 「いちばん少ない手間で、…いちばん多くを学べる版」
  (s5-defs, glossary, card); s5-b1 「次々に浮かびます」; summary-next 「？」 without a half-width space.
  Summary points keep the plain form, the course convention (vibe-ch1).

Not changed, for the owner:
- estMinutes 30 and body length (about 2,500 JP characters by block text, above the 2,400 budget) remain; splitting the
  practice into its own lesson would bring both into the contract but changes `course.json` (publishing, owner only).
- No faded worked example between s3-steps and the practice (rubric 4 for `worked`); adding one would grow the body further.

## Review round 2

Reviewers: `pedagogy-reviewer` (mean 3.54, revise, 2 must-fix) and `ja-editor` (4 criteria scored, revise, 8 must-fix).
Saved over the round 1 files as `reports/vibe-ch2.pedagogy-reviewer.review.json` and `reports/vibe-ch2.ja-editor.review.json`.
`check-review.mjs` before fixes: **REVISE, exit 1**. Merged mean 3.46 (≥ 3.3) and every criterion ≥ 3
(lowest: load, worked, active, practice, accuracy, voice, a11y_l10n at 3), so the only blocker was the 10 open must-fix items.

Must-fix items and what changed:

| # | Criterion / block | Flagged | Change |
|---|---|---|---|
| 1 | practice / `p-moscow` | The practice prompt needed `{{機能の候補}}`, but no practice step produced candidates | New step `p-ideas` 「③ 機能の候補を出す」 between `p-interview` and `p-moscow` (md, expect 「機能の候補が5つ以上並ぶ。」, hint, EN). Later steps renumbered in their titles only (④–⑥); every existing id kept. |
| 2 | practice / `practice-prompt` | The AI did the MoSCoW sort and gave the reasons, so the learner never made the o3 judgment (contradicted 「決めるのは人間です」) | `p-moscow` is now 「④ 自分で分けて、AIに見直してもらう」: 「まず自分で4つに分け、理由を1行ずつ書きます。次に下の依頼文で、AIに見直してもらいます。」 The prompt sends `{{目的}}` + `{{自分の分け方}}` (EN `{{goal}}` + `{{my sorting}}`) and asks the AI only to point out problems with reasons (「分け直すかどうかは私が決めるので、指摘だけをお願いします。」). Title, vars (budget-app hint with reasons), EN and `expect` updated. The model answer now shows the learner's own club-app sort, sample reasons, a sample AI remark, and the learner's decision (reminder → Should, two Musts). `p-moscow` expect: the four groups and reasons are written, and the learner decides whether to act on the AI's points. |
| 3 | voice / `s1-b5` | 「違う問題を解くものができる」 is vague | 「…違う問題を解くアプリができてしまうことがあります。」 (EN "an app that solves the wrong problem"). |
| 4 | load / `s3-b1` | Three ideas in one paragraph; 「〜でなくてよく、」 joined two ideas | Split into two paragraphs: 「企画書は、最初から完璧でなくてかまいません。作って試しながら直していきます。」 EN as given by the reviewer. |
| 5 | a11y_l10n / `s5-defs` | MoSCoW definition opened with the reading; EN note unnatural | 「機能をMust・Should・Could・Won'tの4つに分けて、優先順位を決める方法です。読み方は「モスクワ」です。」 / "It's pronounced like \"Moscow\"." |
| 6 | voice / `check-quiz` q5 | 「コードを止めて」 / "Stop the code" | Option a 「いったん止めて、まず困りごとを質問してもらう」 / "Pause it and have it ask about the problem first"; explanation 「いったん止めて質問してもらえば」 / "Pausing it and having it ask questions". (「まず」 was added so option a is no longer the shortest, see the niceToHave items.) |
| 7 | voice / `s3-check` q4 explanation | Appositive 「AnthropicのAIツール、Claude Code」 and passive 「〜と説明されています」 | 「Anthropic社のAIツール「Claude Code」の公式ガイドにも、同じ考え方があります。ガイドは、役に立つ仕様書（企画書のような文書）の特徴として、範囲外のことを書くことを挙げています。」 This is closer to the source than the reviewer's 「勧めています」. The source was re-fetched on 2026-10-19: "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, …". |
| 8 | voice / `s3-check` q4 | Heading 「やらないこと」 unquoted in options, feedback and explanation | Quoted in option c, the feedback for b and c, and the explanation. The EN feedback now says "what we won't build" in quotes as well. |
| 9 | voice / `check-quiz` q8, q10 | Same quoting problem | Quoted in q8 d, the q10 prompt, q10 a, the q10 b feedback and the q10 explanation, with matching EN quotes. Also quoted in `summary-points[3]` and `pc-wont`, where it names the heading. It stays unquoted in the six-item lists (`s3-defs`, glossary, `card-plan`, prompt headings), where it is clearly an item name. |
| 10 | voice / `ex-review` | 「直しを頼める」 | 「6つの項目が1枚に並び、違うと感じたところを直してもらえる。」 |

niceToHave items also applied:
- active (single-word cues): q1 b is now 「入れたい機能について、私に質問を1つずつしてください。」, which asks for questions but about features, a real "features first" belief. Its feedback, the explanation (「機能ではなく目的について聞いてもらうと…」) and the hint were updated. q5 d is now 「先に、画面の色や見た目の好みを質問してもらう」 (+ feedback). q6 a is now 「カレンダーは月表示と週表示、どちらがうれしい？」. q3 b is now 「感想を書きとめて、あとから一覧で開ける機能」, so it no longer echoes 「読み返す」.
- Length cue: q9 b is now 「先に企画書のMustと画面の流れを直し、次の版を頼む」, about as long as the other options.
- voice: 「目的を確かめられる最小の版」 → 「目的を果たせるか確かめられる最小の版」 in `s5-b1`, `summary-points[2]` and the q7 explanation (EN to match).
- accuracy (q4): the explanation now shows the reasoning step (「線がないと、どこまで作るかをAIが推測で決めることになります。」). The guide is cited only for what it says: useful specs state what is out of scope. The answer option stays hedged (「…ことがある」).
- worked: `ex-goal` now shows one sample exchange (「いつ困りますか？」 → 「月末に、食費を使いすぎたと気づきます」).
- `s1-b2` analogy: architect laying bricks → 「大工さんに「とりあえず建て始めて」と頼むようなもの」 (EN "builder").
- `p-interview` / `p-plan` now name the prompt block they reuse (「2-1の「壁打ちを始める依頼文」」, 「2-4の「1枚企画書を作ってもらう依頼文」」).
- o4 EN: "Build a one-page plan with an AI, from the goal to what you won't build, and revise it".

Not changed, for the owner:
- estMinutes 30 and body length remain above contract §1. Round 2 added text (the `p-ideas` step, the sample exchange, a longer model answer), so the body is now somewhat above the ~2,500 JP characters measured in round 1. Splitting the practice into its own lesson changes `course.json` (owner only).
- There is still no faded example between `s3-steps` and the practice. It would push the body further over budget; the practice's hints and model answer remain the scaffold.
- Prompt blocks with `target: "any"` show the reader's 「Claude Codeで使う」 button before ch3 has set up any tools. This is a platform-level choice (`components/lesson/blocks/PromptBlock.tsx`), outside this draft.
- Section ids `2-5` / `2-3` carry the titles 2-3 / 2-4. The ids stay stable by rule.
- The brief's misconception 3 above still uses the round 1 wording 「目的を確かめられる最小の版」. The lesson now says 「目的を果たせるか確かめられる最小の版」.

After fixes: `lessons:validate` 0 errors, `lessons:lint --strict` 0 warnings. No re-review has been run yet. The gate needs fresh reviewer JSON, because the saved files still list the round 2 must-fix items.

## Review round 3

Reviewers: `pedagogy-reviewer` (mean 3.46, pass, no must-fix), `ja-editor` (4 criteria, revise, 7 must-fix) and
`visual-qa` (3 criteria, revise, 2 must-fix, after `lessons:preview`). Gate before fixes: **REVISE, exit 1**. The merged
mean was 3.38 and every criterion was ≥ 3, so the 9 open must-fix items were the only blockers. Every item is applied
to the draft. The full list and the resolutions are in `reports/vibe-ch2.md`.

Layout changes from visual QA:
- `s2-table` headers are now 「浮かんだ機能」 / 「聞き出した目的」, and the cells are short goal statements in the
  「どうなれる」 form. Both columns now fit at 390 px.
- `s5-b2` has English labels only in the first column. The Japanese gloss now opens the meaning cell
  (「必須：ないと目的を果たせない」 …), and the third header is 「家計簿の例」. On mobile, rows are now at most 3 lines.
- Circled digits ①–⑥ are removed from the step titles in `s3-steps` and `practice-steps`, because the reader already
  numbers the steps.

Other edits: 分かる → わかる (7×, matches ch1 and the style guide). One sentence was added to `s1-b5`
(「機能より先に、誰の何のためのアプリかを聞いてもらいます。」, pedagogy niceToHave for prior/q1). The hedge on q4 d is
aligned with the other options. An EN comma was added in `s5-defs`. No id was added, removed or renamed.
