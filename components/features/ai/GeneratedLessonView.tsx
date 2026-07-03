import React, { useState } from 'react';
import { ArrowLeft, Play, Pause, Volume2, Send, Bot, MessageSquare, X, Lightbulb, Target, Sparkles, Key, Palette } from 'lucide-react';
import { GeneratedCourse } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { generateImagePreview } from '../../../services/curriculumApi';

interface GeneratedLessonViewProps {
    course: GeneratedCourse | null;
    onBack: () => void;
    onComplete: () => void;
}

const GeneratedLessonView: React.FC<GeneratedLessonViewProps> = ({ course, onBack, onComplete }) => {
    const { language } = useLanguage();
    const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [isAudioLoading, setIsAudioLoading] = useState(false);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const imageCacheRef = React.useRef(new Map<string, string>());
    const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
    const [isHeroLoading, setIsHeroLoading] = useState(false);
    const lastPromptRef = React.useRef<string | null>(null);
    const copy = {
        en: {
            noCourseTitle: 'No Course Data Found',
            noCourseBack: 'Go Back',
            back: 'Back',
            preparing: 'Preparing',
            browserVoice: 'Browser Voice',
            aiVoice: 'AI Voice',
            lessonBackgroundAlt: 'Lesson background',
            chapter: 'Chapter',
            slide: 'Slide',
            lessonSlide: 'Lesson Slide',
            visualDefault: 'Concept',
            accentDefault: 'Focus Point',
            animationCue: 'Animation Cue',
            slideTitleFallback: 'Slide Title',
            keyCommand: 'Key Command',
            shortcut: 'Shortcut',
            previous: 'Previous',
            finishChapter: 'Finish Chapter',
            nextSlide: 'Next Slide',
            whyTitle: 'Why it matters',
            whyFallback: 'This knowledge becomes the foundation of your skill set.',
            analogyTitle: 'In other words...',
            analogyFallback: "It's like learning a new language.",
            keyConcepts: 'Key Concepts',
            keyConceptFallback: 'Core concept',
            actionStep: 'Action Step',
            actionFallback: 'Open the editor and try what you learned.',
            tutorTitle: 'Rise Path AI Tutor',
            contextLabel: 'Context',
            notesLabel: "Rise Path's Notes:",
            pointsLabel: 'Key points:',
            askPlaceholder: 'Ask a question...'
        },
        jp: {
            noCourseTitle: 'コースデータが見つかりません',
            noCourseBack: '戻る',
            back: '戻る',
            preparing: '準備中',
            browserVoice: 'ブラウザ音声',
            aiVoice: 'AI音声',
            lessonBackgroundAlt: 'レッスン背景',
            chapter: '第',
            slide: 'スライド',
            lessonSlide: 'レッスンスライド',
            visualDefault: 'コンセプト',
            accentDefault: '注目ポイント',
            animationCue: 'アニメーション指示',
            slideTitleFallback: 'スライドタイトル',
            keyCommand: 'キー操作',
            shortcut: 'ショートカット',
            previous: '前へ',
            finishChapter: '章を完了',
            nextSlide: '次のスライド',
            whyTitle: 'なぜ重要なのか？',
            whyFallback: 'この知識はあなたのスキルセットの基盤となります。',
            analogyTitle: 'たとえて言うなら...',
            analogyFallback: 'それはまるで、新しい言語を学ぶようなものです。',
            keyConcepts: 'キーコンセプト',
            keyConceptFallback: '基本概念',
            actionStep: 'アクション・ステップ',
            actionFallback: 'エディタを開いて、学んだことを試してみましょう。',
            tutorTitle: 'Rise Path AI チューター',
            contextLabel: 'コンテキスト',
            notesLabel: 'Rise Pathのメモ:',
            pointsLabel: 'ここでのポイント:',
            askPlaceholder: '質問する...'
        }
    } as const;
    const t = copy[language];

    if (!course || !course.chapters || course.chapters.length === 0) {
        return (
            <div className="h-screen bg-slate-900 text-white flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold mb-4">{t.noCourseTitle}</h2>
                    <p className="text-slate-400 mb-6">Content is being generated or is empty.</p>
                    <button onClick={onBack} className="bg-indigo-600 px-6 py-2 rounded-lg">{t.noCourseBack}</button>
                </div>
            </div>
        );
    }

    const currentChapter = course.chapters[currentChapterIndex];
    const isLastChapter = currentChapterIndex === course.chapters.length - 1;
    const slides = currentChapter.slides || [];
    const hasSlides = slides.length > 0;
    const currentSlide = hasSlides ? slides[currentSlideIndex] : null;
    const isLastSlide = hasSlides ? currentSlideIndex === slides.length - 1 : true;
    const chapterLabel = language === 'jp'
        ? `第${currentChapterIndex + 1}章 / ${course.chapters.length}`
        : `Chapter ${currentChapterIndex + 1} / ${course.chapters.length}`;
    const slideLabel = hasSlides
        ? `${t.slide} ${currentSlideIndex + 1} / ${slides.length}`
        : '';
    const fallbackHeroUrl = currentSlide?.imagePrompt
        ? `https://image.pollinations.ai/prompt/${encodeURIComponent(currentSlide.imagePrompt)}?nologo=true`
        : `https://picsum.photos/seed/${course.id + currentChapterIndex}/1920/1080`;

    React.useEffect(() => {
        const prompt = currentSlide?.imagePrompt?.trim();
        if (!prompt) {
            setHeroImageUrl(null);
            setIsHeroLoading(false);
            lastPromptRef.current = null;
            return;
        }
        if (imageCacheRef.current.has(prompt)) {
            setHeroImageUrl(imageCacheRef.current.get(prompt) || null);
            setIsHeroLoading(false);
            lastPromptRef.current = prompt;
            return;
        }
        if (lastPromptRef.current === prompt) return;

        let cancelled = false;
        lastPromptRef.current = prompt;
        setIsHeroLoading(true);
        generateImagePreview(prompt, { aspectRatio: '16:9', imageSize: '1K' })
            .then(({ url }) => {
                if (cancelled) return;
                imageCacheRef.current.set(prompt, url);
                setHeroImageUrl(url);
            })
            .catch(() => {
                if (cancelled) return;
                setHeroImageUrl(null);
            })
            .finally(() => {
                if (!cancelled) setIsHeroLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [currentSlide?.imagePrompt]);

    // --- Audio Logic ---
    React.useEffect(() => {
        if (!currentSlide || isMuted) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            return;
        }

        // Generated Audio File
        const audioPath = `/data/audio/${course.id}/${currentChapterIndex}_${currentSlideIndex}.mp3`;
        if (audioRef.current) {
            setIsAudioLoading(true);
            audioRef.current.src = audioPath;

            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => setIsAudioLoading(false))
                    .catch(() => {
                        console.log("Audio file not ready yet, retrying in 3s...");
                        // 音声がまだ生成されていない場合、3秒後に再試行
                        setTimeout(() => {
                            if (!isMuted) {
                                setIsAudioLoading(true);
                                if (audioRef.current) audioRef.current.load();
                            }
                        }, 3000);
                    });
            }
        }

        return () => {
            if (audioRef.current) audioRef.current.pause();
        };
    }, [currentSlide, isMuted, course.id, currentChapterIndex, currentSlideIndex]);

    const handleNext = () => {
        if (isLastChapter) {
            onComplete();
        } else {
            setCurrentChapterIndex(prev => prev + 1);
            setCurrentSlideIndex(0);
            setIsPlaying(false);
        }
    };

    const handlePrev = () => {
        if (currentChapterIndex > 0) {
            setCurrentChapterIndex(prev => prev - 1);
            setCurrentSlideIndex(0);
            setIsPlaying(false);
        }
    };

    const handleNextSlide = () => {
        if (!hasSlides) return;
        if (isLastSlide) {
            handleNext();
        } else {
            setCurrentSlideIndex(prev => prev + 1);
        }
    };

    const handlePrevSlide = () => {
        if (!hasSlides) return;
        if (currentSlideIndex > 0) {
            setCurrentSlideIndex(prev => prev - 1);
        } else {
            handlePrev();
        }
    };

    return (
        <div className="h-screen bg-slate-950 text-white flex overflow-hidden w-full font-sans">
            <audio ref={audioRef} className="hidden" />
            <button
                onClick={onBack}
                className="fixed top-6 left-6 z-50 flex items-center gap-2 text-slate-200 hover:text-white bg-slate-950/80 backdrop-blur-md border border-white/10 px-3 py-2 rounded-full shadow-lg transition-colors"
            >
                <ArrowLeft size={18} />
                <span className="text-xs font-bold tracking-wide uppercase">{t.back}</span>
            </button>
            <div className={`fixed top-6 z-50 flex items-center gap-3 transition-all ${isSidebarOpen ? 'right-[25rem]' : 'right-6'}`}>
                <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-full px-2 py-1 shadow-lg">
                    <button
                        onClick={() => setIsMuted(!isMuted)}
                        className="p-2 rounded-full text-slate-400 hover:text-white transition-colors"
                    >
                        {isMuted ? <Volume2 size={18} className="opacity-50" /> : <Volume2 size={18} />}
                    </button>
                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg"
                    >
                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                    </button>
                    <div className="text-[10px] font-bold px-3 py-1.5 rounded-full border bg-indigo-600/20 text-indigo-300 border-indigo-500/30">
                        {isAudioLoading ? (
                            <span className="flex items-center gap-2">
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-ping"></span>
                                {t.preparing}
                            </span>
                        ) : (
                            t.aiVoice
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className={`p-2 rounded-full transition-colors border ${
                        isSidebarOpen ? 'bg-indigo-600/30 text-white border-indigo-500/40' : 'bg-slate-950/80 text-slate-300 border-white/10 hover:text-white'
                    }`}
                >
                    <MessageSquare size={18} />
                </button>
            </div>
            {/* Main Stage (Content) */}
            <div className="flex-1 relative flex flex-col h-full min-w-0 overflow-y-auto">
                {/* Hero / Header Section */}
                <div className="relative min-h-[40vh] flex flex-col items-center justify-center p-8 text-center overflow-hidden">
                    {/* Dynamic Background */}
                    <div className="absolute inset-0 opacity-30">
                        <img
                            src={heroImageUrl || fallbackHeroUrl}
                            alt={t.lessonBackgroundAlt}
                            className={`w-full h-full object-cover blur-sm scale-105 transition-opacity duration-1000 ${isHeroLoading ? 'opacity-70' : 'opacity-100'}`}
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/20 via-slate-950/60 to-slate-950"></div>
                    </div>

                    <div className="relative z-10 max-w-4xl mx-auto space-y-6">
                        <span className="inline-block text-indigo-300 font-mono text-xs tracking-widest uppercase bg-indigo-900/30 px-3 py-1 rounded-full border border-indigo-500/20 backdrop-blur-sm">
                            {chapterLabel} • {currentChapter.duration}
                            {hasSlides && ` • ${slideLabel}`}
                        </span>
                        
                        <h2 className="text-4xl md:text-6xl font-bold tracking-tight text-white drop-shadow-lg">
                            {currentChapter.title}
                        </h2>
                        
                        <p className="text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
                            {hasSlides ? (currentSlide?.title || currentChapter.content) : currentChapter.content}
                        </p>
                    </div>
                </div>

                {/* Rich Content Cards */}
                <div className="flex-1 bg-slate-950 relative z-10">
                    <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* When slides exist, use them as the primary content */}
                        {hasSlides ? (() => {
                            const normalizeLayout = (hint?: string, idx?: number) => {
                                const h = (hint || '').toLowerCase();
                                if (/visual|image|gallery|media/.test(h)) return 'visual-first';
                                if (/text-only|mono|stack/.test(h)) return 'text-only';
                                if (/wide|hero/.test(h)) return 'wide';
                                const mod = (idx || 0) % 4;
                                return ['two-column', 'visual-first', 'wide', 'text-only'][mod];
                            };

                            const getThemeStyles = (styleHint?: string) => {
                                const s = (styleHint || '').toLowerCase();
                                
                                // 1. Cyber / Tech / Neon
                                if (s.includes('cyan') || s.includes('neon') || s.includes('tech') || s.includes('code')) {
                                    return {
                                        id: 'cyber',
                                        container: 'bg-slate-950/80 border-cyan-500/30 shadow-[0_0_40px_-10px_rgba(6,182,212,0.2)] backdrop-blur-xl',
                                        accent: 'text-cyan-400',
                                        chip: 'bg-cyan-950/50 text-cyan-300 border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]',
                                        decoration: (
                                            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
                                                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(6,182,212,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.1) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
                                                <div className="absolute -top-20 -right-20 w-64 h-64 bg-cyan-500/20 blur-[100px] rounded-full mix-blend-screen"></div>
                                                <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50"></div>
                                            </div>
                                        )
                                    };
                                }

                                // 2. Warm / Sunset / Creative
                                if (s.includes('sunset') || s.includes('warm') || s.includes('creative') || s.includes('art')) {
                                    return {
                                        id: 'warm',
                                        container: 'bg-slate-950/80 border-rose-500/30 shadow-[0_0_40px_-10px_rgba(244,63,94,0.2)] backdrop-blur-xl',
                                        accent: 'text-rose-400',
                                        chip: 'bg-rose-950/50 text-rose-300 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]',
                                        decoration: (
                                            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
                                                <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-bl from-rose-900/10 via-slate-950/50 to-amber-900/10"></div>
                                                <div className="absolute -bottom-10 -left-10 w-96 h-96 bg-gradient-to-tr from-amber-600/10 to-rose-600/10 blur-[80px] rounded-full"></div>
                                                <div className="absolute top-10 right-10 w-2 h-2 bg-rose-400 rounded-full shadow-[0_0_10px_rgba(244,63,94,0.8)] animate-pulse"></div>
                                            </div>
                                        )
                                    };
                                }

                                // 3. Nature / Zen / Growth
                                if (s.includes('green') || s.includes('zen') || s.includes('growth') || s.includes('nature')) {
                                    return {
                                        id: 'nature',
                                        container: 'bg-slate-950/80 border-emerald-500/30 shadow-[0_0_40px_-10px_rgba(16,185,129,0.2)] backdrop-blur-xl',
                                        accent: 'text-emerald-400',
                                        chip: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
                                        decoration: (
                                            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
                                                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.03)_0%,transparent_70%)]"></div>
                                                <div className="absolute bottom-10 right-20 w-32 h-32 border border-emerald-500/10 rounded-full opacity-30"></div>
                                            </div>
                                        )
                                    };
                                }

                                // 4. Default / Professional
                                return {
                                    id: 'default',
                                    container: 'bg-slate-950/90 border-indigo-500/30 shadow-[0_0_40px_-10px_rgba(99,102,241,0.2)] backdrop-blur-xl',
                                    accent: 'text-indigo-400',
                                    chip: 'bg-indigo-950/50 text-indigo-300 border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]',
                                    decoration: (
                                        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
                                            <div className="absolute -top-40 -left-20 w-96 h-96 bg-indigo-600/10 blur-[100px] rounded-full"></div>
                                            <div className="absolute bottom-0 right-0 w-full h-1/2 bg-gradient-to-t from-indigo-900/10 to-transparent"></div>
                                            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent"></div>
                                        </div>
                                    )
                                };
                            };

                            const mapAccentIcon = (name?: string) => {
                                const n = (name || '').toLowerCase();
                                if (n.includes('light') || n.includes('idea')) return Lightbulb;
                                if (n.includes('target') || n.includes('goal')) return Target;
                                if (n.includes('palette') || n.includes('art')) return Palette;
                                if (n.includes('key')) return Key;
                                return Sparkles;
                            };

                            const mapMotionStyle = (cue?: string) => {
                                const c = (cue || '').toLowerCase();
                                if (c.includes('slide-left')) return { animation: 'slideLeft 0.55s ease-out' };
                                if (c.includes('slide-up')) return { animation: 'slideUp 0.55s ease-out' };
                                if (c.includes('pop')) return { animation: 'popIn 0.45s ease-out' };
                                return { animation: 'fadeIn 0.6s ease-out' };
                            };

                            const layout = normalizeLayout(currentSlide?.layoutHint, currentSlideIndex);
                            const theme = getThemeStyles(currentSlide?.visualStyle);
                            const MotionIcon = mapAccentIcon(currentSlide?.accentIcon);
                            const motionStyle = mapMotionStyle(currentSlide?.motionCue);

                            const gridClass =
                                layout === 'text-only'
                                    ? 'grid grid-cols-1 gap-6'
                                    : layout === 'visual-first'
                                        ? 'grid grid-cols-1 md:grid-cols-3 gap-8 items-center'
                                        : layout === 'wide'
                                            ? 'grid grid-cols-1 md:grid-cols-4 gap-8 items-start'
                                            : 'grid grid-cols-1 md:grid-cols-2 gap-8 items-start';

                            const textColSpan =
                                layout === 'wide' ? 'md:col-span-3' : layout === 'visual-first' ? 'md:col-span-2' : 'md:col-span-1';

                            return (
                                <>
                                    <style>{`
                                      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                                      @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
                                      @keyframes slideLeft { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: translateX(0); } }
                                      @keyframes popIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
                                    `}</style>
                                    
                                    <div className={`relative rounded-3xl p-8 md:p-10 transition-all duration-500 md:col-span-2 border ${theme.container}`} style={motionStyle}>
                                        {/* Decorative Background Elements */}
                                        {theme.decoration}
                                        
                                        <div className="relative z-10 flex flex-col h-full">
                                            {/* Slide Header */}
                                            <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
                                                <div className={`flex items-center gap-3 ${theme.accent}`}>
                                                    <div className="p-2 rounded-lg bg-white/5 backdrop-blur-sm border border-white/10">
                                                        <Sparkles size={18} />
                                                    </div>
                                                    <h3 className="font-bold text-lg tracking-wide text-slate-100 uppercase text-xs">{t.lessonSlide}</h3>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                     <div className="h-1 w-24 bg-white/10 rounded-full overflow-hidden">
                                                        <div 
                                                            className={`h-full ${theme.accent.replace('text-', 'bg-')} transition-all duration-500`} 
                                                            style={{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }}
                                                        ></div>
                                                     </div>
                                                     <span className="text-xs font-mono text-slate-400">{currentSlideIndex + 1} / {slides.length}</span>
                                                </div>
                                            </div>

                                            {/* Slide Content Grid */}
                                            <div className={`flex-1 ${gridClass}`}>
                                                {/* Visual/Meta Column (if not text-only) */}
                                                {layout !== 'text-only' && (
                                                    <div className="flex flex-col gap-6 h-full">
                                                        {/* Icon/Theme Card */}
                                                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md flex flex-col items-center justify-center text-center gap-4 hover:bg-white/10 transition-colors group">
                                                            <div className={`w-16 h-16 rounded-2xl ${theme.chip} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                                                                <MotionIcon size={32} />
                                                            </div>
                                                            <div>
                                                                <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${theme.accent}`}>
                                                                    {currentSlide?.visualStyle || t.visualDefault}
                                                                </div>
                                                                <div className="text-slate-400 text-sm">{currentSlide?.accentIcon || t.accentDefault}</div>
                                                            </div>
                                                        </div>
                                                        
                                                        {/* Context/Hint Card */}
                                                        {currentSlide?.motionCue && (
                                                            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 text-xs text-slate-400 font-mono">
                                                                <span className="block text-slate-500 mb-1 uppercase text-[10px]">{t.animationCue}</span>
                                                                {currentSlide.motionCue}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Main Text Content */}
                                                <div className={`${textColSpan} flex flex-col justify-center`}>
                                                    <h4 className="text-3xl md:text-4xl font-bold text-white mb-6 leading-tight drop-shadow-sm">
                                                        {currentSlide?.title || t.slideTitleFallback}
                                                    </h4>
                                                    
                                                    <div className="space-y-4">
                                                        {currentSlide?.bullets?.map((b, idx) => (
                                                            <div 
                                                                key={idx} 
                                                                className="flex gap-4 p-4 rounded-xl hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 group"
                                                                style={{ animationDelay: `${idx * 150}ms`, ...motionStyle }}
                                                            >
                                                                <div className={`w-2 h-2 rounded-full mt-2.5 shrink-0 ${theme.accent.replace('text-', 'bg-')} shadow-[0_0_8px_currentColor] opacity-80 group-hover:opacity-100 transition-opacity`}></div>
                                                                <p className="text-slate-300 text-lg leading-relaxed group-hover:text-slate-200 transition-colors">
                                                                    {b}
                                                                </p>
                                                            </div>
                                                        ))}

                                                        {/* Key Command / Highlight Box */}
                                                        {currentSlide?.highlightBox && (
                                                            <div className="mt-6 p-1 rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 shadow-lg border border-white/10 overflow-hidden relative group/box">
                                                                <div className={`absolute inset-0 opacity-20 ${theme.accent.replace('text-', 'bg-')} blur-xl group-hover/box:opacity-30 transition-opacity`}></div>
                                                                <div className="relative bg-slate-950/90 rounded-lg p-4 flex items-center justify-between gap-4 backdrop-blur-sm">
                                                                    <div className="flex items-center gap-3">
                                                                         <div className={`p-2 rounded-md bg-white/5 border border-white/10 ${theme.accent}`}>
                                                                             <Key size={20} />
                                                                         </div>
                                                                         <div>
                                                                             <span className="text-xs uppercase tracking-wider text-slate-500 font-bold">{t.keyCommand}</span>
                                                                             <p className="font-mono text-lg text-white font-bold tracking-tight">{currentSlide.highlightBox}</p>
                                                                         </div>
                                                                    </div>
                                                                    <div className="px-3 py-1 rounded bg-white/10 text-xs font-mono text-slate-400 border border-white/5">
                                                                        {t.shortcut}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Slide Footer Controls (integrated) */}
                                            <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                                                <button 
                                                    onClick={handlePrevSlide} 
                                                    className="text-slate-400 hover:text-white text-sm font-medium flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white/5 transition-colors"
                                                >
                                                    <ArrowLeft size={16} /> {t.previous}
                                                </button>
                                                <button 
                                                    onClick={handleNextSlide} 
                                                    className={`px-6 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95
                                                        ${isLastSlide 
                                                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-900/20' 
                                                            : 'bg-slate-800 hover:bg-slate-700 border border-white/10'}`}
                                                >
                                                    {isLastSlide ? t.finishChapter : t.nextSlide}
                                                    {!isLastSlide && <ArrowLeft size={16} className="rotate-180" />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            );
                        })() : (
                            <>
                                {/* 1. Why It Matters (Motivation) */}
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-indigo-500/30 transition-colors">
                                    <div className="flex items-center gap-3 mb-4 text-amber-400">
                                        <Target size={24} />
                                        <h3 className="font-bold text-lg text-slate-200">{t.whyTitle}</h3>
                                    </div>
                                    <p className="text-slate-400 leading-relaxed">
                                        {currentChapter.whyItMatters || t.whyFallback}
                                    </p>
                                </div>

                                {/* 2. Analogy (Understanding) */}
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-purple-500/30 transition-colors">
                                    <div className="flex items-center gap-3 mb-4 text-purple-400">
                                        <Lightbulb size={24} />
                                        <h3 className="font-bold text-lg text-slate-200">{t.analogyTitle}</h3>
                                    </div>
                                    <p className="text-slate-400 leading-relaxed italic">
                                        "{currentChapter.analogy || t.analogyFallback}"
                                    </p>
                                </div>

                                {/* 3. Key Concepts (Knowledge) */}
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-cyan-500/30 transition-colors">
                                    <div className="flex items-center gap-3 mb-4 text-cyan-400">
                                        <Key size={24} />
                                        <h3 className="font-bold text-lg text-slate-200">{t.keyConcepts}</h3>
                                    </div>
                                    <ul className="space-y-2">
                                        {currentChapter.keyConcepts && currentChapter.keyConcepts.length > 0 ? (
                                            currentChapter.keyConcepts.map((concept, idx) => (
                                                <li key={idx} className="flex items-center gap-2 text-slate-400">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                                                    {concept}
                                                </li>
                                            ))
                                        ) : (
                                            <li className="text-slate-500">{t.keyConceptFallback}</li>
                                        )}
                                    </ul>
                                </div>

                                {/* 4. Action Step (Practice) */}
                                <div className="bg-gradient-to-br from-indigo-900/20 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-lg shadow-indigo-900/10">
                                    <div className="flex items-center gap-3 mb-4 text-indigo-400">
                                        <Sparkles size={24} />
                                        <h3 className="font-bold text-lg text-white">{t.actionStep}</h3>
                                    </div>
                                    <p className="text-slate-300 leading-relaxed font-medium">
                                        {currentChapter.actionStep || t.actionFallback}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    
                </div>
            </div>

            {/* Sidebar (Chat / Notes) */}
            <div className={`bg-slate-900 border-l border-white/10 flex flex-col transition-all duration-300 ease-in-out h-full shrink-0 ${isSidebarOpen ? 'w-96 translate-x-0' : 'w-0 translate-x-full opacity-0 overflow-hidden'}`}>
                <div className="w-96 flex flex-col h-full">
                    <div className="p-4 border-b border-white/10 flex justify-between items-center bg-slate-950/30">
                        <div>
                            <h3 className="font-bold text-sm text-slate-200">{t.tutorTitle}</h3>
                            <p className="text-xs text-slate-500">{t.contextLabel}: {currentChapter.title}</p>
                        </div>
                        <button onClick={() => setIsSidebarOpen(false)} className="text-slate-500 hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto space-y-4">
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
                                <Bot size={16} className="text-white" />
                            </div>
                            <div className="text-sm text-slate-300 bg-white/5 p-4 rounded-2xl rounded-tl-none border border-white/5">
                                <p className="mb-2 font-bold text-indigo-300">
                                    {hasSlides && currentSlide?.speechScript ? t.notesLabel : t.pointsLabel}
                                </p>
                                <p>
                                    {hasSlides && currentSlide?.speechScript 
                                        ? currentSlide.speechScript 
                                        : currentChapter.analogy}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="p-4 border-t border-white/10 bg-slate-950/30">
                        <div className="relative">
                            <input type="text" placeholder={t.askPlaceholder} className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-10 py-3 text-sm focus:outline-none focus:border-indigo-500/50 text-slate-200" />
                            <button className="absolute right-3 top-3 text-slate-500 hover:text-white"><Send size={16} /></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeneratedLessonView;
