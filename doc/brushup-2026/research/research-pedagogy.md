# Research: learning-material (教材) design for Rise Path — pedagogy, reader UX, JP typography, generator contract

Key: `research-pedagogy` · Date: 2026-10-18 · Scope: learning science → concrete specs for the lesson **reader** (`GeneratedDocView`) and the lesson **generator** prompts/schema (Gemini backend, Kit, MCP / Claude Code authoring).

Screenshots used (all JP UI, 1440×900 unless noted):
- `<session-scratchpad>/shots-before/extra/pedagogy/gen-0.png` … `gen-5.png` (generated lesson "変数とメモリ管理", scrolled top→bottom)
- `<session-scratchpad>/shots-before/extra/generated-lesson_demo-curr-001-m.png` (mobile 390px — broken)
- `<session-scratchpad>/shots-before/mobile/vibe_chapter-1-m.png` (mobile — broken)
- `<session-scratchpad>/shots-before/extra/vibe-ch1-quiz.png` (quiz tab)
- Competitor reference: `<session-scratchpad>/shots-before/extra/competitors/lyw_inline_q.png`, `lyw_lesson_2.png` (Google Learn Your Way)

Helper script (scrolls the inner scroll container, since `FULL=1` only captures the viewport for this app): `<session-scratchpad>/scripts/scrollshots.mjs <outPrefix> <route> <n>`

---

## 0. TL;DR

