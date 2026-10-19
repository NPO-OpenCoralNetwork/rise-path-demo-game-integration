# UI/UX audit: app shell and discovery screens (key: ui-shell)

Scope: landing, dashboard, learning hub, courses, my-content, profile, settings, life-journal, characters, library, assessment, sonic, art, programming, blender. Viewed desktop EN, desktop JP, mobile (390px) and FR.
Code read: `components/common/Layout.tsx`, `index.css`, `index.html`, `context/ThemeContext.tsx`, `context/LanguageContext.tsx`, plus spot checks in `MissionControlDashboard.tsx`, `MyContent.tsx`, `FloatingChatbot.tsx`, `ExperienceLandingView.tsx`, `LearningHub.tsx`.

Screenshots taken for this audit (all under `<session-scratchpad>/shots-before/extra/`):
- `m/*.png`: mobile captures of courses, profile, settings, life-journal, characters, art, sonic, programming, my-content, assessment, library, blender, and `menu-open-m.png`.
- `jp/*.png`: desktop JP captures of courses, settings, characters, profile, life-journal, library, assessment, sonic, art, programming, blender.
- `collapsed-home-jp.png`, `focus-tab-jp.png`, `fr-home.png`, `fr-courses.png`, `fr-settings.png`, `landing-jp.png`, `landing-jp-m.png`, `landing-en-full.png`, `darkpref-courses.png`.
- `full/*-en.png`: full-page dashboard, captured by unlocking the `h-screen` scroller.

---

## 0. TL;DR

1. **Every mobile screen is broken (P0).** `<aside>` has `fixed md:relative … relative` (`Layout.tsx:280-284`). The trailing `relative` overrides `fixed`, so the closed drawer still takes 227px of flex width. Measured on mobile: `aside` is `position: relative` at 227px wide, and `main` starts at left 227 with a width of 163px. The fix is to delete the trailing `relative`. See `shots-before/mobile/*.png` and `extra/m/*.png`, where text wraps one character per line.
2. **The product looks like five brands.** There are three logos: the "L" tile in the app (`Layout.tsx:270,300`), a layers icon with "RISE PATH" on the landing page, and a "D" favicon (`public/favicon.svg`). The landing page is dark neon sci-fi. The dashboard is a light indigo SaaS page with a Playfair serif H1. Sonic is a black DAW style. Art is a dark stone editorial style. Programming and Blender use a light style with cyan or orange gradient words. Tokens are almost absent: `index.css:5-7` defines only `--font-serif`.
3. **Navigation is overloaded and miswired.** The sidebar holds 21 clickable rows. "Design Samples", a dev showcase with 7 items, is expanded by default (`Layout.tsx:50`). "Documents" contains only "AI Characters". "Learning Hub" points to `/courses` (`Layout.tsx:177`), so `/learning-hub` never highlights, and the LEARNING_HUB active-state logic is dead code (`Layout.tsx:225-235`). **Log Out has no onClick** (`Layout.tsx:485-500`).
4. **Japanese typography is never designed for.** No JP webfont is loaded (`index.html:8`). Playfair headings fall back to OS Mincho or Gothic mid-sentence ("おかえりなさい、Guest Explorer"). Japanese gets faux italics (landing headline 「本能的になる」, character quotes). Tracked uppercase eyebrows are applied to kana (ミ ッ シ ョ ン…). There are 194 uses of 9–11px text.
5. **Trust problems from fake signals.** The dashboard hard-codes "75% through Chapter 3", a "3-day streak", and "Level 12" in its copy (`MissionControlDashboard.tsx:95-200`), while the real pills show "0 day streak / Level 1". Two red "unread" dots are always on (`MissionControlDashboard.tsx:818`, `FloatingChatbot.tsx:194`). My Content shows "Total Earnings ¥4,500" to a guest (`MyContent.tsx:194-195`). The landing page claims "millisecond-by-millisecond" adaptation and "Cognitive Fingerprinting".
6. **i18n gaps.** Choosing FR shows English everywhere (`LanguageContext.tsx:27` maps fr to en). My Content is entirely hard-coded English, with a Japanese bot greeting even in EN (`MyContent.tsx:42,190,210`). Language toggles are duplicated inside pages (Assessment, Art, Vibe).
7. **Recommendation: "Studio + Worlds".** Use one calm, token-driven shell with light, dark and system modes. Each course "world" (Art, Vibe, Sonic, P-School, Blender) expresses itself only inside the content canvas through a scoped `data-world` accent and cover art. Japanese-first typography uses Inter + Noto Sans JP, with BIZ UDPGothic as a reading option. The primary nav shrinks to 5 items with a mobile bottom tab bar. Gamification moves into one honest progress cluster with a distinct "sunrise" accent. Tokens are in §5.

