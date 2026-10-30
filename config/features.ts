/**
 * Feature flags for the app shell.
 *
 * - devSamples: the "Design Samples" nav group. Dev builds only, and only after
 *   opening any page with `?dev=1` (remembered in localStorage; `?dev=0` clears it).
 * - frLocale: the FR language button. Off until French strings exist
 *   (LanguageContext resolves FR to EN today). Enable with VITE_FEATURE_FR=true.
 * - labs: experimental tracks. On unless VITE_FEATURE_LABS=false.
 * - agentChat: the shared Hermes chats (the floating AI coach and /life-journal/chat). Off by
 *   default: Rise Path does not offer a shared server-side agent to learners
 *   (doc/brushup-2026/ai-access-plan.ja.md). On only when VITE_FEATURE_AGENT_CHAT is exactly
 *   "true". The in-lesson tutor (components/lesson/TutorPanel, /api/v2/llm) is not Hermes and
 *   does not depend on this flag.
 * - billing: the supporter plan's entry points (Settings → Account 「プラン」, the profile link) and
 *   the /settings/plan pages (doc/brushup-2026/ai-access-plan.ja.md §7). Off by default; on only
 *   when VITE_FEATURE_BILLING is exactly "true". Even then an entry point shows only after GET
 *   /api/v2/billing/me answers eligibility 'ok' or a subscription (services/billingRules.ts), and
 *   every price and cap comes from the server. The public /legal/commerce page does not depend on it.
 * - legalPages: /terms and /privacy with the published text, the sign-up checkbox, the re-consent
 *   page and change notices (doc/legal/README.md). Off by default; on only when
 *   VITE_FEATURE_LEGAL_PAGES is exactly "true". The dev server always shows the pages (with the
 *   draft banner) for the owner and the lawyer; the production build refuses "true" while the text
 *   is a draft (scripts/legal/check-legal-release.mjs, run by vite.config.ts), and refuses a client
 *   with import.meta.env.DEV = true unless LEGAL_DRAFT_PREVIEW_BUILD=true. Public sign-up opens only
 *   with this flag on. The legal text loads only through the conditional imports in
 *   components/routes/lazyRoutes.tsx, so with the flag off Rollup drops it from the bundle.
 *   The server cannot see this flag: its own switch LEGAL_TERMS_REQUIRED (API and remote MCP; off by
 *   default) is turned on after this flag and off before it (doc/legal/README.md).
 * - training: the job-training section /training (doc/brushup-2026/training-plan.ja.md, D1). Off by
 *   default; on only when VITE_FEATURE_TRAINING is exactly "true" (the school's build). The API
 *   answers only where the server's TRAINING_ENABLED is "true" (server/routes/training.js). The
 *   section loads only through the conditional import in components/routes/lazyRoutes.tsx; CI greps
 *   the flag-off build for its marker.
 *
 * Read single flags only (`features.legalPages`). Never spread `features`, pass it whole, call
 * Object.keys/values/entries on it or index it with `features[…]`: Rollup folds a flag only while
 * every use is a plain property read (server/tests/legalPagesFront.test.js).
 */

const DEV_SAMPLES_KEY = 'rp:dev-samples';

function readDevSamples(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;

  let fromQuery: string | null = null;
  try {
    fromQuery = new URLSearchParams(window.location.search).get('dev');
  } catch {
    fromQuery = null;
  }

  try {
    if (fromQuery === '1') window.localStorage.setItem(DEV_SAMPLES_KEY, '1');
    if (fromQuery === '0') window.localStorage.removeItem(DEV_SAMPLES_KEY);
  } catch {
    // Storage blocked (private mode): fall back to the query string alone.
  }

  if (fromQuery === '1') return true;
  if (fromQuery === '0') return false;
  try {
    return window.localStorage.getItem(DEV_SAMPLES_KEY) === '1';
  } catch {
    return false;
  }
}

const labsEnabled = import.meta.env.VITE_FEATURE_LABS !== 'false';

export const features = {
  devSamples: readDevSamples(),
  frLocale: import.meta.env.VITE_FEATURE_FR === 'true',
  // Shared Hermes chats: off by default (see the note above and ai-access-plan.ja.md).
  agentChat: import.meta.env.VITE_FEATURE_AGENT_CHAT === 'true',
  // Supporter plan screens: off by default (see the note above).
  billing: import.meta.env.VITE_FEATURE_BILLING === 'true',
  // Legal pages, sign-up checkbox, re-consent page and notices: off by default (see the note above).
  legalPages: import.meta.env.VITE_FEATURE_LEGAL_PAGES === 'true',
  // Job-training section: off by default (see the note above).
  training: import.meta.env.VITE_FEATURE_TRAINING === 'true',
  labs: {
    sonic: labsEnabled,
    teacherBot: labsEnabled,
    aidj: labsEnabled,
  },
} as const;

export type Features = typeof features;
