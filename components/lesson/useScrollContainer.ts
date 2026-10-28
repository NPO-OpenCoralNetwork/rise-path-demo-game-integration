import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * The app scrolls inside `<main id="main-content">` (Layout), not the window, so
 * `window.scrollTo` is a no-op on lesson routes. These helpers find the element that really
 * scrolls and move it.
 */

/** Height of the sticky LessonBar plus breathing room; headings land this far below the top. */
export const READER_SCROLL_OFFSET = 72;

// Overflow style only: the container may not overflow yet while the lesson is loading.
const isScrollable = (el: Element) => /(auto|scroll|overlay)/.test(window.getComputedStyle(el).overflowY);

/** The nearest scrolling ancestor of `from`, else `#main-content`, else the document. */
export function findScrollContainer(from?: Element | null): HTMLElement {
  let el: Element | null = from?.parentElement ?? null;
  while (el && el !== document.body) {
    if (isScrollable(el)) return el as HTMLElement;
    el = el.parentElement;
  }
  const main = document.getElementById('main-content');
  if (main) return main;
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The height the reader's offline notice adds to the sticky bar while it shows (Phase 8, S1; reader.css). */
export const BAR_EXTRA_PROPERTY = '--rp-bar-extra';

/**
 * That height in px: set inline on the scroll container by OfflineReloadNotice, 0 otherwise. Read
 * from the container's own inline style, so a panel that only inherits it (a sticky column) adds nothing.
 */
export function barExtra(container: HTMLElement): number {
  const value = Number.parseFloat(container.style?.getPropertyValue(BAR_EXTRA_PROPERTY) ?? '');
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Scrolls `container` so `target` sits `offset` px (plus the notice's `barExtra`) below its top edge. */
export function scrollElementIntoContainer(
  container: HTMLElement,
  target: Element,
  { offset = READER_SCROLL_OFFSET, smooth = true }: { offset?: number; smooth?: boolean } = {},
): void {
  const containerTop = container === document.documentElement ? 0 : container.getBoundingClientRect().top;
  const top = target.getBoundingClientRect().top - containerTop + container.scrollTop - offset - barExtra(container);
  container.scrollTo({ top: Math.max(0, top), behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
}

/**
 * Resolves the scroll container for a mounted element. Returns null on the first render.
 */
export function useScrollContainer(ref: RefObject<HTMLElement | null>) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(findScrollContainer(ref.current));
  }, [ref]);

  const scrollToElement = useCallback((target: Element | null, options?: { offset?: number; smooth?: boolean }) => {
    if (!target) return;
    const scroller = container ?? findScrollContainer(ref.current);
    scrollElementIntoContainer(scroller, target, options);
  }, [container, ref]);

  const scrollToTop = useCallback(() => {
    const scroller = container ?? findScrollContainer(ref.current);
    scroller.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [container, ref]);

  return { container, scrollToElement, scrollToTop };
}
