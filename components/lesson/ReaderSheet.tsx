import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Dialog surface for the reader: left drawer (outline), right drawer (side panel below 1280px),
 * bottom sheet (mobile), or a popover anchored to a button (Aa settings). Rendered in a portal on <body> so the Layout's
 * transformed page-transition wrapper cannot mis-position it, and re-applies the reader's
 * theme, world and language attributes there.
 *
 * Focus moves into the dialog, Tab is trapped, Esc / scrim click / close button close it, and
 * focus returns to `returnFocusRef` (the button that opened it).
 */

export type SheetVariant = 'drawer' | 'drawer-end' | 'sheet' | 'popover';

type ReaderSheetProps = {
  open: boolean;
  onClose: () => void;
  variant: SheetVariant;
  title: string;
  closeLabel: string;
  /** Attributes copied from the reader root. */
  scope: { theme: string; world?: string; lang: string };
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Popover only: the element the panel hangs under. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  id?: string;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ReaderSheet({
  open,
  onClose,
  variant,
  title,
  closeLabel,
  scope,
  returnFocusRef,
  anchorRef,
  children,
  id,
}: ReaderSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${id ?? 'rp-sheet'}-title`;
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Popover position under its anchor, right-aligned.
  useLayoutEffect(() => {
    if (!open || variant !== 'popover') return;
    const place = () => {
      const rect = anchorRef?.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, variant, anchorRef]);

  // Focus in, trap, Esc, restore.
  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (variant !== 'popover') return;
      const target = event.target as Node;
      if (panel?.contains(target) || anchorRef?.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
  }, [open, variant, anchorRef, returnFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  const panelClass = {
    drawer: 'rp-sheet-panel rp-sheet-drawer',
    'drawer-end': 'rp-sheet-panel rp-sheet-drawer rp-sheet-drawer-end',
    sheet: 'rp-sheet-panel rp-sheet-bottom',
    popover: 'rp-sheet-panel rp-sheet-popover',
  }[variant];

  return createPortal(
    <div
      className="rp-sheet-root"
      data-theme={scope.theme}
      data-world={scope.world}
      lang={scope.lang}
      data-variant={variant}
    >
      {variant !== 'popover' && (
        <div className="rp-sheet-scrim" aria-hidden="true" onClick={onClose} />
      )}
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal={variant === 'popover' ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={panelClass}
        style={variant === 'popover' && position ? { top: position.top, right: position.right } : undefined}
      >
        {variant === 'sheet' && <div className="rp-sheet-grip" aria-hidden="true" />}
        <div className="rp-sheet-head">
          <h2 id={titleId} className="rp-sheet-title">{title}</h2>
          <button type="button" className="rp-btn rp-btn-icon rp-btn-ghost" aria-label={closeLabel} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="rp-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
