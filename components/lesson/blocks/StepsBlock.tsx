import React from 'react';
import { Check, CircleCheckBig } from 'lucide-react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';
import { useReader } from '../ReaderContext';
import { splitKeyCombo } from './blockText';
import { useLanguage } from '../../../context/LanguageContext';

/**
 * A procedure: numbered rail with a done checkbox per step (saved with the progress, the
 * number turns into a check), keyboard shortcuts as <kbd> chips ("Ctrl+S" → Ctrl + S), the
 * expected result, and a "stuck?" disclosure with the hint and the fix. A counter above the
 * rail shows how many steps are done.
 */

const copy = {
  en: {
    label: 'Steps',
    progress: (n: number, m: number) => `${n} of ${m} done`,
    allDone: 'All steps done',
    done: 'Done',
    doneLabel: (n: number) => `Mark step ${n} as done`,
    expect: 'Expected result',
    stuck: 'Stuck?',
    hint: 'Hint',
    fix: 'If it does not work',
    sep: ': ',
    keys: 'Keys',
    plus: 'plus',
  },
  jp: {
    label: '手順',
    progress: (n: number, m: number) => `${m}ステップ中 ${n} 完了`,
    allDone: 'すべてのステップが完了',
    done: '完了',
    doneLabel: (n: number) => `ステップ${n}を完了にする`,
    expect: '期待される結果',
    stuck: 'うまくいかないときは',
    hint: 'ヒント',
    fix: '直し方',
    sep: '：',
    keys: '操作キー',
    plus: 'と',
  },
} as const;

function KeyCombo({ combo, plus }: { combo: string; plus: string }) {
  const keys = splitKeyCombo(combo);
  if (keys.length <= 1) return <kbd>{keys[0] ?? combo}</kbd>;
  return (
    <kbd className="rp-combo">
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="rp-combo-plus" aria-hidden="true">+</span>}
          {i > 0 && <span className="sr-only">{plus}</span>}
          <kbd>{k}</kbd>
        </React.Fragment>
      ))}
    </kbd>
  );
}

export default function StepsBlock({ block }: BlockProps<'steps'>) {
  const { language } = useLanguage();
  const { progress } = useReader();
  const text = copy[language];
  const key = (stepId: string) => `step:${block.id}/${stepId}`;
  const doneCount = block.items.filter((step) => progress.getCheck(key(step.id))).length;
  const total = block.items.length;
  const labelId = `${block.id}-steps-label`;

  return (
    <div className="rp-steps-wrap" role="group" aria-labelledby={labelId}>
      <div className="rp-steps-head">
        <p id={labelId} className="rp-steps-label">{text.label}</p>
        <span className="rp-steps-count tabular" data-done={doneCount === total || undefined} aria-live="polite">
          {doneCount === total ? <><CircleCheckBig size={14} aria-hidden="true" />{text.allDone}</> : text.progress(doneCount, total)}
        </span>
      </div>
      <ol className="rp-steps">
        {block.items.map((step, i) => {
          const done = Boolean(progress.getCheck(key(step.id)));
          const inputId = `${block.id}-${step.id}-done`;
          const titleId = `${block.id}-${step.id}-title`;
          return (
            <li key={step.id} className="rp-step" data-done={done || undefined} aria-labelledby={titleId}>
              <span className="rp-step-num" aria-hidden="true">
                {done ? <Check size={16} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  <h3 id={titleId} className="rp-step-title"><Txt value={step.title} /></h3>
                  <label htmlFor={inputId} className="rp-step-done">
                    <input
                      id={inputId}
                      type="checkbox"
                      className="rp-checkbox"
                      checked={done}
                      aria-label={text.doneLabel(i + 1)}
                      onChange={(event) => progress.setCheck(key(step.id), event.target.checked)}
                    />
                    <span aria-hidden="true">{text.done}</span>
                  </label>
                </div>
                {step.md && <MdText value={step.md} className="rp-step-body" />}
                {step.keys && step.keys.length > 0 && (
                  <p className="rp-keys">
                    <span className="sr-only">{text.keys}{text.sep}</span>
                    {step.keys.map((k, ki) => <KeyCombo key={ki} combo={k} plus={text.plus} />)}
                  </p>
                )}
                {step.expect && (
                  <div className="rp-step-expect">
                    <p className="rp-step-expect-label">
                      <CircleCheckBig size={13} aria-hidden="true" />{text.expect}
                    </p>
                    <MdText value={step.expect} />
                  </div>
                )}
                {(step.hint || step.troubleshoot) && (
                  <details className="rp-details rp-step-stuck">
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
    </div>
  );
}
