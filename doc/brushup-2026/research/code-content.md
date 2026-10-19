# Rise Path: Learning-content system audit and a unified "Lesson Block" model

Key: `code-content`. Repo: `rise-path-demo-game-integration` (commit 6f9cc1d). All line numbers are from that tree.
Screenshots referenced below are in
`<session-scratchpad>/shots-before/extra/`.

---

## 0. TL;DR

* **There is no single lesson format.** I count **9 lesson/content shapes** (section 2), **4 generation pipelines** (section 4), **3 `LocalizedText` definitions**, **2 copy-pasted doc renderers** (`VibeDocView` and `GeneratedDocView`, about 400 duplicated lines of block, mermaid and mind-map code), **12 near-identical 22-line chapter wrapper components**, and **4 private `getText` helpers**.
* **Several things are visibly broken today (verified at runtime):**
  1. Vibe chapters always render **English content under a Japanese UI**. The wrappers never forward `language` (`VibeChapterOneView.tsx:19-25`, `VibeDocView.tsx:41`). The quiz tab in the same chapter is Japanese, because `VibeQuizView` reads context. See `vibe_chapter-1.png` and `vibe-ch1-quiz.png`.
  2. **Tables are silently dropped** in Vibe and Unity chapters. `VibeDocView`'s `BlockRenderer` has no `case 'table'` (`VibeDocView.tsx:665-770`), but the data contains 12 tables. A runtime probe of `/unity/chapter-0` found `tables: 0`.
  3. **Every "Slide" tab fails** with "Failed to load PDF". `*.pdf` is gitignored (`.gitignore:34`), so `/slides/chapter1.pdf` and `variables-memory.pdf` never ship (`vibe-ch1-slide.png`, `python-slides.png`). The SVG versions of the Python deck do exist (`public/slides/variables-memory/01-05.svg`).
  4. On **mobile**, the lesson reader collapses to a column about 150px wide next to an empty grey sidebar gutter (`generated-lesson_demo-curr-001-m.png`, `mobile/vibe_chapter-1-m.png`).
  5. `ConceptPage` hardcodes **quantum-entanglement text** for *every* concept block (`multi-format/blocks/ConceptPage.tsx:14-27`). `WorkshopPage` shows hardcoded Qiskit code for any goal, and its "Run" is a `setTimeout` (`WorkshopPage.tsx:103-116`). `ReflectionPage` options have no `onClick` (`ReflectionPage.tsx:20-25`).
  6. The **global glossary auto-linker** produces false positives. In a *math* lesson, "シーン" is linked to the Unity "Scene" definition (`generated-lesson_demo-math-001...png`, `GlossaryText.tsx:79-131`, `data/glossary/terms.ts`).
  7. **10 of the 15 catalog "AI-generated" courses (72 lessons) are filler.** `createLesson()` emits the same three generic sentences for every lesson (`services/curriculumApi.ts:27-78`). `USE_DEMO_MODE` defaults to **true** (`curriculumApi.ts:7`), so the "generator" picks a canned course by keyword (`curriculumApi.ts:2356-2389`).
  8. **The server generators write DB columns that don't exist in the migrations.** `routes/ai.js:153-157` writes `curriculum_data`. `tools/core/curriculum.js:248,274` (the MCP `save-curriculum-draft` tool) writes `intake`, `curriculum_data` and `generation_meta`. `migrations/001_core_curriculum.sql:3-20` defines `content`, `intake_json` and `modules_json`. The reader (`routes/content.js:84-93`) reads `curriculum_versions.content_json || curricula.content`. Only REST `POST /ai/curriculum-drafts` writes to the right place (`chatgptCurriculum.js:385-388`).
* **The content model is under-powered for "excellent material".** It lacks inline quizzes, flashcards, prompt cards, runnable code, copyable code (the `Copy` icon is imported but unused), syntax highlighting, real markdown (only `**bold**`; links render as raw `[t](u)`), step-by-step and compare blocks outside Blender, objectives, summaries, per-course glossary, citations and progress.
* **Proposal (section 8):** a single versioned schema, `risepath.lesson/v1`, defined once in zod. It exports JSON Schema for LLMs, MCP and Claude Code, and the TS types come from the same source. It drives one `LessonReader` with a block registry, with Doc, Slides and Practice modes all *derived from the same blocks*. Authoring paths: content files in-repo (Claude Code), MCP `upsert-lesson` (Claude, ChatGPT and other external LLMs) and server structured output (Gemini or Claude API), all validated by the same validator.

---

## 1. Renderer inventory (who renders lessons)

