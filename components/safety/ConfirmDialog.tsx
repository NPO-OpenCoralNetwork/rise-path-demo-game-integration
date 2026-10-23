import React, { useEffect, useId, useRef } from 'react';

/**
 * Small confirmation dialog on the native <dialog> element (modal): the browser keeps focus
 * inside it and Esc closes it; on close, focus returns to `returnFocusRef`.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** 'danger' (default) for destructive actions; 'primary' when confirming is not destructive. */
  confirmTone?: 'danger' | 'primary';
}

const CONFIRM_TONE = {
  danger: 'bg-danger hover:opacity-90',
  primary: 'bg-primary hover:bg-primary-hover',
} as const;

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  busy = false,
  returnFocusRef,
  confirmTone = 'danger',
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
      // The safe choice gets focus first.
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      onClose();
      returnFocusRef?.current?.focus();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose, returnFocusRef]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-hero border border-line bg-raised p-0 text-fg shadow-3 backdrop:bg-overlay"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-h3 text-fg">
          {title}
        </h2>
        <div id={bodyId} className="mt-2 text-body text-fg-2">
          {body}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => ref.current?.close()}
            className="h-10 rounded-control border border-line bg-surface px-4 text-body font-semibold text-fg hover:bg-sunken"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-10 rounded-control border border-transparent px-4 text-body font-semibold text-on-primary disabled:opacity-50 ${CONFIRM_TONE[confirmTone]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
};

export default ConfirmDialog;
