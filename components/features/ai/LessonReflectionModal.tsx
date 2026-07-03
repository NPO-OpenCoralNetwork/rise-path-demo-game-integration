import React, { useState } from 'react';
import { X, Smile, ThumbsUp, Meh, Frown, Send } from 'lucide-react';
import { apiPost } from '../../../services/apiClient';

interface LessonReflectionModalProps {
    lessonId: string;
    moduleId: string;
    courseId: string;
    lessonTitle: string;
    language: 'en' | 'jp';
    onClose: () => void;
    onSubmitted: () => void;
}

const MOODS = [
    { value: 'great', icon: Smile, label: { jp: '完璧', en: 'Great' }, color: 'text-emerald-500 bg-emerald-50 border-emerald-200' },
    { value: 'good', icon: ThumbsUp, label: { jp: '理解できた', en: 'Good' }, color: 'text-blue-500 bg-blue-50 border-blue-200' },
    { value: 'okay', icon: Meh, label: { jp: 'まあまあ', en: 'Okay' }, color: 'text-amber-500 bg-amber-50 border-amber-200' },
    { value: 'struggled', icon: Frown, label: { jp: '難しかった', en: 'Struggled' }, color: 'text-rose-500 bg-rose-50 border-rose-200' },
] as const;

const LessonReflectionModal: React.FC<LessonReflectionModalProps> = ({
    lessonId, moduleId, courseId, lessonTitle, language, onClose, onSubmitted
}) => {
    const [mood, setMood] = useState<string | null>(null);
    const [confidence, setConfidence] = useState<number>(3);
    const [learned, setLearned] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const t = language === 'jp' ? {
        title: '振り返り',
        howFeel: '今の気分は？',
        confidence: '理解度',
        confidenceLow: '不安',
        confidenceHigh: '自信あり',
        learned: '学んだこと',
        learnedPlaceholder: '今回のレッスンで印象に残ったことは？',
        difficulty: '難しかったこと',
        difficultyPlaceholder: 'つまずいた部分や、もう少し知りたいことは？',
        submit: '記録する',
        skip: 'スキップ',
    } : {
        title: 'Reflection',
        howFeel: 'How do you feel?',
        confidence: 'Confidence',
        confidenceLow: 'Unsure',
        confidenceHigh: 'Confident',
        learned: 'What I learned',
        learnedPlaceholder: 'What stood out from this lesson?',
        difficulty: 'What was difficult',
        difficultyPlaceholder: 'What was tricky or what would you like to know more about?',
        submit: 'Save',
        skip: 'Skip',
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            await apiPost(`/curricula/${courseId}/journal`, {
                module_id: moduleId,
                lesson_id: lessonId,
                learned: learned.trim() || undefined,
                difficulty: difficulty.trim() || undefined,
                mood,
                confidence,
            });
        } catch {
            // Best-effort save
        }
        onSubmitted();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden">
                {/* Header */}
                <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between">
                    <div>
                        <h2 className="font-bold text-lg">{t.title}</h2>
                        <p className="text-slate-300 text-sm truncate">{lessonTitle}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
                    {/* Mood */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 block mb-2">{t.howFeel}</label>
                        <div className="grid grid-cols-4 gap-2">
                            {MOODS.map((m) => {
                                const Icon = m.icon;
                                const selected = mood === m.value;
                                return (
                                    <button
                                        key={m.value}
                                        onClick={() => setMood(m.value)}
                                        className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                                            selected ? m.color + ' border-current scale-105' : 'bg-white border-slate-100 hover:border-slate-200'
                                        }`}
                                    >
                                        <Icon size={24} className={selected ? '' : 'text-slate-400'} />
                                        <span className={`text-[10px] font-semibold ${selected ? '' : 'text-slate-400'}`}>
                                            {m.label[language]}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Confidence */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 block mb-2">{t.confidence}</label>
                        <input
                            type="range"
                            min={1}
                            max={5}
                            value={confidence}
                            onChange={(e) => setConfidence(Number(e.target.value))}
                            className="w-full accent-indigo-600"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 font-semibold mt-1">
                            <span>{t.confidenceLow}</span>
                            <span className="text-indigo-600 text-sm font-bold">{confidence}/5</span>
                            <span>{t.confidenceHigh}</span>
                        </div>
                    </div>

                    {/* Learned */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 block mb-2">{t.learned}</label>
                        <textarea
                            value={learned}
                            onChange={(e) => setLearned(e.target.value)}
                            placeholder={t.learnedPlaceholder}
                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                        />
                    </div>

                    {/* Difficulty */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 block mb-2">{t.difficulty}</label>
                        <textarea
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value)}
                            placeholder={t.difficultyPlaceholder}
                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-500 font-semibold text-sm hover:bg-slate-50 transition-colors"
                    >
                        {t.skip}
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || (!mood && !learned && !difficulty)}
                        className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Send size={16} /> {t.submit}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LessonReflectionModal;