| Component | Route | Data source | LOC | Status / notes |
|---|---|---|---|---|
| `components/features/programming/VibeDocView.tsx` | `/vibe/chapter-N` via 12 wrappers; `/unity/:chapterId` via `UnityChapterView` | `DocChapter` TS objects in `data/curricula/vibe_coding/*.ts`, `unity_ai/*.ts` | 772 | Doc, Slide (PDF+WAV) and Quiz modes. No `table`. `Chapter 1` badge hardcoded at :218. Audio `/audio/vibe/chapter1.wav` hardcoded at :444. `SLIDE_TIMINGS` hardcoded at :307. Quiz completion only `console.log` at :297. The `Copy` icon at :5 is unused. `useLanguage` is imported at :14 but unused. |
| `VibeChapter{Zero..Eleven}View.tsx` (12 files) | `/vibe/chapter-0..11` (`App.tsx:415-426`) | one import each | 22-28 each | Pure boilerplate. Differ only in the import line (`diff` of Two vs Three = 4 identifier lines). They accept `language` but don't pass it. |
| `UnityChapterView.tsx` | `/unity/:chapterId` (`App.tsx:483-496` maps the param to `ViewState.UNITY_CHAPTER_n`) | `unity_ai/chapterN.ts` (`{jp:DocChapter,en:DocChapter}` bundles) | 53 | Third localization style (whole-document per locale). |
| `VibeQuizView.tsx` | inside VibeDocView | `QuizData` | 214 | Single-choice only. Uses context language (inconsistent with the doc). Progress not persisted. |
| `components/features/ai/GeneratedDocView.tsx` | `/generated-lesson/:courseId?module&lessonIndex` via `GeneratedLessonViewWrapper` | `GeneratedLesson` (DocChapter + extras) from `curriculumAdapter` | 1779 | Fork of VibeDocView with table, ImageBlock (runtime image generation), personalization badges, reflection modal and voice sheet. `SLIDE_DECKS` is a hardcoded map keyed by `lesson_id` (`:58-92`). Debug `console.log` of the full lesson on every render (`:270-276`). "Back to Document" and "Lesson" are not localized (`:1151`, `:782`). Fixed header `left-0` overlays the app chrome (`:666`). |
| `components/features/ai/GeneratedLessonView.tsx` | **none** (no importer) | legacy `GeneratedCourse.chapters[].slides` | 658 | **Dead code.** |
| `components/features/ai/GeneratedCourseView.tsx` | `/generated-course/:id` | `GeneratedCourse` (flattened `chapters`) | 259 | Course roadmap. Modules flattened away. No per-lesson completion state. Hardcoded "Gemini 3.0 Pro" badge (`:52-53`; screenshot `generated-course_demo-curr-001.png`). |
| `components/features/ai/MultiFormatLessonView.tsx` + `multi-format/blocks/*` (Concept, Dialogue, Workshop, Reflection, Checklist, BlenderViewport) | `/demo/multi` plus the "デザインサンプル" nav group | `MOCK_BLOCKS_EN/JP` constants inside the view (`:13-190`) | 312 + 1337 | Demo only. Blocks are not data-driven (see TL;DR item 5). The renderer uses `block as any` everywhere (`:255-263`). |
| `components/features/blender/BlenderLessonView.tsx` | `/blender/lesson/:stageId` | `data/curricula/blender/courseData.ts` (`StageData`/`LessonStep`, 4 stages) | 599 | **Best reader UX in the app**: in-layout sticky header with progress and complete, step TOC, hotkey chips, compare slider (`ImageSlider` :32), X-ray overlay (:66), Do/Don't (:116), and real progress (`progressService.markStageCompleted`). But its 26 images are Unsplash stock rather than Blender screenshots, and "Reference_Ref.zip" is a fake asset (`blender_lesson_1.png`). |
| `components/features/art/*` (10 views) | `/art/*` | Content embedded in components as `const content = {en:{...JSX}, jp:{...}}` (e.g. `ArtPeriodDetailView.tsx:44-80+`) | 2,700 | Beautiful bespoke "museum" art direction, but content is locked in TSX. One period only (`/art/period`, no param). Mock audio guide (`:14-29`). Own `**bold**` parser (`:122`); `*Sfumato*` italics not handled. |
| `programming/PythonBeginnerView.tsx`, `HtmlCssView.tsx`, `HtmlCssPartTwoView.tsx` | `/programming/*` | inline | 360-363 | Python "Run Cell" is simulated by string matching (`PythonBeginnerView.tsx:88-113`). The HTML/CSS view has a **real** live `iframe srcDoc` preview (`HtmlCssView.tsx:127-140`), a good primitive to generalize. |
| `components/common/LessonView.tsx` | `/lesson/:courseId` | `PersonalizedLesson` (`services/curriculumData.ts`) | 354 | Write, AI rubric feedback (`geminiService.analyzeWriting`), refine, roleplay. A valuable "open response with AI rubric" interaction that is isolated from everything else. |
| `PSchool/*` | `/p-school` | `data/curricula/p_school/beginner.json` | — | Game stages, separate domain (out of scope for the block model, but should link into lessons). |
| `EncyclopediaView.tsx` | `/generated-course/:id/encyclopedia` | `artifactService.buildMiniEncyclopedia` (`server/services/artifactService.js:141-170`) | 153 | Despite the name, it is a table of contents, not a glossary. |

---

## 2. Data shapes that define lessons (9)

