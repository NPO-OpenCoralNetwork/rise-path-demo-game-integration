# Rise Path: feature inventory and pruning analysis (key: `features`)

Repo: `/home/user/rise-path-demo-game-integration` (branch `claude/gracious-edison-7cl4fe`, 1 commit, last 2026-07-03).
Method: read `App.tsx`, `components/routes/lazyRoutes.tsx`, `components/common/Layout.tsx`, every feature folder, and the services. Ran Playwright against the dev server (localhost:3007, guest, JP and EN) to click through the navigation, find broken images and record network failures. Checked 147 hard-coded external image URLs with curl. Measured tracked asset sizes with `git ls-files | du`.

New evidence screenshots are in `<session-scratchpad>/shots-before/extra/features/`. That folder has 43 per-route PNGs plus contact sheets in `sheets/sheet1..9.png` and `sheets/mobile.png`. Helper scripts: `<session-scratchpad>/navtest.mjs` (click test), `<session-scratchpad>/brokenimg.mjs` (broken-image scan), `<session-scratchpad>/ext_status.txt` (HTTP status of every external image).

---

## 0. Headline findings (read this first)

1. **Most of the hand-made course content cannot be reached from the UI.** Navigation goes through a `ViewState` enum and a big `switch` in `App.tsx:200-279`. Any value missing from that switch falls into `default`, which calls `navigate('/')` and drops the user on the Dashboard. I confirmed these with Playwright clicks:
   - All 7 "Design Samples" sidebar items (`DEMO_*`, `Layout.tsx:186-194`) go to `/`.
   - Vibe Coding: clicking any chapter on `/vibe` goes to `/` (`VibePathView.tsx:372` emits `VIBE_CHAPTER_N`). The prologue CTA does the same (`VibePrologueView.tsx:241`).
   - Unity: chapter cards go to `/` (`UnityPathView.tsx:105,234` emits `UNITY_CHAPTER_N`).
   - Blender: project cards go to `/` (`BlenderCurriculum.tsx:126` emits `BLENDER_PATH`). Because of this, `/blender/path` and `/blender/lesson/:id` are reachable only by typing the URL.
   - Programming: "React Ecosystem Mastery" goes to `/` (`PROGRAMMING_PATH`, `ProgrammingCurriculum.tsx:226`). The 6 AI-track cards (ids 101-106) have no click handler at all (`ProgrammingCurriculum.tsx:225-231`).
   - Learning Hub: the "Teacher Bot Live" card goes to `/` (`LearningHub.tsx:267`, `TEACHER_BOT_LIVE`).
   - My Content: `GENERATED_COURSE_PATH` (`MyContent.tsx:181`) goes to `/`.

   The chapter routes themselves work: `/vibe/chapter-1`, `/unity/chapter-0` and `/blender/lesson/1` all render. Only the links are broken.
