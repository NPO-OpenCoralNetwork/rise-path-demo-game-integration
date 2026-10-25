# components/ui

Shared UI primitives for the design system in `doc/design/design-system.md` (WP-09). They use the
design tokens only: no hex colors, no `slate-*`, no `rounded-[…]`, nothing below `text-caption`.

| File | What it is |
|---|---|
| `Button.tsx` | `Button`, `ButtonLink` (react-router `Link` or external `<a>`) and `buttonClasses()`. Variants primary / secondary / ghost, sizes sm / md / lg. |
| `PageHeader.tsx` | Eyebrow line (e.g. the date), the page's single `h1`, a description and an actions slot. |
| `CourseCard.tsx` | Track / course card with a cover generated from the `data-world` accent, an optional image that falls back on error, meta and a progress bar with its number. The whole card is one link or button. |
| `EmptyState.tsx` | Honest "nothing here yet" panel: icon tile, title, what will appear here, optional action. |
| `ProgressCluster.tsx` | Streak and level / XP chips from the server (`achievementsClient.ts`), with zero-state copy; nothing while there is no answer. |
| `achievementsClient.ts` | The page's memory-only store of the learner's XP, streak and badges (GET `/api/v2/user/achievements`), read with `useAchievements()`. |
| `lessonResume.ts` | Pure helper (no React) behind the dashboard's "続きから" card. Tested in `server/tests/dashboardModel.test.js`. |
| `links.ts` | Stable outbound links, such as the authoring guide. |

## Why `components/ui/` and not `components/common/ui/`

`components/common/ui/` already holds two chat-era components (`ChatInterface`, `MessageBubble`)
styled with the old palette. New primitives go here instead, so that:

- this folder contains only token-based components that follow the design-system rules, which a
  future lint rule can check folder by folder;
- the import path stays short and matches the plan (`components/ui/Button`), which other work
  packages already reference.

Leave `components/common/ui/` as it is. When one of its components is restyled with tokens, move it
here and update its imports.

## Landing page screenshots (`public/marketing/`)

`ExperienceLandingView` shows real captures of the reader at `/learn/vibe-coding/vibe-ch1` (signed in
as a guest, light theme, no saved progress). They are not mock-ups: retake them when the reader's
look changes.

| File | Viewport | Language |
|---|---|---|
| `reader-jp.webp`, `reader-en.webp` | 1440×900 at 1x | JP / EN |
| `reader-jp-mobile.webp`, `reader-en-mobile.webp` | 390×720 at 2x | JP / EN (shown below 640px) |

To retake: start the dev server, set `localStorage['risepath:language']` to `jp` or `en`, open the
page in Playwright's Chromium at the viewport above, hide the floating chat button and take a PNG
screenshot. Encode it in the same browser with `canvas.toDataURL('image/webp', 0.82)`. Keep each
file under 250 kB.
