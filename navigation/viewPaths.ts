import { ViewState } from '../types';
import { startsWithSegment, withoutTrailingSlash } from './pathViews';

/**
 * ViewState → URL. Every ViewState must have an entry (Record enforces it), so
 * `onNavigate(view)` can never silently fall back to the dashboard.
 *
 * Views that need an id (a generated course, a craft, a character, a Blender
 * stage) point at the list or first item they belong to; callers that know the
 * id navigate to the full path themselves.
 */
export const VIEW_PATHS: Record<ViewState, string> = {
  [ViewState.DASHBOARD]: '/',
  [ViewState.LEARNING_HUB]: '/learning-hub',
  [ViewState.COURSES]: '/courses',
  [ViewState.COURSE_DETAILS]: '/courses',
  [ViewState.LIBRARY]: '/library',
  // Phase 6: today's review cards (the sidebar's 「復習」).
  [ViewState.REVIEW]: '/review',

  [ViewState.AI_DIAGNOSIS]: '/assessment',
  [ViewState.LIFE_JOURNAL]: '/life-journal',
  [ViewState.LIFE_JOURNAL_MONTHLY]: '/life-journal/monthly',
  [ViewState.LIFE_JOURNAL_INSIGHTS]: '/life-journal/insights',
  [ViewState.LIFE_JOURNAL_CHAT]: '/life-journal/chat',
  [ViewState.AI_CHARACTERS]: '/characters',
  [ViewState.AI_CHARACTER_DETAIL]: '/characters',

  [ViewState.PROFILE]: '/profile',
  [ViewState.PROFILE_DIAGNOSIS]: '/profile/diagnosis',
  [ViewState.PROFILE_HISTORY]: '/profile/history',
  [ViewState.PROFILE_BADGES]: '/profile/badges',
  [ViewState.PROFILE_GENERATED]: '/profile/generated',
  [ViewState.PROFILE_MIRROR]: '/profile/mirror',
  [ViewState.PROFILE_EDIT]: '/profile/edit',
  [ViewState.NOTIFICATIONS]: '/notifications',

  [ViewState.SETTINGS]: '/settings',
  [ViewState.SETTINGS_VOICE]: '/settings/voice',
  [ViewState.SETTINGS_DIALOGUE_VOICE]: '/settings/voice/dialogue',
  [ViewState.SETTINGS_API_KEY]: '/settings/api-key',
  [ViewState.SETTINGS_PRIVACY]: '/settings/privacy',
  [ViewState.SETTINGS_AI_MEMORY]: '/settings/ai-memory',
  [ViewState.SETTINGS_AI_ACCESS]: '/settings/ai-access',
  [ViewState.SETTINGS_ADMIN_SAFETY]: '/settings/admin/safety',
  // Phase 1: the learner's own AI apps connected to the remote MCP endpoint (OAuth).
  [ViewState.SETTINGS_CONNECTED_APPS]: '/settings/connected-apps',
  // Public guide; open when signed out too (App.tsx renders it outside the Layout then).
  [ViewState.AI_SAFETY]: '/ai-safety',
  // Phase 3: the supporter plan (VITE_FEATURE_BILLING; the old /subscription redirects here) and
  // the public 特定商取引法に基づく表記 (open when signed out, like /ai-safety).
  [ViewState.SETTINGS_PLAN]: '/settings/plan',
  [ViewState.SETTINGS_PLAN_CONFIRM]: '/settings/plan/confirm',
  [ViewState.LEGAL_COMMERCE]: '/legal/commerce',
  // Phase 4: deleting one's own account, and the public page after it (open when signed out).
  [ViewState.SETTINGS_DELETE_ACCOUNT]: '/settings/delete-account',
  [ViewState.ACCOUNT_DELETED]: '/account/deleted',
  // Phase 4: the public legal texts ("being prepared" until VITE_FEATURE_LEGAL_PAGES=true).
  [ViewState.LEGAL_TERMS]: '/terms',
  [ViewState.LEGAL_PRIVACY]: '/privacy',

  // A lesson needs its course and lesson ids (/learn/:course/:lesson); without them, the course list.
  [ViewState.LESSON]: '/courses',
  [ViewState.MY_CONTENT]: '/my-content',
  [ViewState.GENERATED_COURSE_PATH]: '/profile/generated',
  [ViewState.GENERATED_LESSON_VIEW]: '/profile/generated',
  [ViewState.COURSE_GENERATOR]: '/course-generator',

  // Blender
  [ViewState.BLENDER]: '/blender',
  [ViewState.BLENDER_PATH]: '/blender/path',
  [ViewState.BLENDER_LESSON]: '/blender/lesson/1',
  [ViewState.TEACHER_BOT_LIVE]: '/blender/teacher-bot',

  // Programming
  [ViewState.PROGRAMMING]: '/programming',
  [ViewState.PROGRAMMING_WEB]: '/programming/web',
  [ViewState.PROGRAMMING_AI]: '/programming/ai',
  [ViewState.PROGRAMMING_VIBE]: '/vibe',
  [ViewState.PROGRAMMING_PATH]: '/programming/path',
  [ViewState.PYTHON_COURSE]: '/programming/python',
  [ViewState.HTML_CSS_PATH]: '/programming/html-css',
  [ViewState.HTML_CSS_COURSE]: '/programming/html-css/course',
  [ViewState.HTML_CSS_PART_TWO]: '/programming/html-css/part2',
  [ViewState.WEB_INSPECTOR]: '/programming/web-inspector',

  // Unity
  [ViewState.UNITY_AI_GAME_DEV]: '/unity',
  [ViewState.UNITY_CHAPTER_0]: '/unity/chapter-0',
  [ViewState.UNITY_CHAPTER_1]: '/unity/chapter-1',
  [ViewState.UNITY_CHAPTER_2]: '/unity/chapter-2',
  [ViewState.UNITY_CHAPTER_3]: '/unity/chapter-3',

  // Vibe Coding. The chapters render in the lesson reader (/vibe/chapter-N redirects there too).
  [ViewState.VIBE_PATH]: '/vibe',

  // Claude Code (lesson-reader course; lessons open at /learn/claude-code/<id>).
  [ViewState.CLAUDE_CODE]: '/claude-code',
  [ViewState.VIBE_PROLOGUE]: '/vibe/prologue',
  [ViewState.VIBE_CHAPTER_0]: '/learn/vibe-coding/vibe-ch0',
  [ViewState.VIBE_CHAPTER_1]: '/learn/vibe-coding/vibe-ch1',
  [ViewState.VIBE_CHAPTER_2]: '/learn/vibe-coding/vibe-ch2',
  [ViewState.VIBE_CHAPTER_3]: '/learn/vibe-coding/vibe-ch3',
  [ViewState.VIBE_CHAPTER_4]: '/learn/vibe-coding/vibe-ch4',
  [ViewState.VIBE_CHAPTER_5]: '/learn/vibe-coding/vibe-ch5',
  [ViewState.VIBE_CHAPTER_6]: '/learn/vibe-coding/vibe-ch6',
  [ViewState.VIBE_CHAPTER_7]: '/learn/vibe-coding/vibe-ch7',
  [ViewState.VIBE_CHAPTER_8]: '/learn/vibe-coding/vibe-ch8',
  [ViewState.VIBE_CHAPTER_9]: '/learn/vibe-coding/vibe-ch9',
  [ViewState.VIBE_CHAPTER_10]: '/learn/vibe-coding/vibe-ch10',
  [ViewState.VIBE_CHAPTER_11]: '/learn/vibe-coding/vibe-ch11',

  // Art
  [ViewState.ART_MUSEUM]: '/art',
  [ViewState.ART_HISTORY]: '/art/history',
  [ViewState.ART_CURRICULUM]: '/art/curriculum',
  [ViewState.ART_INTRO]: '/art/intro',
  [ViewState.ART_PERIOD_DETAIL]: '/art/period',
  [ViewState.ART_KINTSUGI]: '/art/kintsugi',
  [ViewState.ART_CRAFTS]: '/art/crafts',
  [ViewState.ART_CRAFT_DETAIL]: '/art/crafts',
  [ViewState.ART_TRIBAL]: '/art/tribal',
  [ViewState.ART_TRIBAL_DETAIL]: '/art/tribal/intro',

  // Sonic Lab, P-School
  [ViewState.SONIC_LAB]: '/sonic',
  [ViewState.SONIC_SYNTH]: '/sonic/synth',
  [ViewState.P_SCHOOL]: '/p-school',

  // Design samples (dev only, see config/features.ts)
  [ViewState.MULTI_FORMAT_DEMO]: '/demo/multi',
  [ViewState.DEMO_CHECKLIST]: '/demo/checklist',
  [ViewState.DEMO_CHECKLIST_GENERATOR]: '/demo/checklist-gen',
  [ViewState.DEMO_CONCEPT]: '/demo/concept',
  [ViewState.DEMO_DIALOGUE]: '/demo/dialogue',
  [ViewState.DEMO_WORKSHOP]: '/demo/workshop',
  [ViewState.DEMO_BLENDER]: '/demo/blender',
  [ViewState.DEMO_REFLECTION]: '/demo/reflection',
  [ViewState.DEV_BLOCKS]: '/dev/blocks',
};

