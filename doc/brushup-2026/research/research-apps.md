# Competitor & market research: AI learning apps, Oct 2026 (key: `research-apps`)

Scope: what the leading AI-learning and coding-learning products do in late 2026, how they **display lessons**, how their **AI tutors** behave, how they retain users, how they price, and what Rise Path should add, own, or cut.

Method: about 45 web searches and fetches (WebSearch/WebFetch), plus Playwright screenshots of competitor public pages and one live Google *Learn Your Way* lesson. Screenshots are in
`<session-scratchpad>/shots-before/extra/competitors/`:
`lyw_lesson_2.png` (Learn Your Way lesson anatomy), `lyw_inline_q.png` (paragraph-anchored question drawer), `lyw_scrolled.png` (end-of-section quiz), `learnyourway_withgoogle_com.png`, `brilliant_org.png` (Koji tutor), `www_boot_dev.png`, `progate_com.png`, `oboe_com.png`, `notebooklm_google.png`, `scrimba_com.png`, `www_khanmigo_ai.png`, `www_synthesis_com_tutor.png`, `www_speak_com.png`, `mimo_org.png`.
The capture script is `<session-scratchpad>/scripts/compshots.mjs`.

Caveat on sources: many 2026 pricing and feature figures come from third-party aggregators, and they often disagree. I flag those as "3rd-party". First-party pages and peer-reviewed papers are marked as such.

---

## 0. TL;DR — the eight findings that matter for Rise Path