1. Today's generator optimizes for **block variety** ("≥2 mermaid, ≥3 callouts, 7-block section template, fun-fact hooks"), not for **learning**. The research says the active ingredients are: retrieval practice + feedback, spacing, worked→faded examples, segmenting, signaling, and *removing* seductive/decorative material. None of those are first-class in the schema; the quiz is a separate tab at the end and there is no review/spaced-repetition system anywhere in the repo.
2. Replace the "block quota" prompt with a **Lesson Contract**: `objectives → hook (prediction) → [segment: explain → worked example → check]×3-5 → try it (faded) → recap retrieval → reflection → flashcards`, with explicit word/character budgets and a validator + LLM-judge rubric (Google's Learn Your Way 10-dimension rubric).
3. Rebuild the reader as a **reading column + margin rail** (Learn Your Way / Tufte style): inline checks anchored to paragraphs, glossary + "Ask AI about this" in the rail, segment progress, mastery gating instead of a separate Quiz tab.
4. Japanese typography is currently unmanaged: no JP webfont, synthetic *italic* Japanese subtitles, negative tracking on kana headings, mid-word wraps in TOC/quiz headings, mobile layout collapses to ~130px. Adopt a `:lang(ja)` type system (line-height 1.9–2.0, ≤40字 measure, letter-spacing .04em, `word-break: auto-phrase` for headings, `text-autospace`, no italics).
5. For Claude Code / other LLMs: ship the Lesson Contract as an MCP-exposed kit + a `lint-lesson` tool so any model authoring via MCP gets the same rules and self-checks.

---

## 1. Diagnosis of the current implementation (file:line)

### 1.1 Generator (prompts + schema)

| Issue | Evidence | Why it matters (research) |
|---|---|---|
| Block-quota-driven content: "≥1 mermaid, ≥1 code, ≥2 callouts, ≥1 list", "every lesson ≥2 mermaid", "≥3 callouts", "every list ≥3 items" | `server/geminiBackendService.js:442-447`, `:576-584` | Forces diagrams/lists/callouts whether or not they serve the objective → coherence-principle violation (Mayer) and padding. Also internally contradictory (≥1 vs ≥2 mermaid at `:444` vs `:580`; 4-6 vs ≥5 blocks at `:439`/`:212` vs `:579`). |
| Rigid 7-block section template incl. "Hook / Visual Overview / … / Summary (success callout)" for **every section** | `:555-564` | Every section ends in a "success" summary callout → redundant signaling; repetition reads as filler. Segmenting should be by idea, not by template. |
| Hooks via "surprising fact" ("Did you know that Python processes billions…") | `:486-490` | Classic *seductive detail*: interesting-but-irrelevant → medium negative effect on recall/transfer (Rey 2012; Sundararajan & Adesope 2020). Hooks must be about the problem the lesson solves. |
| "Humans are visual learners. For EVERY key concept create a Mermaid diagram" | `:492-497` | Learning-styles framing; dual coding helps only when the visual carries the structure of the idea. LYW found generated illustrations were its lowest-rated component. |
| No `objectives`, `worked_example`, `check`, `try_it`, `recap`, `flashcard` block types; enum is `text/callout/code/list/mermaid` | `:180`; `types.ts:351-369`; `types.ts:377-383` (DocChapter has no objectives) | Retrieval practice and worked examples are the two highest-evidence ingredients; they can't be expressed. |
| Quiz = 2-3 single-answer MCQs at the end of the lesson, optional | `:566-572`; `types.ts:392-404` | Too few, too late, one format; no per-option feedback (only one `explanation`), no misconception tags. |
| Bilingual en+jp generated in one pass; no `fr` although the app ships FR | `:164-172` (`required: ["en","jp"]`) | Doubles output tokens, and JP is usually a translation of EN thinking (unnatural 教材日本語). FR learners get nothing. |
| Mermaid `chart` is a single string → diagram labels stay English in JP lessons ("Object / Ref Count / Zero? / Free Memory" in `gen-5.png`) | `:197` | Split-attention: learner must map EN labels to JP text. Diagram labels must match the text's terms. |
| Kit lesson template is good-ish (overview/key_points/examples/practice/checklist/cautions/reflection/takeaway + learning modes) but it's a *field list*, not a pedagogy; "3–5 sections, mix of text/list/callout" | `server/services/curriculumGenerationKit.js:150-189`, modes `:12-102` | The learning-mode idea (credential/practice/problem_solving/gentle) is worth keeping; re-express each mode as a variant of the Lesson Contract (e.g., problem_solving = problem-first; gentle = shorter segments, 1 check per segment, reassurance copy). |
| `aiPrompts.buildCurriculumPrompt` asks for "min 3 sections × 3 blocks" and an `image` block with a generation prompt | `server/services/aiPrompts.js:116`, `:122` | Again quantity rules; `image` invites decorative AI art (see the isometric "recycling cubes" art in `gen-4.png`). |
| Model hard-coded to `gemini-2.0-flash` | `server/geminiBackendService.js:54, 325, 371, 600` | Older flash model; quality/structured-output ceiling. (Other researchers cover model choice.) |

### 1.2 Reader (`components/features/ai/GeneratedDocView.tsx`, `components/common/GlossaryText.tsx`)

| Issue | Evidence |
|---|---|
| Doc / Slides / Quiz are separate **tabs**; checks never appear inside the reading flow | `GeneratedDocView.tsx:155`, `:171-179`; end-of-doc CTA "クイズに挑戦" (`gen-5.png`) |
| Quiz items test the *analogy* not the concept ("レストランに例えた場合、バックエンドはどれ?") | `vibe-ch1-quiz.png` — tests the seductive analogy instead of transfer |
| Subtitle is `font-serif italic` (Playfair) → Japanese gets **synthetic oblique** + Latin display serif | `:787`; visible in `generated-lesson_…png` ("Pythonのデータ処理の仕組み" slanted) |
| H1 `tracking-tight` applied to kana/kanji → cramped | `:784`; `demo_multi.png` "Blenderの冒険を始める準備" |
| No Japanese webfont: only Inter + Playfair loaded; JP falls to OS defaults (differs per OS) | `index.html:8`, `index.css:6-11` |
| Code blocks: no syntax highlighting, no copy button, no "predict output" | `:1601-1607`; `gen-2.png` (answers already given in comments → missed prediction opportunity) |
| Inline code in callouts renders raw backticks (`` `is` は…``) — only `**bold**` is parsed | `GlossaryText.tsx:80`; `gen-4.png` |
| Glossary highlights **every** occurrence of every term (6 underlines in 2 lines) — over-signaling; static global list not lesson-specific | `GlossaryText.tsx:83-111`; `gen-0.png` |
| Glossary term is a `<span onClick>` with English `title="Click for definition"`; not focusable/keyboard operable | `GlossaryText.tsx:120-127` (WCAG 2.1.1) |
| Reader language type is `'en' \| 'jp'` only | `GeneratedDocView.tsx:1515`, `:1585` |
| Callout titles `uppercase tracking-wide` (meaningless for JP; shouty for EN) | `:1626` |
| TOC wraps mid-word: "すべてはオブジェク/ト", "ミュータブルとイミ/ュータブル" | `gen-0.png` right rail → needs `word-break: auto-phrase` |
| Mobile (390px): main column collapses to ~130–150px, tab labels go vertical, heading overflows | `generated-lesson_demo-curr-001-m.png`, `vibe_chapter-1-m.png` (Layout keeps a left gutter; `Layout.tsx:282-283`) |
| Decorative AI hero images per section, low instructional content | `gen-0.png`, `gen-4.png` |
| Positive: body `leading-8` on 16px = 2.0 line-height, ~640px column ≈ 40字 — already in the JLREQ range; glossary→chat "ask AI about term" hook exists (`GlossaryText.tsx:60-75`) — keep and generalize. |

### 1.3 Nothing for spacing/review
`grep` for `spaced|flashcard|nextReview|due_at` across `services/ server/ components/` → no hits. No objectives rendered anywhere in the reader.

---

## 2. Learning science → design rules

| Principle | Evidence (short) | Rule for Rise Path |
|---|---|---|
| **Retrieval practice (testing effect)** | Dunlosky et al. 2013: practice testing is one of only two techniques rated "high utility"; rereading/highlighting/summarizing rated low. ([APS](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html)) Low/no-stakes quizzing raised scores ~a grade level in classroom studies ([Agarwal / Cult of Pedagogy](https://www.cultofpedagogy.com/retrieval-practice/)). | ≥1 inline check per segment (every ~2–3 min of reading), 5–8 per lesson; never graded punitively; answers must be *produced or chosen* before reveal. |
| **Spacing (distributed practice)** | Also "high utility" (Dunlosky). Optimal gap ≈ 20–40% of the retention interval for 1-week tests, 5–10% for 1-year (Cepeda et al. 2008, [PubMed](https://pubmed.ncbi.nlm.nih.gov/19076480/)); too-short gaps hurt more than too-long. | Every lesson emits 4–8 flashcards → SRS queue (FSRS, desired retention 0.9: [FSRS optimal retention](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention), [Anki FAQ](https://faqs.ankiweb.net/what-spaced-repetition-algorithm)). The start of each lesson includes 1–2 "warm-up" items from earlier lessons. |
| **Interleaving** | Meta-analysis g = 0.42, strongest for visual/category discrimination (Brunmair & Richter 2019, [PDF](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)). | Recap/review sets mix concepts from ≥2 lessons; "which concept applies here?" discrimination items. |
| **Worked examples → fading; expertise reversal** | Novices learn more from studying worked solutions than solving; benefit reverses for experts; fade guidance progressively ([MIT Open Learning](https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples), [Sweller interview](https://www.teachermagazine.com/au_en/articles/cognitive-load-theory-teaching-strategies), [Reisslein et al. 2006](https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf)). | Procedural content: worked example (full) → faded (completion) → independent try-it. If the learner's pre-check is perfect, skip the full example (expertise reversal). |
| **Subgoal labels** | Labels in both text and worked examples improve novel problem solving in programming (Margulieux & Catrambone 2016, [GSU](https://scholarworks.gsu.edu/ltd_facpub/4)). | Every worked-example step has a short *purpose* label ("① 参照を作る" / "① Create the reference"), same labels reused in the text. |
| **Self-explanation** | Prompts g = .55 (Bisra et al. 2018, [BPS summary](https://bps.org.uk/research-digest/self-explanation-powerful-learning-technique-according-meta-analysis-64-studies)). | After a worked example, one "Why does step 3 change `a`?" prompt (free text, AI-graded or self-compared to model answer). |
| **Pretesting / prediction** | Unsuccessful retrieval attempts before study improve later recall if followed by the answer (Richland, Kornell & Kao 2009, [PDF](https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf)); weaker for conceptual pretests ([Hausman & Rhodes 2018](https://hausman.sites.ucsc.edu/files/2023/02/Hausman.Rhodes.2018b-When-Pretesting-Fails-to-Enhance-Learning.pdf)). | Hook = 1 prediction question ("What will `print(a)` show?"); no score, reveal comes in the segment. |
| **Feedback** | d = 0.48 overall; effect depends strongly on information content of the feedback (Wisniewski, Zierer & Hattie 2020, [Frontiers](https://www.frontiersin.org/articles/10.3389/fpsyg.2019.03087/pdf)). Brilliant explains *why* an answer was wrong ([Brilliant](https://brilliant.org/help/why-brilliant)). | Per-option feedback, each distractor tied to a named misconception; wrong → short explanation + retry with a *variant* item. |
| **Mayer multimedia principles** (coherence, signaling, redundancy, segmenting, spatial/temporal contiguity, pre-training) | 15 principles from 200+ experiments ([Dartmouth summary](https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171655), [UT wiki](https://wikis.utexas.edu/x/YLzcB)) | Coherence: cut what doesn't serve an objective. Signaling: ≤1 highlighted term per paragraph; headings that state the idea. Segmenting: learner-paced chunks. Contiguity: labels *inside* diagrams, captions next to figures, terms color-matched. Pre-training: define key terms before the mechanism. Redundancy: audio narration should not duplicate on-screen full text. |
| **Seductive details** | Interesting-but-irrelevant text/images hurt learning; worse for low-prior-knowledge learners, when visual, scattered, and when no objectives are stated ([Learning Scientists](https://www.learningscientists.org/blog/2019/6/20-1), [ACU](https://inspire.acu.edu.au/articles/seductive-details)). | Ban "fun facts" and decorative hero art; analogies allowed only if mapped explicitly and then *dropped* (checks never test the analogy). |
| **Desirable difficulties / mastery** | Mastery learning mean effect ≈ 0.5 SD (Kulik et al. 1990; see [Ed Next](https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science/), [nintil](https://nintil.com/bloom-sigma/)). | A lesson is "mastered" when each objective's check is answered correctly (first or second try with a variant). Heuristic threshold 80%. Otherwise → remediation segment + re-check. |
| **Metacognition / clarity of intentions** | LearnLM principles: inspire active learning, manage cognitive load, adapt to the learner, stimulate curiosity, deepen metacognition ([Google](https://blog.google/outreach-initiatives/education/google-learnlm-gemini-generative-ai/)). LYW rubric includes "Clarity of learning intentions & success criteria". | 2–4 can-do objectives at top ("このレッスンでできるようになること"), each mapped to ≥1 check; confidence tap (自信あり/たぶん/わからない) on checks; one reflection prompt at end. |

Reading-rate numbers for time estimates: EN non-fiction silent reading ≈ 238 wpm (Brysbaert 2019, [PDF](https://www.Gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf)); JP university students ≈ 650字/min average for normal silent reading (Kobayashi & Kawashima 2018, via [bestcalendar](https://bestcalendar.jp/tools/yomu-jikan) — secondary). For *study* reading use **EN 180 wpm / JP 450字/min** plus **40 s per check** and **2 min per try-it**.

---

## 3. What the best explainers and products do (and what to borrow)

- **Google Learn Your Way** (LearnLM; [blog](https://blog.google/products-and-platforms/products/education/learn-your-way/), [paper](https://arxiv.org/html/2509.13348v4)). Personalized base text (re-leveled by grade; interest-based rewrites of *selected* passages, which are highlighted as personalized) + transformations: Immersive Text with **embedded questions opened from "?" markers beside passages**, section quizzes (5–10 MCQ with "Glows & Grows" feedback), timeline drag-and-drop, memory aids, illustrations; Slides+Narration (narration complementary, not a readout); Audio-graphic lesson (teacher-student dialogue); Mind map. RCT (n=60): higher immediate and 3-day retention (78% vs 67%). Experts rated it >0.9 on all 10 rubric axes; **illustrations scored lowest; plain slides had the lowest engagement**. UI (see `lyw_inline_q.png`): warm off-white canvas, explicit LEARNING OBJECTIVES block, left section list with checkbox + "Take quiz to complete", orange "?" margin markers, questions in a right-side panel that doesn't hide the text, top chips "Interest 🏀 · Grade 10".
  → Borrow: objectives block, paragraph-anchored margin questions, side panel, section completion via quiz, interest/level chips, the 10-dimension rubric for evaluation.
- **Brilliant** ([why](https://brilliant.org/help/why-brilliant)): active problem solving, visual models, feedback explaining *why* wrong, bite-size sequenced steps. → Borrow: "steps" mode with one idea per screen and an interaction on most screens.
- **Bartosz Ciechanowski** ([Mechanical Watch](https://ciechanow.ski/mechanical-watch/)): problem → mechanism chain ("what goes wrong without X?"), 2–5 sentence paragraphs between figures, figures driven by sliders, **part names bolded in text and color-matched to figure elements**, concrete numbers, isolate-then-reassemble. → Borrow: color-matched term↔diagram signaling; "what breaks without this?" segment openers; small text chunks between visuals.
- **Bret Victor, Explorable Explanations** ([worrydream](https://worrydream.com/ExplorableExplanations/)): reactive documents, explorable examples, contextual information — "an environment to think in". **Red Blob Games** ([notes](https://redblobgames.com/x/2306-educ432)): explorables *enhance* text (page must work without interacting), guide rather than sandbox, keep scope small, only 10–15% of readers interact, learner-controlled animation beats system-controlled. → Borrow: interactive widgets are optional enhancements; text carries the lesson.
- **Josh Comeau** ([how I built my blog](https://www.joshwcomeau.com/blog/how-i-built-my-blog/), [v2](https://joshwcomeau.com/blog/how-i-built-my-blog-v2)): MDX with custom widgets dropped mid-article; custom course platform with 5 media types (articles, video, in-browser exercises, workshops, mini-games) per his [AMA](https://www.indiehackers.com/post/launched-my-first-course-earned-over-us-500-000-ama-4382405cd5). → Borrow: a typed widget registry the generator can reference by name (e.g., `widget: "reference-vs-copy"`), rendered by hand-built components.
- **Stripe docs** ([Mintlify analysis](https://mintlify.com/blog/stripe-docs), [KnowledgeOwl](https://blog.knowledgeowl.com/blog/posts/code-examples-shine-like-stripe)): code samples treated as prose with a style guide; language switcher; personalized values in samples; side-by-side explanation/code. → Borrow: code blocks with tabs (Python/JS), copy, highlighted lines tied to step labels, "Run" where possible.
- **Next.js Learn** ([chapter 1](https://nextjs.org/learn/dashboard-app/getting-started)): one project across chapters, numbered chapters, "You've Completed Chapter N" + "Next Up" card + "Was this helpful?". → Borrow: completion card with recap + next step; per-lesson feedback widget feeding generator quality.
- **Diátaxis** ([Canonical](https://ubuntu.com/blog/diataxis-a-new-foundation-for-canonical-documentation)): tutorial vs how-to vs reference vs explanation; don't mix. → A lesson is a *tutorial/explanation*; reference material (API tables, shortcut lists) goes to a linked "reference card", not into the lesson flow.
- **NotebookLM** ([Google](https://blog.google/technology/google-labs/notebooklm-student-features/)): source-grounded flashcards/quizzes with adjustable difficulty, "explain" on a card or wrong answer with citations; Learning Guide (Socratic). **Oboe** ([TechCrunch summary via search](https://techcrunch.com/?p=3074607)): moved quizzes *inside* course material. **ChatGPT Study Mode / Gemini Guided Learning / Claude Learning mode** ([Pearson](https://pearson.com/international-schools/international-schools-blog/2026/02/what-is-gemini_s-guided-learning-and-chatgpts-study-mode-.html)): all converged on guided questioning, stepwise hints, withheld answers.
  → Rise Path's in-lesson AI should default to *hint ladders* on checks/try-its (hint 1 → hint 2 → worked solution), and "explain this wrong answer" grounded in the lesson text.

---

## 4. The Lesson Contract (spec for generator prompts, Kit, and Claude Code via MCP)

### 4.1 Lesson anatomy

```
Lesson (8–15 min, ONE big idea, 2–4 objectives)
├─ objectives[]        can-do statements; each has an id (obj1..)
├─ warmup[]            0–2 retrieval items from earlier lessons (spaced/interleaved; from SRS, not generated)
├─ hook                problem/scenario the learner will be able to solve + 1 prediction question (no score)
├─ segments[3–5]       one idea each, learner-paced
│   ├─ explain         ≤ 150 EN words / ≤ 300字 JP; ≤ 3 paragraphs; define new terms before use
│   ├─ visual?         diagram ONLY if it shows structure/process/relationship; labels in learner language;
│   │                  same term names & colors as text; caption states the takeaway
│   ├─ worked_example? (procedural topics) 3–6 steps, each {subgoal label, action/code, why}
│   ├─ check           1–2 items, mapped to objective ids; per-option feedback; misconception tags
│   └─ pitfall?        max 1 per segment, only if a real common error (replaces generic "warning" callouts)
├─ try_it              faded example or independent task; 3-level hint ladder; model solution; self-check rubric
├─ recap               3–5 retrieval items covering every objective (mixed formats, ≥1 transfer item)
├─ summary             3 bullet takeaways (shown AFTER recap, not before — avoid rereading illusion)
├─ reflection          1 prompt (what was hardest / where will you use this)
└─ flashcards[4–8]     {front, back, concept_id}; feed SRS
```

Learning-mode variants (keep `curriculumGenerationKit.js` modes, re-mapped):
- `problem_solving`: hook is a full problem; segments run principle → worked example → near-transfer check.
- `practice`: segments shorter (≤100 words), try-it earlier, ≥2 try-its.
- `credential`: objectives phrased as exam outcomes; recap 6–8 items incl. exam-style; module ends with a mock test.
- `gentle`: 3 segments max, ≤100 words each, 1 check per segment, reassurance in feedback copy, no timed elements.

### 4.2 Hard budgets (validator-enforced)

| Item | EN | JP |
|---|---|---|
| Sentence | ≤ 25 words (aim 15–20) | ≤ 60字 (aim 40–50) — heuristic |
| Paragraph | ≤ 4 sentences / ≤ 80 words | ≤ 3文 / ≤ 160字 |
| Segment explain text | 80–150 words | 160–300字 |
| Lesson reading text (excl. code) | 600–1,200 words | 1,200–2,400字 |
| Checks per lesson (inline + recap) | 6–12 | same |
| Bold/highlighted terms per paragraph | ≤ 1–2 | same |
| New terms per segment | ≤ 3, each defined at first use | same |
| Diagrams per lesson | 0–3 (purpose required) | same |
| Decorative images | 0 | 0 |
| Callouts per segment | ≤ 1 (pitfall or note) | same |

### 4.3 Item-writing rules (checks/recap)

- Formats: `mcq` (single), `multi` (select all), `order` (sequence steps; keyboard alternative to drag — WCAG 2.5.7), `cloze` (fill code/term), `predict_output` (code → choose output), `short` (free text, AI-graded vs. rubric), `classify` (interleaving: "which concept applies?").
- Each item has `objective_id`, `concept_id`, `difficulty (1–3)`, `bloom ("remember"|"understand"|"apply"|"analyze")`. Recap must include ≥1 `apply`-level item per objective.
- MCQ: 3–4 options; options parallel in length/grammar; no "all of the above"; every distractor encodes a real misconception (`misconception: "b = a copies the list"`), with feedback that names it and corrects it in ≤ 2 sentences.
- Never test the analogy, the hook's anecdote, or trivia. Test the concept in a *new* surface context (transfer).
- Provide a **variant** item per objective (different surface, same concept) for retry after a miss.

### 4.4 Worked-example rules

- Steps: 3–6; each `{label (subgoal, ≤ 12 words / ≤ 20字), code_or_action, why (≤ 1 sentence)}`; highlight the changed line(s) (`highlightLines` already exists in `types.ts:354`).
- Follow with a *faded* example on a different surface where 1–2 steps are blanks (cloze) using the same labels.
- Code examples must be runnable/minimal (≤ 15 lines), with expected output stated *after* a predict prompt, not inside comments.

### 4.5 Diagram rules

- Use a diagram only for: process/flow, structure/hierarchy, state change over time, comparison. Write the `purpose` field; if none → no diagram.
- Labels in the learner's language (generate `chart` per locale or a `labels` map). ≤ 9 nodes. Add `accTitle`/`accDescr` (Mermaid supports these → `<title>`/`<desc>` with `aria-labelledby/-describedby`, [docs](https://mermaid.js.org/config/accessibility.html)).
- Prefer hand-built "widgets" (registry) for core recurring ideas (e.g., reference vs copy boxes-and-arrows with a step slider) over AI-generated art. LYW's experience: generated illustrations score lowest.

### 4.6 Language strategy

- Generate **natively in the learner's language** (JP-first for JP users), then a separate translation pass for other locales, stored per locale. Add `fr` to `LocalizedText` for generated content (type already allows `fr?`, `types.ts:345-349`; backend schema does not, `geminiBackendService.js:164-172`).
- JP style guide for the writer: です・ます調; 漢字率 ~30% (heuristic); katakana tech terms first appearance followed by English in parentheses ("参照（reference）"); avoid 体言止め chains in explanations; use 「」 for emphasis rather than italics.

### 4.7 Quality pipeline (same for Gemini, Claude, Hermes, or Claude Code via MCP)

1. `get-generation-kit` (exists in `mcp-server/tool-registry.json`) returns the Lesson Contract + JSON schema + budgets + style guide + 1 gold example lesson.
2. Model writes lesson JSON.
3. **`lint-lesson`** (new deterministic tool): schema validity, budgets (§4.2), every objective has ≥2 items (1 inline + 1 recap), every MCQ option has feedback, no decorative images, diagram labels localized, glossary terms defined at first use, no raw markdown backticks in text fields, reading time computed from §2 rates.
4. **LLM judge** with LYW's 10 axes (Accuracy, Coverage, Emphasis, Engagement, Cognitive load, Active learning, Deepen metacognition, Motivation & curiosity, Adaptability & personalization, Clarity of learning intentions & success criteria; agree=1 / partial=0.5 / disagree=0) — fix loop until each ≥ 0.8.
5. `save-curriculum-draft` (exists). Store judge scores + learner "Was this helpful?" + per-item p-values (difficulty from real attempts) to flag bad items.

### 4.8 Draft system-prompt core (to replace `geminiBackendService.js:478-591`)

```
You are Rise Path's lesson author. You write lessons that make learners able to DO
the objectives, using evidence-based learning design. Quality = what the learner can
do after the lesson, not how many blocks you produce.

Follow the Lesson Contract exactly:
- 2–4 objectives as observable can-do statements. Every objective is checked at least twice.
- Hook: a concrete problem the learner will solve by the end + one prediction question.
  No trivia, no "did you know", no statistics unrelated to the objective.
- 3–5 segments, ONE idea each. Explain in ≤150 words (JP ≤300字). Define each new term
  at first use. Then (if procedural) a worked example with labelled subgoal steps.
  End every segment with a check that requires retrieval or application, not recognition
  of a sentence you just wrote.
- Distractors must encode real misconceptions; write feedback for every option.
- Never quiz the analogy. Test the concept in a new context.
- A diagram only if it shows structure/process/comparison; labels in the lesson language;
  include accTitle/accDescr; state its purpose. No decorative images.
- Try-it: faded version of the worked example, 3 hints from gentle to explicit, model answer.
- Recap: 3–5 mixed items covering all objectives, then a 3-bullet summary, 1 reflection
  prompt, 4–8 flashcards.
- Write natively in {locale}. Japanese: です・ます, plain words, katakana term + (English) at
  first use, no italics, 「」 for emphasis.
Before returning, self-check against the budgets and the rubric; revise if any fails.
```

---

## 5. Reader design spec

### 5.1 Layout (desktop ≥1200px)

```
┌ top bar: back · course › lesson · segment progress dots (●●○○○) · ~8分 · Aa (type settings) · EN/JP/FR ┐
├ left rail (collapsible, 240px): course outline; per-lesson objective checkmarks; "Review (5 due)"      ┤
├ reading column: max-inline-size 68ch (EN) / 38em (JP ≈ 36–38字)                                      ┤
├ right margin rail (280–320px): anchored "?" checks, glossary card, "Ask AI about this selection",    ┤
│   sidenotes; questions open here without covering text (LYW pattern)                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Tablet/mobile (<1024px): single column, 16px gutters, rail content becomes inline cards / bottom sheet; tabs become a horizontal segmented control (fix vertical-text tabs in `generated-lesson_demo-curr-001-m.png`).
- Modes: **Read** (scroll, checks inline), **Steps** (one segment per screen, Brilliant-like, "Continue" gated by the check), **Slides+Narration**, **Audio**. Quiz is not a mode; recap is the end of every mode.
- Hero area: title, 1-line subtitle (no italics), objectives card, level/interest chips (LYW). No decorative hero image.
- End: completion card ("このレッスンを修了しました" + mastered objectives + flashcards added + next lesson card + 👍/👎 "役に立ちましたか?").

### 5.2 Component styles

- **Check card**: neutral surface, 1px border, "確認 / Check" label + objective tag; options as full-width buttons (min 44px tall; WCAG 2.5.8 minimum 24px); after answer: green/red *plus* icon and text (not color-only); feedback text ≤ 2 sentences; "Try a variant" on miss; confidence chips.
- **Worked example**: numbered subgoal labels in a left gutter, code with highlighted lines synced to the active step, "Why?" disclosure per step.
- **Try-it**: editor/answer box, hint ladder buttons (ヒント1 → ヒント2 → 解答を見る), self-check rubric.
- **Callouts**: only `pitfall` and `note` variants in lessons; sentence-case titles (no uppercase tracking).
- **Glossary**: underline first occurrence per segment only; button semantics (`<button>` or `role="button" tabIndex=0` + Enter/Space); popover with plain definition + example + "AIに質問".
- **Code**: syntax highlighting (Shiki/Prism), language tab, copy button, line numbers optional, 14–15px mono, line-height 1.6, horizontal scroll inside block only.
- **Diagrams**: rendered in-theme (light/dark), labels localized, caption = takeaway sentence; click → full-screen zoom.
- **Progress**: segment dots at top; left rail shows objectives as checkboxes that tick when their checks are passed (mastery, not scroll).

### 5.3 Typography

**Latin (EN/FR)**: body 17–18px, line-height 1.6–1.7, measure 60–72 chars (Baymard: 50–75, [Baymard](https://baymard.com/blog/line-length-readability)), paragraph spacing 1em, headings line-height 1.2–1.3, `text-wrap: pretty` (body) / `balance` (headings). Italic allowed for EN only.

**Japanese** (apply via `:lang(ja)`; `<html lang>` is already set in `context/LanguageContext.tsx:40-44`; also put `lang` on content blocks whose language differs from UI):
- Font: `"Inter", "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif` (Latin glyphs from Inter, kana/kanji from Noto Sans JP variable; Google Fonts serves JP via unicode-range slices, [Google](https://developers.googleblog.com/google-fonts-launches-japanese-support/)). Offer a UD option (BIZ UDPGothic — Morisawa universal-design, legibility-tested, [Google Fonts blog](https://fonts.googleblog.com/2022/04/morisawa-biz-universal-design-ud.html)) and an optional 明朝 reading mode (Noto Serif JP / BIZ UDPMincho) in the Aa menu.
- Size: body 16–17px (JP glyphs are visually larger; typical advice: ~10–15% smaller than Latin, [AQ Works](https://aqworks.com/blog/perfect-japanese-typography)).
- Line-height: **1.9–2.0** body. JLREQ: line gap 0.5–1em, "one em spacing or close to it" for lines >35 characters ([W3C JLREQ](https://www.w3.org/TR/jlreq/)). Headings 1.4–1.5.
- Measure: **≤ 40字** (JLREQ: "40 characters, maximum, in horizontal writing mode"); target 34–38字 → `max-inline-size: 38em` at letter-spacing .04em. Mobile 390px with 16px gutters at 16px ≈ 22字 — fine.
- Letter-spacing: body 0.03–0.05em; headings 0.02em with `font-feature-settings: "palt"` (proportional kana) for display sizes only; **never negative tracking** on CJK (remove `tracking-tight` for `:lang(ja)`).
- No italic, no `uppercase`: emphasis by weight (600) or 「」/ 傍点 (`text-emphasis: filled dot` sparingly).
- Line breaking: `line-break: strict` (kinsoku), `overflow-wrap: anywhere` for long URLs/identifiers; headings, TOC, buttons, quiz stems: `word-break: auto-phrase` (BudouX, Chrome 119+; [Chrome blog](https://developer.chrome.com/blog/css-i18n-features)) + `text-wrap: balance`.
- Spacing: `text-autospace: normal` (CJK↔Latin/digit 1/8em; Chrome 139+, Safari 18.4+), `text-spacing-trim: space-first` (Chrome 123+) ([notes](https://scrapbox.io/petamoriken/%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE_CSS_%E3%82%BF%E3%82%A4%E3%83%9D%E3%82%B0%E3%83%A9%E3%83%95%E3%82%A3)). Do not put ASCII spaces around Latin words in JP source text when autospace is on.
- Paragraphs: JP traditionally uses no paragraph spacing (WCAG notes this, [Understanding 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)); on screen keep a 0.75–1em gap between paragraphs (short web paragraphs), no 字下げ indent.
- Alignment: left (start). Justify only with `text-justify: inter-character` and not with inline URLs.

```css
:root:lang(ja) { --measure: 38em; }
.lesson-body:lang(ja) { font-size: 16.5px; line-height: 1.95; letter-spacing: .04em;
  line-break: strict; overflow-wrap: anywhere; text-autospace: normal; text-spacing-trim: space-first; }
.lesson-body:lang(ja) :is(h1,h2,h3,.toc a,button,.check-stem) {
  word-break: auto-phrase; text-wrap: balance; letter-spacing: .02em; font-feature-settings: "palt"; line-height: 1.45; }
.lesson-body:lang(ja) :is(em,i) { font-style: normal; font-weight: 600; }
.lesson-body:lang(en), .lesson-body:lang(fr) { font-size: 18px; line-height: 1.65; max-inline-size: 68ch; }
```

### 5.4 Color / theme
- Reading canvas: warm off-white (e.g., `#FBFAF7`) light / `#14161A` dark; body text ≥ 7:1 where possible (AAA), never < 4.5:1 (callout text on tinted backgrounds included). One accent color for interactive elements; semantic colors only for feedback (with icons).
- Term↔diagram color pairing (Ciechanowski): a palette of 4–5 "concept colors" the generator can assign (`concept_color: 1..5`) consistently in text highlights and diagram nodes.

### 5.5 Accessibility (WCAG 2.2 AA)
- 2.5.8 Target size ≥ 24×24 CSS px (use 44px for options); 2.4.11 Focus not obscured — sticky header must not cover focused element (`scroll-padding-top` = header height); 2.5.7 Dragging alternative for order/timeline items (buttons/keyboard); 3.2.6 Consistent help — "Ask AI" always in the same place; 1.4.12 Text spacing tolerated; 1.4.10 Reflow at 320px (currently fails on mobile shots); 2.1.1 keyboard for glossary/term popovers; `prefers-reduced-motion` for confetti/animated transitions; diagrams with `accTitle/accDescr`; feedback not color-only. ([W3C What's new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/))

---

## 6. Review system (spacing) spec

- Data: `review_items {user_id, concept_id, card_front, card_back, source_lesson_id, fsrs_state(stability, difficulty, due_at, reps, lapses)}`.
- Scheduler: FSRS (open-source; TS port `ts-fsrs` exists on npm — verify version), desired retention 0.9, grades Again/Hard/Good/Easy mapped from check correctness + confidence.
- Surfaces: Dashboard "今日の復習 N枚 (~3分)"; lesson warm-up pulls 1–2 due items; module-end interleaved review.
- Inline check results also update concept mastery → drives adaptivity (skip worked example when pre-check correct; extra segment when missed twice).

---

## 7. What to cut / stop doing

- Quotas: "≥2 mermaid", "≥3 callouts", "every list ≥3 items", "every section ≥5 blocks", per-section success-summary callouts (`geminiBackendService.js:442-447, 555-584`).
- "Surprising fact" hooks and "Humans are visual learners" (`:486-497`).
- Decorative AI-generated hero/section images (`aiPrompts.js:116` image prompt); keep `image` only for real screenshots/photos with an instructional caption.
- Separate Quiz tab as the only assessment (`GeneratedDocView.tsx:155`).
- Synthetic italics / Playfair for JP subtitles (`:787`), uppercase tracking labels on JP, negative tracking on JP headings (`:784`).
- Highlighting every glossary occurrence (`GlossaryText.tsx:111`).
- One-pass en+jp bilingual generation (`geminiBackendService.js:164-172`).

## 8. Priority order for implementation

1. Fix reader fundamentals: mobile layout, JP type system (§5.3), no italics, glossary first-occurrence + keyboard, inline-code rendering, code highlighting + copy.
2. Schema v2 block types: `objectives`, `check` (mcq/multi/cloze/predict_output/order/short), `worked_example`, `try_it`, `recap`, `flashcards`, `pitfall`; render checks inline + margin rail; mastery-based completion.
3. Replace generator prompt with the Lesson Contract (§4.8) + `lint-lesson` + rubric judge; expose via MCP so Claude Code authors with the same contract.
4. SRS review queue (FSRS) + warm-ups.
5. Steps mode, widget registry (hand-built explorables for core concepts), Slides+Narration as a complementary transformation.

## Sources

- Google Learn Your Way: https://blog.google/products-and-platforms/products/education/learn-your-way/ · https://arxiv.org/html/2509.13348v4 · https://arxiv.org/abs/2509.13348v4
- LearnLM principles: https://blog.google/outreach-initiatives/education/google-learnlm-gemini-generative-ai/
- Dunlosky et al. 2013 (APS release): https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html
- Cepeda et al. 2008: https://pubmed.ncbi.nlm.nih.gov/19076480/
- FSRS: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention · https://faqs.ankiweb.net/what-spaced-repetition-algorithm
- Interleaving meta-analysis: https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf
- Self-explanation meta-analysis: https://bps.org.uk/research-digest/self-explanation-powerful-learning-technique-according-meta-analysis-64-studies
- Worked/faded examples: https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples · https://www.teachermagazine.com/au_en/articles/cognitive-load-theory-teaching-strategies · https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf
- Subgoal labels: https://scholarworks.gsu.edu/ltd_facpub/4
- Pretesting: https://learninglab.uchicago.edu/Pre-Testing_files/RichlandKornellKao.pdf · https://hausman.sites.ucsc.edu/files/2023/02/Hausman.Rhodes.2018b-When-Pretesting-Fails-to-Enhance-Learning.pdf
- Retrieval practice in class: https://www.cultofpedagogy.com/retrieval-practice/ · https://ctl.wustl.edu/wp-content/uploads/2021/03/ScienceOfLearning_RetrievalPractice.pdf
- Feedback meta-analysis: https://www.frontiersin.org/articles/10.3389/fpsyg.2019.03087/pdf
- Mastery learning / 2-sigma: https://www.educationnext.org/two-sigma-tutoring-separating-science-fiction-from-science/ · https://nintil.com/bloom-sigma/
- Mayer principles: https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171655 · https://wikis.utexas.edu/x/YLzcB
- Seductive details: https://www.learningscientists.org/blog/2019/6/20-1 · https://inspire.acu.edu.au/articles/seductive-details
- Reading rate: https://www.Gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf · https://bestcalendar.jp/tools/yomu-jikan
- Brilliant: https://brilliant.org/help/why-brilliant
- Ciechanowski: https://ciechanow.ski/mechanical-watch/
- Bret Victor: https://worrydream.com/ExplorableExplanations/ · Red Blob Games: https://redblobgames.com/x/2306-educ432
- Josh Comeau: https://www.joshwcomeau.com/blog/how-i-built-my-blog/ · https://joshwcomeau.com/blog/how-i-built-my-blog-v2 · https://www.indiehackers.com/post/launched-my-first-course-earned-over-us-500-000-ama-4382405cd5
- Stripe docs: https://mintlify.com/blog/stripe-docs · https://blog.knowledgeowl.com/blog/posts/code-examples-shine-like-stripe
- Next.js Learn: https://nextjs.org/learn/dashboard-app/getting-started
- Diátaxis: https://ubuntu.com/blog/diataxis-a-new-foundation-for-canonical-documentation
- NotebookLM: https://blog.google/technology/google-labs/notebooklm-student-features/
- AI study modes: https://pearson.com/international-schools/international-schools-blog/2026/02/what-is-gemini_s-guided-learning-and-chatgpts-study-mode-.html
- Japanese typography: https://www.w3.org/TR/jlreq/ · https://aqworks.com/blog/perfect-japanese-typography · https://developer.chrome.com/blog/css-i18n-features · https://scrapbox.io/petamoriken/%E6%97%A5%E6%9C%AC%E8%AA%9E%E3%81%AE_CSS_%E3%82%BF%E3%82%A4%E3%83%9D%E3%82%B0%E3%83%A9%E3%83%95%E3%82%A3 · https://fonts.googleblog.com/2022/04/morisawa-biz-universal-design-ud.html · https://developers.googleblog.com/google-fonts-launches-japanese-support/
- Line length: https://baymard.com/blog/line-length-readability
- WCAG 2.2: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ · https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- Mermaid accessibility: https://mermaid.js.org/config/accessibility.html

Caveats: several numeric heuristics (JP sentence ≤60字, 漢字率 30%, 80% mastery threshold, study reading rates) are practitioner rules of thumb, not single-study findings; JP reading speed figure is from a secondary citation of Kobayashi & Kawashima 2018. Browser support versions for `text-autospace`/`text-spacing-trim` come from a community wiki; verify on MDN before relying on them (all are progressive enhancements).
