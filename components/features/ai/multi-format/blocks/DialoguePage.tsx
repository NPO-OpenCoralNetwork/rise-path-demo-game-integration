import React, { useEffect, useState } from 'react';
import { MessageCircle, User, Bot, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DialogueBlock } from '../../../../../types';
import { useLanguage } from '../../../../../context/LanguageContext';
import { resolveDialogueVoiceId } from '../../../../../data/tts/dialogueSpeakers';
import { getVoiceLabel } from '../../../../../data/tts/voiceCatalog';
import { SETTINGS_DIALOGUE_VOICE_PATH } from '../../../../../constants/settingsRoutes';
import { useUserRole } from '../../../../../hooks/useUserRole';
import {
    loadTtsPreferences,
    TTS_PREFERENCES_CHANGED_EVENT,
    type TtsPreferences,
} from '../../../../../services/ttsPreferencesService';

interface DialoguePageProps {
  block: DialogueBlock;
}

const DialoguePage: React.FC<DialoguePageProps> = ({ block }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { isAdmin } = useUserRole();
  const [prefs, setPrefs] = useState<TtsPreferences | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      loadTtsPreferences(language)
        .then((loaded) => { if (active) setPrefs(loaded); })
        .catch(() => { if (active) setPrefs(null); });
    };

    refresh();
    const onPrefsChanged = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener(TTS_PREFERENCES_CHANGED_EVENT, onPrefsChanged);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.removeEventListener(TTS_PREFERENCES_CHANGED_EVENT, onPrefsChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [language]);

  const copy = {
    en: {
      title: 'Interactive Scoping',
      subtitle: 'Q&A Session with Rise Path',
      voiceLabel: 'Voice',
      editMapping: 'Edit dialogue voices',
    },
    jp: {
      title: 'インタラクティブ・スコーピング',
      subtitle: 'Rise PathとのQ&Aセッション',
      voiceLabel: '声',
      editMapping: '対話の話者マッピング',
    }
  } as const;
  const t = copy[language];

  const uniqueSpeakers = [...new Set(block.lines.map((line) => line.speaker))];

  return (
    <div className="space-y-12">
      <div className="flex items-center gap-4 border-b border-slate-200 pb-8 mb-12">
        <div className="w-12 h-12 bg-white rounded-xl shadow-md border border-slate-100 flex items-center justify-center text-indigo-600">
          <MessageCircle size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{t.title}</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{t.subtitle}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => navigate(SETTINGS_DIALOGUE_VOICE_PATH)}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-lg border border-indigo-100 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          >
            <Settings2 size={14} />
            {t.editMapping}
          </button>
        )}
      </div>

      {uniqueSpeakers.length > 0 && (
        <div className="flex flex-wrap gap-2 max-w-2xl mx-auto">
          {uniqueSpeakers.map((speaker) => {
            const voiceId = resolveDialogueVoiceId(speaker, prefs);
            const label = getVoiceLabel(voiceId, language);
            return (
              <span
                key={speaker}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600"
              >
                <span className="text-slate-500">{speaker}</span>
                <span aria-hidden>·</span>
                <span>{label}</span>
              </span>
            );
          })}
        </div>
      )}
      
      <div className="mb-8 space-y-4 max-w-2xl mx-auto py-4">
        {block.lines.map((line, idx) => {
          const voiceId = resolveDialogueVoiceId(line.speaker, prefs);
          const voiceLabel = getVoiceLabel(voiceId, language);
          return (
            <div key={idx} className={`flex gap-4 ${line.speaker === 'User' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md ${
                line.speaker === 'User' ? 'bg-slate-900 text-white' : 'bg-white text-indigo-600 border border-indigo-100'
              }`}>
                {line.speaker === 'User' ? <User size={20} /> : <Bot size={20} />}
              </div>
              <div className={`min-w-0 max-w-[80%] ${line.speaker === 'User' ? 'text-right' : ''}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  {line.speaker} · {t.voiceLabel}: {voiceLabel}
                </p>
                <div className={`p-5 rounded-3xl text-base leading-relaxed shadow-sm ${
                  line.speaker === 'User' 
                    ? 'bg-slate-900 text-white rounded-tr-sm' 
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-sm'
                }`}>
                  {line.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DialoguePage;