---

## 1. Visual identity coherence

| Surface | Look | Evidence |
|---|---|---|
| Landing | Black, radial pink-purple glow, mono "NEURO-ADAPTIVE LEARNING ENGINE V2.0", Playfair italic gradient word, "INITIALIZE PROFILE / ENTER SYSTEM" | `00-landing.png`, `ExperienceLandingView.tsx:164,172` |
| Dashboard | Light slate canvas, Playfair H1, letter-spaced "MISSION CONTROL", navy hero card, pastel pills | `home.png` |
| Learning Hub / Courses | Light SaaS cards with stock photos, but two different card designs | `learning-hub.png`, `courses.png` |
| Programming / Blender | "What will you **build**?" / "**create**?" with gradient word and fake version tags "DEV CAMPUS V2.0" and "3D LAB V1.0" | `programming.png`, `blender.png` |
| Sonic | Black DAW panel inside a light shell, mono headings, light sidebar beside a dark page, white strip at the right edge | `sonic.png` |
| Art | Stone-900 page, Playfair, sidebar turns dark, and the hero image is broken ("Museum Hall" alt text shows) | `art.png` |
| Programming shell | `theme='vibe'` turns the sidebar and `main` black (`Layout.tsx:60-66`), but the page itself is light, so black gutters frame a light page | `programming.png` |

Root causes:
- Theme is a string enum (`ThemeContext.tsx:4`) mapped to hard-coded Tailwind class bundles (`Layout.tsx:80-110`) and chosen by route prefix (`Layout.tsx:56-70`). `'sonic'` is declared but never applied, and the `PROGRAMMING` prefix rule contradicts the light page.
- There is no token layer. The code has 145 arbitrary hex colors (`bg-[#…]`), 16 Tailwind hue families (slate 1728 uses, indigo 391, stone 226, cyan 142, purple 128, emerald 127, orange 101, amber 98, green 75, blue 70, rose 62, red 54…), 15 radius values including 9 arbitrary ones (`rounded-[2.5rem]`, `[1.4rem]`, `[28px]`…), and 173 custom tracking values.
- Logos: "L" tile (`Layout.tsx:270,300`; also on the profile card), layers icon (landing), "D" + arrow (`public/favicon.svg`). The app is "Rise Path" and none of them is an R.

## 2. Typography

- Loaded fonts are Inter 300–700 and Playfair Display (`index.html:8`). Body text is set in plain CSS (`index.css:9-11`), not through `@theme --font-sans`. There is no CJK font.
- `font-serif` appears 79 times in 15 files. Playfair is a high-contrast Didone that is weak below about 24px and has no Japanese pairing. In JP the browser falls back to the OS serif (Hiragino or Yu Mincho on Mac and Windows). The dashboard H1 therefore renders Mincho kana next to Didone Latin (`jp/home.png`), while the card titles beneath are Gothic.
- `font-mono` appears 115 times, mostly as decoration (eyebrows, fake version numbers, footers). The stack resolves to the system mono, which is Courier-like on many machines. See the Library template cards in `library.png`, which read as a typewriter.
- Six page-header patterns are in use: a serif H1 with eyebrow (dashboard), a bold slate-700 H1 (hub), a bold slate-900 H1 (courses), a centred H1 (profile, assessment), an icon tile + H1 (life journal), and a gradient-word H1 (programming, blender).
- Small text: 194 uses of `text-[9px|10px|11px]`. This is illegible for kanji. The minimum should be 12px, with 13px preferred for JP.
- Weights: a 300 weight is loaded and used for subtitles. Thin weights are hard to read in JP Gothic at small sizes.

