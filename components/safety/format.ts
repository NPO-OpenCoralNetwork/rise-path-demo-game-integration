import { splitBirthYm } from '../../services/aiAccessApi';

/** Display helpers for the AI access pages (Japan time). */

type Lang = 'en' | 'jp';

export function formatBirthYm(ym: string | null, language: Lang): string {
  const parts = splitBirthYm(ym);
  if (!parts) return '—';
  if (language === 'jp') return `${parts.year}年${parts.month}月`;
  return new Date(Date.UTC(parts.year, parts.month - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function formatTokyoDateTime(iso: string | null | undefined, language: Lang, withTime = false): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === 'jp' ? 'ja-JP' : 'en-GB', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
