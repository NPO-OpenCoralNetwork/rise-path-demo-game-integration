# Brief: vibe-coding/vibe-ch2-practice

第2章 演習｜自分のアイデアで1枚企画書をつくる / Chapter 2 practice: your own one-page plan — a short practice
lesson split off from `vibe-ch2` in review round 4 (pedagogy must-fix "load": `vibe-ch2` was about 50% over the
length budget). The practice section and its ids (`practice-task`, `practice-steps`, `practice-prompt`,
`practice-tip`, `practice-checklist`, steps `p-*`, checklist `pc-*`) moved here unchanged in id.

## 学習者 / Learner (必須)
- 誰が読むか / who: プログラミング経験のない初心者。AIに指示してアプリを作りたい人 / non-engineer beginners who want to build apps by instructing an AI.
- すでに知っていること（前提） / prior knowledge: `vibe-ch2` の全体（壁打ち、目的と機能、MVP と MoSCoW、1枚企画書の6項目、家計簿アプリの例題）。チャットAIに文章で依頼した経験がある。
- 前のレッスン / previous lesson: `vibe-ch2`（第2章｜AIと企画する力を身につける）。次は `vibe-ch3`（VS Code の準備）、第4章でこの企画書をAIに渡す。

## 到達目標 / Outcome (必須)
このレッスンの後、学習者は次のことができる / After this lesson the learner can:
- o3 (bloom: evaluate): 自分のアイデアの機能の候補を、Must以外も含めてMoSCoWで分け、最初の版に入れる範囲を判断できる / Sort the candidate features of your own idea with MoSCoW, beyond the Musts too, and judge what goes into the first version.
- o4 (bloom: create): 自分のアイデアで、目的から「やらないこと」までの1枚企画書をAIと作り、チェックリストで直せる / Build a one-page plan for your own idea with an AI and revise it against a checklist.

The ids o3/o4 match the `vibe-ch2` objectives they practise; `vibe-ch2` keeps o3 (evaluate) and now states o4 at the
evaluate level (review a plan and judge the fix), because the create-level task lives here.

## 範囲 / Scope
- 扱う / in: 自分の題材での手順（1行のアイデア → 壁打ち → 候補 → 自分で MoSCoW → AI に指摘だけ頼む → 1枚企画書 → チェックリストで直す）、Should と Won't の分け方、AI が推測で埋めた項目の扱い、直しの頼み方（どこを・なぜ・どう）。
- 扱わない（別レッスン） / out: 新しい概念の導入（すべて `vibe-ch2` で定義済み）、技術選定、コード生成。
- 学習者がよく持つ誤解 / likely misconceptions:
  1. 「分けるのは AI に任せればよい」— AI は分けられても、自分の目的にとって何が必須かは決められない。自分で分けて理由を書き、AI には指摘だけを頼む。
  2. 「便利な機能・迷う機能は Must に入れておく」— Must は「ないと目的を果たせない」ものだけ。重要でもなくて成り立つものは Should。
  3. 「Won't は消してよい」— Won't は「この版では作らない」と決めて企画書に書いておくもの。範囲の境目が AI にも伝わり、次の版の候補として残る。
  4. 「AI が埋めた項目はそのまま使える」— 決めていない項目は AI の推測。「これは決めていません」と伝えて質問してもらう。

## 形式 / Format
- 所要時間 / minutes: 20（演習 約15分 + 問題5問 約3分 + 導入とまとめ 約2分）。The practice step itself states 「目安は15分」.
- 難易度 / level: beginner
- ロケール / locales: jp → en
- 演習の題材 / practice task idea: 自分の作りたいアプリ（思いつかなければ「サークルの出欠確認アプリ」）。模範解答はサークルの出欠確認アプリで、`practice-prompt.expect`（分け方と AI の指摘）と `practice-prompt-plan.expect`（完成した1枚企画書）に入れる。

## 制約 / Constraints
- ツールとバージョン / tools and versions: 特定のチャットAIに依存しない（`target: "any"`）。
- OS / environment: ブラウザで使えるチャットAIならどれでもよい。
- 使ってはいけないもの / avoid: 確かめられない数字、AI の出力傾向についての断定、架空の URL・画像。

## 資料 / Sources
- `abc-moscow` — What is MoSCoW Prioritization? — https://www.agilebusiness.org/resource/what-is-moscow-prioritization/ — Agile Business Consortium — checked 2026-10-19. Used for the Should / Could / Won't meanings in `practice-recap` and `check-quiz` (Won't = agreed not to be delivered in this timeframe).
- `cc-best-practices` — Best practices for Claude Code — https://code.claude.com/docs/en/best-practices — Anthropic — checked 2026-10-19. Used for the interview request `practice-prompt-interview` (copied from `vibe-ch2` `s1-b4`, same cite: "have Claude interview you").
- Repository: `content/courses/vibe-coding/lessons/vibe-ch2.lesson.json` (the source of the moved section and of the two copied prompts; a draft in `drafts/` until both were published on 2026-10-19).