1. **`DocChapter` / `LocalizedDocBlock`** (`types.ts:345-383`). Blocks: text(normal|lead|quote), image, code(+highlightLines, unused), list(bullet|number|check|key), callout(info|warning|tip|success), mermaid, table, mindmap. Used by Vibe, Unity and generated lessons. **This is the closest thing to a standard and the right seed.**
2. **`QuizData`** (`types.ts:387-404`). Single-choice only, explanation per question.
3. **`LearningBlock`** (`types.ts:245-291`): concept / dialogue / workshop(subType code|design|logic|blender) / reflection / checklist. Multi-format demo only.
4. **`GeneratedChapter`** with legacy `slides[]` (`types.ts:293-323`, `modelUsed` includes non-existent model names :333). Only the dead `GeneratedLessonView` uses it.
5. **Legacy `doc_blocks` / vibe_coding** (`services/vibeCodingAdapter.ts:5-60`, `services/curriculumAdapter.ts:20-81`): text/bullets/code, quiz `{q, choices, answer}` with no explanation.
6. **Flat `lesson_template`** for external LLMs (`server/services/curriculumGenerationKit.js:126-190`): `summary, explanation, why_it_matters, key_points[], examples[], practice[], checklist[], cautions[], reflection[], takeaway`, as plain strings. `server/services/chatgptCurriculumAdapter.js:353-450` expands these into DocChapter sections with **hardcoded Japanese section titles** ('学ぶ内容', 'ポイント整理', ...). Its `toLocalizedText` sets en=jp (`:37-47`). **No code, diagram, table or quiz is expressible.**
7. **Blender `StageData` / `LessonStep`** (`data/curricula/blender/courseData.ts:1-35`), with its own `LocalizedText` (:1).
8. **`PersonalizedLesson`** (`types.ts:50-76`): templates, tasks and rubric for writing practice.
9. **Art inline JSX objects** (not a schema at all).

Plus three JSON Schemas in `doc/system_design/ai-curriculum-spec/schemas/` (`doc_chapter`, `slide_set`, `vibe_coding`, `tts_bundle`) that are **never enforced at runtime**. Grep finds no import. `schemaValidator.js` only validates the generation *kit*. They have also already drifted: the JSON Schema list style enum lacks `key`, and `image.src` is required in the schema but optional (with `prompt`) in TS.

**Localization is triplicated and lossy.**
* `types.ts:345` has `string | {en, jp, fr?}`.
* `courseData.ts:1` has `{en, jp}`.
* `vibeCodingAdapter.ts:3` has `{jp?, en?} | string`.
* `LanguageContext.tsx:27` maps `fr` to `en`, so French content can never display even though the UI offers FR.
* Adapters copy one language into both keys (`curriculumAdapter.ts:150-158`, `chatgptCurriculumAdapter.js:37-47`), so the EN/JP toggle on generated lessons is a no-op.
* Fallback strings are passed in the wrong argument slot, e.g. `normalizeLocalizedText('理解度チェック','Comprehension Check')` (`curriculumAdapter.ts:243,267,288`). The value wins, so EN users see Japanese defaults.

---

## 3. Where content lives

| Location | What | Size |
|---|---|---|
| `data/curricula/vibe_coding/*.ts` | 12 hand-written chapters + 1 quiz (inline en/jp) | ~1,900 lines; block mix: 94 text, 50 callout, 33 list, 18 code, 13 mermaid, 12 table, 3 image, 2 mindmap |
| `data/curricula/unity_ai/*.ts` | 4 chapters, separate jp/en documents | ~750 lines |
| `doc/curricula/chapters/*.md` | 13 Unity chapter outlines in markdown (ch 4-12 never converted to app content) | ~460 lines |
| `services/curriculumApi.ts:122-2356` | **15 demo "generated" courses hardcoded in a service file**; 10 are `createLesson` filler (72 lessons); only 2 quizzes in total | ~2,230 lines |
| `services/aidjDemoData.ts` | AI DJ demo course | 328 |
| `data/curricula/blender/courseData.ts` + `index.jsonl`/`image_index.jsonl` | 4 Blender stages + Blender manual RAG index (5,962 chunks) | — |
| `components/features/art/*`, `programming/*`, `sonic/*` | content inside JSX | ~5k lines |
| `data/glossary/terms.ts` | 49 global terms, Unity-centric, categories `unity|code|concept|general` | 522 |
| DB `curricula` / `curriculum_versions.content_json` | user-generated courses (only when `VITE_DEMO_MODE=false` and Postgres configured) | — |
| `GeneratedDocView.tsx:58-92` | slide deck metadata (narrations, audio path, timestamps) **inside the renderer** | — |

---

## 4. Generation pipelines (4, mutually inconsistent)

**A. In-app 3-stage generator** (`CourseGeneratorView` → `services/curriculumApi.ts:2751 sendAiChat` / `:2818 sendAiDecision` → `POST /api/v2/ai/generate` in `server/routes/ai.js:35-268` → `server/services/aiGenerator.js` → prompts in `server/services/aiPrompts.js`).
* Requirements, then roadmap, then the **entire curriculum in one call**: 3-5 modules × 2-4 lessons × ≥3 sections × ≥3 blocks, bilingual, `gemini-2.5-flash`, `maxOutputTokens: 16384` (`aiGenerator.js:16,61`). This almost certainly truncates, which leads to `JSON.parse` failing and a 422 (`ai.js:147-149`).
* The schema is injected as `JSON.stringify(schema).slice(0, 2000)` (`aiPrompts.js:118`), which produces broken JSON in the prompt.
* There is no `responseSchema`, no validation of the output and no repair loop.
* The prompt never asks for quizzes (`aiPrompts.js:108-122`), and its callout enum omits `success`.
* Agent logs are fabricated ("quality: 品質チェック完了") although no check runs (`ai.js:172-177`).
* The final save writes the non-existent `curriculum_data` column (`ai.js:153`).
* `server.js:100` comments this router as "deprecated (410 Gone)", but it is live.

