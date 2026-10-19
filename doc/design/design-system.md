# Rise Path design system: tokens and typography

Visual direction: **Sunrise Studio**. Warm paper canvas, ink text, one indigo action color, and an amber "sun" used only for achievements. Each track ("world") shows its own accent color only inside its content canvas. Background is in `doc/brushup-2026/PLAN.ja.md` §4.

| File | What it holds |
|---|---|
| `styles/tokens.css` | Raw `--rp-*` custom properties: light, dark and system scopes, plus the `[data-world]` accents. Plain CSS in `@layer base`. |
| `styles/typography.css` | Per-language leading for the type scale, Japanese typesetting rules, the `tabular` / `eyebrow` utilities, and the JP migration shims. |
| `index.css` | Imports both files right after `tailwindcss`. Maps tokens to utilities (`@theme` / `@theme inline`), defines the `dark:` variant, the body defaults, the global focus ring and the scrollbar. |
| `index.html` | Google Fonts request and `<body class="bg-canvas text-fg antialiased">`. |

New UI uses the utilities below, not hex values or `slate-*`.

---

## 1. Themes

| Scope | Selector | Behaviour |
|---|---|---|
| Light (default) | `:root`, `[data-theme="light"]` | Always on unless a dark scope applies. |
| Dark | `[data-theme="dark"]` on `<html>` or any subtree | Dark values for that subtree. |
| System | `[data-theme="system"]` on a subtree | Dark only when the OS prefers dark. **Only this scope reacts to `prefers-color-scheme`.** |

There is no app-wide auto dark mode yet: existing components assume a white background. The lesson reader may opt in with `data-theme="system"` on its root.

The `dark:` variant follows the same rules. It matches inside `[data-theme="dark"]`, and inside `[data-theme="system"]` when the OS prefers dark. It does **not** follow the OS setting app-wide, unlike Tailwind's default.

```html
<div data-theme="dark" class="bg-canvas text-fg">…</div>
<button class="bg-surface dark:bg-sunken">…</button>
```

---

## 2. Color tokens

All text pairs meet WCAG AA (4.5:1). Ratios are measured on `surface` unless noted.

| Utility color | Token | Light | Dark | Use | Contrast (light / dark) |
|---|---|---|---|---|---|
| `canvas` | `--rp-canvas` | `#F7F7F4` | `#0D0D12` | App background | — |
| `surface` | `--rp-surface` | `#FFFFFF` | `#15151C` | Cards, sidebar | — |
| `sunken` | `--rp-sunken` | `#F0F0EB` | `#1C1C25` | Wells, stat tiles, code background | — |
| `raised` | `--rp-raised` | `#FFFFFF` | `#22222C` | Popovers, modals (dark elevation) | — |
| `overlay` | `--rp-overlay` | `rgb(13 13 18 / .5)` | `rgb(0 0 0 / .6)` | Drawer / modal scrim | — |
| `line` | `--rp-border` | `#E4E4DE` | `#2A2A35` | Decorative dividers, card borders | — |
| `line-strong` | `--rp-border-strong` | `#8A8A96` | `#62626F` | Input and checkbox outlines | 3.4 / 3.0 (UI ≥ 3:1) |
| `fg` | `--rp-fg` | `#16161D` | `#ECECF1` | Body text | 18.0 / 15.4 |
| `fg-2` | `--rp-fg-2` | `#454552` | `#B6B6C2` | Secondary text | 9.4 / 9.1 |
| `fg-3`, `muted` | `--rp-fg-3` | `#676774` | `#8C8C9A` | Captions, meta. **Replaces `text-slate-400`** | 5.6 / 5.5 (4.9 on sunken) |
| `primary` | `--rp-primary` | `#4F46E5` | `#8C86FF` | Primary buttons, links, focus | — |
| `primary-hover` | `--rp-primary-hover` | `#4338CA` | `#A29DFF` | Hover state of `primary` | — |
| `on-primary` | `--rp-on-primary` | `#FFFFFF` | `#0D0D12` | Text on `bg-primary` | 6.3 / 6.4 |
| `primary-soft` | `--rp-primary-soft` | `#EEF0FF` | `#23224A` | Selected nav row, tinted chip | — |
| `primary-text` | `--rp-primary-text` | `#4338CA` | `#A9A4FF` | Text on `primary-soft` | 7.0 / 6.8 |
| `sun` | `--rp-sun` | `#F59E0B` | `#FBBF24` | **Achievement fills only** (XP bar, streak flame). Never text. | 2.2 (fill only) |
| `sun-soft` | `--rp-sun-soft` | `#FFF4DB` | `#2E2410` | Achievement chip background | — |
| `sun-text` | `--rp-sun-text` | `#A34A06` | `#FBBF24` | Achievement text | 5.4 on sun-soft / 9.1 |
| `success` | `--rp-success` | `#137A3A` | `#4ADE80` | Status | 5.4 / 10.4 |
| `danger` | `--rp-danger` | `#B91C1C` | `#F87171` | Status, errors | 6.5 / 6.6 |
| `info` | `--rp-info` | `#0369A1` | `#38BDF8` | Status | 5.9 / 8.5 |
| `focus` | `--rp-focus` | `#4F46E5` | `#A9A4FF` | Focus ring | — |