## Outline

| section id | role | title (jp) | the one idea | blocks | questions → objective |
|---|---|---|---|---|---|
| `hook` | hook | はじめに：自分のアイデアだと、どれも大事に見える | 自分の題材だと Must が増えがち（幹事が6つ全部を Must にした場面）。AI の力をどう借りるか | markdown (3-sentence scenario + prompt to guess; the answer is no longer stated), quiz predict | `pq0` → o3 (ungraded) |
| `practice` | practice | 演習1：目的を1文にする | 例題と同じ手順を自分の題材で。まず目的を1文に | markdown `practice-task` (task, 15 min, "decide yourself, AI reviews", the three parts), steps `practice-steps` (`p-idea`, `p-interview`), prompt `practice-prompt-interview` (copy of ch2 `s1-b4`) right after the step that uses it | — |
| `practice-sort` | practice | 演習2：機能を分けて、最初の版を決める | 自分で分けて理由を書き、AI には見直しだけを頼む | callout `practice-recap` (MoSCoW recap, cite), quiz inline `practice-check`, steps `practice-steps-sort` (`p-ideas`, `p-moscow`), prompt `practice-prompt` (MoSCoW review incl. "is anything missing?", club-app model sort) | `pq1` → o3 (evaluate: an AI remark on a Must, new context 買い物メモ) |
| `practice-plan` | practice | 演習3：1枚企画書にまとめて直す | 1枚にまとめ、チェックリストで読み返して直す | steps `practice-steps-plan` (`p-plan`, `p-revise`), prompt `practice-prompt-plan` (copy of ch2 `s2-b3`, club-app model plan), callout `practice-tip`, diagram `practice-flow` (club-app Must screens, 4 nodes, roles in parentheses), checklist (7, incl. `pc-flow`), quiz inline `practice-plan-check` | `pq5` → o4 (evaluate: a plan whose goal fails the checklist, new context ゴミ出し) |
| `check` | check | 理解度チェック | 両方の目標、すべて新しい題材 | quiz exam (3) | `pq2` → o3 (Should vs Won't, ジム記録), `pq3` → o4 (a plan missing the Must its goal depends on, レシピ帳), `pq4` → o4 (AI filled 「使う人」 by guessing) |
| `summary` | summary | まとめ | 持ち帰る4点、振り返り、次の一歩 | summary (4), markdown (reflection + ch3/ch4), flashcards (4), askTutor (2) | — |

Contract check (round 6: the practice is split into three sections so each prompt follows the steps that use it):
hook ≤ 3 sentences + predict; three practice sections, two of them with an inline quiz (lint needs 2 of 3); no new terms;
practice has task, success criteria (checklist), hints then troubleshoot on all 6 steps, and model answers; exam
covers both objectives with transfer contexts, including one item that sorts beyond Must (`pq2`); summary 4 points;
4 flashcards. No images; one diagram (round 5) that shows a screen flow reaching the goal, for the `pc-flow` check.
Glossary repeats 壁打ち from `vibe-ch2` (round 5), because learners may open this lesson on its own.

## Assumptions
- Headless run: the outline above was used as is.
- The two prompts the steps use (interview, one-page plan) are copied into this lesson so the practice works without
  going back to `vibe-ch2`. Their new ids are `practice-prompt-interview` and `practice-prompt-plan`; the var hints use
  the club app (interview) and the budget app (plan, as in ch2), so the club-app answer is only in the model answers.
- The club-app model answer now has 「イベントの作成」 as a Must and in the screen flow (pedagogy must-fix "worked",
  round 4). The sample sort starts with four Musts, so the AI's remark and the learner's decision (reminder → Should,
  three Musts) also model `p-moscow`'s troubleshoot.
- Lesson title kept exactly as specified in the round-4 instructions (JP uses 「つくる」, EN uses a colon). The reader
  shows the JP prefix 「第2章 演習」 as an eyebrow; the EN title is shown whole.
- Publishing is owner-only. The owner published this lesson on 2026-10-19: `course.json` lists it between `vibe-ch2` and
  `vibe-ch3`. Before that, as an unlisted draft, the preview's end card said 「このコースの最後のレッスンまで読み終えました。」
  because an unlisted lesson has no outline position or next link.

## Review round 4 (created)

What was flagged (round 4, reviews of `vibe-ch2`): pedagogy must-fix "load" — `vibe-ch2` was about 3,620 JP characters
of body against the 2,400 budget and 30 minutes against 8–20, deferred for three rounds; the suggested fix was to move
the practice into its own lesson. Pedagogy must-fix "worked" — the club-app model answer started at an event list with
no Must to create an event. Pedagogy niceToHave — troubleshoot hints for `p-idea`, `p-ideas`, `p-plan`; a graded item
that sorts beyond Must.

What changed: this lesson was created with the moved practice section (ids kept), a short hook with an ungraded
prediction, objectives o3/o4 restated at evaluate/create, a MoSCoW recap callout, the two prompts the steps use, an
inline check, a 3-item exam (Should vs Won't, a missing data-entry Must, an AI-guessed item), summary, 4 flashcards.
Steps now point to the prompts "below" instead of 「2-1の…」「2-4の…」. 「イベントの作成」 is a Must in the club-app
sort and plan. `p-idea`, `p-ideas` and `p-plan` gained troubleshoot hints. The `自分の分け方` var hint uses the
budget Must 「今月の予算の設定と残り金額の表示」.

Measured (script over block texts, JP characters without whitespace; see the `vibe-ch2` brief for the method):
body 1,766; with prompt model answers and var hints 2,732; all non-quiz text 3,666; 5 questions; estMinutes 20.

**Owner decision needed:** splitting the practice into its own lesson only takes effect when the owner adds
`vibe-ch2-practice` to `course.json` (module `m2`, between `vibe-ch2` and `vibe-ch3`, estMinutes 20, and a `next` link
from `vibe-ch2`), and updates `vibe-ch2`'s estMinutes there from 30 to 18. If the owner rejects the split, the
alternative is to move the section back and record a length waiver in the `vibe-ch2` brief.

## Review round 5 (workflow review round 1; first review of this lesson)

Reviewers: `pedagogy-reviewer` (revise, 3 must-fix; hook 2), `ja-editor` (revise, 6 must-fix), `visual-qa` (mean
3.33, pass, no must-fix). Gate before fixes: `check-review.mjs` → **REVISE**, exit 1 (hook 2, merged mean 3.08 < 3.3,
9 open must-fix).

| # | Reviewer / criterion / block | Flagged | Change |
|---|---|---|---|
| A | pedagogy / hook / `hook-b1`, subtitle | Sentence 3 and the subtitle gave away pq0's answer; generic problem | Sentence moved to `practice-task` (JP/EN). Subtitle 「機能を分けて最初の版を決め、1枚企画書に仕上げる」 / "Sort the features, decide the first version, and finish a one-page plan". `hook-b1` is now a concrete 3-sentence scenario: a club organizer lists six features and makes all six Musts. pq0 asks about that organizer; pq0 a names MoSCoW. |
| B | pedagogy / practice / `practice-checklist` | pq3 grades a missing-Must check the practice never asked for | `pc-flow` added: 「Mustと画面の流れだけで、目的を最初から最後まで果たせる（入力・登録の画面が抜けていない）」. `practice-prompt` gained 「目的を果たすのに足りない機能がないかも確かめてください。」 Summary point 4 mentions the check, and the new diagram `practice-flow` shows a flow that reaches the goal. |
| C | pedagogy + ja-editor / voice / `summary-points` | 「重要でもなくて成り立つもの」 inverts Should | ja-editor's wording (「重要だけれど、なくても最初の版が成り立つものはShouldです。」); all four points now in です・ます so point 2 does not stand out. |
| D | ja-editor / voice / `practice-recap` | 「重要でも、なくても」 misreadable | 「Shouldは重要だけれど、なくても最初の版は成り立つもの…」 |
| E | ja-editor / voice / `practice-check` | pq1 d feedback and hint | Both as given. |
| F | ja-editor / a11y_l10n / `p-revise`, `p-ideas` | 「埋まる」; EN hint | 「直したあとの企画書が、下のチェックリストにすべて当てはまります。」 (です・ます like the other step expects now); EN "When would something help, and what would it be?" |

niceToHave applied: `practice-check` moved after `practice-recap`, before the steps; `pc-must` says 「（目安）」; pq3 d →
「レシピの検索をMustに足し、探しやすくする」 (a plausible wrong fix); 壁打ち glossary entry and an inline gloss in `p-interview`;
all six step expects in です・ます; the fee reason in `practice-prompt.expect` now ends in 「から」 like the others;
「Must・Should・Could(・Won't)」 in both prompts; a 4-node diagram (visual-qa).

Not applied: reader-level items (flashcard 「タップでめくる」, the 未回答 sidebar marker, the end banner for an unlisted
draft); the ch4 hand-off sentence in `summary-next` is kept (ch4 is about generating the front end with an AI; the
owner may confirm when ch4 is reworked).

Body (same method as `vibe-ch2`, checklist labels included): 1,766 → **2,038** (≤ 2,400). estMinutes 20. After fixes:
`lessons:validate` 0 errors, `lessons:lint --strict` 0 warnings, `lessons:preview` OK (no overflow, console or diagram
errors; desktop-jp median 37 chars/line, desktop-en 68). The saved review JSON describes the pre-fix draft; the gate
needs a fresh round.