/** Sidebar entries that can be highlighted. */
export type NavKey =
  | 'dashboard'
  | 'learning'
  | 'review'
  | 'generator'
  | 'diagnosis'
  | 'journal'
  | 'passport'
  | 'history'
  | 'badges'
  | 'generated'
  | 'myContent'
  | 'characters'
  | 'settings'
  | 'demoChecklist'
  | 'demoChecklistGenerator'
  | 'demoConcept'
  | 'demoDialogue'
  | 'demoWorkshop'
  | 'demoBlender'
  | 'demoReflection'
  | 'devBlocks';

// Track hubs, readers and catalogs all highlight "Learning content".
const LEARNING_PREFIXES = [
  '/learning-hub',
  '/courses',
  '/course',
  '/lesson',
  '/learn',
  '/preview',
  '/library',
  '/vibe',
  '/claude-code',
  '/unity',
  '/blender',
  '/programming',
  '/art',
  '/sonic',
  '/p-school',
  '/aidj',
];

const DEMO_KEYS: Record<string, NavKey> = {
  checklist: 'demoChecklist',
  'checklist-gen': 'demoChecklistGenerator',
  concept: 'demoConcept',
  dialogue: 'demoDialogue',
  workshop: 'demoWorkshop',
  blender: 'demoBlender',
  reflection: 'demoReflection',
};

