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
  labs: {
    sonic: labsEnabled,
    teacherBot: labsEnabled,
    aidj: labsEnabled,
  },
} as const;

export type Features = typeof features;
