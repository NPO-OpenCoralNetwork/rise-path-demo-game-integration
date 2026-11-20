import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { sourceAnchorId } from './model';
import { offsetInContainer, restoreOffsetInContainer } from './useScrollContainer';

/**
 * The sources list's state (「出典と検索」 step 5): open or folded, the source a number led to, and
 * the way back. LessonReader keeps it; a screen that reuses the blocks without the reader (the
 * training plan §4.6) can use it as is.
 *
 * - show: a number under a block (CiteMarks) unfolds the list; once it is open the page moves to
 *   that source below the sticky bar (and the offline notice's barExtra) and the focus goes to it.
 *   The same number again moves again (seq).
 * - holding: true from when the list comes on screen after a jump until the learner is back in the
 *   lesson: the way back, or scrolling up until the list's top has left the bottom of the screen.
 *   Meanwhile the reader keeps the resume position where they were reading (useLessonProgress's
 *   trackPosition), instead of saving the end of the lesson and sending it to their other devices.
 *   Folding the list, scrolling on to the wrap-up below it, or a way back whose block has gone
 *   does not end it: the learner is still past the lesson's blocks.
 * - back: the number that was clicked returns to where it sat on screen and gets the focus again.
 * - The list unfolds before printing, so printed numbers have their list.
 */

/** The source the learner jumped to, and the block they came from. */
export type SourceTarget = { sourceId: string; blockId: string };

type Jump = SourceTarget & { markTop: number | null; seq: number };

/**
 * Since a jump (to `sourceId`), until the learner is back in the lesson. `past`: the list's top is
 * above the bottom of the screen (the list, or the wrap-up below it, is what they see).
 */
type Away = { sourceId: string; past: boolean };

export type SourceJump = {
  /** The list is unfolded. */
  open: boolean;
  /** The source the learner jumped to (marked in the list, with the way back), else null. */
  target: SourceTarget | null;
  /** Since a jump the learner is at the list or below it: keep the resume position where they were reading. */
  holding: boolean;
  show: (sourceId: string, blockId: string, from?: HTMLElement | null) => void;
  back: (target: SourceTarget) => void;
  /** The learner folded or unfolded the list (folding forgets the jump, not the hold). */
  toggle: (open: boolean) => void;
  /** Fold the list and forget the jump and the hold (the lesson was started over). */
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
  const [away, setAway] = useState<Away | null>(null);
  const notify = useRef(onScroll);
  notify.current = onScroll;

  const show = useCallback((sourceId: string, blockId: string, from?: HTMLElement | null) => {
    const markTop = from && container ? offsetInContainer(container, from) : null;
    setOpen(true);
    setJump((previous) => ({ sourceId, blockId, markTop, seq: (previous?.seq ?? 0) + 1 }));
    // A number clicked during a hold (at the end of the lesson) keeps it: the list is the same.
    setAway((current) => current ?? { sourceId, past: false });
  }, [container]);

  const seq = jump?.seq;
  const sourceId = jump?.sourceId;
  const awayId = away?.sourceId;

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

  // Since a jump: is the list's top above the bottom of the screen? Once it has been, scrolling
  // up until it leaves the screen is the way back into the lesson and ends the hold.
  useEffect(() => {
    const list = awayId && container ? document.getElementById(sourceAnchorId(awayId))?.closest('.rp-sources') : null;
    if (!list || !container) return undefined;
    let frame = 0;
    let reached = false;
    const measure = () => {
      frame = 0;
      const bottom = container === document.documentElement ? window.innerHeight : container.getBoundingClientRect().bottom;
      const past = list.getBoundingClientRect().top < bottom;
      if (past) reached = true;
      else if (reached) {
        setAway(null);
        return;
      }
      setAway((current) => (current && current.past !== past ? { ...current, past } : current));
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
  }, [awayId, container]);

  const back = useCallback((target: SourceTarget) => {
    const markTop = jump && jump.sourceId === target.sourceId && jump.blockId === target.blockId ? jump.markTop : null;
    setJump(null);
    const block = document.getElementById(`b-${target.blockId}`);
    if (!block) {
      // Nothing to go back to (the block has gone): keep the focus in the list, not on <body>, and
      // the hold, since the learner is still at the list.
      document.getElementById(sourceAnchorId(target.sourceId))?.focus({ preventScroll: true });
      return;
    }
    setAway(null);
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
    setAway(null);
  }, []);

  // flushSync: React does not treat beforeprint as a discrete event, so a plain update would be
  // drawn only after the print dialog has taken the page (the folded list).
  useEffect(() => {
    const unfold = () => flushSync(() => setOpen(true));
    window.addEventListener('beforeprint', unfold);
    return () => window.removeEventListener('beforeprint', unfold);
  }, []);

  return {
    open,
    target: jump ? { sourceId: jump.sourceId, blockId: jump.blockId } : null,
    holding: away?.past === true,
    show,
    back,
    toggle,
    reset,
  };
}
