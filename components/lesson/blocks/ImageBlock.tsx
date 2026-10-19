import React, { useMemo, useRef, useState } from 'react';
import { Expand, ImageOff } from 'lucide-react';
import type { BlockProps } from './registry';
import { Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';
import { ZoomDialog, type ZoomContent } from './ZoomDialog';

const copy = {
  en: {
    figure: (n: number) => `Figure ${n}`,
    missing: 'The image could not be loaded.',
    zoomLabel: (name: string) => `Enlarge ${name}`,
    image: 'image',
  },
  jp: {
    figure: (n: number) => `図${n}`,
    missing: '画像を読み込めませんでした。',
    zoomLabel: (name: string) => `${name}を拡大して見る`,
    image: '画像',
  },
} as const;

const SAFE_SRC = /^(https?:\/\/|\/|\.\/|data:image\/(png|jpe?g|gif|webp|avif);)/i;

/**
 * A teaching image: max 420px tall, caption with figure number, alt text required, and a
 * zoom dialog (lightbox) for screenshots that need a closer look.
 */
export default function ImageBlock({ block }: BlockProps<'image'>) {
  const { language } = useLanguage();
  const { t, figures } = useReader();
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const text = copy[language];
  const number = figures.get(block.id);
  const alt = block.decorative ? '' : t(block.alt);
  const caption = t(block.caption);
  const src = SAFE_SRC.test(block.src) ? block.src : '';
  const figureName = number ? text.figure(number) : caption || text.image;
  const zoomable = Boolean(src && !failed && !block.decorative);
  const zoomContent = useMemo<ZoomContent | null>(
    () => (zoomable ? { kind: 'image', src, alt, width: natural || 800 } : null),
    [zoomable, src, alt, natural],
  );

  return (
    <figure ref={figureRef} className={`rp-figure rp-image ${block.layout === 'wide' ? 'rp-figure-wide' : ''}`}>
      <div className="rp-image-frame">
        {src && !failed ? (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={(event) => setNatural(event.currentTarget.naturalWidth)}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-small text-fg-3">
            <ImageOff size={24} aria-hidden="true" />
            <span>{text.missing}</span>
            {alt && <span className="text-fg-2">{alt}</span>}
          </div>
        )}
      </div>
      {(block.caption || number) && !block.decorative && (
        <figcaption className="rp-figcaption">
          {number ? <span className="rp-fig-num">{text.figure(number)}</span> : null}
          <Txt value={block.caption} />
        </figcaption>
      )}
      {zoomable && (
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
