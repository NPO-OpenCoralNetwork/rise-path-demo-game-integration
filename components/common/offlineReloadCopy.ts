/**
 * Phase 8 (S1): what the page says while it waits for the connection after a part failed to load
 * offline (chunkReload.ts, `ChunkWait`). One wording for the three places that show it: the root
 * ErrorBoundary (outside the providers, so this file has no React), LearnRoute's lesson problem and
 * the reader bar's OfflineReloadNotice.
 *
 * - *Title / *PageBody: a screen with nothing usable on it (it reloads by itself once Rise Path
 *   answers); `checkingBody` is also the notice's text while the probe runs.
 * - part*: the reader bar's notice, where the page stays usable and reloads only on request.
 */

import type { ChunkWait } from './chunkReload';

export const offlineReloadCopy = {
  en: {
    offlineTitle: "You're offline",
    offlinePageBody:
      "This page couldn't load. It reloads by itself once Rise Path answers again. Your learning records stay on this device.",
    checkingTitle: 'Checking the connection',
    checkingBody: "You're back online. Checking that Rise Path answers…",
    unreachableTitle: "Rise Path isn't answering",
    unreachablePageBody:
      "You're online, but Rise Path isn't answering yet. The page reloads by itself once it does. Your learning records stay on this device.",
    partOffline:
      "You're offline, so part of this page couldn't load. Once you're back online, you can reload it from here. Your learning records stay on this device.",
    partUnreachable: "Rise Path isn't answering yet. Once it does, you can reload from here.",
    partBack: "You're back online. Reload to show the parts that didn't load.",
    reload: 'Reload',
    reloadPage: 'Reload page',
    close: 'Close',
  },
  jp: {
    offlineTitle: 'インターネットにつながっていません',
    offlinePageBody:
      'このページを読み込めませんでした。Rise Path につながると、自動で読み込み直します。学習の記録は、この端末に残っています。',
    checkingTitle: 'つながるか確かめています',
    checkingBody: 'インターネットにつながりました。Rise Path につながるか確かめています…',
    unreachableTitle: 'Rise Path につながりません',
    unreachablePageBody:
      'インターネットにはつながっていますが、Rise Path が答えません。答えると、自動で読み込み直します。学習の記録は、この端末に残っています。',
    partOffline:
      'インターネットにつながっていないため、ページの一部を読み込めませんでした。つながったら、ここから読み込み直せます。学習の記録は、この端末に残っています。',
    partUnreachable: 'Rise Path がまだ答えません。答えたら、ここから読み込み直せます。',
    partBack: 'つながりました。読み込み直すと、読み込めなかった部分も表示されます。',
    reload: '読み込み直す',
    reloadPage: '再読み込み',
    close: '閉じる',
  },
} as const;

export type OfflineReloadLanguage = keyof typeof offlineReloadCopy;
type Waiting = Exclude<ChunkWait, 'none' | 'back'>;

/** The heading of a screen with nothing usable on it, while it waits ('back' reads as checking: it checks again at once). */
export function offlinePageTitle(language: OfflineReloadLanguage, wait: Exclude<ChunkWait, 'none'>): string {
  const t = offlineReloadCopy[language];
  const w: Waiting = wait === 'back' ? 'checking' : wait;
  return w === 'offline' ? t.offlineTitle : w === 'unreachable' ? t.unreachableTitle : t.checkingTitle;
}

/** The body of that screen. */
export function offlinePageBody(language: OfflineReloadLanguage, wait: Exclude<ChunkWait, 'none'>): string {
  const t = offlineReloadCopy[language];
  const w: Waiting = wait === 'back' ? 'checking' : wait;
  return w === 'offline' ? t.offlinePageBody : w === 'unreachable' ? t.unreachablePageBody : t.checkingBody;
}

/** The reader bar notice's text. */
export function offlinePartText(language: OfflineReloadLanguage, wait: Exclude<ChunkWait, 'none'>): string {
  const t = offlineReloadCopy[language];
  if (wait === 'offline') return t.partOffline;
  if (wait === 'checking') return t.checkingBody;
  if (wait === 'unreachable') return t.partUnreachable;
  return t.partBack;
}