2. **The mobile layout is broken on every page.** In `Layout.tsx:280-284` the `<aside>` className has `fixed md:relative …` followed later by a bare `relative`. The bare `relative` wins on mobile, so the off-canvas sidebar still takes up the flex row. At 390px the main content gets about 120px (see `sheets/mobile.png`: one-character-wide columns).
3. **Fake data looks like real data.** Examples: "今週 2.5h", "Vibe Coding: The Engine, 第3章は75%完了", the quest board, the AI Coach cards, the Smart Schedule, the Momentum chart `[12,18,15,25,20,8,30]`, "Weekly goal 75%", and the level pill that animates to level 13 (`MissionControlDashboard.tsx:93-330, 342, 395, 527, 551, 677, 773`). Also "Total Earnings ¥4,500" (`MyContent.tsx:194-195`), fake "Gemini 3 Pro / Nano Banana Pro / Kokoro" generation logs on a timer (`MyContent.tsx:116-140`), hard-coded track progress (Vibe 75% plus "Done" on chapters 0-10, `VibePathView.tsx:219,327,332`; HTML/CSS 40%, `HtmlCssPathView.tsx:145,150`), and Unity showing "0%" next to chapters marked "Done" (`UnityPathView.tsx:104,189`).
4. **Dev leftovers are visible to users.** The main nav has an expanded-by-default "Design Samples / デザインサンプル" group (`Layout.tsx:50,121,182-195`). The Learning Hub has a "管理/Manage" admin toggle that is not gated by role (`LearningHub.tsx:419-429`; `hooks/useUserRole.ts` exists but is unused there). Teacher Bot Live shows a localhost base-URL field. `public/debug/blender_install_setup_sample.html` is served. `/demo/checklist-gen` says it is a "テストページ".
5. **Many images are broken.** 40 of about 140 unique external image URLs return 404/400: dead Unsplash IDs, and Wikimedia `800px-` thumbs that now return 400. The worst files are `ArtCraftsView.tsx` (8 of 8 broken), `VibePathView.tsx` (6), `ArtTribalDetailView.tsx` (6), `ArtMuseumView.tsx`, `ArtCraftDetailView.tsx`, `data/curricula/blender/courseData.ts` (5 each), `ArtPeriodDetailView.tsx` and `ArtCurriculumView.tsx` (4 each). The Unity card on the Learning Hub shows its alt text "Unity AI Game Dev". The Art "Museum Hall" hero is broken.
6. **The i18n is incomplete.** With JP selected, the Vibe Coding chapters render in English: the `VibeChapter*View` wrappers never pass `language` to `VibeDocView`, which falls back to `'en'` (`VibeChapterOneView.tsx:19-26`, `VibeDocView.tsx:41`), even though the chapter data contains full JP. FR exists only in the global toggle. `LanguageContext.tsx:27` maps `fr` to `en`, and only 4 assessment components have FR copy. Feature pages have their own EN/JP-only toggles (Vibe, Unity, Art, VibeDocView) that duplicate the sidebar switch.
7. **The repo carries about 1.6 GB of tracked files.** The full Blender manual HTML is 1.2 GB / 5,243 files (`data/curricula/blender/blender_manual_v500_en.html/`) and is only an input to build scripts. Another 244 MB of the same images is copied into `public/data/curricula/blender/_images`. The browser downloads an 8 MB + 3 MB JSONL for client-side RAG (`services/blenderRagService.ts:27`, `blenderImageRagService.ts:84`). 67 MB of uncompressed WAV narration sits in `public/vice`.

---

## 1. Route inventory (App.tsx + lazyRoutes)

Maturity levels: **P** = polished, **H** = half-done, **Ph** = placeholder/mock, **D** = dev-only. "Reach" says how a user can get to the page: nav = sidebar, link = in-app link, URL = only by typing the address, broken = in-app link exists but goes to `/`.

