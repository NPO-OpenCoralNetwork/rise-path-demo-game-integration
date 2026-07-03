import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
    ASSESSMENT_PROFILE_CHANGED_EVENT,
    ASSESSMENT_PROFILE_STORAGE_KEY,
} from '../../../constants/assessment';
import type { Language } from '../../../context/LanguageContext';
import { getVoiceById } from '../../../data/tts/voiceCatalog';
import {
    hasAssessmentProfile,
    recommendVoiceId,
} from '../../../data/tts/voiceRecommendations';
import { ViewState } from '../../../types';

interface VoiceRecommendBannerProps {
    language: Language;
    autoRecommend: boolean;
    onNavigate: (view: ViewState) => void;
}

const VoiceRecommendBanner: React.FC<VoiceRecommendBannerProps> = ({
    language,
    autoRecommend,
    onNavigate,
}) => {
    const [hasProfile, setHasProfile] = useState(() => hasAssessmentProfile());

    useEffect(() => {
        const refresh = () => setHasProfile(hasAssessmentProfile());
        const onStorage = (event: StorageEvent) => {
            if (event.key === ASSESSMENT_PROFILE_STORAGE_KEY) refresh();
        };

        window.addEventListener(ASSESSMENT_PROFILE_CHANGED_EVENT, refresh);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(ASSESSMENT_PROFILE_CHANGED_EVENT, refresh);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const copy = {
        en: {
            noDiagnosisTitle: 'Get a voice recommendation',
            noDiagnosisBody: 'Complete the AI learning diagnosis and we will suggest a narrator that fits your style.',
            ctaDiagnosis: 'Take diagnosis',
            recommendPrefix: 'Recommended for you:',
            viewDiagnosis: 'View diagnosis results',
        },
        jp: {
            noDiagnosisTitle: '診断でおすすめの声を見つけましょう',
            noDiagnosisBody: 'AI学習診断を受けると、あなたに合ったナレーション声を提案します。',
            ctaDiagnosis: '診断を受ける',
            recommendPrefix: '診断に合う声:',
            viewDiagnosis: '診断結果を見る',
        },
    } as const;

    const t = copy[language];

    if (!hasProfile) {
        return (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-4 space-y-3">
                <div className="flex items-start gap-2">
                    <Sparkles size={18} className="text-indigo-600 shrink-0 mt-0.5" aria-hidden />
                    <div className="space-y-1">
                        <p className="font-medium text-indigo-900">{t.noDiagnosisTitle}</p>
                        <p className="text-sm text-indigo-700/90">{t.noDiagnosisBody}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => onNavigate(ViewState.PROFILE_DIAGNOSIS)}
                    className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
                >
                    {t.ctaDiagnosis}
                </button>
            </div>
        );
    }

    if (!autoRecommend) return null;

    const voiceId = recommendVoiceId();
    const entry = getVoiceById(voiceId);
    const label = entry?.label[language] ?? voiceId;
    const description = entry?.description[language] ?? '';

    return (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-4 py-4 space-y-2">
            <div className="flex items-start gap-2">
                <Sparkles size={18} className="text-indigo-600 shrink-0 mt-0.5" aria-hidden />
                <div className="space-y-1">
                    <p className="font-medium text-indigo-900">
                        {t.recommendPrefix} {label}
                    </p>
                    {description && (
                        <p className="text-sm text-indigo-700/90">{description}</p>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={() => onNavigate(ViewState.PROFILE_DIAGNOSIS)}
                className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
            >
                {t.viewDiagnosis}
            </button>
        </div>
    );
};

export default VoiceRecommendBanner;
