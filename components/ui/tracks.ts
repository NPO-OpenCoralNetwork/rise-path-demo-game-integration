/**
 * One name per track and locale, shared by the dashboard, the Learning Hub fallback portals and
 * the track pages. Vibe Coding is a lesson-reader course: its title and subtitle come from
 * content/courses/vibe-coding/course.json (the reader breadcrumb reads the same file). The other
 * tracks have no course.json yet, so their copy lives here.
 */
import type { Course } from '../../shared/lesson/schema.js';
import { resolveLText, type ContentLocale } from '../lesson/model';

export type TrackLang = 'en' | 'jp';
export type TrackId = 'vibe' | 'unity' | 'blender' | 'art';
export type TrackCopy = { badge: string; title: string; description: string; lang?: string };

const STATIC_TRACKS: Record<Exclude<TrackId, 'vibe'>, Record<TrackLang, TrackCopy>> = {
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

/** The track badge for Vibe Coding (the title itself is the course title). */
const VIBE_BADGE: Record<TrackLang, string> = { en: 'Web × AI', jp: 'Web × AI' };

/** Title, subtitle and badge of a track in the UI language. `course` is needed for 'vibe'. */
export function trackCopy(id: TrackId, lang: TrackLang, course?: Course | null): TrackCopy {
  if (id !== 'vibe') return STATIC_TRACKS[id][lang];
  const locale: ContentLocale = lang;
  const fallback = (course?.locale as ContentLocale | undefined) ?? 'jp';
  const title = resolveLText(course?.title ?? { jp: 'バイブコーディング', en: 'Vibe Coding' }, locale, fallback);
  const description = resolveLText(course?.subtitle, locale, fallback);
  return { badge: VIBE_BADGE[lang], title: title.value, description: description.value, ...(title.lang ? { lang: title.lang } : {}) };
}
