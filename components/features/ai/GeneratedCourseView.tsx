import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Clock, Award, BookOpen, Share2, RefreshCw, Sparkles, ArrowRight, Layers } from 'lucide-react';
import { GeneratedCourse, LocalizedText } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

// Helper to extract text from LocalizedText or string
const getText = (value: string | LocalizedText | undefined, lang: 'en' | 'jp'): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value[lang] || value['en'] || value['jp'] || '';
};

export interface ResumeCardData {
    type: 'fresh_start' | 'continue' | 'gentle_return' | 'recovery';
    message: string;
    gap_days?: number;
    next_lesson?: { module_id: string; lesson_id: string; title: string | LocalizedText };
    estimated_minutes?: number;
    completion_rate?: number;
    recovery_plan?: {
        review_lesson: string;
        next_lesson?: { module_id: string; lesson_id: string; title: string | LocalizedText };
        reduced_load: boolean;
        estimated_minutes: number;
        message: string;
    };
}

interface GeneratedCourseViewProps {
    course: GeneratedCourse;
    onBack: () => void;
    onStartLesson: (moduleIndex: number, lessonIndex: number) => void;
    resumeCard?: ResumeCardData | null;
}

const GeneratedCourseView: React.FC<GeneratedCourseViewProps> = ({ course, onBack, onStartLesson, resumeCard }) => {
    const { language } = useLanguage();
    const nav = useNavigate();
    const [activeChapter, setActiveChapter] = useState<number | null>(null);
    const [isNavigating, setIsNavigating] = useState(false);
    const navTimerRef = useRef<number | null>(null);
    console.log("GeneratedCourseView: Rendering with course:", {
        id: course.id,
        title: course.title,
        chaptersCount: course.chapters?.length,
    });

    const copy = {
        en: {
            back: 'Back to Courses',
            generatedWith: 'Generated with',
            modelPro: 'Gemini 3.0 Pro',
            modelFlash: 'Gemini 2.0 Flash',
            start: 'Start Learning',
            share: 'Share',
            encyclopedia: 'Encyclopedia',
            pathTitle: 'Curriculum Path',
            completion: 'Completion Certificate'
        },
        jp: {
            back: 'コース一覧に戻る',
            generatedWith: '生成モデル',
            modelPro: 'Gemini 3.0 Pro',
            modelFlash: 'Gemini 2.0 Flash',
            start: '学習を開始',
            share: '共有',
            encyclopedia: '図鑑',
            pathTitle: 'カリキュラムパス',
            completion: '修了証'
        }
    } as const;
    const t = copy[language];

    const handleStartClick = () => {
        console.log("Start Learning clicked");
        const firstChapter = course.chapters?.[0] as any;
        const moduleIndex = firstChapter?._moduleIndex ?? 0;
        const lessonIndex = firstChapter?._lessonIndex ?? 0;
        onStartLesson(moduleIndex, lessonIndex);
    };

    const handleChapterClick = (chapterIndex: number) => {
        if (isNavigating) return;
        const chapter: any = course.chapters[chapterIndex];
        console.log("Chapter clicked:", chapterIndex);
        setActiveChapter(chapterIndex);
        setIsNavigating(true);
        navTimerRef.current = window.setTimeout(() => {
            const moduleIndex = chapter?._moduleIndex ?? chapterIndex;
            const lessonIndex = chapter?._lessonIndex ?? 0;
            onStartLesson(moduleIndex, lessonIndex);
        }, 180);
    };

    useEffect(() => {
        return () => {
            if (navTimerRef.current) {
                window.clearTimeout(navTimerRef.current);
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Hero */}
            <div className="bg-slate-900 text-white relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&q=80')] bg-cover bg-center opacity-40"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/50 to-transparent"></div>

                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-10 pt-10 sm:pt-12 pb-20 sm:pb-24 relative z-10">
                    <button onClick={onBack} className="flex items-center gap-2 text-slate-300 hover:text-white mb-8 transition-colors">
                        <ArrowLeft size={20} /> {t.back}
                    </button>

                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold border backdrop-blur ${course.modelUsed === 'pro'
                            ? 'bg-purple-500/80 border-purple-400/50'
                            : 'bg-indigo-500/80 border-indigo-400/50'
                            }`}>
                            {t.generatedWith} {course.modelUsed === 'pro' ? t.modelPro : t.modelFlash}
                        </span>
                        <span className="bg-white/10 backdrop-blur px-3 py-1 rounded-full text-xs font-bold border border-white/10 flex items-center gap-1"><Clock size={12} /> {course.duration}</span>
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 leading-tight break-words">{getText(course.title, language)}</h1>
                    <p className="text-base sm:text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed break-words">{getText(course.description, language)}</p>

                    <div className="mt-8 flex flex-wrap gap-4">
                        <button onClick={handleStartClick} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/30 flex items-center gap-2">
                            <Play size={20} fill="currentColor" /> {t.start}
                        </button>
                        <button className="bg-white/10 text-white px-6 py-3 rounded-xl font-bold hover:bg-white/20 transition-all flex items-center gap-2">
                            <Share2 size={20} /> {t.share}
                        </button>
                        <button
                            onClick={() => nav(`/generated-course/${course.id}/encyclopedia`)}
                            className="bg-white/10 text-white px-6 py-3 rounded-xl font-bold hover:bg-white/20 transition-all flex items-center gap-2"
                        >
                            <Layers size={20} /> {t.encyclopedia}
                        </button>
                    </div>
                </div>
            </div>

            {/* Resume Card */}
            {resumeCard && resumeCard.type !== 'fresh_start' && (
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 -mt-10 mb-6 relative z-20">
                    <div className={`rounded-2xl p-5 sm:p-6 border shadow-lg ${
                        resumeCard.type === 'recovery'
                            ? 'bg-amber-50 border-amber-200'
                            : resumeCard.type === 'gentle_return'
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-white border-slate-200'
                    }`}>
                        <div className="flex items-start gap-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                resumeCard.type === 'recovery' ? 'bg-amber-100 text-amber-600' :
                                resumeCard.type === 'gentle_return' ? 'bg-blue-100 text-blue-600' :
                                'bg-indigo-100 text-indigo-600'
                            }`}>
                                {resumeCard.type === 'recovery' ? <RefreshCw size={20} /> :
                                 resumeCard.type === 'gentle_return' ? <Sparkles size={20} /> :
                                 <ArrowRight size={20} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-800 text-base mb-1">{resumeCard.message}</p>
                                {resumeCard.gap_days !== undefined && resumeCard.gap_days > 0 && (
                                    <p className="text-sm text-slate-500">
                                        {language === 'jp' ? `${resumeCard.gap_days}日ぶりの学習` : `${resumeCard.gap_days} days since last session`}
                                    </p>
                                )}
                                {resumeCard.completion_rate !== undefined && (
                                    <div className="mt-3 flex items-center gap-3">
                                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${resumeCard.completion_rate}%` }} />
                                        </div>
                                        <span className="text-xs font-semibold text-slate-500">{resumeCard.completion_rate}%</span>
                                    </div>
                                )}
                                {resumeCard.recovery_plan && (
                                    <div className="mt-3 bg-white/60 rounded-xl p-3 text-sm text-slate-600">
                                        <p>{resumeCard.recovery_plan.message}</p>
                                        {resumeCard.estimated_minutes && (
                                            <p className="mt-1 text-xs text-slate-400 flex items-center gap-1">
                                                <Clock size={12} /> {language === 'jp' ? `約${resumeCard.recovery_plan.estimated_minutes}分` : `~${resumeCard.recovery_plan.estimated_minutes} min`}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Path */}
            <div className={`max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 relative z-20 ${resumeCard && resumeCard.type !== 'fresh_start' ? '' : '-mt-16'}`}>
                <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8 border border-slate-200">
                    <h2 className="text-xl font-bold text-slate-800 mb-8 flex items-center gap-2">
                        <BookOpen size={24} className="text-indigo-600" /> {t.pathTitle}
                    </h2>

                    <div className="relative">
                        {/* Line */}
                        <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-slate-200"></div>

                        <div className="space-y-6 sm:space-y-8">
                            {course.chapters.map((chapter, index) => (
                                <div
                                    key={chapter.id}
                                    className={`relative flex items-start gap-4 group cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors path-card ${
                                        activeChapter === index ? 'path-card-active' : ''
                                    }`}
                                    onClick={() => handleChapterClick(index)}
                                >
                                    <div className="path-card-glow" aria-hidden="true" />
                                    {/* Node */}
                                    <div className="w-12 h-12 rounded-full bg-white border-4 border-indigo-100 flex items-center justify-center relative z-10 shrink-0 shadow-sm group-hover:scale-110 transition-transform group-hover:border-indigo-200">
                                        <span className="text-lg font-bold text-indigo-600">{index + 1}</span>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 pt-1.5 relative z-10 min-w-0">
                                        <h3 className="font-bold text-slate-900 text-lg group-hover:text-indigo-700 transition-colors break-words">{getText(chapter.title, language)}</h3>
                                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 mt-1">
                                            <span className="flex items-center gap-1"><Clock size={12} /> {getText(chapter.duration, language) || chapter.duration}</span>
                                            <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                            <span>{getText(chapter.type, language) || chapter.type}</span>
                                        </div>
                                        {chapter.content && (
                                            <p className="text-sm text-slate-500 mt-2 line-clamp-2 break-words">{getText(chapter.content, language)}</p>
                                        )}
                                    </div>

                                    <div className="pt-3 text-slate-300 group-hover:text-indigo-400 transition-transform group-hover:translate-x-1 relative z-10 shrink-0">
                                        <Play size={20} />
                                    </div>
                                </div>
                            ))}

                            {/* Final Reward */}
                            <div className="relative flex items-start gap-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-100 border-4 border-emerald-50 flex items-center justify-center relative z-10 shrink-0 text-emerald-600">
                                    <Award size={24} />
                                </div>
                                <div className="pt-2">
                                    <h3 className="font-bold text-slate-400">{t.completion}</h3>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeneratedCourseView;