/** Which sidebar entry the URL belongs to, or null when none should be highlighted. */
export function pathToNavKey(pathname: string): NavKey | null {
  const path = withoutTrailingSlash(pathname);

  if (path === '/' || path === '') return 'dashboard';
  if (startsWithSegment(path, '/course-generator')) return 'generator';
  if (startsWithSegment(path, '/assessment') || startsWithSegment(path, '/profile/diagnosis')) return 'diagnosis';
  if (startsWithSegment(path, '/life-journal')) return 'journal';
  if (startsWithSegment(path, '/profile/history')) return 'history';
  if (startsWithSegment(path, '/profile/badges')) return 'badges';
  if (startsWithSegment(path, '/review')) return 'review';
  if (startsWithSegment(path, '/profile/generated')) return 'generated';
  if (startsWithSegment(path, '/generated-course') || startsWithSegment(path, '/generated-lesson')) return 'generated';
  if (startsWithSegment(path, '/profile')) return 'passport';
  if (startsWithSegment(path, '/my-content')) return 'myContent';
  if (startsWithSegment(path, '/characters') || startsWithSegment(path, '/character')) return 'characters';
  if (
    startsWithSegment(path, '/settings')
    || startsWithSegment(path, '/notifications')
    || startsWithSegment(path, '/subscription')
  ) return 'settings';
  if (startsWithSegment(path, '/dev/blocks')) return 'devBlocks';
  if (startsWithSegment(path, '/demo')) {
    return DEMO_KEYS[path.split('/')[2] ?? ''] ?? null;
  }
  if (LEARNING_PREFIXES.some((prefix) => startsWithSegment(path, prefix))) return 'learning';
  return null;
}

/**
 * Lesson reader routes. The shell shows a 64px rail there, drops the page
 * padding, and hides the mobile header and the chat launcher.
 */
export function isLessonPath(pathname: string): boolean {
  return (
    pathname.startsWith('/learn/')
    || pathname.startsWith('/preview/')
    || startsWithSegment(pathname, '/dev/blocks')
  );
}
