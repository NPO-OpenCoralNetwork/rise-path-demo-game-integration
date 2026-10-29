/**
 * Card and lesson-title text for the review screens (Phase 6): the server sends the text as
 * written in the lesson (a string in the lesson's locale, or { jp, en }), and the page resolves it
 * here so a Japanese-only card or title in the English UI keeps lang="ja" (screen readers and
 * fonts read it as Japanese). Pure.
 */
import { resolveLText, type ContentLocale } from '../lesson/model';
import type { ReviewLocale, ReviewText } from '../../services/reviewApi';

export type CardText = { value: string; lang?: string };

/** The text in the UI language, else the lesson's own, with `lang` when it is not the UI's. */
export function cardText(text: ReviewText | null | undefined, language: 'jp' | 'en', lessonLocale: ReviewLocale): CardText {
  return resolveLText(text, language as ContentLocale, lessonLocale as ContentLocale);
}
