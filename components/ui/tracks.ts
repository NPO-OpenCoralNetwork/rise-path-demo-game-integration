/**
 * One name per track and locale, shared by the dashboard, the Learning Hub fallback portals and
 * the track pages. Vibe Coding and Claude Code are lesson-reader courses: their title and subtitle
 * come from content/courses/<slug>/course.json (the reader breadcrumb reads the same file). The
 * other tracks have no course.json yet, so their copy lives here.
 */
import type { Course, LText } from '../../shared/lesson/schema.js';
import { resolveLText, type ContentLocale } from '../lesson/model';

export type TrackLang = 'en' | 'jp';
export type TrackId = 'vibe' | 'claude-code' | 'unity' | 'blender' | 'art';
export type TrackCopy = { badge: string; title: string; description: string; lang?: string };

type CourseTrackId = 'vibe' | 'claude-code';

const STATIC_TRACKS: Record<Exclude<TrackId, CourseTrackId>, Record<TrackLang, TrackCopy>> = {
  unity: {
    en: { badge: 'Unity × AI', title: 'Game development in the AI era', description: 'Design games with Unity and AI as your partner.' },
    jp: { badge: 'Unity × AI', title: 'AI時代のゲーム開発', description: 'AIを相棒に、Unityでゲームを設計します。' },
  },
  blender: {
    en: { badge: 'Blender', title: 'Your first 3D models', description: 'Model, light and render step by step in Blender.' },
    jp: { badge: 'Blender', title: 'はじめての3Dモデリング', description: 'モデリングからライティングまで、手順どおりに。' },
  },
  art: {
    en: { badge: 'Art', title: 'A journey through art and craft', description: 'Art history and the ideas behind great works.' },
    jp: { badge: 'Art', title: '美術史と工芸の旅', description: '名作の背景にある歴史と考え方をたどります。' },
  },
};

/** Badge of each course track, and the title to show when its course.json is missing. */
const COURSE_TRACKS: Record<CourseTrackId, { badge: Record<TrackLang, string>; title: LText }> = {
  vibe: { badge: { en: 'Web × AI', jp: 'Web × AI' }, title: { jp: 'バイブコーディング', en: 'Vibe Coding' } },
  'claude-code': { badge: { en: 'AI agent', jp: 'AIエージェント' }, title: { jp: 'Claude Code 実践', en: 'Claude Code in Practice' } },
};

/** Title, subtitle and badge of a track in the UI language. `course` is needed for 'vibe' and 'claude-code'. */
export function trackCopy(id: TrackId, lang: TrackLang, course?: Course | null): TrackCopy {
  if (id !== 'vibe' && id !== 'claude-code') return STATIC_TRACKS[id][lang];
  const locale: ContentLocale = lang;
  const fallback = (course?.locale as ContentLocale | undefined) ?? 'jp';
  const title = resolveLText(course?.title ?? COURSE_TRACKS[id].title, locale, fallback);
  const description = resolveLText(course?.subtitle, locale, fallback);
  return { badge: COURSE_TRACKS[id].badge[lang], title: title.value, description: description.value, ...(title.lang ? { lang: title.lang } : {}) };
}