**B. External-LLM path (ChatGPT, Claude via MCP or REST).** `get-generation-kit` → LLM writes a flat `lesson_template` → `save-curriculum-draft` (MCP, `mcp-server/index.js:380-414`; input `curriculum: z.object({}).passthrough()`, so the tool exposes no schema to the model) or `POST /api/v2/ai/curriculum-drafts` (`server/routes/chatgptCurriculum.js:195+`). Validation covers presence of title/goal/objective only (`curriculumGenerationKit.js:400-460`) plus a quality rubric that counts flat fields (`:462-556`). The server adapter expands the fields into sections. Expressiveness is capped at text, lists and callouts. MCP `saveDraft` writes non-existent columns (`tools/core/curriculum.js:248,274`). There is no tool to read back, edit a single lesson or preview.

**C. Client-side generator** (`services/geminiService.ts:546-601`, `generateChapterDetails` around :380-544). It uses a plain-text `BLOCK:`/`@@@` protocol parsed by string matching and references non-existent models (`gemini-3.0-pro`, `gemini-2.0-flash`, :554). It posts to a non-existent `/api/debug/log-course`. It is **only used by `test_generation.ts`**, so it is dead code.

**D. Demo mode (default).** Keyword match to canned data, a 2.5s fake delay, and fake agent logs (`curriculumApi.ts:2751-2790`). Unknown IDs silently fall back to the Python course (`:2724`).

**Runtime image generation.** `ImageBlock` calls `generateImagePreview(prompt)` at **read time**, with an in-memory cache only (`GeneratedDocView.tsx:1352-1392`). Every visitor and session pays for generation, and images are non-deterministic.

---

## 5. Doc, Slide and Quiz modes

* **Doc:** scroll-spy TOC (xl only), section `#` headers, BlockRenderer. The TOC hack strips "1-1. " via `split('. ')[1]` (`VibeDocView.tsx:278`). There is no reading progress, no "mark section done", no next-chapter link in Vibe (Complete just navigates to `VIBE_PATH`), and no anchors or deep links.
* **Slide:** not derived from content. It is a separate PDF (react-pdf, worker from unpkg, `VibeDocView.tsx:18`) or a hardcoded image deck plus a WAV, with hand-typed timestamps (`VibeDocView.tsx:307-309`, `GeneratedDocView.tsx:88-91`). It is broken in the OSS repo because PDFs are gitignored. Two different slide players exist: a full-screen dark one in Vibe and a card one in Generated.
* **Quiz:** two implementations. `VibeQuizView` shows one question at a time with immediate feedback. `GeneratedDocView`'s inline quiz (:1147-1251) shows all questions and then "Check answers". Both are single-choice only. Neither persists scores. Completion is only an optional reflection modal (`LessonReflectionModal`, journaled via API) plus a Nexloom report (`GeneratedLessonViewWrapper.tsx:195-205`).
* **Progress:** only Blender records progress (`progressService.markStageCompleted`). `VibePathView.tsx:219` **fakes** status (`idx <= 10 ? 'completed' : ...`).

---

## 6. Duplication map

* `VibeDocView.tsx:311-770` ≈ `GeneratedDocView.tsx:1284-1779`: mermaid helpers (`detectMermaidType`, `getMermaidThemeForType`, `injectMermaidTheme`, `injectFlowchartClasses`), `MermaidBlock`, `MindMapNode`, `BlockRenderer`, the callout variants table and the list renderer, all copy-pasted. Each also has its own `mermaidConfig` (`securityLevel: 'loose'` + `dangerouslySetInnerHTML`, `VibeDocView.tsx:74`, `GeneratedDocView.tsx:338`).
* 12 `VibeChapter*View.tsx` wrappers + 12 `ViewState.VIBE_CHAPTER_*` + 4 `UNITY_CHAPTER_*` enums (`types.ts:140-157`) + 12 explicit routes (`App.tsx:415-426`) + 12 lazy imports (`lazyRoutes.tsx:88-123`). All of this can be replaced by one `/:track/:chapter` route and a content registry.
* Chapter titles exist twice: in `VibePathView.tsx:27-200` (en/jp) and in `chapterN.ts`.
* 4 × `getText` (`GeneratedCourseView.tsx:8`, `GeneratedDocView.tsx:27`, `VibeDocView.tsx:21`, `PersonalityAssessment.tsx:18`), 3 × `LocalizedText`, 2 × bold parsers.
* 3 adapters converting into DocChapter (`curriculumAdapter.ts`, `vibeCodingAdapter.ts`, server `chatgptCurriculumAdapter.js`), plus `normalizeGeneratedCourse` (`curriculumApi.ts:2391-2468`) which flattens modules into `chapters` and smuggles the real lesson in `_lessonData`.
* The 'key' list style splits on `:` with a regex (`GeneratedDocView.tsx:1645-1668`) instead of structured `{term, desc}`.

---

## 7. Missing or weak primitives (for "excellent material")

