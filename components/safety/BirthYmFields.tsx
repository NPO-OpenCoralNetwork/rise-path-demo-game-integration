import React, { useId, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { tokyoYearMonth } from '../../services/aiAccessApi';

/**
 * Year and month selects for a birth month (no day is asked). Years run from this year back to
 * 1900; months after the current month (Japan time) are left out for this year.
 */
export interface BirthYmFieldsProps {
  year: string;
  month: string;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  disabled?: boolean;
  /** id of a hint paragraph read with both selects. */
  describedBy?: string;
  /** Visible group label. */
  legend: string;
}

const copy = {
  en: { year: 'Year', month: 'Month', choose: 'Choose', yearOption: (y: number) => String(y), monthOption: (m: number) => new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' }) },
  jp: { year: '年', month: '月', choose: '選ぶ', yearOption: (y: number) => `${y}年`, monthOption: (m: number) => `${m}月` },
} as const;

export const selectClasses =
  'h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-body text-fg disabled:opacity-50';

export const BirthYmFields: React.FC<BirthYmFieldsProps> = ({
  year,
  month,
  onYearChange,
  onMonthChange,
  disabled,
  describedBy,
  legend,
}) => {
  const { language } = useLanguage();
  const t = copy[language];
  const yearId = useId();
  const monthId = useId();
  const current = useMemo(() => tokyoYearMonth(), []);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = current.year; y >= 1900; y -= 1) list.push(y);
    return list;
  }, [current.year]);
  const lastMonth = Number(year) === current.year ? current.month : 12;
  const months = Array.from({ length: lastMonth }, (_, i) => i + 1);

  return (
    <fieldset disabled={disabled} aria-describedby={describedBy}>
      <legend className="text-body font-semibold text-fg">{legend}</legend>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:max-w-sm">
        <div>
          <label htmlFor={yearId} className="block text-small font-medium text-fg-2">
            {t.year}
          </label>
          <select
            id={yearId}
            value={year}
            onChange={(e) => {
              onYearChange(e.target.value);
              if (Number(e.target.value) === current.year && Number(month) > current.month) onMonthChange('');
            }}
            aria-describedby={describedBy}
            className={`mt-1 ${selectClasses}`}
          >
            <option value="">{t.choose}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {t.yearOption(y)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={monthId} className="block text-small font-medium text-fg-2">
            {t.month}
          </label>
          <select
            id={monthId}
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            aria-describedby={describedBy}
            className={`mt-1 ${selectClasses}`}
          >
            <option value="">{t.choose}</option>
            {months.map((m) => (
              <option key={m} value={String(m)}>
                {t.monthOption(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </fieldset>
  );
};

export default BirthYmFields;
