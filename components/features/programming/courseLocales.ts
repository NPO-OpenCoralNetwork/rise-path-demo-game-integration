/**
 * Pure helper behind the course page's "this course is in … only" note. No React or DOM
 * imports, so server/tests can import this file directly.
 */
import type { Course } from '../../../shared/lesson/schema.js';
import type { ContentLocale } from '../../lesson/model.ts';

/**
 * The locales a course is written in when the UI language is not one of them, else null (no
 * note). A course without `locales` is in its `locale` only.
 */
export function courseOnlyLocales(course: Pick<Course, 'locale' | 'locales'>, language: ContentLocale): ContentLocale[] | null {
  const locales: ContentLocale[] = course.locales?.length ? [...course.locales] : [course.locale];
  return locales.includes(language) ? null : locales;
}