| Primitive | Today | Needed |
|---|---|---|
| Inline markdown | `**bold**` only (GlossaryText). Links show raw (`curriculumAdapter.ts:279` emits `[t](u)`). `\n` collapses in callouts. `react-markdown` is installed but unused for lessons | md subset: bold/italic/`code`/links/line breaks/footnote cites/`[[glossary]]` |
| Code | No highlighting (`text-blue-100`), no copy, `highlightLines` ignored, filename only | Shiki/Prism, copy button, line highlight, diff, tabs (multi-file), "explain this line" (ask tutor) |
| Run code | Fake (Python string-match, Workshop timer). Real only in the HTML/CSS iframe | `sandbox` block: html/css/js iframe now, Python via Pyodide later, with tests |
| Prompt card | Prompts are shoved into `code` with `language: 'markdown'` (e.g. `vibe_coding/chapter2.ts`) | `prompt` block: copy, "open in Claude/ChatGPT/Gemini", variables, expected-output note. **Essential for the Vibe Coding track** |
| Diagrams | Mermaid (good, auto-themed) but `securityLevel: 'loose'`, light-only, errors show "Invalid Syntax" with no fallback | Mermaid strict + dark theme + zoom + source fallback; later SVG/Excalidraw |
| Inline checks | Quiz only at lesson end, single-choice | `quiz` block anywhere (single/multi/true-false/order/fill-blank), hints, explanations per option |
| Flashcards / SRS | none | `flashcards` block feeding a review queue |
| Glossary | Global 49-term auto-linker (false positives, regex rebuilt every render, `GlossaryText.tsx:82-102`) | Course-scoped glossary + explicit `[[term]]` marks + auto "Key terms" panel |
| Steps / walkthrough | Blender only (rich) | Generic `steps` with media, hotkeys, hint, troubleshooting |
| Compare | Blender only (slider, overlay, do/don't) | Generic `compare` (before/after, do/don't, vs table) |
| Objectives / summary | none (generated) or ad hoc | Lesson header "You will be able to…", end "Key takeaways" |
| Exercise with AI feedback | isolated in `LessonView` | `exercise` block with rubric + AI grading + journal save |
| Dialogue | demo only (TTS-ready) | `dialogue` block with speakers/voices |
| Video/audio/embed | none / hardcoded WAV | `video`, `audio` (with transcript), allowlisted `embed` |
| Citations | Designed in `12_source_aware_generation.md:167-220` but not rendered | `sources[]` at course level + `cite` refs on blocks + footnotes |
| Progress | Blender only | Block-level "seen", quiz scores, checklist state, lesson completion rules |
| Ask tutor | Glossary popup dispatches `open-rise-path-chat` (`GlossaryText.tsx:58-76`) | `askTutor` block + "Ask about this section" on every section, passing lesson/block context |

---

## 8. Proposal: one schema, `risepath.lesson/v1`

### 8.1 Principles
1. **One source of truth in zod** (`src/content/schema.ts`), exported as `content/schema/lesson.schema.json` (via `zod-to-json-schema`) for LLMs, MCP and editors. TS types come from `z.infer`. The same validator runs in the browser (dev), the server (save), the CLI (`npm run content:validate`) and MCP.
2. **Blocks are the only unit.** Doc, Slides and Practice are *views* over the same blocks, not separate assets.
3. **Stable ids** on lesson, section and block, for progress, translations, TTS timing, comments and LLM patching.
4. **Localization by locale, not by duplication.** Plain strings are in `lesson.locale`. Translations are either inline `{jp,en,fr}` (keeps existing data valid) or sidecar `translations/<locale>.json` keyed by block id. The fallback chain is requested locale, then source locale. This halves LLM output tokens and makes FR real.
5. **Pedagogy in the schema, not the prompt.** Objectives, checks for understanding and summary are first-class, so a validator or rubric can enforce them.
6. **Generated media are assets created at publish time**, stored with provenance, never generated at read time.

### 8.2 Types (concrete)

