// @ts-check
/**
 * Stable ids for the headings of the legal pages (Phase 4, design §2.4), so other pages can link
 * a part of the text: `/privacy#section-3` (利用目的), `/privacy#section-8` (保存期間),
 * `/terms#article-10`. No imports (shared/ is imported by the browser, the server and scripts).
 *
 *   第 N 条…   → article-N
 *   N.M …      → section-N-M
 *   N. …       → section-N
 *   anything else → null (the heading gets no id)
 *
 * @param {unknown} text the heading's text
 * @returns {string | null}
 */
export function legalHeadingId(text) {
  const value = String(text ?? '').trim();
  let match = /^第\s*(\d+)\s*条/.exec(value);
  if (match) return `article-${Number(match[1])}`;
  match = /^(\d+)\.(\d+)(?:\s|$)/.exec(value);
  if (match) return `section-${Number(match[1])}-${Number(match[2])}`;
  match = /^(\d+)\.(?:\s|$)/.exec(value);
  if (match) return `section-${Number(match[1])}`;
  return null;
}