Every color works with any color utility and with opacity modifiers: `bg-canvas`, `text-fg-2`, `border-line`, `divide-line`, `ring-focus`, `bg-primary/10`, `hover:bg-primary-hover`.

Utilities resolve the `--rp-*` variable where they are used (`@theme inline`). A `[data-theme]` or `[data-world]` subtree therefore recolors itself without new classes.

### Status colors

Status always comes as icon plus text, never color alone. There are no `*-soft` variants for status yet; use `bg-sunken` or a bordered row.

---

## 3. World accents

A track puts `data-world` on its **content canvas** (lesson body, track hero). The shell, table of contents, progress, quizzes and AI tutor never change color.

```html
<section data-world="vibe">
  <span class="rounded-full bg-world-soft px-2 text-caption text-world">Vibe Coding</span>
  <div class="h-1 rounded-full bg-world-accent" style="width: 40%"></div>
</section>
```

| Utility color | Variable | Use |
|---|---|---|
| `world` | `--world-accent-text` | `text-world`, `border-world`, and `bg-world` with `text-on-world`. This is the AA-safe darker value. |
| `world-accent` | `--world-accent` | Bright fill for covers, illustrations and decorative bars. **Not for text**; most accents are below 3:1 on white. |
| `world-soft` | `--world-accent-soft` | Tinted chip or badge background behind `text-world`. |
| `on-world` | `--world-on-accent` | Text on `bg-world` (white in light, ink in dark). |

Outside any `[data-world]`, and for an unknown world name, these fall back to `primary-text` / `primary` / `primary-soft` / `on-primary`.

| `data-world` | Accent (fill) | Text, light | On surface / canvas / soft | Soft, light | Text, dark | Soft, dark |
|---|---|---|---|---|---|---|
| `art` | `#B4532A` | `#A1461F` | 6.2 / 5.7 / 5.2 | `#F7E9E2` | `#E9936A` | `#2E1A12` |
| `vibe` | `#22C55E` | `#15803D` | 5.0 / 4.7 / 4.6 | `#EDF8F1` | `#4ADE80` | `#0F2A1A` |
| `unity`, `ai` | `#8B5CF6` | `#7C3AED` | 5.7 / 5.3 / 4.9 | `#F1ECFE` | `#A78BFA` | `#221A3D` |
| `sonic` | `#06B6D4` | `#0E7490` | 5.4 / 5.0 / 4.9 | `#E6F7FA` | `#22D3EE` | `#0B2730` |
| `pschool` | `#F97316` | `#C2410C` | 5.2 / 4.8 / 4.7 | `#FFF1E6` | `#FB923C` | `#2E1A0C` |
| `blender` | `#EA7600` | `#B45309` | 5.0 / 4.7 / 4.6 | `#FFF3E2` | `#F59E42` | `#2C1D0A` |
| `web` | `#0EA5E9` | `#0369A1` | 5.9 / 5.5 / 5.2 | `#E0F2FE` | `#38BDF8` | `#0B2233` |

All dark text values are 6:1 or better on dark `surface`, `canvas`, `sunken` and soft.

Rules:
- **Do not put `text-world` on `bg-sunken`.** `vibe` and `blender` drop to 4.4:1 there.
- A progress line in `bg-world-accent` is decorative. For vibe, sonic, web, pschool and blender it does not reach 3:1, so always pair it with a number ("40%").
- Dark worlds (Vibe, Sonic, P-School) should set `data-theme="dark"` on the whole route (Phase 2), not put a dark panel inside a light frame.

