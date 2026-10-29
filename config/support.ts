/**
 * Where learners ask for help (Phase 4, design §5.11, finding 18): one front setting, used by
 * every "contact us" line (components/ui/SupportContact.tsx): the account deletion pages, the
 * re-consent page and Settings. A front setting, not an api one: the deleted-account page has no
 * session to ask the api with. Not a secret (a contact link, not a key).
 *
 * VITE_SUPPORT_CONTACT accepts only
 *   - an https:// URL (a contact form), shown as its host and path, opened in a new tab;
 *   - mailto: with exactly one address (no query), shown as the address.
 * Anything else counts as unset (one console.warn in dev builds). Unset: the lines say to tell the
 * staff at the learning site, as /ai-safety already does.
 */

export type SupportContactInfo = { href: string; label: string; kind: 'url' | 'mail' };

const MAIL = /^mailto:([^\s@,;?&#/:]+@[^\s@,;?&#/:]+\.[^\s@,;?&#/:]+)$/i;

export function parseSupportContact(raw: unknown, warn?: (message: string) => void): SupportContactInfo | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  const mail = MAIL.exec(value);
  if (mail) return { href: `mailto:${mail[1]}`, label: mail[1], kind: 'mail' };
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) {
      const path = url.pathname === '/' ? '' : url.pathname;
      return { href: url.href, label: `${url.host}${path}`, kind: 'url' };
    }
  } catch {
    // Not a URL.
  }
  warn?.('[support] VITE_SUPPORT_CONTACT must be an https:// URL or mailto: with one address; it is ignored.');
  return null;
}

export const SUPPORT_CONTACT: SupportContactInfo | null = parseSupportContact(
  import.meta.env.VITE_SUPPORT_CONTACT,
  import.meta.env.DEV ? (message) => console.warn(message) : undefined,
);
