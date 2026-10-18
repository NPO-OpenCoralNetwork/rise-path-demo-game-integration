import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChartNetwork } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';
import { readPalette, renderMermaid } from './mermaidRenderer';

/**
 * Baseline mermaid diagram (WP-05 adds zoom). Lazy-loaded, securityLevel 'strict', SVG
 * sanitized with DOMPurify, exposed as role="img" with the alt text. Labels stay ≥ 13px:
 * the SVG never scales below 87%; wider diagrams scroll horizontally inside the figure.
 */

const copy = {
  en: {
    figure: 'Figure',
    loading: 'Drawing the diagram…',
    failed: 'This diagram could not be drawn. Its description:',
    describe: 'Describe the figure in words',
    scroll: 'Diagram, scrolls sideways',
  },
  jp: {
    figure: '図',
    loading: '図を描いています…',
    failed: 'この図を表示できませんでした。図の内容：',
    describe: '図の説明を読む',
    scroll: '図（横にスクロールできます）',
  },
} as const;

const MIN_SCALE = 0.87;

function fitSvg(host: HTMLElement) {
  const svg = host.querySelector('svg');
  if (!svg) return false;
  const viewBox = svg.viewBox?.baseVal;
  const natural = viewBox && viewBox.width > 0 ? viewBox.width : svg.getBoundingClientRect().width;
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
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  const code = t(block.code);
  const alt = t(block.alt);
  const number = figures.get(block.id);

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
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [svg]);

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
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div key="loading" role="img" aria-label={alt} aria-busy="true" className="rp-diagram-host">
            <span className="rp-diagram-loading" aria-hidden="true">{text.loading}</span>
          </div>
        )}
      </div>
      {(block.caption || number) && (
        <figcaption className="rp-figcaption">
          {number ? <span className="rp-fig-num">{text.figure}{number}</span> : null}
          <Txt value={block.caption} />
        </figcaption>
      )}
      {block.description && (
        <details className="rp-details">
          <summary>{text.describe}</summary>
          <MdText value={block.description} className="rp-details-body" />
        </details>
      )}
    </figure>
  );
}
