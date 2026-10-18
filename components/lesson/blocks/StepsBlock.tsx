import React from 'react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * A procedure: numbered rail, keyboard chips, expected result, "stuck?" disclosure and a done
 * checkbox per step (saved with the progress). WP-05 polishes the interaction.
 */

const copy = {
  en: { done: 'Done', expect: 'Expected result', stuck: 'Stuck?', hint: 'Hint', fix: 'If it does not work', sep: ': ' },
  jp: { done: '完了', expect: '期待される結果', stuck: 'うまくいかないときは', hint: 'ヒント', fix: '直し方', sep: '：' },
} as const;

export default function StepsBlock({ block }: BlockProps<'steps'>) {
  const { language } = useLanguage();
  const { progress } = useReader();
  const text = copy[language];
  const key = (stepId: string) => `step:${block.id}/${stepId}`;

  return (
    <ol className="rp-steps">
      {block.items.map((step, i) => {
        const done = Boolean(progress.getCheck(key(step.id)));
        const inputId = `${block.id}-${step.id}-done`;
        const titleId = `${block.id}-${step.id}-title`;
        return (
          <li key={step.id} className="rp-step" data-done={done || undefined} aria-labelledby={titleId}>
            <span className="rp-step-num" aria-hidden="true">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <h3 id={titleId} className="rp-step-title"><Txt value={step.title} /></h3>
                <label htmlFor={inputId} className="rp-step-done">
                  <input
                    id={inputId}
                    type="checkbox"
                    className="rp-checkbox"
                    checked={done}
                    onChange={(event) => progress.setCheck(key(step.id), event.target.checked)}
                  />
                  {text.done}
                </label>
              </div>
              {step.md && <MdText value={step.md} className="rp-step-body" />}
              {step.keys && step.keys.length > 0 && (
                <p className="rp-keys">
                  {step.keys.map((k, ki) => <kbd key={ki}>{k}</kbd>)}
                </p>
              )}
              {step.expect && (
                <div className="rp-step-expect">
                  <p className="rp-step-expect-label">{text.expect}</p>
                  <MdText value={step.expect} />
                </div>
              )}
              {(step.hint || step.troubleshoot) && (
                <details className="rp-details">
                  <summary>{text.stuck}</summary>
                  <div className="rp-details-body">
                    {step.hint && <p><strong>{text.hint}{text.sep}</strong><MdText value={step.hint} inline /></p>}
                    {step.troubleshoot && <p><strong>{text.fix}{text.sep}</strong><MdText value={step.troubleshoot} inline /></p>}
                  </div>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
