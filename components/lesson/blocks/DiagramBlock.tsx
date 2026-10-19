import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChartNetwork, Expand } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';
import { readPalette, renderMermaid } from './mermaidRenderer';
import { ZoomDialog, reidSvg, type ZoomContent } from './ZoomDialog';

/**
 * Mermaid diagram: lazy-loaded, securityLevel 'strict', init directives stripped, SVG
 * sanitized with DOMPurify (svg + html profiles), colors from the reader tokens. Exposed as
 * role="img" with the alt text, a <details> text description and a zoom dialog. Labels stay
 * ≥ 13px: the SVG never scales below 87% of its 15px labels; wider diagrams scroll sideways.
 */

const copy = {
  en: {
    figure: (n: number) => `Figure ${n}`,
    loading: 'Drawing the diagram…',
    failed: 'This diagram could not be drawn. Its description:',
    describe: 'Describe the figure in words',
    scroll: 'Diagram, scrolls sideways',
    zoomLabel: (name: string) => `Enlarge ${name}`,
  },
  jp: {
    figure: (n: number) => `図${n}`,
    loading: '図を描いています…',
    failed: 'この図を表示できませんでした。図の内容：',
    describe: '図の説明を読む',
    scroll: '図（横にスクロールできます）',
    zoomLabel: (name: string) => `${name}を拡大して見る`,
  },
} as const;

const MIN_SCALE = 0.87;

/** Natural width of the rendered SVG (viewBox), or 0. */
function svgWidth(host: HTMLElement): number {
  const svg = host.querySelector('svg');
  const viewBox = svg?.viewBox?.baseVal;
  return viewBox && viewBox.width > 0 ? viewBox.width : svg?.getBoundingClientRect().width ?? 0;
}

function fitSvg(host: HTMLElement) {
  const svg = host.querySelector('svg');
  if (!svg) return false;
  const natural = svgWidth(host);
  const available = host.clientWidth;
  if (!natural || !available) return false;
  const width = Math.min(natural, Math.max(available, natural * MIN_SCALE));
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.width = `${Math.round(width)}px`;
  svg.style.maxWidth = 'none';
  svg.style.height = 'auto';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return width > available + 1;
}

export default function DiagramBlock({ block }: BlockProps<'diagram'>) {
  const { language } = useLanguage();
  const { t, figures, appearance } = useReader();
  const text = copy[language];
  const figureRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const code = t(block.code);
  const alt = t(block.alt);
  const caption = t(block.caption);
  const number = figures.get(block.id);
  const figureName = number ? text.figure(number) : caption || alt;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const el = figureRef.current;
    if (!el || !code) {
      setFailed(true);
      return;
    }
    renderMermaid(code, readPalette(el), block.id)
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, block.id, appearance]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !svg) return;
    const apply = () => setScrolls(fitSvg(host));
    apply();
    setNaturalWidth(svgWidth(host));
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [svg]);

  const zoomMarkup = useMemo(() => (svg ? reidSvg(svg, 'zoom') : ''), [svg]);
  // React 19 re-assigns innerHTML whenever this object changes identity, which would throw
  // away the sizing applied by fitSvg on every progress update. Keep it stable.
  const svgHtml = useMemo(() => ({ __html: svg ?? '' }), [svg]);
  const zoomContent = useMemo<ZoomContent | null>(
    () => (svg ? { kind: 'svg', markup: zoomMarkup, width: naturalWidth || 640 } : null),
    [svg, zoomMarkup, naturalWidth],
  );

  return (
    <figure ref={figureRef} className="rp-figure rp-diagram">
      <div className="rp-diagram-card">
        {failed ? (
          <div className="flex items-start gap-3 p-5 text-small text-fg-2">
            <ChartNetwork size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-3" />
            <p className="m-0">{text.failed} {alt}</p>
          </div>
        ) : svg ? (
          <div
            key="svg"
            ref={hostRef}
            role="img"
            aria-label={alt}
            className="rp-diagram-host"
            tabIndex={scrolls ? 0 : undefined}
            title={scrolls ? text.scroll : undefined}
            // Sanitized by DOMPurify in renderMermaid.
            dangerouslySetInnerHTML={svgHtml}
          />
        ) : (
          <div key="loading" role="img" aria-label={alt} aria-busy="true" className="rp-diagram-host">
            <span className="rp-diagram-loading" aria-hidden="true">{text.loading}</span>
          </div>
        )}
      </div>
      {(block.caption || number) && (
        <figcaption className="rp-figcaption">
          {number ? <span className="rp-fig-num">{text.figure(number)}</span> : null}
          <Txt value={block.caption} />
        </figcaption>
      )}
      {svg && (
        <button
          ref={zoomButtonRef}
          type="button"
          className="rp-diagram-zoom"
          aria-haspopup="dialog"
          aria-expanded={zoomOpen}
          aria-label={text.zoomLabel(figureName)}
          title={text.zoomLabel(figureName)}
          onClick={() => setZoomOpen(true)}
        >
          <Expand size={15} aria-hidden="true" />
        </button>
      )}
      {block.description && (
        <details className="rp-details">
          <summary>{text.describe}</summary>
          <MdText value={block.description} className="rp-details-body" />
        </details>
      )}
      <ZoomDialog
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={number ? `${text.figure(number)} ${caption}`.trim() : caption || alt}
        caption={alt}
        content={zoomContent}
        scopeRef={figureRef}
        returnFocusRef={zoomButtonRef}
      />
    </figure>
  );
}