```ts
// src/content/schema.ts (zod; shown as TS for brevity)
export type Locale = 'jp' | 'en' | 'fr';            // keep 'jp' to match LanguageContext
export type Text = string | Partial<Record<Locale, string>>;   // string = lesson.locale
export type Md = Text;                               // inline-markdown subset (bold, italic, `code`, [link](url), [[term]], [^srcId], line breaks)

export interface Course {
  schema: 'risepath.course/v1';
  id: string; slug: string; locale: Locale; locales?: Locale[];
  title: Text; subtitle?: Text; description?: Md;
  cover?: MediaRef; level?: 'beginner'|'intermediate'|'advanced';
  theme?: { accent?: 'violet'|'amber'|'emerald'|'sky'|'rose'|'stone'; style?: 'technical'|'editorial'|'museum'|'playful' };
  outcomes?: Text[]; prerequisites?: Text[]; tags?: string[];
  modules: Module[];
  glossary?: GlossaryEntry[];          // replaces global auto-link
  sources?: Source[];                  // from 12_source_aware_generation.md §7
  provenance?: Provenance;
  personalization?: Record<string, string>;   // existing CurriculumPersonalization
}
export interface Module { id: string; title: Text; objective?: Text; lessons: Lesson[] }   // lessons may be {ref:'lessons/x.json'} in files
export interface Lesson {
  schema: 'risepath.lesson/v1';
  id: string; title: Text; subtitle?: Text; locale?: Locale;
  estMinutes: number; kind?: 'reading'|'workshop'|'review'|'project';
  objectives?: Text[];                 // header "このレッスンでできるようになること"
  sections: Section[];
  slides?: { mode: 'auto'|'manual'; deck?: { images: MediaRef[]; narration?: Text[]; audio?: MediaRef; cues?: number[] } };
  completion?: { require?: ('read'|'quiz'|'checklist'|'exercise')[]; passScore?: number };
  glossary?: GlossaryEntry[]; provenance?: Provenance;
}
export interface Section {
  id: string; title: Text;
  role?: 'hook'|'concept'|'example'|'practice'|'check'|'pitfalls'|'summary'|'reflection';  // drives personalization emphasis (replaces id-prefix hack GeneratedDocView.tsx:796-813)
  blocks: Block[];
}
interface BlockBase {
  id?: string;                         // required after normalization (auto "s2-b3")
  slide?: boolean | { title?: Text; layout?: 'title'|'bullets'|'image'|'code'|'quote' };
  narration?: Text;                    // spoken text for slide/audio mode (TTS)
  audience?: { modes?: string[]; levels?: string[] };   // personalization filter
  cite?: string[];                     // Source ids
}
export type Block = BlockBase & (
  // prose
  | { type: 'markdown'; md: Md; style?: 'normal'|'lead' }                // == old 'text'
  | { type: 'callout'; variant: 'info'|'tip'|'warning'|'danger'|'success'|'note'|'analogy'|'example'; title?: Text; md: Md }
  | { type: 'list'; style?: 'bullet'|'number'|'check'; items: Md[] }
  | { type: 'definitions'; items: { term: Text; md: Md }[] }             // == old list style 'key'
  | { type: 'quote'; md: Md; by?: Text }
  | { type: 'table'; columns: Text[]; rows: Md[][]; caption?: Text; emphasizeColumn?: number }
  | { type: 'summary'; points: Md[] }                                   // "Key takeaways"
  // media
  | { type: 'image'; src: string; alt: Text; caption?: Text; layout?: 'wide'|'full'|'inline'|'float'; gen?: { prompt: string; model?: string } }
  | { type: 'video'; src: string; provider?: 'file'|'youtube'; start?: number; caption?: Text }
  | { type: 'audio'; src: string; transcript?: Md }
  | { type: 'diagram'; engine: 'mermaid'; code: string; caption?: Text }  // == old 'mermaid'
  | { type: 'mindmap'; root: MindNode }
  | { type: 'compare'; variant: 'before_after'|'do_dont'|'versus'|'overlay'; left: Pane; right: Pane }
  | { type: 'embed'; url: string; height?: number }                      // allowlisted hosts
  // code & AI
  | { type: 'code'; lang: string; code: string; filename?: string; highlight?: number[]; diff?: boolean; run?: 'html'|'js'|'python' }
  | { type: 'codeTabs'; files: { filename: string; lang: string; code: string }[] }
  | { type: 'terminal'; lines: { cmd: string; out?: string }[] }
  | { type: 'prompt'; prompt: string; target?: 'any'|'claude'|'chatgpt'|'gemini'|'claude-code'; vars?: { name: string; hint?: Text }[]; note?: Md; expect?: Md }
  | { type: 'sandbox'; runtime: 'html'|'js'|'python'; files: { filename: string; code: string }[]; task?: Md; checks?: { expect: string; hint?: Text }[]; solution?: string }
  // procedure
  | { type: 'steps'; items: { title: Text; md?: Md; media?: MediaRef; keys?: string[]; params?: { label: Text; value: Text }[]; hint?: Md; troubleshoot?: Md }[] }
  | { type: 'checklist'; items: { id: string; label: Text; details?: Md; media?: MediaRef; link?: string }[] }
  | { type: 'keys'; keys: string[]; os?: 'mac'|'win'|'any' }
  // interaction / assessment
  | { type: 'quiz'; questions: QuizQ[]; mode?: 'inline'|'exam' }
  | { type: 'flashcards'; cards: { front: Md; back: Md; term?: string }[] }
  | { type: 'reflection'; prompt: Md; kind?: 'free'|'scale'|'choice'; options?: Text[]; journal?: boolean }
  | { type: 'exercise'; prompt: Md; rubric?: { criterion: Text; desc: Text }[]; sample?: Md; aiFeedback?: boolean }
  | { type: 'dialogue'; speakers: { id: string; name: Text; voice?: string; avatar?: string }[]; lines: { speaker: string; md: Md; emotion?: string }[] }
  | { type: 'askTutor'; suggestions: Text[]; context?: string }
);
export interface QuizQ {
  id: string; kind: 'single'|'multi'|'truefalse'|'order'|'fill';
  prompt: Md; options?: { id: string; md: Md; feedback?: Md }[];
  answer: string | string[];  explanation: Md; hint?: Md; bloom?: 'remember'|'understand'|'apply'|'analyze';
}
export interface GlossaryEntry { term: string; aliases?: string[]; md: Md; askTutorPrompt?: Text }
export interface Source { id: string; title: string; url?: string; publisher?: string; checkedAt?: string }
export interface Provenance { author: 'human'|'claude-code'|'claude'|'gemini'|'chatgpt'|'other'; model?: string; generatedAt?: string; reviewedBy?: string; promptVersion?: string }
type MediaRef = { src: string; alt?: Text };  type Pane = { title?: Text; md?: Md; media?: MediaRef; items?: Md[] };
```