### JP-specific failures
- **Faux italic on Japanese.** The landing headline 「本能的になる」 uses `italic font-serif` (`ExperienceLandingView.tsx:172`), and so do the AI-partner quotes (`jp/characters.png`). Japanese has no italic, so the browser slants the glyphs.
- **Letter-spaced uppercase eyebrows on kana**, e.g. 「ミ ッ シ ョ ン コ ン ト ロ ー ル」 and 「再 開 ポ イ ン ト」 (`jp/home.png`). `uppercase` does nothing in JP and the wide tracking breaks words apart.
- **Bad line breaks.** Examples: 「ブロックプログラミングバト／ル」 (`jp/learning-hub.png`), 「イノベーション・パートナ／ー」 wrapping inside a pill (`jp/characters.png`), and 「プロファイルを初期化」 as the JP CTA. There is no `word-break: auto-phrase` and no `text-wrap: balance`.
- `lang` handling is fine at runtime (`LanguageContext.tsx:39-47` sets `ja`), but `index.html:2` hard-codes `en` for first paint. No `:lang(ja)` rules exist.

## 3. Color, contrast, spacing

- `text-slate-400` (#94a3b8) is used 310 times for captions and helper text. It reaches only **2.56:1** on white and 2.45:1 on slate-50, which fails AA. Examples: "Wellness trends only…", "90d lookback", the profile footnote, mood labels in Life Journal.
- The landing footer uses `text-white/20` on black (`ExperienceLandingView.tsx:234`) at **1.66:1**. The streak pill (orange-500 on orange-50) is 2.64:1. Sonic's "ENTER LAB" (slate-600 on black) is 2.77:1.
- Spacing and width: each page picks its own max width. Settings and Life Journal sit in a narrow centred column of about 600–670px. The hub is about 1024px, courses about 1056px, and the dashboard is full-bleed with no max width (`Layout.tsx:257-263`). On Programming and Blender the card grid is wider than the intro box above it (`programming.png`).
- `page-transition` animates `scale(0.985)` (`index.css:298-311`). It is applied to every route, causing a slight blur during the transition and creating a transform containing block for `position: fixed` children while it runs.

## 4. Information architecture and navigation

Current sidebar (`Layout.tsx:175-217`, plus Settings, Language and Log Out): 5 top-level items, then **Design Samples** (7 dev demos, open by default), **Documents** (contains only "AI Characters"), **Account** (Student Card, AI Diagnosis, History, Badges, Generated, My Content), Settings, a language switch and Log Out. That is 21 rows with every group open.

Problems:
- Internal demo pages take the most prominent part of the nav (`Layout.tsx:50` `useState('lab')`).
- There are two catalogs. `/learning-hub` ("Learning Content", 9 track tiles with a "Manage" button) and `/courses` ("Curriculum", 16 course cards with search and filters) use different card systems. The nav item labelled "Learning Hub" opens `/courses` (`Layout.tsx:177`). Deep pages such as Blender, Art, Sonic and Programming highlight nothing because the active check compares against `LEARNING_HUB`, which is not in the nav (`Layout.tsx:229-235`).
- Creation is split across three places: "AI Course Generator" (top level), "My Content" (under Account, a second chat-based generator branded "Gemini 3 Pro Architect"), and "Generated" (under Account).
- "AI Learning Diagnosis" is a one-off onboarding flow but sits in primary nav. Its results also live under Account → AI Diagnosis.
- Collapsed rail (`collapsed-home-jp.png`): labels only appear through `title` tooltips. Clicking a group expands the whole sidebar. The EN/JP/FR switch stacks vertically.
- The floating chatbot is `z-[9999]` at the bottom right on every page and overlaps cards and Save buttons (`life-journal.png`). It has no `aria-label` and shows a permanent red dot whenever there are zero messages (`FloatingChatbot.tsx:187-195`).
- The language switch is duplicated: once in the sidebar, and again inside Assessment, Art and Vibe pages, each styled differently.
- Log Out is dead, and its `mt-auto` has no effect because `<nav>` is not a flex column (`Layout.tsx:306,485`).

## 5. Empty states and gamification signals

- Dashboard (`full/home-en.png`): the "Now Playing" hero is static ("Vibe Coding: The Engine… 75% through Chapter 3"), even for a brand-new guest. Other signals contradict each other: the Quest Board shows "Lesson Complete 1/3", the AI Coach says "Keep the 3-day streak", and the Weekly Goal shows 75%, while the real pills show "0 day streak" and "Level 1". The page has seven stacked sections with no prioritisation.
- Notifications: the level pill dot and the chatbot dot are both always red. This teaches users to ignore badges.
- My Content (`my-content.png`): an empty chat with about 260px of blank space, plus fake earnings. The page also scrolls the whole app shell up by about 17px on mount, clipping the sidebar header, because `messagesEndRef.scrollIntoView` scrolls every ancestor (`MyContent.tsx:55`). Use `container.scrollTop = container.scrollHeight` instead.
- Profile (`profile.png`): a pleasant ID card concept, but it is almost empty, with Level 1, XP 0 and no next step. Badges and history are hidden in nav sub-items instead of on the card.
- Life Journal: the strongest form. "Detailed fields unlock after 7 entries" is a good progressive-disclosure pattern to keep.
- Broken images show raw alt text. Measured failures: 1 on learning-hub (Unity), 1 on courses, 1 on blender (Procedural Geometry Nodes), and 5 on art (Museum Hall hero, Vermeer, and others). Some images don't match their course: "Donut Tutorial" shows a sunflower and "Low Poly Isometric Room" shows a motorbike. `LearningHub.tsx:474` uses `alt={title}` with no `onError` fallback.

## 6. Mobile

- P0 layout bug, explained in TL;DR item 1. With it fixed, the page structure would still need a bottom tab bar, a sticky compact page header, and tap targets of at least 44px. The language pills are about 22px today.
- The drawer (`menu-open-m.png`) shows 18 rows and pushes Settings and Log Out below the fold.
- The hamburger has no `aria-label` and stays `text-slate-600` even on dark themes (`Layout.tsx:273`).

## 7. Accessibility

- `focus-visible` appears 0 times, and `outline-none` appears 27 times. Default UA outlines appear on some elements (`focus-tab-jp.png`), but there is no consistent ring.
- Icon-only buttons have no names: sidebar collapse (`Layout.tsx:287`), hamburger (`:273`), chatbot FAB, and the course-card chevrons. There are only 21 `aria-label`s across 121 TSX files.
- Collapsible nav groups have no `aria-expanded`, and there is no `aria-current="page"` on the active item.
- `dark:` appears 0 times, and `prefers-color-scheme` is ignored (`darkpref-courses.png`). `prefers-reduced-motion` is handled (`index.css:343,457-487`), which is good.
- Alt text exists but duplicates titles. Decorative cover images should use `alt=""`, with the title carried by the heading.

## 8. i18n consistency

- FR is offered in the sidebar, landing and assessment, but `resolvedLanguage = fr ? 'en'` (`LanguageContext.tsx:27`). Either ship FR strings or hide it or mark it "FR (beta)".
- Copy objects are defined inline per component (e.g. `Layout.tsx:114-171`). There is no shared dictionary, no ICU plurals ("0 day streak"), and no number or date formatting by locale (`10/18/2026` appears under JP in Life Journal).
- Untranslated pages: My Content, the dashboard hero title, and Sonic and Programming fake version tags.

---

## 9. Design direction options

### Option A: "Calm Studio" (light-first, editorial, single accent)
A Notion, Linear or Brilliant-style neutral shell on warm paper (#F7F7F4) with ink text, one indigo action color, and illustrated covers. It is best for long reading, adults and JP legibility, and is the cheapest to retrofit. The risk is that it can feel generic unless the cover art and worlds carry personality.

### Option B: "Night Lab" (dark-first, unify around the landing page)
Everything adopts the landing's dark neon look, like Raycast or Vercel dark. It fits Vibe Coding, Sonic and P-School. The risks are fatigue over long JP reading sessions, an unfriendly feel for younger learners and parents, and dark stock photos that look muddy. It also cements the pseudo-science tone.

### Option C: "Quest Path" (playful, Duolingo-like)
Chunky rounded UI, bright primaries, a mascot-led map path, and heavy streak, XP and league mechanics. It gives strong habit loops, but it undercuts the adult and professional tracks (Blender, Art History, AI dev, Life Journal wellness), and Japanese adult learners often find it childish.

### Recommendation: A + scoped worlds ("Studio + Worlds")
- **One shell.** The sidebar or tab bar, top bar, page header, cards and settings look the same everywhere and come from tokens. Light, dark and system modes are user-selectable.
- **Worlds live inside the canvas.** `<div data-world="art|vibe|sonic|pschool|blender|web">` changes `--accent`, `--world-canvas`, the display font and the cover art. A dark world (Sonic, Vibe, P-School) sets `data-theme="dark"` on `<html>` for that route, so the shell turns dark consistently instead of a dark panel sitting in a light frame.
- **Sunrise accent for achievement only.** Indigo means "do or go" (navigation and actions). Amber "sunrise" means "you grew" (XP, streak, badges, level-ups). That gives gamification a recognisable, meaningful colour, and it matches the brand name "Rise Path".
- **Honest gamification.** One progress cluster: a streak flame, an XP ring to the next level, and a weekly goal. It sits in the top bar (desktop) or the top of the dashboard (mobile). It shows real data only, with friendly zero-states, and badges appear only for real unread items.
- **Landing restyled with the same tokens** (a dark hero is fine via dark tokens). Replace jargon with a concrete promise, real product screenshots of the Vibe terminal, Blender viewport, P-School RPG and AI-authored lessons, an "AI tutors and Claude Code authoring" story, and honest claims. Example JP headline: 「つくりながら学ぶ。AIが、あなた専用の教材に。」 CTAs: 「無料ではじめる」 and 「ゲストで試す」.

Reference patterns from competitors: Duolingo (bottom tab bar, a top-bar streak and XP cluster, semantic colours), Brilliant (light shell, illustrated course covers, progress on cards, less scrolling on course pages), Khan Academy and Khanmigo (AI tutor placed in context rather than as a generic FAB), Notion and Linear (sidebar with a command palette, Cmd+K), Progate, Schoo and N予備校 (JP Gothic UI with generous line-height and illustrated characters).

---

## 10. Token set (implementable as `styles/tokens.css`, Tailwind v4)

### 10.1 Color (all text pairs checked for WCAG AA)

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--rp-canvas` | `#F7F7F4` | `#0D0D12` | app background (warm paper / ink) |
| `--rp-surface` | `#FFFFFF` | `#15151C` | cards, sidebar |
| `--rp-sunken` | `#F0F0EB` | `#1C1C25` | wells, stat tiles, code bg |
| `--rp-border` | `#E4E4DE` | `#2A2A35` | dividers, card borders (decorative) |
| `--rp-border-strong` | `#8A8A96` | `#62626F` | input and checkbox outlines (≥3:1, WCAG 1.4.11) |
| `--rp-fg` | `#16161D` | `#ECECF1` | 18.0 / 15.4 : 1 |
| `--rp-fg-2` | `#454552` | `#B6B6C2` | secondary text, 9.4 / 9.1 |
| `--rp-fg-3` | `#676774` | `#8C8C9A` | captions, **replaces slate-400**, 5.6 / 5.5 |
| `--rp-primary` | `#4F46E5` | `#8C86FF` | actions, links, focus |
| `--rp-primary-hover` | `#4338CA` | `#A29DFF` | |
| `--rp-on-primary` | `#FFFFFF` | `#0D0D12` | 6.3 / 6.4 |
| `--rp-primary-soft` | `#EEF0FF` | `#23224A` | selected nav and tinted chips |
| `--rp-primary-text` | `#4338CA` | `#A9A4FF` | text on soft (7.0) |
| `--rp-sun` | `#F59E0B` | `#FBBF24` | achievement fills (XP bar, streak flame) |
| `--rp-sun-soft` | `#FFF4DB` | `#2E2410` | |
| `--rp-sun-text` | `#A34A06` | `#FBBF24` | 5.9 / 10.9 |
| `--rp-success` | `#137A3A` | `#4ADE80` | |
| `--rp-danger` | `#B91C1C` | `#F87171` | |
| `--rp-info` | `#0369A1` | `#38BDF8` | |
| `--rp-focus` | `#4F46E5` | `#A9A4FF` | ring color |
| `--rp-overlay` | `rgb(13 13 18 / .5)` | `rgb(0 0 0 / .6)` | drawer and modal scrim |

World accents (scoped through `[data-world=…]` and used only inside the content canvas):
`art #B4532A` (terracotta; display font Newsreader / Noto Serif JP), `vibe #22C55E` (terminal green, dark), `sonic #06B6D4` (cyan, dark), `pschool #F97316` (pixel orange, dark), `blender #EA7600`, `web #0EA5E9`, `ai #8B5CF6`. Each world exposes `--world-accent`, `--world-accent-soft` and `--world-on-accent`.

### 10.2 Typography

```css
--font-sans: "Inter", "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", system-ui, sans-serif;
--font-read-ja: "BIZ UDPGothic", "Noto Sans JP", sans-serif;   /* optional 'reading mode' for lesson bodies (UD font) */
--font-serif: "Newsreader", "Noto Serif JP", "Hiragino Mincho ProN", serif; /* Art world and pull quotes only */
--font-mono: "JetBrains Mono", "Noto Sans Mono CJK JP", ui-monospace, monospace; /* code only */
```
Google Fonts request: `Inter:wght@400..700` + `Noto+Sans+JP:wght@400..700` + `JetBrains+Mono:wght@400;600`, plus `BIZ+UDPGothic:wght@400;700` and `Newsreader` loaded lazily on the routes that need them. Drop Playfair from the shell.

| Step | Size / line-height (EN) | JP line-height | Weight | Use |
|---|---|---|---|---|
| `display` | 40 / 48 (2.5rem) | 1.35 | 700 | landing and world heroes |
| `h1` | 30 / 38 | 1.4 | 700 | page title (one per page) |
| `h2` | 22 / 30 | 1.45 | 700 | section |
| `h3` | 18 / 26 | 1.5 | 600 | card title |
| `body-lg` | 17 / 28 | 1.85 | 400 | lesson reading |
| `body` | 15 / 24 | 1.75 | 400 | default UI |
| `small` | 13 / 20 | 1.6 | 400–500 | meta, helper |
| `caption` | 12 / 16 | 1.5 | 500 | badges, minimum size |
| `overline` | 12 / 16, `0.06em`, uppercase | `0`, no uppercase | 600 | eyebrows |

Rules:
```css
:root { font-family: var(--font-sans); font-feature-settings: "cv11", "ss01"; }   /* Inter tidy glyphs */
:lang(ja) { line-height: 1.75; letter-spacing: 0.02em; line-break: strict; }
:lang(ja) :is(h1,h2,h3,.title,button,.chip) { font-feature-settings: "palt"; letter-spacing: 0.01em; word-break: auto-phrase; text-wrap: balance; }
:lang(ja) :is(em, i, .italic) { font-style: normal; font-weight: 600; }       /* no faux italics */
:lang(ja) .overline { text-transform: none; letter-spacing: 0; }
.tabular { font-variant-numeric: tabular-nums; }                               /* XP, timers, stats */
```
Reading measure: `max-width: 40em` for lesson text (about 36–40 JP characters, about 70 Latin characters per line). Ban `text-[9-11px]`.

### 10.3 Spacing, layout, radii, elevation, motion

- **Spacing scale** (4px base): 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- **Page gutters:** 16px (mobile), 24px (≥640), 32px (≥1024).
- **Content widths:** `--w-read: 720px`, `--w-form: 640px`, `--w-page: 1200px`, `--w-wide: 1440px`.
- **Shell:** sidebar 248px, collapsed rail 64px, top bar 56px, mobile tab bar 64px plus `env(safe-area-inset-bottom)`.
- **Radii:** `--radius-sm: 6px` (chips, inner), `--radius-md: 10px` (buttons, inputs), `--radius-lg: 14px` (cards), `--radius-xl: 20px` (hero panels, modals, sheets), `--radius-full`. No other values.
- **Shadows (light):**
  - `--shadow-1: 0 1px 2px rgb(16 16 24/.06)`
  - `--shadow-2: 0 1px 2px rgb(16 16 24/.04), 0 6px 16px rgb(16 16 24/.06)` (hover and raised)
  - `--shadow-3: 0 16px 40px rgb(16 16 24/.14)` (popover and modal)
  - Dark mode: shadows at 40% opacity, with elevation expressed by moving from surface to sunken to `#22222C` plus a border.
- **Focus:** `--ring: 0 0 0 2px var(--rp-surface), 0 0 0 4px var(--rp-focus)`, applied through `:focus-visible` globally.
- **Motion:** durations of 120ms (hover), 200ms (UI) and 320ms (page or sheet), with easing `cubic-bezier(.22,.61,.36,1)`. The page transition becomes opacity plus `translateY(4px)` only, with no scale.

### 10.4 Tailwind v4 wiring sketch

```css
/* styles/tokens.css, imported by index.css after @import "tailwindcss" */
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
:root { --rp-canvas:#F7F7F4; --rp-surface:#FFF; /* …table above… */ }
:root[data-theme=dark] { --rp-canvas:#0D0D12; --rp-surface:#15151C; /* … */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) { /* same dark values */ } }
[data-world=art]   { --world-accent:#B4532A; --world-accent-soft:#F7E9E2; }
[data-world=sonic] { --world-accent:#06B6D4; --world-accent-soft:#0B2730; }
@theme inline {
  --color-canvas: var(--rp-canvas);  --color-surface: var(--rp-surface); --color-sunken: var(--rp-sunken);
  --color-line: var(--rp-border);    --color-line-strong: var(--rp-border-strong);
  --color-fg: var(--rp-fg); --color-fg-2: var(--rp-fg-2); --color-fg-3: var(--rp-fg-3);
  --color-primary: var(--rp-primary); --color-primary-soft: var(--rp-primary-soft); --color-on-primary: var(--rp-on-primary);
  --color-sun: var(--rp-sun); --color-sun-soft: var(--rp-sun-soft); --color-sun-text: var(--rp-sun-text);
  --color-world: var(--world-accent, var(--rp-primary));
  --font-sans: …; --font-serif: …; --font-mono: …;
  --radius-sm:6px; --radius-md:10px; --radius-lg:14px; --radius-xl:20px;
  --shadow-1: …; --shadow-2: …; --shadow-3: …;
}
*:focus-visible { outline: none; box-shadow: var(--ring); border-radius: inherit; }
```
After this, components use `bg-surface text-fg border-line rounded-lg shadow-1`, with no hex or slate classes. Add an ESLint or stylelint rule that rejects `\[#[0-9a-f]{3,8}\]` and `rounded-\[` in `components/`.

---

## 11. Component patterns (shell and discovery)

1. **`AppShell`**
   - Sidebar: brand, 5 primary items, a "Continue" mini-card showing the last lesson with a progress ring, then an avatar menu at the bottom (Profile, Badges, History, Settings, Language, Theme, Log out).
   - Collapsed rail: a real tooltip with `aria-label` on each icon.
   - Mobile: a 56px top bar (brand, search, Ask AI, avatar) and a bottom tab bar.
   - Route-to-theme mapping lives in a `worlds.ts` config, not in `Layout`.
2. **Primary IA (5 items)**
   - **Home** (ホーム)
   - **Learn** (学ぶ): one catalog at `/learn` with tabs for My paths, Explore and Saved, merging `/learning-hub` and `/courses`
   - **Create** (つくる): AI course generator, My content, generated items, and "Connect Claude Code / MCP" for authoring
   - **Journal** (記録): life journal, insights and diagnosis results
   - **Mentors** (AIパートナー)

   Move AI Diagnosis into onboarding and a Profile tab. Move Design Samples to `/dev/samples` behind `import.meta.env.DEV` or `?dev=1`. Delete "Documents".
3. **`PageHeader`**: breadcrumb, optional overline, H1, description, actions slot, and an optional tab bar. This one component replaces the six current header styles.
4. **`CourseCard`** (one component for hub, courses, programming and blender)
   - 16:9 cover from a generated cover system: a world gradient plus a glyph pattern, or consistent AI illustrations, with an `onError` fallback to the generated cover.
   - World chip, a 2-line clamped title, and a meta row: `lessons · duration · level`.
   - A progress bar when started, the whole card clickable, `alt=""` on the cover, and hover `shadow-2`.
   - Variants: `track` (large) and `compact` (list).
5. **`ProgressCluster`**: streak (sun), level ring with tabular XP, and weekly goal. It has zero-state copy: 「今日の1レッスンで連続記録スタート」.
6. **`EmptyState`**: illustration or icon, a title, one sentence and one primary action. Use it for My Content, Profile badges, Journal and Generated.
7. **`ListRow`** (Settings pattern, already good): 44px+ height, leading icon in a sunken tile, label and value, chevron.
8. **`AskAI`**: a top-bar button, or the tab-bar center action, opening a right sheet (desktop) or full-screen sheet (mobile). It is context-aware (lesson, page) and replaces the global FAB, with no fake unread dot.
9. **`CommandPalette`** (Cmd+K, already promised at `ProgrammingCurriculum.tsx:202`): search courses, lessons, glossary and commands such as switching language or theme.
10. **`LanguageSwitch`**: one component in the avatar menu, Settings and the landing header. Remove the per-page duplicates. Hide FR until it has strings.

## 12. Prioritised fix list

- **P0**
  - Remove the trailing `relative` on `<aside>` (`Layout.tsx:284`).
  - Wire up Log Out (`Layout.tsx:485`).
  - Point "Learning Hub" at `/learning-hub` or merge the catalogs, and fix active states (`Layout.tsx:177,225-235`).
  - Fix the My Content `scrollIntoView` shell shift (`MyContent.tsx:55`).
- **P1**
  - Add the token file, the JP font stack and `:lang(ja)` rules, and replace `text-slate-400` with `fg-3`.
  - Add a global `:focus-visible` ring and `aria-label`s on icon buttons.
  - Hide Design Samples in production.
  - Remove fake data, red dots and earnings.
  - Add image fallbacks.
- **P2**
  - Build AppShell v2 (5-item IA, bottom tabs, avatar menu, Ask AI sheet).
  - Unify `PageHeader` and `CourseCard`.
  - Implement worlds via `data-world`, light/dark/system theme, and a landing rewrite.
  - Build the command palette.
- **P3**
  - Ship FR strings or remove FR.
  - Centralise the i18n dictionary with ICU plurals and `Intl` formatting.
  - Run a lint rule against arbitrary colors and radii.

Sources consulted for JP typography and competitor notes:
- [ics.media: palt kerning in Japanese](https://ics.media/en/entry/14087/)
- [W3C CSSWG thread on palt / Yu Gothic UI](https://lists.w3.org/Archives/Public/public-css-archive/2025Sep/1022.html)
- [W3C CSSWG thread on Noto Sans JP default](https://lists.w3.org/Archives/Public/public-css-archive/2026Feb/0735.html)
- [tak-dcxi JP CSS gist](https://gist.github.com/tak-dcxi/0f8b924d6dd81aaeb58dc2e287f2ab3a)
- [Brilliant 5.0 release notes (UI redesign, less scrolling)](https://www.apkmirror.com/apk/brilliant-org/brilliant/brilliant-5-0-0-release)
