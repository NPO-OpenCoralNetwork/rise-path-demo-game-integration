import React from 'react';
import { CirclePause, Lock, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { ButtonLink } from '../ui/Button';
import { AI_ACCESS_SETUP_PATH, AI_SAFETY_PATH, type AiAccessErrorKind } from '../../services/aiAccessApi';

/**
 * Inline card shown where an AI feature was refused by the access gate (401/403 from
 * server/middleware/aiAccessGate.js): says what is needed and links to the setup page.
 * Use with aiAccessErrorKind(error) from services/aiAccessApi.ts.
 */

type Entry = { title: string; body: string; action?: string; to?: string };

const copy: Record<'en' | 'jp', Record<AiAccessErrorKind, Entry> & { more: string }> = {
  en: {
    sign_in_required: {
      title: 'Sign in to use AI',
      body: 'AI features are for signed-in learners. You can keep reading lessons without AI.',
    },
    age_required: {
      title: 'One step before using AI',
      body: 'Please enter the year and month you were born. We use it to set up AI in a way that fits your age.',
      action: 'Set up AI',
      to: AI_ACCESS_SETUP_PATH,
    },
    guardian_consent_required: {
      title: 'A parent or guardian needs to agree',
      body: 'If you are under 18, a parent or guardian agrees first. Open the setup page together with them.',
      action: 'Open with a guardian',
      to: AI_ACCESS_SETUP_PATH,
    },
    ai_paused_safety: {
      title: 'AI is resting for today',
      body: 'AI can be used again after midnight (Japan time). You can keep learning without AI.',
      action: 'See details',
      to: AI_ACCESS_SETUP_PATH,
    },
    adults_only: {
      title: 'This feature is for adults',
      body: 'Only people aged 18 or over can use this feature. Other AI features stay available.',
    },
    more: 'About AI safety',
  },
  jp: {
    sign_in_required: {
      title: 'AI を使うには、ログインが必要です',
      body: 'AI の機能は、ログインした人が使えます。AI を使わない学習は、このまま続けられます。',
    },
    age_required: {
      title: 'AI を使う前に、ひとつだけ設定してください',
      body: '生まれた年と月を教えてください。年れいに合ったやり方で AI を使うためです。',
      action: 'AI の利用設定へ',
      to: AI_ACCESS_SETUP_PATH,
    },
    guardian_consent_required: {
      title: '保護者の人の同意が必要です',
      body: '18歳未満の人が AI を使うには、保護者の人の同意が必要です。保護者の人といっしょに設定画面を開いてください。',
      action: '保護者の人と設定する',
      to: AI_ACCESS_SETUP_PATH,
    },
    ai_paused_safety: {
      title: '今日は AI をお休みしています',
      body: '日本時間の夜0時をすぎると、また使えます。AI を使わない学習は、このまま続けられます。',
      action: 'くわしく見る',
      to: AI_ACCESS_SETUP_PATH,
    },
    adults_only: {
      title: 'この機能は、18歳以上の人が使えます',
      body: 'ほかの AI の機能は、これまでどおり使えます。',
    },
    more: 'AI の安全について',
  },
};

const ICONS: Record<AiAccessErrorKind, React.ElementType> = {
  sign_in_required: LogIn,
  age_required: UserRound,
  guardian_consent_required: ShieldCheck,
  ai_paused_safety: CirclePause,
  adults_only: Lock,
};

export interface AiAccessRequiredProps {
  kind: AiAccessErrorKind;
  /** Overrides the app language (a screen with its own language switch, e.g. the assessment). */
  language?: 'en' | 'jp';
  className?: string;
}

export const AiAccessRequired: React.FC<AiAccessRequiredProps> = ({ kind, language: override, className = '' }) => {
  const { language: appLanguage } = useLanguage();
  const t = copy[override ?? appLanguage];
  const entry = t[kind] ?? t.age_required;
  const Icon = ICONS[kind] ?? UserRound;

  return (
    <div role="status" className={`rounded-card border border-line bg-surface p-4 shadow-1 ${className}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-text">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-body font-semibold text-fg">{entry.title}</p>
          <p className="mt-0.5 text-small text-fg-2">{entry.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {entry.action && entry.to ? (
              <ButtonLink to={entry.to} variant="primary" size="sm">
                {entry.action}
              </ButtonLink>
            ) : null}
            <ButtonLink to={AI_SAFETY_PATH} variant="ghost" size="sm">
              {t.more}
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAccessRequired;
