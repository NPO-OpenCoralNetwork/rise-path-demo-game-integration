import { useCallback, useEffect, useRef, useState } from 'react';
import { sourceAnchorId } from './model';
import { READER_SCROLL_OFFSET, barExtra, offsetInContainer, restoreOffsetInContainer } from './useScrollContainer';

/**
 * The sources list's state (「出典と検索」 step 5): open or folded, the source a number led to, and
 * the way back. LessonReader keeps it; a screen that reuses the blocks without the reader (the
 * training plan §4.6) can use it as is.
 *
 * - show: a number under a block (CiteMarks) unfolds the list; once it is open the page moves to
 *   that source below the sticky bar (and the offline notice's barExtra) and the focus goes to it.
 *   The same number again moves again (seq).
 * - holding: true while the learner reads the list after a jump. The reader then keeps the resume
 *   position where they were reading (useLessonProgress's trackPosition), instead of saving the
 *   end of the lesson and sending it to their other devices. Scrolling back into the lesson
 *   releases it.
 * - back: the number that was clicked returns to where it sat on screen and gets the focus again.
 * - The list unfolds before printing, so printed numbers have their list.
 */

/** The source the learner jumped to, and the block they came from. */
export type SourceTarget = { sourceId: string; blockId: string };

type Jump = SourceTarget & { markTop: number | null; seq: number };

export type SourceJump = {
  /** The list is unfolded. */
  open: boolean;
  /** The source the learner jumped to (marked in the list, with the way back), else null. */
  target: SourceTarget | null;
  /** The learner reads the list after a jump: keep the resume position where they were reading. */
  holding: boolean;
  show: (sourceId: string, blockId: string, from?: HTMLElement | null) => void;
  back: (target: SourceTarget) => void;
  /** The learner folded or unfolded the list (folding forgets the jump). */
  toggle: (open: boolean) => void;
  /** Fold the list and forget the jump (the lesson was started over). */
  reset: () => void;
};

export function useSourceJump({ container, scrollToElement, onScroll }: {
  container: HTMLElement | null;
  /** Moves the page to an element below the sticky bar (useScrollContainer's scrollToElement). */
  scrollToElement: (target: Element) => void;
  /** Called before each move of the page (the reader marks it as its own). */
  onScroll?: () => void;
}): SourceJump {
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);
  const [listInView, setListInView] = useState(false);
  const notify = useRef(onScroll);
  notify.current = onScroll;

  const show = useCallback((sourceId: string, blockId: string, from?: HTMLElement | null) => {
    const markTop = from && container ? offsetInContainer(container, from) : null;
    setOpen(true);
    setJump((previous) => ({ sourceId, blockId, markTop, seq: (previous?.seq ?? 0) + 1 }));
  }, [container]);

  const seq = jump?.seq;
  const sourceId = jump?.sourceId;

  // After the list has opened: move to the source and focus it, so a screen reader reads it and
  // the next Tab reaches its link. Only a new jump (seq) moves the page.
  useEffect(() => {
    if (!sourceId) return;
    const item = document.getElementById(sourceAnchorId(sourceId));
    if (!item) return;
    notify.current?.();
    scrollToElement(item);
    item.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  // While a jump is open: is the list on screen (below the sticky bar)?
  useEffect(() => {
    if (!sourceId || !container) {
      setListInView(false);
      return undefined;
    }
    const list = document.getElementById(sourceAnchorId(sourceId))?.closest('.rp-sources');
    if (!list) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = container === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : container.getBoundingClientRect();
      const rect = list.getBoundingClientRect();
      setListInView(rect.bottom > box.top + READER_SCROLL_OFFSET + barExtra(container) && rect.top < box.bottom);
    };
    const onContainerScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    container.addEventListener('scroll', onContainerScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onContainerScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [seq, sourceId, container]);

  const back = useCallback((target: SourceTarget) => {
    const markTop = jump && jump.sourceId === target.sourceId && jump.blockId === target.blockId ? jump.markTop : null;
    setJump(null);
    const block = document.getElementById(`b-${target.blockId}`);
    if (!block) {
      // Nothing to go back to (the block has gone): keep the focus in the list, not on <body>.
      document.getElementById(sourceAnchorId(target.sourceId))?.focus({ preventScroll: true });
      return;
    }
    const marks = Array.from(block.querySelectorAll<HTMLElement>('.rp-cite-num'));
    const mark = marks.find((el) => el.dataset.cite === target.sourceId) ?? marks[0] ?? null;
    notify.current?.();
    if (mark && container && markTop !== null) restoreOffsetInContainer(container, mark, markTop);
    else scrollToElement(block);
    (mark ?? document.getElementById('main-content'))?.focus({ preventScroll: true });
  }, [jump, container, scrollToElement]);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setJump(null);
  }, []);

  const reset = useCallback(() => {
    setOpen(false);
    setJump(null);
  }, []);

  useEffect(() => {
    const unfold = () => setOpen(true);
    window.addEventListener('beforeprint', unfold);
    return () => window.removeEventListener('beforeprint', unfold);
  }, []);

  return {
    open,
    target: jump ? { sourceId: jump.sourceId, blockId: jump.blockId } : null,
    holding: jump !== null && listInView,
    show,
    back,
    toggle,
    reset,
  };
}