---

## 4. Typography

### Font stacks

| Utility | Stack | Use |
|---|---|---|
| `font-sans` (default) | `Inter`, `Noto Sans JP`, Hiragino Sans, Hiragino Kaku Gothic ProN, Yu Gothic UI, Meiryo, system-ui | All UI and body text |
| `font-serif` | `Newsreader`, `Noto Serif JP`, Hiragino Mincho ProN, Yu Mincho | Art world and pull quotes only. Not shell headings (WP-09 removed them from the dashboard and landing). |
| `font-mono` | `JetBrains Mono`, ui-monospace, SFMono-Regular, Menlo, Consolas, `Noto Sans JP` | Code only, not decoration |
| `font-ud` | `BIZ UDPGothic`, `Noto Sans JP`, … | Optional UD reading font for lesson bodies. **Not loaded globally** (see below). |

Playfair Display is gone. Existing `font-serif` usages now render Newsreader / Noto Serif JP.

### Loading

`index.html` preconnects to Google Fonts and makes two requests, both with `display=swap`.

The first stylesheet blocks rendering, as the first screen needs it:

| Family | Axes requested | Why it is in the blocking request |
|---|---|---|
| Inter | `wght@300..700` (variable) | UI font. 300 is kept because 21 existing `font-light` usages would otherwise change weight. |
| Noto Sans JP | `wght@400..700` (variable) | Japanese UI and body text |
| JetBrains Mono | `wght@400..700` (variable) | Code; existing `font-mono font-bold` labels |

The second stylesheet does not block rendering. It is loaded with `media="print"` and switched to `all` on load, with a `<noscript>` copy:

| Family | Axes requested | Why it is still loaded |
|---|---|---|
| Newsreader | `ital,opsz,wght@0,6..72,400..700;1,6..72,400..700` | `font-serif` on the Art routes and the Vibe prologue, including real italics in EN |
| Noto Serif JP | `wght@400..700` (variable) | The same serif text in JP |

The dashboard and landing no longer use `font-serif` (WP-09), so no first-paint screen waits for the serif stylesheet. That removes about 117 kB of render-blocking CSS. A serif screen opened first may show the fallback serif for a moment before the swap.

Google serves each family as `unicode-range` slices (124 for each Noto JP family). The browser downloads a slice only when rendered text needs it. EN screens never fetch Noto glyph files, and screens without `font-serif` never fetch Newsreader or Noto Serif JP glyphs. A later step could move the serif `<link>` onto the Art routes only.

**BIZ UDPGothic is not in `index.html`.** When the reader's "UD font" setting is chosen, inject its stylesheet on demand (`family=BIZ+UDPGothic:wght@400;700`) and apply `font-ud`. Until it loads, `font-ud` falls back to Noto Sans JP.

### Type scale

| Utility | Size | Line-height EN | Line-height JP | Weight | Use |
|---|---|---|---|---|---|
| `text-display` | 40px | 48px (1.2) | 1.35 | 700 | Landing and world heroes |
| `text-h1` | 30px | 38px | 1.4 | 700 | Page title (one per page) |
| `text-h2` | 22px | 30px | 1.45 | 700 | Section |
| `text-h3` | 18px | 26px | 1.5 | 600 | Card title |
| `text-body-lg` | 17px | 28px | 1.85 | 400 | Lesson reading |
| `text-body` | 15px | 24px | 1.75 | 400 | Default UI text |
| `text-small` | 13px | 20px | 1.6 | 400 | Meta, helper text |
| `text-caption` | 12px | 16px | 1.5 | 500 | Badges. **Minimum size; nothing below 12px.** |

The JP line-height is picked automatically from the nearest `[lang]` ancestor (`<html lang>` is set by `LanguageContext`). A block of English content inside a JP page should carry `lang="en"` so it gets EN leading and keeps its italics. `leading-*` and `font-*` utilities still override the defaults (`text-h2 font-semibold`).

Tailwind's own `text-xs … text-9xl` are unchanged. Migrate to the scale above when a component is restyled.

### Helpers

