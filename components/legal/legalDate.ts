/**
 * Effective dates of the legal texts (shared/legal/versions.js effectiveDate, 'YYYY-MM-DD') as
 * people read them: 「2026 年 12 月 1 日」 / "December 1, 2026". Used by the legal pages
 * (components/features/legal/LegalDocument.tsx), the re-consent page and the change notice. Holds
 * no legal text, so the flag-off bundle can carry it.
 */

/** 'YYYY-MM-DD' → 「2026 年 12 月 1 日」 / "December 1, 2026"; null when it is not a date. */
export function formatEffectiveDate(iso: string | null, language: 'en' | 'jp'): string | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (language === 'jp') return `${year} 年 ${month} 月 ${day} 日`;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(
    Date.UTC(year, month - 1, day),
  );
}