**LLM profile.** Export a trimmed `lesson.llm.schema.json` with no `embed` and no `video`, where `image` has `gen.prompt` only, plus enum descriptions and one exemplar lesson. Gemini `responseSchema` and Claude tool `input_schema` use this. Keep it free of `oneOf` depth beyond what providers accept (discriminated union on `type`).

### 8.3 Migration mapping (old to new)

| Old | New |
|---|---|
| `LocalizedDocBlock.text` | `markdown` (`style` lead kept; `quote` becomes the `quote` block) |
| `.list` style `key` | `definitions` (parse `label：rest` once in the migration script) |
| `.mermaid` | `diagram{engine:'mermaid'}` |
| `.code` (+ `language:'markdown'` prompt examples in Vibe) | `code`; **convert prompt examples to `prompt`** |
| `QuizData` / legacy `{q,choices,answer}` / `ReflectionBlock` with options | `quiz` block (Vibe `chapter1_quiz.ts` becomes a final `check` section) |
| `LearningBlock.concept` | section(role concept) = `markdown` + `callout{variant:'analogy'}` |
| `.dialogue` / `.checklist` | `dialogue` / `checklist` |
| `.workshop` | `steps` (+ `sandbox` for code, `keys` for blender) |
| flat `lesson_template` fields | sections with roles (move `buildLessonSections` from `chatgptCurriculumAdapter.js:353` into a shared `normalizeLesson()`, fixing en=jp and JP-only titles) |
| Blender `LessonStep` | `steps` item; `imageType: compare/overlay/dos_donts` becomes `compare` variants; `troubleshooting` becomes `callout warning`; `tip` becomes `callout tip`; `parameters` becomes `steps.params` |
| `PersonalizedLesson` | `exercise` with rubric |
| `SLIDE_DECKS['m1-l1']` | `lesson.slides.deck` (use the existing SVGs, drop the PDF) |
| Art JSX content | `quote`, `markdown`, `image`, `compare(overlay)` for the perspective reveal + `course.theme.style:'museum'` |

A one-time script `scripts/content/migrate-v0.ts` imports the TS data modules and writes `content/courses/<slug>/...json`, validating each.

### 8.4 Renderer architecture

```
src/content/schema.ts            zod schema + types + normalizeLesson() (legacy → v1)
src/content/text.ts              t(text, locale, fallbackLocale) — the ONE getText
src/content/inline.tsx           InlineMd: react-markdown (already a dep) + remark plugins for [[term]] and [^cite]
components/lesson/LessonReader.tsx   shell: in-layout sticky header (progress bar, mode tabs Read | Slides | Practice, locale), TOC w/ completion ticks, prev/next, completion rules
components/lesson/blocks/registry.ts  { markdown: MarkdownBlock, callout: Callout, ... } + <BlockView block/>
components/lesson/blocks/*.tsx    one file per block (CodeBlock with Shiki + copy; Diagram with lazy mermaid, strict, theme-aware; Quiz; Flashcards; Prompt; Sandbox; Steps; Compare (from Blender); Checklist ...)
components/lesson/modes/SlidesView.tsx   auto-derives slides: section title slide + blocks with slide!=false, narration via Kokoro TTS (existing /api/v2/tts) ; or manual deck
components/lesson/modes/PracticeView.tsx collects quiz/flashcards/exercise blocks across the lesson
hooks/useLessonProgress.ts       block seen (IntersectionObserver), quiz scores, checklist state → progressService + /api/v2/user/progress
```
Then:
* `VibeDocView`, `GeneratedDocView`, the 12 wrappers, `UnityChapterView` and `MultiFormatLessonView` are replaced by `<LessonReader lesson=… course=…/>` behind routes `/learn/:courseSlug/:lessonId` (curated, from `content/`) and `/generated-lesson/...` (DB).
* `BlenderLessonView` is migrated last; its compare, overlay and hotkey widgets become shared blocks.
* Art keeps a `museum` theme variant of the reader.

### 8.5 Authoring paths (same schema everywhere)

1. **Claude Code (in-repo, highest quality).**
   * Content lives in `content/courses/<slug>/course.json` + `lessons/<id>.json`, imported by Vite (`import.meta.glob`).
   * Add `skills/lesson-author/SKILL.md` covering: the schema link, a pedagogy checklist (objectives, hook, concept, worked example, inline check, practice, pitfalls, summary, final quiz), a style guide (JP tone, length per block, at most 1 diagram per section, every code has a filename, every prompt is a `prompt` block), and exemplars (convert Vibe ch1 as the gold example).
   * Add `npm run content:validate` (zod) and `npm run content:lint` (pedagogy rubric: has objectives, ≥1 inline check per 2 sections, summary present, alt text present, no orphan glossary refs).
   * Add a dev route `/preview/:slug/:lesson` that hot-reloads, so Claude Code can screenshot with `.shots/shoot.mjs` and self-review.