1. **The winning lesson format in 2026 is one source with many representations and checks built in.** It is not "a chat" and it is not "a long doc". Google *Learn Your Way* (live, screenshotted) shows the pattern: a top switcher (Source / Immersive Text / Slides & Narration / Audio Lesson / Mindmap), a personalization pill ("Interest 🏀 · Grade 10"), a left section list where each section needs a quiz to complete, and orange **"?" markers in the margin next to paragraphs** that open a side-drawer question and highlight the source paragraph. Google reports **+11 pp on long-term recall** against a PDF reader ([Google blog](https://blog.google/outreach-initiatives/education/learn-your-way/), [Maginative](https://www.maginative.com/article/learn-your-way-googles-new-ai-transforms-static-textbooks-into-interactive-personalized-lessons/)). Rise Path already has Doc / Slide / Quiz tabs (`VibeDocView`, screenshot `shots-before/jp/vibe_chapter-1.png`). That is the right skeleton, but the checks are not inline, nothing gates completion, and there is no audio or mindmap view derived from the same blocks.
2. **"Never give the answer" is now the industry default for AI tutors.** Khanmigo, Brilliant Koji, Boot.dev Boots, ChatGPT Study Mode, Gemini Guided Learning, Claude Learning mode, Coursera Coach Dialogues and NotebookLM Learning Guide all work this way. Evidence: the Bastani et al. PNAS 2025 RCT found unrestricted GPT-4 raised practice scores by 48% but **cut exam scores by 17%**, while the guardrailed "GPT Tutor" had no harm ([PNAS / SSRN](https://papers.ssrn.com/abstract=4895486), [Wharton](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education)). The Harvard RCT (Kestin et al., *Sci. Rep.* 2025) found a **pedagogy-prompted** tutor gave about 2× the learning gains of active-learning class ([summary](https://michellemillerphd.substack.com/p/r3-37-july-15-2025-how-do-tutoring)). Rise Path's floating coach is page-agnostic and gets no lesson context by default (`components/common/FloatingChatbot.tsx:100-107`). Its Socratic rule is one line in `server/services/hermesAgentService.js:21`.
3. **The best tutors are anchored to the material.** Koji works "on a shared interactive canvas… sketches on your screen, gives hints" (brilliant.org, screenshot). Coursera Coach covers 97% of courses and sits inside the course ([Gulf Business](https://gulfbusiness.com/en/2026/interviews/coursera-ceo-greg-hart-on-ai-and-learning-trends/)). Boots knows your exercise and your code. A generic chat bubble in the corner is now seen as low-value.
4. **Retention comes from retrieval and spacing, not points.** Dunlosky et al. 2013 rate only *practice testing* and *distributed practice* as "high utility" ([APS](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html)). NotebookLM's 2026 flashcards persist "Got it / Missed it" across sessions ([Workspace Updates, Mar 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)). Quizlet Learn, Monoxer and Oboe all schedule reviews. **Rise Path has no review / spaced-repetition system at all**: a grep for `spaced|flashcard|srs|fsrs|nextReview` returns nothing.
5. **Gamification: streaks and levels work, but badges, points and leaderboards are weak on their own.** Duolingo's own A/B tests: streak freezes +0.38% DAU, Weekend Amulet +4% week-1 return ([Duolingo blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit), [making.duolingo.com](https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals)). A multi-level meta-analysis on *programming* learning found only **levels** had a significant effect. Badges, points, avatars and leaderboards had none ([ISCTE](https://ciencia.iscte-iul.pt/publications/using-game-concepts-to-improve-programming-learning-a-multi-level-meta-analysis/95533?lang=en)). Rise Path shows fake XP, level, "今週 2.5h" and momentum charts (`MissionControlDashboard.tsx`, see `features.md` §0.3). Those should go, replaced by one honest streak and real progress.
6. **Distribution is moving into the assistant.** Coursera (Oct 2025) and Quizlet (Mar 2026) ship as **apps inside ChatGPT** ([BusinessWire](https://www.businesswire.com/news/home/20251006989293/en), [Quizlet PR](https://www.streetinsider.com/PRNewswire/Quizlet+Launches+as+Native+App+in+ChatGPT+to+Transform+AI-Powered+Learning/26142955.html)). Claude connects to Canvas, Panopto and Wiley over MCP ([Anthropic](https://anthropic.com/news/advancing-claude-for-education)). **MCP Apps (SEP-1865, Final)** standardizes interactive `ui://` HTML views that render inside Claude, ChatGPT and VS Code ([spec](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)). Rise Path already has a 19-tool MCP server (`mcp-server/tool-registry.json`). That gives it a rare head start, but `save-curriculum-draft` takes `z.object({}).passthrough()` (`mcp-server/index.js:388-389`), so external LLMs get no schema.
7. **Curated beats generated for flagship content; AI is the author's assistant.** Synthesis says lessons are "designed by educators and neuroscientists rather than generated by an LLM", with AI used "where appropriate" (synthesis.com/tutor). Brilliant and Duolingo keep human-designed cores. Duolingo's "148 AI-built courses" plus its AI-first memo caused a backlash ([Maginative](https://www.maginative.com/article/duolingo-introduces-148-new-language-courses-built-with-ai/)). Oboe generates whole courses but runs "auditing agents" for accuracy ([Homebrew](https://homebrew.co/blog/2025/09/10/oboe-fyi-launches-because-ai-should-help-you-learn-not-become-a-substitute-for-learning)). For Rise Path: **Claude Code / MCP authoring into a validated schema, with lint and review, then publish.** Do not generate at read time.
8. **"Learning styles" matching has no evidence behind it, so Big5 should steer tone and pacing, not format.** Pashler et al. 2008 found almost no support for the meshing hypothesis ([USF](https://digitalcommons.usf.edu/psy_facpub/1765/)). Learn Your Way personalizes by **grade level and interests** (examples swapped to the learner's interest), not by learning style. Rise Path's Big5 claim ("AI dynamically adapts curriculum content, tone, and learning style", README) should be reframed as tone, encouragement style, pacing and goal-setting. Interest-based examples should be added, since that is what Learn Your Way actually tested.

---

## 1. Competitor profiles

Legend: **Loop** = core loop; **Display** = how a lesson is shown; **Tutor** = AI tutor UX; **Retention** = gamification and retention; **Price**; **Exceptional** = what they do best.

### 1.1 Global AI-native / AI-heavy

| Product | Loop | Display | Tutor | Retention | Price | Exceptional |
|---|---|---|---|---|---|---|
| **Duolingo (Super/Max)** | Daily 3–5 min lesson on a linear "path". Mixed exercise types. Energy replaced hearts in Jul 2025 | Single-exercise cards, large tappable targets, character art, instant feedback sounds | Max: *Video Call* with Lily (voice, topic-scoped, level-scaled, **no mid-call correction, feedback after the call**), *Roleplay*. "Explain My Answer" reported free since Jan 2026 (3rd-party) | Streak (with freezes and the Weekend Amulet), leagues, XP, quests. Streak tests: +3% DAU from streak on top, +0.38% DAU from 2 freezes | Max about $30/mo or $168/yr (3rd-party, [nibble](https://nibble-app.com/blog/is-duolingo-max-worth-it)) | Habit engineering run on a large A/B culture. Characters with personality. Expanding to math, music, chess. Q2-2026 DAU +23% YoY ([IR](https://duolingo.gcs-web.com/news-releases/news-release-details/duolingo-announce-second-quarter-2026-results-wednesday-august-5)) |
| **Khan Academy / Khanmigo** | Video and article, then mastery exercises. Khanmigo alongside | Exercise-first, with hints and worked steps | "Challenges you to think critically… without giving you direct answers" ([khanmigo.ai](https://www.khanmigo.ai/)). Writing Coach. Teacher tools (rubrics, lesson plans, exit tickets) are free | Mastery points, course mastery % | Learners about $4/mo or $44/yr (3rd-party). Teachers free | Tutor plus teacher co-pilot. Strong guardrails. Parent can add up to 10 kids |
| **Brilliant (+ Koji)** | 15 min/day of interactive problems. 10–25 problems per lesson | **Visual, manipulable widgets** (drag, slide, toggle) with 2–4 sentence intros. No video lectures ([skillscouter](https://skillscouter.com/brilliant-review-math-science-coding/)) | **Koji** (2026): "A visual, interactive tutor, not a cheating machine… on a shared interactive canvas… sketches on your screen, gives hints." It tracks gaps and builds practice and review sessions (brilliant.org, screenshot). CEO principle: "Never tell the learner the answer" ([EdTech Insiders](https://edtechinsiders.buzzsprout.com/1877869/episodes/19457440-building-an-ai-tutor-that-gets-students-to-think-with-sue-khim-of-brilliant)) | Streaks, daily goal, parent dashboards | Subscription | **Interactive explorable figures**. Restrained, editorial typography (serif headlines, lots of whitespace) |
| **Google Learn Your Way** (Labs) | Upload a PDF, pick grade and interest, then move between representations | **Immersive Text** (sections, generated images, **margin "?" embedded questions**), **Slides & Narration**, **Audio Lesson** (2-voice), **Mindmap**, timelines. **Section quiz gates completion**. Source view keeps the PDF reachable (live screenshot) | Embedded questions with feedback. Quizzes adapt | Section checklist | Free experiment | **Evidence: +11 pp recall vs. PDF reader** (N=60). Personalizes with *interests*, not "styles". Tech report [arXiv 2509.13348](https://arxiv.org/abs/2509.13348) |
| **Gemini Guided Learning** | Toggle in the Gemini app | Step-by-step answers with diagrams, images, YouTube clips, and quizzes in Canvas | Socratic, adaptive ([Google](https://blog.google/products/gemini/guided-learning-google-gemini/)) | — | Gemini plans | Pulls high-quality diagrams and videos in-line |
| **NotebookLM → "Gemini Notebook"** (renamed 16 Jul 2026, [Google](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/)) | Add sources, then chat grounded in them, then generate "Studio" outputs | Studio panel: Audio Overview (Deep Dive / Brief / Critique / Debate, interactive), Video Overview incl. "Cinematic", Mind Map, Flashcards, Quizzes, Infographics, Slides, Learning Guide | **Learning Guide**: Socratic tutor grounded only in your sources | **Flashcard and quiz progress persists. "Got it / Missed it". Re-run missed cards** (Mar 2026) | Free, with Pro/Ultra tiers | Grounding and citations to sources. Many outputs from one corpus. 30M+ users |
| **ChatGPT Study Mode** | Toggle "Study and learn" | Sectioned explanations. Quizzes (single-source report of interactive MC quiz cards with hint button and score, Aug 2026, [promptoptimizer](https://promptoptimizer.tools/blog/chatgpt-quiz-me-feature-how-to-use)) | Socratic questions, hints, self-reflection, level check, memory ([InfoQ](https://www.infoq.com/news/2025/08/study-mode-chatgpt)) | Memory | Free/Plus | Huge reach. **Apps in ChatGPT** (Coursera, Quizlet) put third-party learning UIs inside the chat |
| **Claude Learning mode / Claude Code output styles** | Claude.ai style dropdown "Learning". Claude Code `/config` → Output style | Claude Code **Explanatory** adds "Insights". **Learning** makes the user write code at `TODO(human)` markers ([docs](https://code.claude.com/docs/en/output-styles)) | Socratic in Claude.ai ([Engadget](https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html)) | — | Claude plans | Learning *while doing real work*. MCP connectors to Canvas (LTI), Panopto, Wiley |
| **Coursera Coach** | Video course, Coach in the side panel | Video and readings | Coach Dialogues (Socratic, instructor-placed), **Role Play** (60 activities). On 97% of courses ([Gulf Business 2026](https://gulfbusiness.com/en/2026/interviews/coursera-ceo-greg-hart-on-ai-and-learning-trends/)). Self-reported +9.5% first-attempt quiz pass ([Coursera blog](https://blog.coursera.org/announcing-ai-powered-capabilities-enabling-educators-to-use-coursera-coach-to-deliver-interactive-personalized-instruction)) | Certificates | Coursera Plus | Instructor-placed AI checkpoints inside content. ChatGPT app |
| **Scrimba (+ Explain)** | Interactive screencast ("scrim"): pause and edit the instructor's code | Video and IDE in one. **Explain** (Aug 2026 beta): a question yields a **DOM-rendered narrated slide "video" in 2–3 s** with code, diffs and diagrams, ending in a quiz ([docs](https://docs.scrimba.com/explain/introduction), [PH](https://www.producthunt.com/p/scrimba/scrimba-explain-instant-video-tutorials-about-anything-beta)) | Instant AI code review on challenges | Path progress | Pro about $49/mo or $294/yr (3rd-party) | **DOM-based narrated explainer instead of pixel video**. Cheap, instant, editable. Very relevant to Rise Path's Slide mode plus Kokoro TTS |
| **Boot.dev** | Read short lesson, write code in browser, tests pass, earn XP | Text lesson left, editor and tests right. Fully committed **fantasy-RPG brand** (screenshot) | **Boots** (wizard persona): "socratic method… not hand out answers" (boot.dev) | XP (12.5B earned), levels, quests, leagues, chests, boss battles, streaks. Some learners find XP distracting ([coddy](https://coddy.tech/vs/fr/boot-dev)) | About $40/mo (3rd-party). Free tier becomes read-only after a few chapters | **One coherent game identity** across tutor, rewards and UI. Interactive features locked, content readable |
| **Codecademy** | Narrative pane, editor, run/check | Split-screen instruction, editor and output | AI Learning Assistant: explain errors, project hints, free-response feedback | Streaks, skill paths | Plus about $17.49, Pro about $29.99/mo annual (3rd-party, conflicting) | Zero-setup in-browser coding |
| **Mimo** | Mobile bite-size code lessons | Phone-native tap-to-code | AI tutor (limited on free tier). **Build tab**: AI-first IDE with hosting and version history ([release notes](https://www.apkmirror.com/apk/mimohello-gmbh/mimo-learn-to-code/mimo-learn-coding-programming-7-0-release/)) | Streaks, leagues | Pro about $12.49/mo (3rd-party) | Learn, then build and ship from the same app |
| **Oboe** | "I want to learn…" prompt, then a generated course. In 2026 the homepage says "Chat that actually teaches you. Structured, cited, personalized, and interactive." (oboe.com screenshot) | About 9 formats: course, podcast, audiobook, key takeaways, FAQ, flashcards, quiz, games. Uses **real images, not AI images**. Auditing agents check accuracy | Not a tutor first. "LLMs… won't notice when you're lost" (CEO, [Every](https://every.to/podcast/transcript-why-your-ai-learning-projects-keep-fizzling-out)) | Streaks, spaced repetition, mastery heat-map (3rd-party) | Freemium, about 5 free courses/mo (3rd-party) | Prompt-to-course in seconds. Very minimal, warm editorial UI. Shareable links |
| **Synthesis Tutor** | Ages 5–11 math, voice-guided | Manipulatives, voice read-aloud | Patient, warm; "AI where appropriate"; **lessons designed by educators, not LLM-generated** | Level unlocks, parent reports | $29–45/mo (first-party page, inconsistent) | Mastery micro-assessments before advancing |
| **Speak** | Learn phrase, drill to automaticity, open conversation | Speaking-first cards | AI tutor with pronunciation feedback. "Made for You" lessons **built from your mistakes** (Premium Plus) | Streaks | $17.99/mo or $83.99/yr; Plus $164.99/yr (3rd-party) | Strong in Japan and Korea. Mistakes become custom lessons |
| **Quizlet** | Sets, then Learn / Test / Flashcards | Cards | Magic Notes (notes to cards, tests, outlines). Q-Chat reportedly discontinued Jun 2025 ([nibble](https://nibble-app.com/blog/quizlet-review)) | Adaptive Learn repeats weak terms | Plus about $7.99/mo | **App in ChatGPT** (Mar 2026). Massive content library |

### 1.2 Japan

| Product | Loop | Display | AI | Retention | Price | Exceptional |
|---|---|---|---|---|---|---|
| **Progate** | Slides, then in-browser editor, along a "Progate Path" | **"イラスト中心のスライドで学ぶ"**: illustrated slides as a middle ground between book and video. Editor, preview and instructions side by side (progate.com, screenshot) | 生成AI入門 (beta, chat with AI in browser). **AI駆動開発 course teaching Claude Code / Codex delegation** | Path with checkpoints, completion certificates, level | Plus ¥990/mo, Pro ¥2,490/mo (progate.com) | Mascot-led friendly illustration. Very low friction. Now teaches Claude Code workflows, which overlaps with Vibe Coding |
| **Schoo** | Live classes plus 9,000+ on-demand | Live streams where viewer comments shape the class | **まなびステップ (β, Feb 2026)**: AI plan from goal and frequency. Class search assistant ([appbank](https://www.appbank.net/2026/02/16/iphone-news/2928569.php)) | Live schedule, community | Personal/Business subscription | Social live learning for working adults |
| **Studyplus** | Log study time per material, timeline SNS | Stopwatch, per-book stats, barcode registration | "Studyplus AI" (3rd-party only, unverified) | **Social accountability**: 10M+ members, 2,800+ school classrooms ([app-liv](https://app-liv.jp/449926/)) | Free/Premium | Logging is the product. This maps to Rise Path's Life Journal |
| **スタディサプリ** | 10-min mini lessons, adaptive problem sets | Short video plus problems | 2026 reportedly AI-adaptive problems, AI speaking trainer (3rd-party, unverified) | School integration | Subscription | Low-cost top teachers. Short units |
| **Udemy JP (Benesse)** | Video courses | Video | **AI Assistant in Japanese since Apr 2025**. **AI Role Play** (537k users by Apr 2026, custom scenarios and avatars) ([Udemy PR](https://about.udemy.com/press-releases/new-udemy-data-shows-individual-ai-adoption-outpaces-organizational-support-in-japan/), [Udemy Business](https://business.udemy.com/?p=162690)) | Certificates | Per course / Business | Scale. 2M+ JP learners |
| **paiza** | Coding problems leading to **rank S–E**, then job matching | Problem, editor, tests | No confirmed 2026 AI features | **Rank as a career credential**. 842 problems, new ones weekly ([paiza](https://paiza.jp/challenges/info)) | Free/paid learning | Skill rank tied to hiring |
| **Monoxer** | Register what to memorize, then auto-generated questions | Drill | **Auto-generates questions, adapts frequency and difficulty to forgetting** ([ASCII](https://weekly.ascii.jp/elem/000/004/010/4010006/)) | Retention dashboards for schools | B2B | "Solve, don't reread" memory design. 3,400+ classrooms |

---

## 2. Cross-cutting patterns (what "good" looks like in 2026)

### 2.1 Lesson display (教材の表示)
1. **One canonical content, many views.** Learn Your Way (Text, Slides+Narration, Audio, Mindmap), NotebookLM Studio, Oboe (about 9 formats), Scrimba Explain (narrated DOM slides). The view switcher sits at the **top centre** with icons. A **Source** tab keeps the original reachable.
2. **Checks inside the reading, not only at the end.** Learn Your Way's margin "?" opens a right-side drawer and **highlights the paragraph it tests** (`lyw_inline_q.png`). Every section ends with a "check your understanding" card with a progress bar (`lyw_scrolled.png`), and the left nav shows "Take quiz to complete".
3. **Left: progress outline. Centre: about 65ch reading column. Right: contextual drawer** (question, tutor, glossary). Rise Path's doc already has a right "On this page" TOC. Make the right rail contextual instead (tutor or question), and move the TOC into the left outline with completion checkboxes.
4. **Restraint in typography.** Brilliant and Oboe use editorial serif headlines, warm off-white backgrounds, one accent colour and generous whitespace. Learn Your Way uses warm peach. Boot.dev commits fully to a dark-fantasy theme. Each is **coherent**. Rise Path today mixes a serif "おかえりなさい" headline, Inter body, purple accent and dark hero cards, plus a long "Design Samples" nav. Pick one system, and keep the RPG skin for P-School only.
5. **Explorable interactives over static images** (Brilliant widgets, Progate's live preview, Scrimba's editable video).
6. **Short units.** Duolingo 3–5 min, Brilliant 15 min/day, スタディサプリ 10-min lessons, Progate slides. Rise Path chapters say "15 min read" of continuous prose. Split them into sections of 3–5 minutes, each with a check.

### 2.2 AI tutor UX
- **Socratic by default, with a "show me" escape hatch** (all majors). Bastani shows why: unguarded help acts as a crutch.
- **Grounded and context-aware.** The tutor knows the current block, the learner's last answer, and their code or blocks. NotebookLM is source-grounded with citations. Koji sees the canvas.
- **Persona-consistent.** Boots (wizard), Koji (green blob), Lily (Duolingo), Progate ninja. Rise Path has characters (Lumina, Rise Path) and Kokoro voices. Make the tutor in-lesson *be* one of those characters.
- **Feedback after, not during, for conversation practice.** Duolingo Video Call: "focus on communication, not correction", with feedback at the end. Applies to Rise Path's English for engineers path.
- **Mistakes become material.** Speak "Made for You", Koji gap plans, Quizlet Learn, Monoxer.

### 2.3 Retention
- **Streak with forgiveness** (freeze, weekend), a **daily goal measured in minutes**, and **review due today**. These have evidence behind them.
- **Levels and mastery** (paiza rank, Brilliant mastery, Khan mastery). Levels have evidence in programming. Points, badges and leaderboards alone do not.
- **Accountability and social**: Studyplus logs, Schoo live, Boot.dev guilds.
- **Weekly report to self or parent** (Brilliant, Synthesis, Khanmigo).

### 2.4 Authoring and distribution
- AI is an **author's assistant plus QA** (Duolingo "create and validate", Oboe audit agents, Synthesis human-designed). Fully generated content gets credibility pushback.
- **Assistant-native distribution**: Apps in ChatGPT (Coursera, Quizlet), Claude connectors (Canvas LTI, Panopto, Wiley), **MCP Apps** (`ui://` HTML views with mime `text/html;profile=mcp-app`, sandboxed iframes, tools reference via `_meta.ui.resourceUri`; reference SDK `@modelcontextprotocol/ext-apps`).
- **Agent Skills (SKILL.md)** became a cross-tool open standard in 2025–26 (Claude Code, Codex CLI, Gemini CLI, Copilot, Cursor; [overview](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/), 3rd-party). A Rise Path "lesson-author" skill would work in all of them.
- **Progate now teaches "AI駆動開発" with Claude Code / Codex.** Rise Path's Vibe Coding is in a contested space, so its story-driven angle has to be the reason to choose it.

---

## 3. Evidence base (use in product decisions)

| Claim | Evidence | Implication |
|---|---|---|
| Unguarded AI help harms learning | Bastani et al., PNAS 2025: GPT Base −17% on exam vs control; GPT Tutor about 0 ([SSRN](https://papers.ssrn.com/abstract=4895486)) | Hint ladder by default. "Show answer" only after an attempt |
| Pedagogy-prompted tutors can beat class | Kestin et al., Sci. Rep. 2025: about 2× gains, median 49 min ([summary](https://michellemillerphd.substack.com/p/r3-37-july-15-2025-how-do-tutoring)) | Write pedagogy into the tutor prompt and the sequencing, not just the persona |
| Retrieval and spacing are the strongest techniques | Dunlosky 2013 ([APS](https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html)) | Inline checks, plus an SRS review queue |
| Multi-representation plus embedded questions improves recall | Learn Your Way +11 pp ([Google](https://blog.google/outreach-initiatives/education/learn-your-way/)) | Doc / Slides+Narration / Audio / Mindmap from one block set |
| Learning-style matching is unsupported | Pashler 2008 ([USF](https://digitalcommons.usf.edu/psy_facpub/1765/)) | Big5 drives tone and pacing, not format. Learner chooses the format |
| Levels help. Badges, points and leaderboards don't (programming) | Multi-level meta-analysis ([ISCTE](https://ciencia.iscte-iul.pt/publications/using-game-concepts-to-improve-programming-learning-a-multi-level-meta-analysis/95533?lang=en)) | Keep the P-School stage/level progression. Drop the decorative XP |
| Streak forgiveness raises return | Duolingo A/B ([blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit)) | Streak with a freeze. No guilt mechanics |

---

## 4. Rise Path vs. the field

Current Rise Path facts, from the repo and sibling audits:
- Lesson views: Doc / Slide / Quiz tabs (`VibeDocView`). Block types: text, image, code, list, callout, mermaid, table, mindmap (`types.ts:345-383`). Quiz is single-choice only (`types.ts:387-404`).
- Floating "learning-coach" chat with no lesson context by default (`components/common/FloatingChatbot.tsx:100-107`). External context arrives only via an `open-rise-path-chat` event (`:163-172`).
- MCP server with 19 tools including `get-generation-kit`, `validate-intake`, `save-curriculum-draft`, `learner-adaptation-signals`, `learner-memory-*`, `request-tts`, `daily-life-*` (`mcp-server/tool-registry.json`). Draft input is a schemaless passthrough (`mcp-server/index.js:388-389`).
- Big5 assessment (`components/features/dashboard/assessment/PersonalityAssessment.tsx`). Life Journal with streak widget (`components/features/life-journal/LifeJournalWeeklyWidget.tsx`). P-School Blockly and Phaser RPG (`components/features/PSchool/`).
- No SRS or review queue. Course generator UI exposes "2.5-FLASH" as "CURRENT ENGINE" (screenshot `jp/course-generator.png`; `CourseGeneratorView.tsx:18`). References to non-existent `gemini-3.0-pro` (`services/geminiService.ts:101,150`).
- Fake progress and stats, a visible "Design Samples" nav group (`Layout.tsx:121,186-194`), and broken images (see `features.md` §0).

### (a) Table-stakes features Rise Path lacks

1. **Inline retrieval checks inside the reading** (margin "?" to a drawer question that highlights its paragraph). **Section completion gated by a check.** Multiple question types: MCQ, multi-select, fill-in, order-steps, short answer graded by LLM against a rubric, code/block output check. *Competitors:* Learn Your Way, Brilliant, Khan, Codecademy.
2. **Spaced-repetition review queue.** Cards auto-derived from lesson key points and missed questions, an FSRS-style schedule, "Review (n due)" on the dashboard, and "Got it / Missed it" that persists. *Competitors:* NotebookLM, Quizlet, Oboe, Monoxer, Koji.
3. **Lesson-aware Socratic tutor in the right rail**, not a generic floating bubble. It receives the lesson id, current block, the learner's last answer and code. It uses a hint ladder (nudge, then hint, then worked step, then answer only after an attempt). Every claim cites a block. *Competitors:* Khanmigo, Koji, Boots, Coursera Coach, NotebookLM Learning Guide.
4. **Real, honest progress model.** Per-section completion, mastery per concept, a "continue where you left off" that is real, and a weekly report. Remove all fabricated numbers. *Competitors:* all.
5. **Audio and narrated-slides view from the same blocks** (Kokoro TTS is already in the stack). Two modes: narrated slides (Scrimba Explain / Learn Your Way) and a hands-free audio lesson (NotebookLM, Oboe). Generate at publish time, never at read time.
6. **Mindmap / outline view** of the lesson (NotebookLM, Learn Your Way). The `mindmap` block exists already. Auto-derive one per lesson from section headings and key points.
7. **Short-unit structure** (3–5 min sections) with an estimated time and a daily goal in minutes (Duolingo, Brilliant, スタディサプリ).
8. **Streak with forgiveness** (freeze or weekend) tied to *learning or review done*, not page views. One place, honest.
9. **Mobile-first reading layout.** Every leader is mobile-native. Rise Path is broken at 390 px (`features.md` §0.2).
10. **Interest-based personalization of examples** ("Interest: games · Level: beginner" pill, as in Learn Your Way), editable per lesson.
11. **Shareable lesson links and "Source" provenance** (Oboe share, Learn Your Way Source tab, NotebookLM citations).
12. **Model choice hidden from learners.** No "2.5-FLASH" engine badge. Competitors never show model names to learners.

### (b) Differentiators Rise Path could own

1. **"Author with Claude Code, learn anywhere" (the strongest moat).** Nobody in consumer edtech offers a first-class *authoring* pipeline for agentic coding tools. Proposed shape:
   - Publish an **Agent Skill** (`skills/risepath-lesson-author/SKILL.md`) plus a JSON Schema (`risepath.lesson/v1`, already proposed in `code-content.md` §8) plus a `validate` and pedagogy-lint CLI. Claude Code (or Codex or Gemini CLI) drafts lessons into the repo, runs lint (objectives present, one check per section, reading level, alt text, JP/EN parity) and opens a preview route.
   - MCP tools with **real schemas**: `lesson.create/patch/validate/preview/publish`, `quiz.generate_from_block`, `tts.render`. Replace the passthrough.
   - **MCP Apps `ui://` views** so a Rise Path lesson card, quiz or P-School stage **renders inside Claude and ChatGPT**. That is the same distribution Coursera and Quizlet won inside ChatGPT, but on the open standard.
   - "Learn while you build" mode: pair with Claude Code's **Learning output style** (`TODO(human)`). Rise Path lessons can emit "now implement this in your repo" steps, and the learner's Claude Code session reports completion back via `learner-state-update`.
2. **Story-driven "Vibe" curriculum as narrative scaffolding.** Narrative gamification is the direction the literature points ([AWorld summary](https://www.aworld.org/blog/gamification-engagement/narrative-gamification-why-badges-and-leaderboards-are-no-longer-enough/)). Progate teaches the same topics (AI駆動開発) without story. Make chapters short, with a story beat, a concept, an inline check and a mission in Claude Code. The story is the reason to choose Rise Path over Progate.
3. **P-School as Rise Path's "Brilliant widget".** Block-coding battles are explorable, and *levels/stages are the one game element with evidence in programming learning*. Embed mini P-School puzzles as a lesson **block type** (`sandbox:pschool`) inside normal lessons, not only as a separate destination. Give it the Boot.dev treatment: one coherent RPG identity (tutor persona, stage map, boss = chapter test).
4. **Character tutors with voice** (Lumina / Rise Path persona plus Kokoro JP/EN voices). This is Duolingo-Lily-level charm, but grounded and Socratic like Boots. Use post-conversation feedback for English practice (Duolingo pattern) and Role Play scenarios (Coursera and Udemy show demand in JP enterprise).
5. **Life Journal plus learning, as the "Studyplus with a coach" angle.** Studyplus proves Japanese learners value logging (10M members). Rise Path can correlate sleep, focus and mood with learning sessions, then suggest timing ("you retain best after 7 h sleep, so schedule review tomorrow morning"). Keep it opt-in and non-medical, as the existing disclaimer already does.
6. **Big5, reframed honestly.** Use it for *tutor tone* (encouraging vs. direct), *goal-setting and pacing* (conscientiousness → plan granularity; neuroticism → softer error framing, smaller steps) and *nudge timing*. Do **not** claim format matching. Let the learner choose Doc / Slides / Audio freely, and pair that with interest-based examples.
7. **Trilingual JP/EN/FR with true parity.** Most JP players are JP-only and most global ones are EN-first. Content stored once with sidecar translations (`code-content.md` §8.1.4) makes this cheap.

### (c) Low-value features Rise Path should cut or demote

| Cut | Why (competitor and evidence signal) | Where |
|---|---|---|
| Fabricated stats, XP, level-13 animation, momentum chart, "¥4,500 earnings", fake agent logs | Trust killer. No leader fakes metrics. Points and badges show no learning effect anyway | `MissionControlDashboard.tsx`, `MyContent.tsx:116-140,194-195` (see `features.md` §0.3) |
| "Design Samples" nav group, admin "管理" toggle, localhost fields, test pages | Dev leftovers. Every competitor ships one focused nav | `Layout.tsx:121,186-194`, `LearningHub.tsx:419-429` |
| Engine and model picker shown to learners ("2.5-FLASH") | No competitor exposes this. Route models on the server | `CourseGeneratorView.tsx:18`, screenshot `jp/course-generator.png` |
| Read-time AI image generation | Non-deterministic, costly. Oboe deliberately uses *real* images | `GeneratedDocView.tsx:1352-1392` (per `code-content.md`) |
| "One-click whole course from a prompt" as the hero feature | Commoditized (Oboe, Gemini, ChatGPT, NotebookLM all do it free). Quality concerns (Duolingo backlash). Keep it as "draft, review, publish" for authors | `CourseGeneratorView`, demo mode in `curriculumApi.ts:2751-2790` |
| Generic floating chatbot on every page | Replace with the lesson-anchored tutor rail. Keep one global "ask" entry at most | `FloatingChatbot.tsx` |
| Leaderboards, badges walls, "earnings" creator economy | Weak evidence, distracting for adult learners (Boot.dev reviews) | — |
| Per-page duplicate language toggles | One global setting, as all competitors do | Vibe, Unity, Art views (`features.md` §0.6) |
| Breadth without depth (Art, Sonic, AIDJ, Unity, Blender, Programming, English all half-done) | Brilliant, Boot.dev and Progate each win by depth in a narrow domain. Pick 2–3 flagship paths (Vibe Coding plus P-School, Gen-AI app dev, plus one creative path) and hide the rest behind "Labs" | Learning Hub |
| 1.2 GB Blender manual and client-side 11 MB RAG JSONL | Move to server-side retrieval like NotebookLM's grounding | `services/blenderRagService.ts:27` |

---

## 5. Recommended lesson-display spec ("Lesson Reader v2"), synthesized from the field

Layout (desktop ≥1280):
- **Top bar**: back · course › chapter · **view switcher (Read · Slides ▶ · Listen 🎧 · Map)** centred with icons (Learn Your Way) · personalization pill "Interest: games · Level: beginner" (editable) · time left.
- **Left rail (240 px)**: section outline with checkboxes, "✓ check to complete" chips, and the "Review due (n)" link.
- **Centre column (max about 68ch, 18 px JP / 17 px EN body, 1.8 line-height for JP)**: story beat (Vibe), concept text, diagram, analogy callout, then a **margin "?"** next to key paragraphs, then the section-end check card with a progress bar.
- **Right drawer (380 px, slides in)**: question, tutor chat scoped to the highlighted block, or glossary. The paragraph being asked about is highlighted (Learn Your Way pattern).
- **Mobile**: single column. The switcher becomes a segmented control. The drawer becomes a bottom sheet. Sticky "Next" and "Ask" buttons.

Tutor behaviour: Socratic hint ladder. It cites the block id it is using. "Show answer" unlocks after one attempt. Missed questions go automatically into the SRS queue. Persona is the chosen character with an optional Kokoro voice.

Visual system: one neutral warm off-white surface, one accent (keep Rise Path purple), editorial serif for H1 only, Noto Sans JP / Inter for body, and **real illustrations** in place of dead Unsplash stock. The RPG skin (Boot.dev-level commitment) belongs to P-School only.

---

## 6. Sources (all accessed Oct 2026)

First-party / primary:
- Google Learn Your Way blog — https://blog.google/outreach-initiatives/education/learn-your-way/ ; live site https://learnyourway.withgoogle.com/ ; tech report https://arxiv.org/abs/2509.13348
- Gemini Guided Learning — https://blog.google/products/gemini/guided-learning-google-gemini/
- NotebookLM 2026 updates — https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html ; rename — https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/
- NotebookLM student features — https://blog.google/technology/google-labs/notebooklm-student-features/
- Claude Code output styles — https://code.claude.com/docs/en/output-styles
- Anthropic Claude for Education — https://anthropic.com/news/advancing-claude-for-education
- MCP Apps SEP-1865 — https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- Khanmigo — https://www.khanmigo.ai/
- Boot.dev — https://www.boot.dev/
- Brilliant — https://brilliant.org/ (Koji section, screenshot)
- Oboe — https://oboe.com/
- Synthesis Tutor — https://www.synthesis.com/tutor
- Progate — https://progate.com/
- Scrimba Explain docs — https://docs.scrimba.com/explain/introduction
- Duolingo streak research — https://blog.duolingo.com/how-duolingo-streak-builds-habit ; https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals
- Duolingo Max — https://blog.duolingo.com/duolingo-max ; Q2-2026 — https://duolingo.gcs-web.com/news-releases/news-release-details/duolingo-announce-second-quarter-2026-results-wednesday-august-5
- Coursera × OpenAI — https://www.businesswire.com/news/home/20251006989293/en ; Coach — https://blog.coursera.org/announcing-ai-powered-capabilities-enabling-educators-to-use-coursera-coach-to-deliver-interactive-personalized-instruction
- Udemy JP — https://about.udemy.com/press-releases/new-udemy-data-shows-individual-ai-adoption-outpaces-organizational-support-in-japan/
- paiza — https://paiza.jp/challenges/info

Research:
- Bastani et al. PNAS 2025 — https://papers.ssrn.com/abstract=4895486 ; https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education
- Kestin et al. Sci. Rep. 2025 — https://michellemillerphd.substack.com/p/r3-37-july-15-2025-how-do-tutoring
- Dunlosky et al. 2013 — https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html
- Pashler et al. 2008 — https://digitalcommons.usf.edu/psy_facpub/1765/
- Gamification in programming meta-analysis — https://ciencia.iscte-iul.pt/publications/using-game-concepts-to-improve-programming-learning-a-multi-level-meta-analysis/95533?lang=en

Secondary / 3rd-party (pricing and feature claims, lower confidence):
- https://nibble-app.com/blog/is-duolingo-max-worth-it ; https://www.kidsaitools.com/en/articles/khanmigo-review-2026 ; https://skillscouter.com/brilliant-review-math-science-coding/ ; https://www.maginative.com/article/learn-your-way-googles-new-ai-transforms-static-textbooks-into-interactive-personalized-lessons/ ; https://www.infoq.com/news/2025/08/study-mode-chatgpt ; https://promptoptimizer.tools/blog/chatgpt-quiz-me-feature-how-to-use ; https://engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html ; https://gulfbusiness.com/en/2026/interviews/coursera-ceo-greg-hart-on-ai-and-learning-trends/ ; https://www.producthunt.com/p/scrimba/scrimba-explain-instant-video-tutorials-about-anything-beta ; https://tooldirectory.ai/tools/boot-dev ; https://coddy.tech/vs/fr/boot-dev ; https://subger.com/en/service/codecademy ; https://www.apkmirror.com/apk/mimohello-gmbh/mimo-learn-to-code/mimo-learn-coding-programming-7-0-release/ ; https://homebrew.co/blog/2025/09/10/oboe-fyi-launches-because-ai-should-help-you-learn-not-become-a-substitute-for-learning ; https://every.to/podcast/transcript-why-your-ai-learning-projects-keep-fizzling-out ; https://recurdash.com/subscription-pricing/speak ; https://languatalk.com/blog/speak-app-review/ ; https://nibble-app.com/blog/quizlet-review ; https://www.streetinsider.com/PRNewswire/Quizlet+Launches+as+Native+App+in+ChatGPT+to+Transform+AI-Powered+Learning/26142955.html ; https://www.appbank.net/2026/02/16/iphone-news/2928569.php ; https://app-liv.jp/449926/ ; https://app-tatsujin.com/study-supple-2026-features-success/ ; https://weekly.ascii.jp/elem/000/004/010/4010006/ ; https://www.maginative.com/article/duolingo-introduces-148-new-language-courses-built-with-ai/ ; https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/ ; https://www.aworld.org/blog/gamification-engagement/narrative-gamification-why-badges-and-leaderboards-are-no-longer-enough/
