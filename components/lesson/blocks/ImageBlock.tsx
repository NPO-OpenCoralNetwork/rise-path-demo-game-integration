import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { BlockProps } from './registry';
import { Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

const copy = {
  en: { figure: 'Figure', missing: 'The image could not be loaded.' },
  jp: { figure: '図', missing: '画像を読み込めませんでした。' },
} as const;

const SAFE_SRC = /^(https?:\/\/|\/|\.\/|data:image\/(png|jpe?g|gif|webp|avif);)/i;

/** A teaching image: max 420px tall, caption with figure number, alt text required. */
export default function ImageBlock({ block }: BlockProps<'image'>) {
  const { language } = useLanguage();
  const { t, figures } = useReader();
  const [failed, setFailed] = useState(false);
  const text = copy[language];
  const number = figures.get(block.id);
  const alt = block.decorative ? '' : t(block.alt);
  const src = SAFE_SRC.test(block.src) ? block.src : '';

  return (
    <figure className={`rp-figure ${block.layout === 'wide' ? 'rp-figure-wide' : ''}`}>
      <div className="rp-image-frame">
        {src && !failed ? (
          <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
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
          {number ? <span className="rp-fig-num">{text.figure}{number}</span> : null}
          <Txt value={block.caption} />
        </figcaption>
      )}
    </figure>
  );
}
