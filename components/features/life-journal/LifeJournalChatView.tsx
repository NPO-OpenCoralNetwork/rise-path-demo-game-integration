import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarRange,
  MessageCircle,
  Shield,
  Sparkles,
} from 'lucide-react';
import { Message, ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import { ChatInterface } from '../../common/ui/ChatInterface';
import {
  getClientTimezone,
  mapAgentChatError,
  postAgentChat,
  shouldRetryAgentChatWithoutStream,
  streamAgentChat,
} from '../../../services/agentApi';
import { getLocalDateString, shiftDate } from './lifeJournalMetrics';
import { loadLifeJournalPrivacy } from '../../../services/lifeJournalPrivacyService';

interface LifeJournalChatViewProps {
  onNavigate: (view: ViewState) => void;
}

const makeId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const LifeJournalChatView: React.FC<LifeJournalChatViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();

  const today = getLocalDateString();
  const defaultFrom = useMemo(() => shiftDate(today, -29), [today]);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [settingsAllowDiary, setSettingsAllowDiary] = useState(false);
  const [includeDiaryExcerpts, setIncludeDiaryExcerpts] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [caveats, setCaveats] = useState<string[]>([]);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    let active = true;
    loadLifeJournalPrivacy()
      .then((prefs) => {
        if (!active) return;
        setSettingsAllowDiary(prefs.allow_diary_excerpts_in_ai);
        if (!prefs.allow_diary_excerpts_in_ai) {
          setIncludeDiaryExcerpts(false);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const copy = {
    en: {
      title: 'Habit & Learning Chat',
      subtitle: 'Evidence-based patterns from your journal — not medical advice.',
      period: 'Analysis period',
      from: 'From',
      to: 'To',
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      diaryToggle: 'Include diary excerpts in analysis',
      diaryHint: 'Off by default. Short excerpts only when you opt in.',
      diarySettingsLink: 'Enable in Settings → Privacy first.',
      placeholder: 'Ask about sleep, focus, exercise, and learning…',
      disclaimer: 'This is reference information for learning habits, not medical or psychological diagnosis.',
      evidence: 'Evidence',
      caveats: 'Notes',
      backInsights: 'Insights',
      backJournal: 'Daily journal',
      emptyTitle: 'Ask about your habits',
      emptyBody: 'Try questions like how sleep relates to focus, or what your best learning days have in common.',
      suggestions: [
        'What patterns do you see in my sleep and focus?',
        'Which days was I most productive this month?',
        'How does exercise relate to my learning time?',
      ],
      hermesUnavailable: 'The AI coach is not available. Check that Hermes is running and HERMES_API_KEY is set.',
      rateLimited: 'Too many requests. Please wait a minute and try again.',
      genericError: 'Something went wrong. Please try again.',
      loginRequired: 'Please sign in to use the habit chat.',
      diaryExcerptsNotAllowed: 'Enable diary excerpts in Settings → Privacy first.',
      invalidRange: 'End date must be on or after start date.',
    },
    jp: {
      title: '生活習慣 × 学習チャット',
      subtitle: 'ジャーナルデータに基づく傾向の説明（医療アドバイスではありません）',
      period: '分析期間',
      from: '開始',
      to: '終了',
      last7: '直近7日',
      last30: '直近30日',
      diaryToggle: '分析に日記抜粋を含める',
      diaryHint: 'デフォルト OFF。明示的にオンにしたときだけ短い抜粋を送信します。',
      diarySettingsLink: '先に設定 → プライバシーで許可してください。',
      placeholder: '睡眠・集中・運動・学習について質問…',
      disclaimer: '学習習慣の参考情報であり、医療・心理の診断ではありません。',
      evidence: '根拠',
      caveats: '注意',
      backInsights: 'インサイト',
      backJournal: '日次ジャーナル',
      emptyTitle: '習慣について質問してみましょう',
      emptyBody: '睡眠と集中の関係、学習がうまくいった日の共通点などを聞けます。',
      suggestions: [
        '睡眠と集中の関係にどんな傾向がありますか？',
        '今月、最も集中できた日の共通点は？',
        '運動と学習時間の関係を教えてください。',
      ],
      hermesUnavailable: 'AI コーチを利用できません。Hermes の起動と HERMES_API_KEY を確認してください。',
      rateLimited: 'リクエストが多すぎます。1分ほど待ってから再試行してください。',
      genericError: 'エラーが発生しました。もう一度お試しください。',
      loginRequired: '生活習慣チャットを利用するにはログインが必要です。',
      diaryExcerptsNotAllowed: '日記抜粋を使うには、設定 → プライバシーで許可をオンにしてください。',
      invalidRange: '終了日は開始日以降にしてください。',
    },
  } as const;

  const t = copy[language];

  const errorCopy = useMemo(() => ({
    genericError: t.genericError,
    hermesUnavailable: t.hermesUnavailable,
    rateLimited: t.rateLimited,
    loginRequired: t.loginRequired,
    diaryExcerptsNotAllowed: t.diaryExcerptsNotAllowed,
  }), [t]);

  const applyPreset = (days: number) => {
    setFrom(shiftDate(today, -(days - 1)));
    setTo(today);
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    if (from > to) {
      setError(t.invalidRange);
      return;
    }

    setError(null);
    setEvidence([]);
    setCaveats([]);

    const userMessage: Message = {
      id: makeId(),
      role: 'user',
      text: trimmed,
      timestamp: new Date(),
    };
    const assistantId = makeId();
    const assistantPlaceholder: Message = {
      id: assistantId,
      role: 'model',
      text: '',
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setIsLoading(true);

    const payload = {
      skill: 'life-habit-analyst',
      message: trimmed,
      context: {
        from,
        to,
        timezone: getClientTimezone(),
        ui_language: language,
      },
      include_diary_excerpts: includeDiaryExcerpts,
    };

    const appendAssistantText = (chunk: string) => {
      setMessages((prev) => prev.map((m) => (
        m.id === assistantId ? { ...m, text: `${m.text}${chunk}` } : m
      )));
    };

    try {
      let streamed = false;
      let streamedText = '';
      try {
        await streamAgentChat(payload, (chunk) => {
          streamedText += chunk;
          appendAssistantText(chunk);
        });
        streamed = streamedText.trim().length > 0;
      } catch (streamErr) {
        if (!shouldRetryAgentChatWithoutStream(streamErr)) {
          throw streamErr;
        }
      }

      if (!streamed) {
        const result = await postAgentChat(payload);
        setMessages((prev) => prev.map((m) => (
          m.id === assistantId
            ? { ...m, text: result.answer || '', isStreaming: false }
            : m
        )));
        setEvidence(result.evidence || []);
        setCaveats(result.caveats || []);
      } else {
        setMessages((prev) => prev.map((m) => (
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )));
        setCaveats([
          t.disclaimer,
          language === 'jp'
            ? 'ストリーミング応答では根拠データは別途インサイト画面で確認してください。'
            : 'Structured evidence is available on the Insights screen for streamed replies.',
        ]);
      }
    } catch (err) {
      setError(mapAgentChatError(err, errorCopy));
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsLoading(false);
    }
  };

  const periodControls = (
    <div className="px-4 py-3 space-y-3 border-b border-slate-100 bg-slate-50/80">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        <CalendarRange size={14} />
        {t.period}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          <span className="block mb-1 font-medium">{t.from}</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          />
        </label>
        <label className="text-xs text-slate-600">
          <span className="block mb-1 font-medium">{t.to}</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => applyPreset(7)}
            className="px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-indigo-50"
          >
            {t.last7}
          </button>
          <button
            type="button"
            onClick={() => applyPreset(30)}
            className="px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white hover:bg-indigo-50"
          >
            {t.last30}
          </button>
        </div>
      </div>
      {settingsAllowDiary ? (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={includeDiaryExcerpts}
            onChange={(e) => setIncludeDiaryExcerpts(e.target.checked)}
            className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800 block">{t.diaryToggle}</span>
            {t.diaryHint}
          </span>
        </label>
      ) : (
        <div className="flex items-start gap-3 opacity-70">
          <input
            type="checkbox"
            checked={false}
            disabled
            readOnly
            aria-disabled="true"
            className="mt-1 rounded border-slate-300 text-indigo-600 disabled:opacity-50"
          />
          <span className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800 block">{t.diaryToggle}</span>
            <button
              type="button"
              onClick={() => onNavigate(ViewState.SETTINGS_PRIVACY)}
              className="text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-2"
            >
              {t.diarySettingsLink}
            </button>
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-[calc(100dvh-4rem)] md:h-[calc(100dvh)] flex flex-col bg-slate-50">
      <ChatInterface
        messages={messages}
        onSend={handleSend}
        isLoading={isLoading}
        placeholder={t.placeholder}
        suggestions={messages.length === 0 ? [...t.suggestions] : []}
        header={(
          <div>
            <div className="flex items-center gap-3 p-4 bg-white">
              <button
                type="button"
                onClick={() => onNavigate(ViewState.LIFE_JOURNAL_INSIGHTS)}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                aria-label={t.backInsights}
              >
                <ArrowLeft size={20} className="text-slate-500" />
              </button>
              <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center text-white shadow-md">
                <Sparkles size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-slate-800 truncate">{t.title}</h2>
                <p className="text-xs text-slate-500 truncate">{t.subtitle}</p>
              </div>
            </div>
            {periodControls}
            {error && (
              <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}
          </div>
        )}
        emptyState={(
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <MessageCircle size={28} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">{t.emptyTitle}</h3>
            <p className="text-sm text-slate-500 mt-2">{t.emptyBody}</p>
          </div>
        )}
      />

      {(evidence.length > 0 || caveats.length > 0) && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 max-h-40 overflow-y-auto">
          {evidence.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.evidence}</p>
              <ul className="mt-1 space-y-1">
                {evidence.map((item) => (
                  <li key={item} className="text-xs text-slate-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}
          {caveats.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <Shield size={12} />
                {t.caveats}
              </p>
              <ul className="mt-1 space-y-1">
                {caveats.map((item) => (
                  <li key={item} className="text-xs text-slate-600">• {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 px-4 py-2 bg-slate-100 border-t border-slate-200 flex flex-wrap gap-4 justify-between text-xs text-slate-500">
        <span>{t.disclaimer}</span>
        <button
          type="button"
          onClick={() => onNavigate(ViewState.LIFE_JOURNAL)}
          className="font-semibold text-indigo-600 hover:text-indigo-700"
        >
          {t.backJournal}
        </button>
      </div>
    </div>
  );
};

export default LifeJournalChatView;