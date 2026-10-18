// @ts-check
/**
 * Localized-text helpers for risepath.lesson/v1. No zod import, so the reader can use these
 * without pulling the validator into its bundle.
 *
 * @typedef {'jp' | 'en' | 'fr'} Locale
 * @typedef {string | { jp?: string, en?: string, fr?: string }} LText
 */

import { LOCALES } from './constants.js';

/** @type {readonly Locale[]} */
export const LOCALE_KEYS = LOCALES;

/** @type {Record<Locale, string>} */
const BCP47 = { jp: 'ja', en: 'en', fr: 'fr' };

/**
 * Resolves a text and reports which locale was actually used, so a renderer can set `lang`
 * on a block that fell back to another language.
 * Order: requested locale → fallback → any other locale. A plain string counts as `fallback`.
 *
 * @param {LText | null | undefined} text
 * @param {Locale} locale
 * @param {Locale} [fallback] usually lesson.locale
 * @returns {{ value: string, locale: Locale | null }}
 */
export function resolveText(text, locale, fallback = 'jp') {
  if (text == null) return { value: '', locale: null };
  if (typeof text === 'string') return { value: text, locale: fallback };
  if (typeof text !== 'object') return { value: String(text), locale: null };
  /** @type {Locale[]} */
  const order = [locale, fallback, ...LOCALE_KEYS];
  for (const key of order) {
    const value = text[key];
    if (typeof value === 'string' && value.trim() !== '') return { value, locale: key };
  }
  return { value: '', locale: null };
}

/**
 * The one getText: `t({jp:'こんにちは', en:'Hello'}, 'en') === 'Hello'`.
 *
 * @param {LText | null | undefined} text
 * @param {Locale} locale
 * @param {Locale} [fallback] usually lesson.locale
 * @returns {string}
 */
export function t(text, locale, fallback = 'jp') {
  return resolveText(text, locale, fallback).value;
}

/**
 * True when the text has a non-empty value for `locale`. A plain string has only `sourceLocale`.
 *
 * @param {LText | null | undefined} text
 * @param {Locale} locale
 * @param {Locale} [sourceLocale]
 * @returns {boolean}
 */
export function hasLocale(text, locale, sourceLocale = 'jp') {
  if (text == null) return false;
  if (typeof text === 'string') return locale === sourceLocale && text.trim() !== '';
  const value = text[locale];
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Locales present in a text (a plain string reports `sourceLocale`).
 *
 * @param {LText | null | undefined} text
 * @param {Locale} [sourceLocale]
 * @returns {Locale[]}
 */
export function textLocales(text, sourceLocale = 'jp') {
  return LOCALE_KEYS.filter((key) => hasLocale(text, key, sourceLocale));
}

/**
 * Content locale → BCP-47 tag for the HTML `lang` attribute and LLM prompts (`jp` → `ja`).
 *
 * @param {Locale} locale
 * @returns {string}
 */
export function toBcp47(locale) {
  return BCP47[locale] ?? locale;
}

/**
 * BCP-47 tag (`ja`, `ja-JP`, `en-US`, …) → content locale, or null when unsupported.
 *
 * @param {string} tag
 * @returns {Locale | null}
 */
export function fromBcp47(tag) {
  const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
  if (base === 'ja' || base === 'jp') return 'jp';
  if (base === 'en') return 'en';
  if (base === 'fr') return 'fr';
  return null;
}