2. **MCP (Claude Desktop, ChatGPT and others).** Replace the passthrough with real schemas and add these tools:
   * `get-lesson-schema` (LLM profile + style guide + exemplar)
   * `validate-lesson` (returns path-precise errors)
   * `upsert-lesson {course_id, module_id, lesson}` (writes a new `curriculum_versions` row; per-lesson, so no giant payloads)
   * `get-course` / `get-lesson` (read back for edits)
   * `patch-blocks {lesson_id, ops:[{op:'replace'|'insert'|'delete', blockId, block}]}`
   * `preview-url`

   Keep `save-curriculum-draft` as a legacy alias that runs `normalizeLesson()`. **Fix the column names** (`tools/core/curriculum.js:248,274`).
3. **Runtime generation (server).** Use outline, then **per-lesson** generation (parallel, streamed to the UI as each lesson lands) with provider structured output on `lesson.llm.schema.json`. Then validate. On failure, feed the zod errors back once (repair). Then run the pedagogy lint and store real lint results instead of fabricated agent logs. Translation is a separate pass into sidecar translations. Images: run `gen.prompt` through the generator once at publish, store under `public/generated/` or object storage, and set `src`. Provider-agnostic `server/services/llm/` with Gemini + Claude adapters. **Fix the `curriculum_data` write** (`ai.js:153`): use `curriculum_versions.content_json`, the same path that `/ai/curriculum-drafts` already uses.

### 8.6 What to cut
* `components/features/ai/GeneratedLessonView.tsx` (dead, 658 lines). `GeneratedChapter.slides` and `CourseTemplate` once migrated.
* `geminiService.generateCourse` / `generateChapterDetails` / `getMockBlenderCourse` (client-side, dead, fake models, posts to a non-existent endpoint) and `test_generation.ts`.
* The 12 `VibeChapter*View.tsx` files, `UnityChapterView.tsx`, and the `VIBE_CHAPTER_*`/`UNITY_CHAPTER_*` ViewStates and routes.
* Hardcoded `SLIDE_DECKS`, `SLIDE_TIMINGS`, and the `/audio/vibe/chapter1.wav` path. Drop PDF slides (react-pdf + unpkg worker) in favor of derived slides.
* MultiFormat mock data and the "デザインサンプル" nav group (7 demo pages exposed to learners). Keep one `/dev/blocks` gallery that renders every block type from a fixture (doubles as a visual regression page).
* The 10 filler demo courses (72 lessons) in `curriculumApi.ts`. Either regenerate them properly with the new pipeline or remove them. Move the rest to `content/` JSON. Also remove the "Gemini 3.0 Pro" badge and the fake agent logs.
* The global glossary auto-link. Replace it with explicit `[[term]]` + course glossary.
* `console.log` of full lesson payloads (`GeneratedDocView.tsx:270`, `GeneratedLessonViewWrapper.tsx:49,53`, `GeneratedCourseViewWrapper.tsx:28`, `curriculumAdapter.ts:440-487`).

### 8.7 Suggested implementation order (smallest risk first)
1. **Quick fixes (hours):** forward `language` in Vibe wrappers; add the `table` case (or route Vibe through the shared renderer); hide the Slide tab when the asset is missing / switch m1-l1 to the SVG `images` deck; fix ConceptPage, Workshop and Reflection hardcoding or hide the demos; set mermaid `securityLevel:'strict'`; add a code copy button; render links and `\n`.
2. **Extract the shared `components/lesson/blocks/*` + registry + `src/content/text.ts`.** Point both doc views at it, which deletes about 800 duplicated lines.
3. **Introduce the zod schema + `normalizeLesson()`** (legacy to v1) at the adapter boundary. `LessonReader` consumes v1 only.
4. **Migrate curated content to `content/`** (script). Collapse routes to `/learn/:course/:lesson`. Add progress.
5. **New blocks:** quiz (inline), prompt, steps, compare, summary, flashcards, sandbox (html first), exercise (reuse `analyzeWriting`), askTutor.
6. **Authoring:** the Claude Code skill + validate/lint CLI + preview route, MCP tools, and server per-lesson structured generation with repair. Fix DB writes.
7. **Slides and audio derived from blocks** (TTS narration via existing Kokoro), then the Blender and Art migrations.

---

## 9. Evidence index (screenshots)
* `.../shots-before/jp/vibe_chapter-1.png`: JP chrome, EN lesson body; fixed lesson header overlaps the app sidebar logo.
* `.../extra/vibe-ch1-quiz.png`: same chapter, quiz in JP (inconsistent with the doc).
* `.../extra/vibe-ch1-slide.png`, `.../extra/python-slides.png`: "Failed to load PDF", "1 / 0".
* `.../extra/unity-ch0-table-area.png`: Unity ch0; probe found 0 `<table>` elements while the data has 2.
* `.../extra/generated-lesson_demo-math-001_module_0_lessonIndex_0.png`: filler lesson (3 generic lines) + Unity "Scene" glossary link inside math.
* `.../extra/python-code.png`: unhighlighted code, no copy, no filename bar; glossary underlines dense.
* `.../extra/demo-multi-concept.png`: hardcoded quantum "Key insight" / outro.
* `.../extra/generated-lesson_demo-curr-001-m.png`, `.../mobile/vibe_chapter-1-m.png`: mobile reader column about 150px.
* `.../extra/blender_lesson_1.png`: reference for the best existing reader shell (in-layout header, progress, step TOC).
* `.../extra/generated-course_demo-curr-001.png`: course page, "Gemini 3.0 Pro" badge, modules flattened, no completion state.
