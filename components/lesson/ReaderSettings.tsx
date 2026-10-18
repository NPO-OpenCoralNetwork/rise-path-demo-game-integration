import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { ReaderSheet, type SheetVariant } from './ReaderSheet';

/**
 * Aa settings (PLAN §5.8): text size S/M/L, standard or UD typeface, line spacing, reader-only
 * light / sepia / dark theme, focus mode, and the language. Saved per browser in localStorage
 * (every access in try/catch). The UD face (BIZ UDPGothic) is fetched only when chosen.
 */

export type ReaderSize = 's' | 'm' | 'l';
export type ReaderFont = 'standard' | 'ud';
export type ReaderLeading = 'normal' | 'relaxed';
export type ReaderTheme = 'light' | 'sepia' | 'dark';

export type ReaderSettingsValue = {
  size: ReaderSize;
  font: ReaderFont;
  leading: ReaderLeading;
  theme: ReaderTheme;
  focus: boolean;
};

export const SETTINGS_KEY = 'rp:reader-settings';
const UD_FONT_LINK_ID = 'rp-ud-font-stylesheet';
const UD_FONT_HREF = 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap';

export const DEFAULT_SETTINGS: ReaderSettingsValue = {
  size: 'm',
  font: 'standard',
  leading: 'normal',
  theme: 'light',
  focus: false,
};

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  (options as readonly unknown[]).includes(value) ? (value as T) : fallback;

export function parseSettings(raw: string | null): ReaderSettingsValue {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      size: pick(data.size, ['s', 'm', 'l'] as const, DEFAULT_SETTINGS.size),
      font: pick(data.font, ['standard', 'ud'] as const, DEFAULT_SETTINGS.font),
      leading: pick(data.leading, ['normal', 'relaxed'] as const, DEFAULT_SETTINGS.leading),
      theme: pick(data.theme, ['light', 'sepia', 'dark'] as const, DEFAULT_SETTINGS.theme),
      focus: data.focus === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function readSettings(): ReaderSettingsValue {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Adds the BIZ UDPGothic stylesheet once. Until it loads, font-ud falls back to Noto Sans JP. */
export function ensureUdFont(): void {
  if (typeof document === 'undefined' || document.getElementById(UD_FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = UD_FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = UD_FONT_HREF;
  document.head.appendChild(link);
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettingsValue>(readSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable: settings last for this visit only.
    }
    if (settings.font === 'ud') ensureUdFont();
  }, [settings]);

  const update = useCallback((patch: Partial<ReaderSettingsValue>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return [settings, update] as const;
}

const copy = {
  en: {
    title: 'Reading settings',
    close: 'Close settings',
    size: 'Text size',
    sizes: { s: 'Small', m: 'Medium', l: 'Large' },
    font: 'Typeface',
    fonts: { standard: 'Standard', ud: 'UD (easy read)' },
    leading: 'Line spacing',
    leadings: { normal: 'Standard', relaxed: 'Relaxed' },
    theme: 'Theme',
    themes: { light: 'Light', sepia: 'Sepia', dark: 'Dark' },
    focus: 'Focus mode',
    focusHint: 'Hide the outline and side panel (F key)',
    language: 'Language',
  },
  jp: {
    title: '表示設定',
    close: '表示設定を閉じる',
    size: '文字サイズ',
    sizes: { s: '小', m: '中', l: '大' },
    font: '書体',
    fonts: { standard: '標準', ud: 'UD書体' },
    leading: '行間',
    leadings: { normal: '標準', relaxed: 'ゆったり' },
    theme: 'テーマ',
    themes: { light: 'ライト', sepia: 'セピア', dark: 'ダーク' },
    focus: '集中モード',
    focusHint: '目次と補助パネルを隠します（Fキー）',
    language: '言語',
  },
} as const;

function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: React.ReactNode; lang?: string; swatch?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="rp-setting">
      <legend className="rp-setting-legend">{legend}</legend>
      <div className="rp-segmented" data-count={options.length}>
        {options.map((option) => {
          const inputId = `${name}-${option.value}`;
          return (
            <label key={option.value} htmlFor={inputId} className="rp-segment" data-checked={value === option.value || undefined}>
              <input
                id={inputId}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="sr-only"
                data-autofocus={name === 'rp-size' && value === option.value ? true : undefined}
              />
              {option.swatch && <span className={`rp-swatch ${option.swatch}`} aria-hidden="true" />}
              <span lang={option.lang}>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type ReaderSettingsProps = {
  open: boolean;
  onClose: () => void;
  variant: SheetVariant;
  settings: ReaderSettingsValue;
  onChange: (patch: Partial<ReaderSettingsValue>) => void;
  scope: { theme: string; world?: string; lang: string };
  anchorRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export default function ReaderSettings({
  open,
  onClose,
  variant,
  settings,
  onChange,
  scope,
  anchorRef,
  returnFocusRef,
}: ReaderSettingsProps) {
  const { language, setLanguage } = useLanguage();
  const text = copy[language];

  return (
    <ReaderSheet
      id="rp-settings"
      open={open}
      onClose={onClose}
      variant={variant}
      title={text.title}
      closeLabel={text.close}
      scope={scope}
      anchorRef={anchorRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="flex flex-col gap-4">
        <Choice
          name="rp-size"
          legend={text.size}
          value={settings.size}
          onChange={(size) => onChange({ size })}
          options={[
            { value: 's', label: <span className="rp-size-sample rp-size-s">Aa<span className="sr-only">{text.sizes.s}</span></span> },
            { value: 'm', label: <span className="rp-size-sample rp-size-m">Aa<span className="sr-only">{text.sizes.m}</span></span> },
            { value: 'l', label: <span className="rp-size-sample rp-size-l">Aa<span className="sr-only">{text.sizes.l}</span></span> },
          ]}
        />
        <Choice
          name="rp-font"
          legend={text.font}
          value={settings.font}
          onChange={(font) => onChange({ font })}
          options={[
            { value: 'standard', label: text.fonts.standard },
            { value: 'ud', label: text.fonts.ud },
          ]}
        />
        <Choice
          name="rp-leading"
          legend={text.leading}
          value={settings.leading}
          onChange={(leading) => onChange({ leading })}
          options={[
            { value: 'normal', label: text.leadings.normal },
            { value: 'relaxed', label: text.leadings.relaxed },
          ]}
        />
        <Choice
          name="rp-theme"
          legend={text.theme}
          value={settings.theme}
          onChange={(theme) => onChange({ theme })}
          options={[
            { value: 'light', label: text.themes.light, swatch: 'rp-swatch-light' },
            { value: 'sepia', label: text.themes.sepia, swatch: 'rp-swatch-sepia' },
            { value: 'dark', label: text.themes.dark, swatch: 'rp-swatch-dark' },
          ]}
        />
        <Choice
          name="rp-language"
          legend={text.language}
          value={language}
          onChange={(next) => setLanguage(next)}
          options={[
            { value: 'jp', label: '日本語', lang: 'ja' },
            { value: 'en', label: 'English', lang: 'en' },
          ]}
        />
        <label htmlFor="rp-focus" className="rp-switch-row">
          <span className="min-w-0 flex-1">
            <span className="block text-small font-semibold text-fg">{text.focus}</span>
            <span className="block text-caption text-fg-3">{text.focusHint}</span>
          </span>
          <input
            id="rp-focus"
            type="checkbox"
            role="switch"
            className="rp-switch"
            checked={settings.focus}
            onChange={(event) => onChange({ focus: event.target.checked })}
          />
        </label>
      </div>
    </ReaderSheet>
  );
}