| Utility | Effect |
|---|---|
| `tabular` | `font-variant-numeric: tabular-nums`, for XP, timers and stats (same as Tailwind's `tabular-nums`) |
| `eyebrow` | 12/16, weight 600, `0.06em`, uppercase. In Japanese: no uppercase and `0` tracking. Plan §4.2 calls this `.overline`, but Tailwind already uses `overline` for `text-decoration-line`, so it is named `eyebrow`. |
| `max-w-measure` | `40em` reading measure (about 36–40 JP characters, about 70 Latin characters) |

### Japanese rules (`:lang(ja)`)

Applied globally from `styles/typography.css`.

| Rule | Selector | Layer |
|---|---|---|
| `letter-spacing: .02em`, `line-break: strict` | the `[lang]` root (inherited) | base |
| `line-height: 1.75` | `p`, `blockquote` | base |
| `font-feature-settings: "palt"`, `letter-spacing: .01em`, `word-break: auto-phrase`, `text-wrap: balance` | `h1`–`h4`, `button`, `[role=tab]` | base |
| `font-style: normal; font-weight: 600` | `em`, `i` | base |
| `font-style: normal` | `.italic` | utilities (shim) |
| `letter-spacing: .02em` | `.uppercase` (unless also `tracking-tight*`), any `tracking-wide*`, any `tracking-[0.…]` | utilities (shim) |

Why the layers matter:
- Element rules live in `@layer base`, so any utility on the element (`leading-*`, `tracking-*`, `font-*`) still wins. Unlayered CSS would beat every Tailwind v4 utility in the app.
- The 1.75 line-height is scoped to paragraphs, not the root. Labels in buttons and nav rows keep their height, so the current shell does not grow. Lesson bodies set 1.9 themselves or use `text-body-lg`.
- The two **shims** are deliberately in `@layer utilities` with higher specificity, because their job is to override existing `italic` and wide-tracking classes in Japanese. They fix the faux-italic 「本能的になる」 and spaced-out eyebrows like 「ミ ッ シ ョ ン」. `tracking-tight` and `tracking-tighter` are not touched. In Japanese mode this also straightens Latin words marked `italic` unless they sit in a `lang="en"` block. Remove the shims once components stop using `italic` and wide tracking on Japanese text.

---

## 5. Shape, elevation, focus, motion, layout

### Radius

| Utility | Value | Use |
|---|---|---|
| `rounded-chip` | 6px | Chips, inner elements |
| `rounded-control` | 10px | Buttons, inputs |
| `rounded-card` | 14px | Cards |
| `rounded-hero` | 20px | Hero panels, modals, sheets |
| `rounded-full` | pill | Pills, avatars |

These are new names. **`rounded-sm/md/lg/xl` keep Tailwind's defaults** (4/6/8/12px). Remapping them would silently restyle about 380 existing elements. New code uses only the five names above. `rounded-[…]` is banned.

### Shadows

| Utility | Light | Use |
|---|---|---|
| `shadow-1` | `0 1px 2px rgb(16 16 24/.06)` | Resting card |
| `shadow-2` | `0 1px 2px …/.04, 0 6px 16px …/.06` | Hover, raised |
| `shadow-3` | `0 16px 40px rgb(16 16 24/.14)` | Popover, modal |

In dark scopes the shadows switch to black at higher alpha. Elevation there should mainly come from `surface` → `sunken` → `raised` plus `border-line`.

### Focus

Every focusable element gets `outline: 2px solid var(--rp-focus); outline-offset: 2px` on `:focus-visible` (in `@layer base`). The ring is an **outline, not the box-shadow** in plan §4.2: a base-layer box-shadow would be replaced by any `shadow-*` or `ring-*` utility on the same element, and most buttons have one. The box-shadow form is available as `--rp-ring` for custom components: `focus-visible:shadow-(--rp-ring) focus-visible:outline-none`.

An element that uses `outline-none` or `focus:outline-none` opts out and must draw its own visible focus state (for example `focus-visible:ring-2 ring-focus`).

### Motion

| Token | Value | Use |
|---|---|---|
| `--rp-duration-fast` / `duration-120` | 120ms | Hover |
| `--rp-duration-base` / `duration-200` | 200ms | UI state |
| `--rp-duration-slow` / `duration-320` | 320ms | Page, sheet |
| `--rp-ease` / `ease-rise` | `cubic-bezier(.22,.61,.36,1)` | Default easing |

`.page-transition` is opacity plus a 4px slide, with no scale. Respect `prefers-reduced-motion`; the existing reduced-motion block in `index.css` covers the shared animation classes.

### Layout

| Token | Value | Utility |
|---|---|---|
| Reading width | 720px | `max-w-read` |
| Form width | 640px | `max-w-form` |
| Page width | 1200px | `max-w-page` |
| Wide | 1440px | `max-w-wide` |
| Sidebar / rail / top bar / mobile tab bar | 248 / 64 / 56 / 64px | `w-(--rp-sidebar)`, `w-(--rp-rail)`, `h-(--rp-topbar)`, `h-(--rp-tabbar)` |

Spacing uses Tailwind's 4px scale (0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20). Page gutters are `px-4 sm:px-6 lg:px-8`.

---

## 6. Rules for new code

Do:
- Use `bg-canvas` / `bg-surface` / `bg-sunken`, `text-fg` / `text-fg-2` / `text-fg-3`, `border-line`.
- Use one primary action per screen (`bg-primary text-on-primary hover:bg-primary-hover rounded-control`).
- Use amber (`sun*`) only for achievements.
- Use world colors only inside `[data-world]` content.
- Put new learner-facing copy in both EN and JP (`copy = { en, jp }` with `useLanguage().language`).
- Give icon-only buttons an `aria-label`.

Do not, in new code under `components/`:
- Write hex colors in classes (`bg-[#…]`, `text-[#…]`).
- Use `rounded-[…]`.
- Use `text-[9px]`, `text-[10px]` or `text-[11px]`, or anything below `text-caption`.
- Use `text-slate-400`. Use `text-fg-3` instead.
- Use `italic`, `uppercase` or wide tracking on Japanese text. Use `eyebrow` for labels.
- Use `font-serif` or `font-mono` as decoration.
- Use `outline-none` without a replacement focus style.

A lint rule for these lands in Phase 2.

---

## 7. Differences from PLAN.ja.md §4.2

These follow the critique (`doc/brushup-2026/research/critique.md` C4, C6, C15, C16) or Tailwind constraints.

| Plan | Implemented | Reason |
|---|---|---|
| `rounded-sm/md/lg/xl` = 6/10/14/20 | `rounded-chip/control/card/hero` | Remapping restyles existing elements (C4) |
| `text-world` = accent | `text-world` = `--world-accent-text` | Most accents fail AA as text (C6). Bright value is `world-accent`. |
| Global `:lang(ja)` rules | Element rules in `@layer base`, tracking shim narrowed | Unlayered rules override utilities app-wide (C4) |
| JP body `line-height: 1.75` on all text | On `p` and `blockquote`, plus the JP leading of the `text-*` scale | Keeps the current shell's row heights |
| `.overline` | `eyebrow` | Tailwind's `overline` is text-decoration |
| Focus ring as box-shadow | `outline` with offset | Box-shadow loses to `shadow-*` utilities |
| BIZ UDPGothic in the font set | Lazy, injected by reader settings | C15 |
| Inter 400–700; Noto Serif JP 400;600; JetBrains Mono 400;600 | Inter 300–700; Noto Serif JP and JetBrains Mono 400–700 variable | Existing `font-light` / `font-bold` usages keep their weights |
| — | Extra colors `raised`, `overlay`, `muted`, `world-accent`, `world-soft`, `on-world` | Needed for modals, scrims and world chips |

---

## 8. Checking a change

- Font loading (C16): `document.fonts.check()` is not enough because it returns true when nothing needs loading. Check that `await document.fonts.load('16px "Noto Sans JP"', 'あ')` returns a non-empty array **and** that some `FontFace` with family `Noto Sans JP` has `status === 'loaded'`.
- Radius: on `/`, every `.rounded-lg` still computes to `8px`.
- Japanese italics: on the logged-out landing in JP, 「本能的になる」 has computed `font-style: normal`. In EN, "Instinct" stays italic.
- Focus: Tab from the top of `/` and the sidebar buttons show a 2px indigo ring.
- Screens: compare `/`, `/learning-hub`, `/art`, `/vibe` and `/p-school` (desktop and 390px) before and after. Only font, kana spacing and Japanese paragraph leading should differ.
