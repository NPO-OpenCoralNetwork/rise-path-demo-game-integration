import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CloudOff, RotateCw } from 'lucide-react';
import { useLanguage, type Language } from '../../context/LanguageContext';
import { BAR_EXTRA_PROPERTY } from '../lesson/useScrollContainer';
import { pageOfflineReload, type ChunkWait } from './chunkReload';
import { offlinePartText, offlineReloadCopy } from './offlineReloadCopy';

/**
 * Phase 8 (S1): the reader bar's notice after a part of the lesson failed to load offline (a
 * diagram, highlighted code: they show their plain form in place). Only a failure while this reader
 * is mounted counts (the controller's `failures()` grew since mount): the page-wide state outlives
 * the lesson that degraded, so a lesson opened afterwards (or the one whose lesson chunk failed,
 * then left) shows nothing. Back on a lesson that degraded, its diagram or code loads again and
 * fails again, which counts. It sits in the sticky bar's flow
 * (LessonReader's notice slot, `.rp-chunk-status`), so it is always in view and never covers the
 * text. It follows the page's offline controller (chunkReload.ts):
 *   - offline: part of the page couldn't load; records stay on this device;
 *   - checking: back online, checking that Rise Path answers;
 *   - unreachable: Rise Path isn't answering yet;
 *   - back: Rise Path answered; 「読み込み直す」 reloads (never by itself: the AI tutor thread and
 *     typed text would go without asking).
 * Every state has 閉じる; a closed notice shows again at the next change of state, every time
 * (offline → back is the moment the learner needs it, also on a second outage). The role="status"
 * region is always mounted and empty otherwise, so what appears in it is announced (as ReaderStatus
 * and SaveStoppedNotice do). While the card shows, the bar is taller by its height: the notice
 * publishes it as --rp-bar-extra (reader.css, useScrollContainer.ts) so focused controls, the
 * reader's jumps and the sticky columns stay clear of the grown bar.
 */

const subscribe = (listener: () => void) => pageOfflineReload()?.subscribe(listener) ?? (() => {});
const snapshot = (): ChunkWait => pageOfflineReload()?.state() ?? 'none';
const serverSnapshot = (): ChunkWait => 'none';
const failuresSnapshot = (): number => pageOfflineReload()?.failures() ?? 0;
const serverFailures = (): number => 0;

/** The page's offline controller state ('none' outside a browser). */
export function useOfflineReloadState(): ChunkWait {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** How many chunks failed on this page so far (0 outside a browser). */
export function useOfflineFailures(): number {
  return useSyncExternalStore(subscribe, failuresSnapshot, serverFailures);
}

/**
 * The page's offline state as this reader shows it: 'none' until a part failed to load while the
 * reader is mounted (the controller's `failures()` grew since mount), then the controller's state.
 * The notice reads it, and LessonReader, which leaves out its own "kept on this device" card while
 * this one says 'offline' (ReaderStatus.tsx shownReaderStatus).
 */
export function useReaderOfflineWait(): ChunkWait {
  const pageWait = useOfflineReloadState();
  const failures = useOfflineFailures();
  // The count when this reader mounted: only a failure after it counts.
  const [mountedAt] = useState(failures);
  return failures > mountedAt ? pageWait : 'none';
}

/** While `active`, this screen has nothing usable on it: the page reloads by itself once the app answers. */
export function useRequireReload(active: boolean): void {
  useEffect(() => (active ? pageOfflineReload()?.requireReload() : undefined), [active]);
}

/** The Layout's main (tabIndex -1), without scrolling it. */
function focusMain(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('main-content')?.focus({ preventScroll: true });
}

/**
 * Publishes the notice's height as --rp-bar-extra on `#main-content` (the reader's scroll container;
 * else the reader root), inherited by the sticky columns; removed while the region is empty and on unmount.
 */
function useBarExtra(ref: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const host = ref.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const target = host.closest<HTMLElement>('#main-content') ?? host.closest<HTMLElement>('.rp-reader');
    if (!target) return undefined;
    const publish = () => {
      const height = Math.ceil(host.getBoundingClientRect().height);
      if (height > 0) target.style.setProperty(BAR_EXTRA_PROPERTY, `${height}px`);
      else target.style.removeProperty(BAR_EXTRA_PROPERTY);
    };
    const observer = new ResizeObserver(publish);
    observer.observe(host);
    publish();
    return () => {
      observer.disconnect();
      target.style.removeProperty(BAR_EXTRA_PROPERTY);
    };
  }, [ref]);
}

export function OfflineReloadNoticeView({ language, wait, dismissed, onReload, onDismiss, hostRef }: {
  language: Language;
  wait: ChunkWait;
  dismissed: boolean;
  onReload: () => void;
  onDismiss: () => void;
  hostRef?: React.Ref<HTMLDivElement>;
}) {
  const t = offlineReloadCopy[language];
  let content: React.ReactNode = null;
  if (wait !== 'none' && !dismissed) {
    const Icon = wait === 'back' ? RotateCw : CloudOff;
    content = (
      <p className="rp-status-card" data-kind="chunk" data-state={wait}>
        <Icon size={16} aria-hidden="true" className="rp-status-icon" />
        <span className="rp-status-text">{offlinePartText(language, wait)}</span>
        {wait === 'back' ? (
          <button type="button" className="rp-link-btn" onClick={onReload}>
            {t.reload}
          </button>
        ) : null}
        <button type="button" className="rp-link-btn rp-notice-x" aria-label={t.close} onClick={onDismiss}>
          ×
        </button>
      </p>
    );
  }
  // The same element in every state: only its content changes.
  return (
    <div ref={hostRef} className="rp-chunk-status" role="status" aria-live="polite">
      {content}
    </div>
  );
}

export default function OfflineReloadNotice() {
  const { language } = useLanguage();
  // The card shows only after a part failed here.
  const wait = useReaderOfflineWait();
  // One stretch of one state: `closed` belongs to the state it was set in. When the state changes,
  // a new stretch starts open (during render, so the card never misses a frame), so after
  // back → offline → back the card comes back even if it was closed in the first back.
  const [stretch, setStretch] = useState<{ wait: ChunkWait; closed: boolean }>(() => ({ wait, closed: false }));
  if (stretch.wait !== wait) setStretch({ wait, closed: false });
  const hostRef = useRef<HTMLDivElement | null>(null);
  useBarExtra(hostRef);
  return (
    <OfflineReloadNoticeView
      language={language}
      wait={wait}
      dismissed={stretch.wait === wait && stretch.closed}
      hostRef={hostRef}
      onReload={() => pageOfflineReload()?.reloadNow()}
      onDismiss={() => {
        setStretch({ wait, closed: true });
        focusMain();
      }}
    />
  );
}
