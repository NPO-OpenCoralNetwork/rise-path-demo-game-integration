import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize, Minus, Plus, X } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * Full-screen viewer for a diagram (sanitized SVG markup) or an image. Portal on <body> that
 * re-applies the reader's theme / world / lang, traps Tab, closes on Esc or the scrim, returns
 * focus to the opener, and zooms with the buttons, +/- and 0 (fit). At a fixed zoom the
 * picture pans by scrolling or by dragging.
 */

const copy = {
  en: {
    close: 'Close',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit to screen',
    zoom: 'Zoom',
    keys: '+ / − to zoom, 0 to fit, Esc to close',
    level: (pct: number | null) => (pct === null ? 'Fit' : `${pct}%`),
  },
  jp: {
    close: '閉じる',
    zoomIn: '拡大',
    zoomOut: '縮小',
    fit: '画面に合わせる',
    zoom: '表示倍率',
    keys: '＋／−で拡大・縮小、0で画面に合わせる、Escで閉じる',
    level: (pct: number | null) => (pct === null ? '全体' : `${pct}%`),
  },
} as const;

const LEVELS = [0.5, 0.75, 1, 1.5, 2, 3];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ZoomContent =
  | { kind: 'svg'; markup: string; width: number }
  | { kind: 'image'; src: string; alt: string; width: number };

type ZoomDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Text shown under the picture (caption, figure number). */
  caption?: React.ReactNode;
  content: ZoomContent | null;
  /** Element whose closest .rp-reader supplies theme / world / lang. */
  scopeRef: React.RefObject<HTMLElement | null>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

/** Gives duplicated mermaid markup its own ids so markers and styles do not collide. */
export function reidSvg(markup: string, suffix: string): string {
  const match = /<svg[^>]*\sid="([^"]+)"/.exec(markup);
  if (!match) return markup;
  return markup.split(match[1]).join(`${match[1]}-${suffix}`);
}

function readScope(el: HTMLElement | null) {
  const root = el?.closest<HTMLElement>('.rp-reader');
  return {
    theme: root?.dataset.theme ?? 'light',
    world: root?.dataset.world,
    lang: root?.getAttribute('lang') ?? document.documentElement.lang ?? 'ja',
  };
}

export function ZoomDialog({ open, onClose, title, caption, content, scopeRef, returnFocusRef }: ZoomDialogProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const titleId = `${useId()}-zoom-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [scope, setScope] = useState(() => readScope(null));
  // Stable object: React 19 re-assigns innerHTML (and drops the sizing) when it changes.
  const markup = content?.kind === 'svg' ? content.markup : '';
  const svgHtml = useMemo(() => ({ __html: markup }), [markup]);

  useLayoutEffect(() => {
    if (open) {
      setScope(readScope(scopeRef.current));
      setZoom(null);
    }
  }, [open, scopeRef]);

  const step = useCallback((dir: 1 | -1) => {
    setZoom((current) => {
      const stage = stageRef.current;
      const natural = content?.width || 1;
      // From "fit", start at the scale the picture is currently shown at.
      const base = current ?? (stage ? Math.min(1, stage.clientWidth / natural) : 1);
      const next = dir > 0 ? LEVELS.find((l) => l > base + 0.01) : [...LEVELS].reverse().find((l) => l < base - 0.01);
      return next ?? (dir > 0 ? LEVELS[LEVELS.length - 1] : LEVELS[0]);
    });
  }, [content]);

  // Focus in, trap, keys, restore.
  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef.current;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          step(1);
          return;
        }
        if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          step(-1);
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          setZoom(null);
          return;
        }
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef, step]);

  // Size the picture: fit = contained in the stage; otherwise natural width × zoom.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage || !content) return;
    const el = stage.querySelector<HTMLElement | SVGSVGElement>('svg, img');
    if (!el) return;
    el.removeAttribute('width');
    el.removeAttribute('height');
    el.setAttribute('aria-hidden', 'true');
    const style = (el as HTMLElement).style;
    style.maxWidth = 'none';
    if (zoom === null) {
      style.width = '100%';
      style.height = '100%';
    } else {
      style.width = `${Math.round(content.width * zoom)}px`;
      style.height = 'auto';
    }
  }, [open, zoom, content]);

  // Drag to pan at a fixed zoom.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom === null || event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    drag.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!drag.current || !stage) return;
    stage.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    stage.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  if (!open || !content || typeof document === 'undefined') return null;
  const pct = zoom === null ? null : Math.round(zoom * 100);

  return createPortal(
    <div className="rp-sheet-root rp-zoom-root" data-theme={scope.theme} data-world={scope.world} lang={scope.lang}>
      <div className="rp-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="rp-zoom-panel">
        <div className="rp-zoom-head">
          <h2 id={titleId} className="rp-zoom-title">{title}</h2>
          <div className="rp-zoom-tools" role="group" aria-label={text.zoom}>
            <button type="button" className="rp-btn rp-btn-icon rp-btn-sm" aria-label={text.zoomOut} title={text.zoomOut} onClick={() => step(-1)}>
              <Minus size={16} aria-hidden="true" />
            </button>
            <span className="rp-zoom-level tabular" aria-live="polite">{text.level(pct)}</span>
            <button type="button" className="rp-btn rp-btn-icon rp-btn-sm" aria-label={text.zoomIn} title={text.zoomIn} onClick={() => step(1)}>
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-icon rp-btn-sm"
              aria-label={text.fit}
              title={text.fit}
              aria-pressed={zoom === null}
              onClick={() => setZoom(null)}
            >
              <Maximize size={15} aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="rp-btn rp-btn-icon rp-btn-ghost" aria-label={text.close} data-autofocus onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div
          ref={stageRef}
          className="rp-zoom-stage"
          data-fit={zoom === null || undefined}
          role="img"
          aria-label={content.kind === 'image' ? content.alt : title}
          tabIndex={zoom === null ? undefined : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {content.kind === 'svg'
            // Sanitized by DOMPurify in renderMermaid; ids made unique by reidSvg.
            ? <div className="rp-zoom-svg" dangerouslySetInnerHTML={svgHtml} />
            : <img src={content.src} alt="" className="rp-zoom-img" draggable={false} />}
        </div>
        <div className="rp-zoom-foot">
          {caption && <div className="rp-zoom-caption">{caption}</div>}
          <p className="rp-zoom-keys">{text.keys}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
