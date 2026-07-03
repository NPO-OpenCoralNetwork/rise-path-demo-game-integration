import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Language } from '../../../context/LanguageContext';
import type { TtsPreferences } from '../../../services/ttsPreferencesService';

interface VoiceAdvancedPanelProps {
    language: Language;
    prefs: TtsPreferences;
    disabled?: boolean;
    onSpeedChange: (speed: number) => void;
    onAutoRecommendChange: (enabled: boolean) => void;
}

const VoiceAdvancedPanel: React.FC<VoiceAdvancedPanelProps> = ({
    language,
    prefs,
    disabled = false,
    onSpeedChange,
    onAutoRecommendChange,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [speed, setSpeed] = useState(prefs.speed ?? 1.0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const speedRef = useRef(speed);
    const savedSpeedRef = useRef(prefs.speed ?? 1.0);
    const onSpeedChangeRef = useRef(onSpeedChange);

    useEffect(() => {
        const next = prefs.speed ?? 1.0;
        setSpeed(next);
        savedSpeedRef.current = next;
    }, [prefs.speed]);

    useEffect(() => {
        speedRef.current = speed;
    }, [speed]);

    useEffect(() => {
        onSpeedChangeRef.current = onSpeedChange;
    }, [onSpeedChange]);

    useEffect(() => () => {
        if (!debounceRef.current) return;
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        if (speedRef.current !== savedSpeedRef.current) {
            onSpeedChangeRef.current(speedRef.current);
        }
    }, []);

    const copy = {
        en: {
            title: 'Advanced settings',
            speed: 'Narration speed',
            autoRecommend: 'Pick voice from diagnosis',
            autoRecommendHint: 'When on, your recommended voice updates from assessment results.',
        },
        jp: {
            title: '詳細設定',
            speed: '読み上げ速度',
            autoRecommend: '診断から自動で選ぶ',
            autoRecommendHint: 'オンにすると、診断結果に基づいておすすめの声を選びます。',
        },
    } as const;

    const t = copy[language];

    const handleSpeedInput = (value: number) => {
        setSpeed(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onSpeedChange(value);
            debounceRef.current = null;
        }, 300);
    };

    return (
        <div className="border border-slate-100 rounded-2xl bg-white overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                aria-expanded={expanded}
            >
                <span className="font-medium text-slate-800">{t.title}</span>
                <ChevronDown
                    size={18}
                    className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    aria-hidden
                />
            </button>

            {expanded && (
                <div className="px-4 pb-4 space-y-5 border-t border-slate-100 pt-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <label htmlFor="tts-speed-slider" className="font-medium text-slate-700">
                                {t.speed}
                            </label>
                            <span className="text-slate-500 tabular-nums">{speed.toFixed(1)}×</span>
                        </div>
                        <input
                            id="tts-speed-slider"
                            type="range"
                            min={0.8}
                            max={1.1}
                            step={0.05}
                            value={speed}
                            disabled={disabled}
                            onChange={(e) => handleSpeedInput(Number(e.target.value))}
                            className="w-full accent-indigo-600 disabled:opacity-50"
                        />
                    </div>

                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700">{t.autoRecommend}</p>
                            <p className="text-xs text-slate-500">{t.autoRecommendHint}</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-label={t.autoRecommend}
                            aria-checked={prefs.auto_recommend !== false}
                            disabled={disabled}
                            onClick={() => onAutoRecommendChange(!(prefs.auto_recommend !== false))}
                            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
                                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            } ${prefs.auto_recommend !== false ? 'bg-indigo-600' : 'bg-slate-200'}`}
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                                    prefs.auto_recommend !== false ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VoiceAdvancedPanel;