| Route | Component | Purpose | Maturity | Reach | Overlaps | Rec |
|---|---|---|---|---|---|---|
| `/` | `MissionControlDashboard` (via `Dashboard.tsx` re-export) | Home | H (real XP/streak/name, everything else fake) | nav | LifeJournalWeeklyWidget, LearningInsightsWidget | KEEP, rebuild around real data only |
| `/learning-hub` | `LearningHub` | Portal grid of 9 hand-made tracks (DB-backed with fallback) | P visually, 2 bad links | dashboard quick action only. The sidebar "Learning Hub" item goes to `/courses` instead | `/courses`, `/profile/generated` | MERGE into one "Library/Explore" |
| `/courses` | `CourseList` | Search/filter over 16 demo "generated" courses (`curriculumApi.ts` DEMO_DATA) | P | nav ("Learning Hub / 学習コンテンツ") | `/learning-hub`, `/profile/generated` (same 16 cards) | MERGE |
| `/course/:courseId` | `CoursePathViewWrapper` → `CoursePathView` | Static English-course path ("Survival English for Travel") | Ph, a leftover from the "Master English with AI" template | URL only (`handleCourseSelect` never receives static ids now) | generated course view | CUT |
| `/lesson/:courseId` | `LessonViewWrapper` → `common/LessonView` | English writing lesson "At the Airport" (EN only, no i18n) | Ph | URL only (plus the sessionStorage `ViewState.LESSON` heuristic, `App.tsx:223-235`) | GeneratedDocView | CUT |
| `/my-content` | `MyContent` | "My Content Library": fake chat-to-generate, fake earnings | Ph (all setTimeout simulation, no API, no i18n) | nav (Account › My Content) | `/course-generator` (the real one) | CUT, replace with "My courses" in Library |
| `/generated-course/:id` | `GeneratedCourseViewWrapper` → `GeneratedCourseView` | Course overview for an AI-generated curriculum | P | link from `/courses` | — | KEEP |
| `/generated-lesson/:id` | `GeneratedLessonViewWrapper` → `GeneratedDocView` (1,779 LOC) | **Main AI-material reader**: Doc / Slide / Quiz, TOC, glossary, mermaid, mind map, images, TTS slides | P (best UI in the app) | link | `VibeDocView` (772 LOC, a near-fork) | KEEP as THE lesson reader |
| `/generated-course/:id/encyclopedia` | `EncyclopediaView` | Glossary/encyclopedia per course | H (API returns 503 with no DB) | link from course view | GlossaryText | KEEP; fold into the reader as a side panel |
| `/course-generator` | `CourseGeneratorView` | Real AI generator chat (`sendAiChat/sendAiDecision/uploadFile/fetchAiDrafts`) | H-P. Labels: "Back to Library" actually goes to `/`; shows a "2.5-FLASH" engine label; demo prompt buttons have JP-only labels | nav | MyContent (fake), FloatingChatbot | KEEP as "Create" |
| `/assessment` | `PersonalAssessmentView` | Big Five learning diagnosis (Gemini) | P | nav | `/profile/diagnosis`, `/profile/mirror`, `/characters` | KEEP, MERGE result pages |
| `/life-journal` (+ `/chat`, `/insights`, `/monthly`) | life-journal/* | Mood/sleep/exercise journal plus correlations plus habit chat | P-H (real backend, but EN strings leak: "Keep logging — correlations unlock after 7 logged days." from `tools/core/lifeJournalAnalysis.js:387`; "AI can make mistakes…" from `ChatInterface.tsx:120`) | nav | FloatingChatbot, dashboard widget, AI memory | KEEP behind a flag, or reposition as "Reflect" |
| `/profile` | `ProfilePassport` | Student ID card | H (stock Unsplash avatar fallback, `ProfilePassport.tsx:73`) | nav | ProfileEdit | KEEP (merge sub-pages into tabs) |
| `/profile/diagnosis` | `ProfileDiagnosisView` | Stored diagnosis result | P (empty state) | nav | `/assessment` results, `/profile/mirror` | MERGE |
| `/profile/history` | `ProfileHistoryView` | Activity timeline | H (empty) | nav | dashboard | MERGE into profile tabs |
| `/profile/badges` | `ProfileBadgesView` | Badges | H | nav | dashboard badges, P-School achievements | MERGE |
| `/profile/generated` | `ProfileGeneratedView` | "Generated" content: currently the same 16 demo catalog courses as `/courses` | H/duplicate | nav | `/courses` | CUT (becomes the "My courses" filter) |
| `/profile/edit` | `ProfileEditView` | Name/avatar (6 Unsplash stock faces, `ProfileEditView.tsx:13-18`) | H | link | — | KEEP (use generated/initial avatars) |
| `/profile/mirror` | `LearningMirrorView` | "Learning mirror" (diagnosis summary) | H | link from passport | `/profile/diagnosis` | MERGE |
| `/settings` (+ `/voice`, `/voice/dialogue`, `/api-key`, `/privacy`, `/ai-memory`) | settings/* | Real settings: TTS voices, BYO Gemini key, journal privacy, AI memory | P | nav | — | KEEP (make API key provider-agnostic: Claude/OpenAI/Gemini) |
| `/notifications` | `NotificationsView` | localStorage notifications plus `seedDemoNotifications` | H | link | — | KEEP, minimal; drop the seed |
| `/subscription` | `SubscriptionView` | Free/Pro ¥980/Premium ¥1,980, buttons "近日公開" | Ph | link from passport | — | HIDE until billing exists |
| `/library` | `common/Library` | "Template Library: clearer, safer, more logical English" phrase templates | Ph (English-app leftover) | URL only | — | CUT |
| `/characters`, `/character/:id` | `AICharacterIntroView` / `AICharacterDetailView` | 5 Big-Five "AI Partners" (Spark, Focus, Vibe…) | P visually. "Chat with X" actually opens AI Diagnosis (`AICharacterIntroView.tsx:237-243`); dynamic Tailwind classes `hover:border-${…}` are never generated | nav (under "Documents") | assessment results (`CharacterRevealPanel`), FloatingChatbot persona "ルミナ" | MERGE into the diagnosis result ("your type") and/or the coach persona picker |
| `/blender` | `BlenderCurriculum` | Blender hub (5 projects) | P visual, links broken | Learning Hub | — | KEEP, fix nav |
| `/blender/path` | `BlenderPathView` | Stage path | P | broken (URL only) | — | KEEP |
| `/blender/lesson/:stageId` | `BlenderLessonView` (599 LOC) | Stage lesson (steps, shortcut chips, "Reference_Ref.zip 3.4MB" fake asset at `:574`) | H-P | URL only | GeneratedDocView, multi-format BlenderViewport block | MERGE into the unified reader as a "Blender stage" template |
| `/blender/teacher-bot` | `TeacherBotLiveView` | Live sidecar view for a Blender add-on (base URL `localhost:3006`, session ID) | D | broken | — | HIDE (dev flag) |
| `/programming`, `/programming/web`, `/programming/ai` | `ProgrammingCurriculum` | Web / AI track hubs | H (AI track: 6 dead cards; "Cmd + K… (coming soon)" at `:202`) | Learning Hub | Learning Hub | KEEP the web track only; CUT the AI-track cards or point them at generated courses |
| `/programming/python` | `PythonBeginnerView` | Notebook-style Python | Ph ("Run Cell" uses setTimeout plus canned output, `:94-107`) | URL only | GeneratedDocView code blocks | CUT, or rebuild with Pyodide |
| `/programming/path` | `ProgrammingCourseView` | "React Ecosystem Mastery" fake git-commit syllabus | Ph | broken | — | CUT |
| `/programming/html-css`, `/course`, `/part2` | HtmlCss* | Interactive HTML/CSS lessons with a **real iframe preview** | P (best interactive exercise) | link | — | KEEP; extract the editor as a reusable "code playground" block |
| `/programming/web-inspector` | `WebInspectorView` | "Inspector Mode" tour (EN only) | H | link | — | HIDE |
| `/vibe` | `VibePathView` | Vibe Coding track overview | P visual, fake progress, dead chapter links, 6 broken images | Learning Hub | — | KEEP, fix |
| `/vibe/prologue`, `/vibe/chapter-0..11` | `VibePrologueView`, `VibeChapter*View` (11 near-identical 22-line wrappers) → `VibeDocView` | **Best hand-made 教材** (12 bilingual chapters in `data/curricula/vibe_coding/*.ts`) | P content, but renders EN only. Slide tab on ch1 fails ("Failed to load PDF": `.gitignore` has `*.pdf`, `/slides/chapter1.pdf` is not shipped). Header says "Chapter 1" on every chapter (`VibeDocView.tsx:218`) | broken (URL only) | GeneratedDocView | KEEP the content; MERGE the renderer into the unified reader; replace the 12 wrappers with `/vibe/:chapterId` |
| `/unity`, `/unity/:chapterId` | `UnityPathView`, `UnityChapterView` | Unity × AI (4 chapters) | P-H (hero image broken, 0% next to "Done") | Learning Hub; chapters broken | GeneratedDocView | KEEP, fix |
| `/art` + 9 sub-routes | art/* (10 bespoke views) | "Rise Path Atelier": art history, crafts (kintsugi, urushi…), tribal art | P visual design (strongest art direction in the repo) but heavily broken images (crafts 8/8), fake top nav "Exhibitions / Artists / Magazine" (`ArtMuseumView.tsx:49`), fixed headers overlap the sidebar logo | Learning Hub | GeneratedDocView (`demo-art-001`, `demo-kintsugi-001` duplicate the same topics) | KEEP as a showcase track; self-host images; long term, port to the reader with an "editorial/dark" theme |
| `/sonic`, `/sonic/synth` | Sonic Lab | Audio-engineering lab with a working oscillator/filter synth | H (synth works; the 4 other "labs" all open the same synth) | no link anywhere | — | HIDE (or CUT) |
| `/p-school` | `PSchoolView` + Phaser + scratch-blocks (~15k LOC JS) | Block-coding RPG "The Legacy of Technology" | P (works, but a black screen for 2-8 s with no loader; its own Supabase client, XP/level/gold, Discord button, settings) | Learning Hub | app gamification | KEEP as a flagship "game" track; unify XP; add a loader |
| `/aidj` | `AidjCurriculumView` | AI-DJ streaming course landing (MCP code samples, Suno) | H (EN/JP mixed, no i18n). Rendered **outside Layout and outside auth** (`App.tsx:330,342-347`); declared twice (`:345`, `:353`) | no link | generated course `AIDJ_DEMO_DATA` | HIDE, or convert to a generated course |
| `/demo/multi` | `MultiFormatLessonView` | Block showcase: Checklist, Concept, Dialogue, Workshop, Blender viewport, Reflection | H (mock blocks, but these are good interactive block types) | none (Design Samples links are broken) | GeneratedDocView | MERGE the blocks into the unified reader's block library; CUT the route |
| `/demo/checklist-gen` | `BlenderChecklistGeneratorView` | Image-RAG checklist generator test | D | none | — | CUT the route (keep the service if used by the generator) |
| `/auth/callback`, `/auth/confirm-pending` | auth views | Supabase auth | P | auth flow | — | KEEP |
| (logged out) | `ExperienceLandingView`, `ExperienceLoginView` | Landing + login | P visual; overclaims ("Neuro-Adaptive Learning Engine v2.0", "millisecond-by-millisecond"); "Watch Demo" button has no handler (`ExperienceLandingView.tsx:189`) | — | — | KEEP, rewrite the copy honestly |
| `*` | Navigate to `/` | — | — | — | — | OK |

Also wrong in routing/nav state:
- `getCurrentViewState` (`App.tsx:160-198`) has no mapping for `/p-school`, `/course`, `/lesson`, `/demo`, `/aidj`, so the sidebar highlights "Dashboard" on those pages (visible on the P-School screenshot).
- `isNavItemActive` treats `LEARNING_HUB` as the parent of the track pages (`Layout.tsx:225-235`), but the nav item is `COURSES`. On `/learning-hub`, `/vibe`, `/art`, `/blender` and similar pages nothing is highlighted.

## 2. Sidebar nav inventory (`components/common/Layout.tsx`)

| Item | Target | State | Rec |
|---|---|---|---|
| Dashboard / ダッシュボード | `/` | works | KEEP ("Home / ホーム") |
| Learning Hub / 学習コンテンツ | `/courses` (not `/learning-hub`, which uses the same JP title 学習コンテンツ) | naming collision | KEEP as "Library / ライブラリ" (merged) |
| AI Learning Diagnosis / AI学習診断 | `/assessment` | works | MOVE under Profile ("My learning type") |
| Life Journal / ライフジャーナル | `/life-journal` | works | KEEP (flag) as "Reflect / ふりかえり" |
| AI Course Generator / AIカリキュラム生成 | `/course-generator` | works (the dashboard calls it "AIコース生成") | KEEP as "Create / つくる" |
| **Design Samples / デザインサンプル** (7 children, expanded by default) | `DEMO_*` → all go to `/` | dead + dev-only | **CUT** |
| Documents / ドキュメント › AI Characters | `/characters` | works, but the group name is misleading | MERGE into Profile/Coach |
| Account / アカウント › Student Card, AI Diagnosis, History, Badges, Generated, My Content | profile routes | 6 thin pages; My Content and Generated are fake/duplicates | MERGE into one tabbed Profile |
| Settings / 設定 | `/settings` | works; active state misses `/settings/privacy` and `/settings/ai-memory` (`Layout.tsx:407-412`) | KEEP (move to avatar menu/footer) |
| Language EN/JP/FR | context | FR is mostly English | KEEP EN/JP; HIDE FR until translated |
| Log Out / ログアウト | **no onClick** (`Layout.tsx:485-500`); `logout` is pulled from `useAuth` in `App.tsx:150` and never used | broken | FIX |
| Logo "L" | — | placeholder letter mark | Replace with a real mark |

Global extras: `FloatingChatbot` (real Hermes agent chat via `services/agentApi.ts`) appears on every page at `z-[9999]`. Its red "unread" dot shows whenever there are 0 messages, so it is always on for a new user (`FloatingChatbot.tsx:193-195`). It covers reader content and slide controls. Recommendation: KEEP the agent, but make it a context-aware side panel inside the reader ("Ask about this section"), drop the fake dot, and hide it on game/slide pages.

## 3. Feature folders

| Folder | Content | Verdict |
|---|---|---|
| `components/features/ai` | GeneratedDocView (core), GeneratedCourseView, CourseGenerator, Encyclopedia, Characters, LessonReflectionModal, MultiFormat blocks; **orphans:** `RisePathConciergeView.tsx` (475 LOC, TS1128 syntax error noted in `doc/guides/prod_readiness_plan.md:22`), `GeneratedLessonView.tsx` (658 LOC, picsum backgrounds) | KEEP the core; CUT the 2 orphans |
| `components/features/dashboard` | Mission Control, LearningHub, CourseList, MyContent, profile/*, assessment/*, Notifications, Subscription | Consolidate (see above) |
| `components/features/programming` | Vibe (12 views + 772-LOC DocView + Quiz), Unity, HtmlCss (good), Python (fake), React path (fake), WebInspector | Keep Vibe/Unity/HtmlCss content; collapse the wrappers |
| `components/features/art` | 10 bespoke views | Keep (showcase); self-host assets |
| `components/features/blender` | Curriculum, Path, Lesson, TeacherBotLive | Keep 3; flag the teacher bot |
| `components/features/PSchool` | Phaser game, own Supabase client and lib | Keep; integrate XP/auth |
| `components/features/sonic` | Lab + Synth | Hide |
| `components/features/aidj` | Standalone landing | Hide / convert |
| `components/features/life-journal` | Journal, monthly, insights, chat, widget | Keep (flag) |
| `components/features/settings` | Real settings | Keep |
| `components/common` | Layout, ErrorBoundary, Experience{Landing,Login}View, GlossaryText, FloatingChatbot, LessonView (mock); **orphans:** `LoginView.tsx`, `LoginModal.tsx`, `LandingView.tsx`, `ui/StatsCard.tsx` | CUT the orphans and LessonView |
| `components/wrappers` | Course/Lesson/Generated wrappers | Keep the Generated ones; cut Course/Lesson |
| `ai-learning-diagnosis/` (root) | Old standalone Vite app; **3 files still imported** by `PersonalAssessmentView.tsx:13-15` (LoadingScreen, ResultScreen, types); excluded from tsconfig | MOVE those 3 into `components/features/dashboard/assessment/`, then CUT the folder |
| `ai-personal-insights-pro/` (root) | Old standalone Vite app (1,163 LOC), already ported into `dashboard/assessment/*`, **not imported anywhere** | CUT |
| `services/curriculumApi.ts` (2,978 LOC) | API client plus about 2,500 lines of embedded DEMO course data (Python, Art, Unity, AI agents, English, French, Math, Kintsugi, JP history…) | MOVE the demo data to `data/demo-courses/*.json` (same schema as the generator/MCP output) |
| `services/curriculumData.ts` | English-app COURSES_DATA + phrase templates | CUT with `/course`, `/lesson`, `/library` |
| `mcp-server/`, `tools/core`, `skills/`, `agents/`, `hermes/` | MCP server with 19 tools incl. `get-generation-kit`, `validate-intake`, `save-curriculum-draft` (a curriculum-builder profile), Claude-style SKILL.md files (curriculum-generator with Bloom/Big5 refs) | **KEEP and promote**: this is the hook for "Claude Code authors 教材". Add a `.claude/` setup and a documented JSON schema |
| `server/` | Express routes (ai, agent, content, tts, lifeJournal, learnerMemory, chatgptCurriculum), migrations, tests | KEEP |
| `.gemini/`, `.grok/` | Per-tool agent configs | Keep (dev); add a Claude Code equivalent |
| `doc/` (89 files), `deploy/`, `scripts/` (47) | Specs, runbooks, smoke scripts | Keep |

## 4. Root-level strays

| File | What it is | Rec |
|---|---|---|
| `final_policy.txt` | "This is a policy about Space Travel security. Always wear helmets." (RAG test junk) | CUT |
| `VIVEcode.01.txt` | JP narration script for a Web-architecture slide deck (useful source content) | MOVE to `doc/content-sources/` or turn it into a chapter |
| `check_audio_length.py` | One-off WAV duration check for `public/vice/*.wav` | MOVE to `scripts/` or CUT |
| `test_generation.ts` | Manual Gemini `generateCourse` smoke test (excluded in tsconfig) | MOVE to `scripts/smoke/` or CUT |
| `test_generation_storage.js` | Manual DB storage test with mock AI output | MOVE to `server/tests` or CUT |
| `test_human_tool_flow.js` | Manual API flow test against :3006 | MOVE to `scripts/smoke/` |
| `metadata.json` | AI-Studio leftover: "Master English with AI…" | FIX the description or CUT |
| `index.html` | Title "Rise Path Learning", `lang="en"` hard-coded (the context updates it later) | OK; add a meta description and OG tags |
| `.gitignore` | `*.pdf` blocks slide decks; a missing newline merges two patterns (`sample/**/__pycache__test_mcp_client.js`) | FIX |
| `public/debug/`, `public/data/curricula/blender/_images_test/` | Dev artefacts served publicly | CUT |
| `public/*_1782917xxxxx.jpg` (3 AIDJ images, about 2.7 MB) | Timestamped names in the public root | Move under `public/aidj/` |

## 5. Assets and repo weight

- Tracked total is about **1.6 GB** (pack 328 MB).
  - `data/curricula/blender/blender_manual_v500_en.html/`: **1.2 GB, 5,243 files**. Only used by `scripts/extract_blender_*.js` and `generate_install_setup_page.js`. Move it out of git (download script or LFS).
  - `public/data/curricula/blender/_images`: 244 MB copied from the manual. Keep only the images the lessons reference, or load them via the server.
  - `public/data/curricula/blender/index.jsonl` (8 MB) and `image_index.jsonl` (3 MB): duplicated in `data/` and in `public/`, and fetched whole into the browser for client-side RAG. Move the RAG server-side (`server/ragService.js` already exists).
  - `public/vice/*.wav` (67 MB, 7 files) and `public/audio/*.wav`: convert to Opus/MP3, which is roughly a 10x saving.
  - `public/p_school` (38 MB) and `public/generated` (15 MB, 23 JPGs at 0.3-1 MB each): convert to WebP/AVIF and use responsive sizes.
- **147 hot-linked external images** (130 Unsplash, 9 Wikimedia, 6 transparenttextures, 1 picsum, 1 dicebear), of which **40 are dead**. Self-host curated images (or generate them) and put a fallback component on every `<img>` (`onError`, then a gradient or icon placeholder).

## 6. Placeholder / fake data checklist

- `App.tsx:105-146` `ProfilePlaceholder`: "Alex Johnson", "Level 12", picsum avatar. Dead code; CUT.
- Dashboard: real items are name, streak, level and the journal widget. Fake items: weekly hours, "Now Playing" card, quests, AI coach, schedule ("Open planner" and "See all quests" have no handlers, `:622,:714`), momentum chart, weekly goal, "+40 XP" streak popup, and the level-up demo to level 13.
- MyContent: ¥4,500 earnings, simulated multi-model pipeline, Unsplash thumbnails.
- Track hubs: hard-coded 75% / 40% / 0% progress and "Done" states that ignore `progressService`.
- Blender lesson: "Reference_Ref.zip 3.4MB" download card with no file.
- Python notebook: canned output.
- Notifications: `seedDemoNotifications`.
- Subscription prices: fake plans.
- Landing: "v2.0" neuro-adaptive claims and a dead "Watch Demo".
- Assessment copy says "5-question demo assessment" ("5問のデモ診断").
- Model names hard-coded in UI copy: "Gemini 3 Pro Architect", "2.5-FLASH", "Powered by Gemini 2.5 Flash". These will age and are provider-specific.

## 7. i18n gaps observed (JP selected)

- Vibe chapters 0-11: entirely EN (the `language` prop is never passed). The JP data exists.
- Untranslated EN components: `MyContent` (no i18n at all), `common/LessonView`, `WebInspectorView` ("Welcome to Inspector Mode"), `AidjCurriculumView` (mixed), `ChatInterface` footer, `CharacterRevealPanel`, `ReflectionPage` block, P-School React shell.
- Backend strings arrive in English (`tools/core/lifeJournalAnalysis.js:387`).
- FR: the global toggle offers FR, but `LanguageContext` resolves it to EN except in 4 assessment components. Feature-local toggles offer EN/JP only, and three different toggle styles exist.
- Mixed-language labels: CourseGenerator demo cards show JP labels ("Python 入門", "美術史", "Unity開発") in EN mode (`CourseGeneratorView.tsx:412-414`).

## 8. Proposed focused product story

> **Rise Path: an AI that writes a course for you, and a reader that makes it a joy to study.**
> Loop: (optional 3-minute type check) → pick a featured track or generate your own (in-app, or authored by Claude Code / any MCP client) → study in one beautiful Lesson Reader (Read · Slides · Practice · Quiz · Ask the coach) → reflect → real progress.

Target IA (5 + 1):
1. **ホーム / Home**: "Continue" (the real last lesson), today's single next step, real streak/XP, the journal check-in widget. No fabricated stats.
2. **ライブラリ / Library**: merges `/learning-hub` + `/courses` + `/profile/generated` + My Content. Shelves: Featured tracks (Vibe Coding, Unity×AI, Blender, Web HTML/CSS, Art Atelier, P-School game), AI-generated courses, My courses/drafts. One card design, self-hosted images.
3. **つくる / Create**: the real CourseGenerator, plus a "Drafts from Claude Code / MCP" inbox (`fetchAiDrafts` already exists), plus JSON import and validation (`validate-intake`).
4. **ふりかえり / Reflect** (feature flag): Life Journal + Insights + monthly view, merged with Learning Mirror.
5. **プロフィール / Me**: tabs for Passport · Type (diagnosis + characters) · Badges · History.
6. Footer/avatar menu: Settings, language, log out (working).

Engineering moves that support the pruning:
- Replace the `ViewState` switch with typed route constants and `<Link>`/`navigate(path)`. This removes the whole class of "silently goes to dashboard" bugs, and the sidebar highlight can be derived from the route prefix.
- **One Lesson Reader**: merge `VibeDocView` into `GeneratedDocView`. Vibe and Unity data become curriculum JSON via the existing `services/vibeCodingAdapter.ts`. Add the multi-format interactive blocks (checklist, dialogue, workshop, code playground from HtmlCssView, Blender viewport, reflection) to its BlockRenderer. Expose a single documented block schema, which is exactly what Claude Code / MCP `save-curriculum-draft` should emit.
- Feature flags (`VITE_FEATURES=sonic,aidj,teacherBot,subscription,frLocale,journal`) for HIDE items; a dev-only `/dev/blocks` gallery replaces "Design Samples".
- Asset hygiene: self-host plus an `<Img>` fallback, WebP/Opus, Blender manual out of git, server-side RAG.

## 9. Recommendation summary

**KEEP (core):** GeneratedDocView reader, GeneratedCourseView, CourseGenerator, Assessment, Settings, Vibe/Unity/Blender/HTML-CSS/Art content, P-School, auth/landing, FloatingChatbot (reworked), MCP server + skills + Hermes.

**MERGE:**
- LearningHub + CourseList + ProfileGenerated + MyContent → Library
- VibeDocView + MultiFormat blocks + BlenderLessonView → the unified reader
- Diagnosis + ProfileDiagnosis + LearningMirror + Characters → Profile "Type"
- Profile sub-pages → tabs
- Feature-local language toggles → the global one
- P-School XP → app gamification
- Notifications → the bell in the header

**HIDE (flag):** Sonic Lab, AIDJ, Teacher Bot Live, Web Inspector, Subscription, FR locale, Life Journal (optional), Encyclopedia until the API works without a DB.

**CUT:** the Design Samples nav, `/demo/*` routes, `/library`, `/course/:id`, `/lesson/:id`, `common/LessonView`, `CoursePathView`, `curriculumData.ts`, MyContent (fake), ProfileGenerated, PythonBeginnerView (or rebuild with Pyodide), ProgrammingCourseView, the AI-track dead cards, orphans (RisePathConciergeView, GeneratedLessonView, LoginView, LoginModal, LandingView, StatsCard, ProfilePlaceholder), `ai-personal-insights-pro/`, `ai-learning-diagnosis/` (after moving 3 files), `final_policy.txt`, root `test_*` (move to scripts), `public/debug`, `_images_test`, and the Blender manual HTML from git.

Rough removable surface: about 5.3k LOC of views/orphans plus 1.9k LOC of the old sub-apps plus about 2.5k LOC of inline demo data moved to JSON, and about 1.2-1.5 GB of tracked assets.
