import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, BookOpen, List, Clock,
    ChevronRight, AlertTriangle, Info, Lightbulb, CheckCircle2,
    Copy, Check, FileText, Brain, ChevronDown, ChevronLeft, ChevronUp, Image, Play, Pause, Volume2, VolumeX
} from 'lucide-react';
import mermaid from 'mermaid';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { DocChapter, DocSection, LocalizedDocBlock, LocalizedText, QuizData } from '../../../types';
import { GeneratedLesson, CurriculumPersonalization } from '../../../services/curriculumAdapter';
import LessonReflectionModal from './LessonReflectionModal';
import GlossaryText from '../../common/GlossaryText';
import { generateImagePreview } from '../../../services/curriculumApi';
import {
    checkTtsAvailable,
    getDisplayName,
    loadTtsPreferences,
} from '../../../services/ttsPreferencesService';
import VoiceQuickSwitchSheet from '../settings/VoiceQuickSwitchSheet';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Helper to handle both string (legacy/resolved) and LocalizedText
const getText = (content: string | LocalizedText | undefined, lang: 'en' | 'jp'): string => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    return content[lang] || content['en'] || '';
};

interface GeneratedDocViewProps {
    lesson: GeneratedLesson;
    onBack: () => void;
    onComplete: () => void;
    onNextLesson?: () => void;
    onPrevLesson?: () => void;
    language: 'en' | 'jp';
    setLanguage?: (lang: 'en' | 'jp') => void;
    courseTitle?: string;
    hasNext?: boolean;
    hasPrev?: boolean;
    personalization?: CurriculumPersonalization;
    courseId?: string;
}

type SlideDeck = {
    type: 'images' | 'pdf';
    title?: LocalizedText;
    slides?: string[];
    pdfUrl?: string;
    narrations?: LocalizedText[];
    audio?: string[];
    audioDurations?: number[];
};

const SLIDE_DECKS: Record<string, SlideDeck & { slideTimestamps?: number[] }> = {
    'm1-l1': {
        type: 'pdf',
        title: { en: 'Variables & Memory Slides', jp: '変数とメモリ管理スライド' },
        pdfUrl: '/slides/variables-memory/variables-memory.pdf',
        narrations: [
            {
                en: 'A variable is a label. It does not store a value directly, it points to an object in memory. Multiple labels can reference the same object.',
                jp: '変数は箱ではなくラベルです。値を直接持たず、メモリ上のオブジェクトを指します。複数の名前が同じオブジェクトを参照できます。'
            },
            {
                en: 'Every object has an identity. Mutable objects keep the same identity when changed, while immutable objects create new identities.',
                jp: 'すべてのオブジェクトにはIDがあります。リストなどの可変オブジェクトは変更してもIDが同じですが、不変オブジェクトは変更時に新しいIDになります。'
            },
            {
                en: 'Assignment copies references, not data. Use copy or slicing for shallow copies, and deepcopy when nested objects are involved.',
                jp: '代入は参照をコピーするだけでデータは複製されません。浅いコピーは copy やスライス、ネスト構造は deepcopy が必要です。'
            },
            {
                en: 'Mutable types like lists can change in place, while immutable types like strings cannot. This changes how data flows through variables.',
                jp: '可変型（リストなど）はその場で変化し、不変型（文字列など）は新しいオブジェクトになります。これがデータの流れ方を左右します。'
            },
            {
                en: 'Python reclaims memory when references drop to zero. A garbage collector also cleans up cycles.',
                jp: '参照数が0になるとメモリが解放されます。循環参照はガーベジコレクタが回収します。'
            }
        ],
        // Single master audio file for the entire deck
        audio: ['/audio/slides/m1-l1/01.wav'], 
        // Cumulative timestamps (seconds) when each slide should transition to the next
        slideTimestamps: [10.87, 21.74, 32.61, 43.48, 54.37] 
    }
};

// Personalization mode badge labels
const MODE_LABELS: Record<string, { jp: string; en: string; color: string }> = {
    credential: { jp: '資格モード', en: 'Credential Mode', color: 'bg-amber-100 text-amber-700' },
    practice: { jp: '実践モード', en: 'Practice Mode', color: 'bg-emerald-100 text-emerald-700' },
    problem_solving: { jp: '問題演習モード', en: 'Problem Solving Mode', color: 'bg-blue-100 text-blue-700' },
    gentle: { jp: 'やさしい理解モード', en: 'Gentle Mode', color: 'bg-purple-100 text-purple-700' },
};

const TRAIT_BADGES: Record<string, { jp: string; en: string; color: string }> = {
    credential_orientation_high: { jp: '資格志向', en: 'Credential-oriented', color: 'bg-amber-50 text-amber-600' },
    problem_solving_orientation_high: { jp: '問題解決志向', en: 'Problem-solver', color: 'bg-blue-50 text-blue-600' },
    reassurance_need_high: { jp: '安心サポート', en: 'Reassurance+', color: 'bg-rose-50 text-rose-600' },
    example_first_preference_high: { jp: '例から理解', en: 'Example-first', color: 'bg-teal-50 text-teal-600' },
};

const PersonalizationBar: React.FC<{ p: CurriculumPersonalization; lang: 'en' | 'jp' }> = ({ p, lang }) => {
    const badges: { label: string; color: string }[] = [];
    const mode = p.learning_mode && MODE_LABELS[p.learning_mode];
    if (mode) badges.push({ label: mode[lang], color: mode.color });

    for (const [key, meta] of Object.entries(TRAIT_BADGES)) {
        const [trait, level] = key.split('_high');
        // trait keys like "credential_orientation" — check if value is "high"
        const traitKey = key.replace(/_high$/, '');
        if (p[traitKey] === 'high') {
            badges.push({ label: meta[lang], color: meta.color });
        }
    }

    if (badges.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 mt-4">
            {badges.map((b, i) => (
                <span key={i} className={`text-xs font-semibold px-3 py-1 rounded-full ${b.color}`}>
                    {b.label}
                </span>
            ))}
        </div>
    );
};

const GeneratedDocView: React.FC<GeneratedDocViewProps> = ({
    lesson,
    onBack,
    onComplete,
    onNextLesson,
    onPrevLesson,
    language,
    setLanguage,
    courseTitle,
    hasNext,
    hasPrev,
    personalization,
    courseId
}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [voiceBadgeLabel, setVoiceBadgeLabel] = useState(language === 'jp' ? 'AI音声' : 'AI Voice');
    const [voiceBadgeUnavailable, setVoiceBadgeUnavailable] = useState(false);
    const [showVoiceSheet, setShowVoiceSheet] = useState(false);
    // Theme is handled by context
    const [activeSection, setActiveSection] = useState<string>('');
    const [viewMode, setViewMode] = useState<'doc' | 'quiz' | 'slides'>('doc');
    const [showReflection, setShowReflection] = useState(false);
    const [pendingAction, setPendingAction] = useState<'complete' | 'next' | null>(null);
    const [slideIndex, setSlideIndex] = useState(0);
    const [isSlidePlaying, setIsSlidePlaying] = useState(false); // Default to paused
    const [isSlideMuted, setIsSlideMuted] = useState(false);
    const slideAudioRef = useRef<HTMLAudioElement | null>(null);
    const [slideDirection, setSlideDirection] = useState<'next' | 'prev'>('next');
    const [pdfPageCount, setPdfPageCount] = useState(0);
    const [pdfPageWidth, setPdfPageWidth] = useState<number | null>(null);
    const [pdfContainerEl, setPdfContainerEl] = useState<HTMLDivElement | null>(null);
    const [audioProgress, setAudioProgress] = useState(0);
    const pendingAudioSeek = useRef<number | null>(null);
    const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
    const [quizSubmitted, setQuizSubmitted] = useState(false);
    const observer = useRef<IntersectionObserver | null>(null);
    const hasQuiz = Boolean(lesson.quiz && lesson.quiz.questions && lesson.quiz.questions.length > 0);
    const slideDeck = SLIDE_DECKS[lesson.lesson_id];
    const hasSlides = Boolean(
        slideDeck &&
        ((slideDeck.type === 'images' && slideDeck.slides && slideDeck.slides.length > 0) ||
            (slideDeck.type === 'pdf' && slideDeck.pdfUrl))
    );
    const hasSlideAudio = Boolean(slideDeck?.audio && slideDeck.audio.length > 0);
    const effectiveViewMode = (viewMode === 'quiz' && !hasQuiz) || (viewMode === 'slides' && !hasSlides) ? 'doc' : viewMode;
    const totalSlides = slideDeck
        ? slideDeck.type === 'pdf'
            ? pdfPageCount || (slideDeck.slideTimestamps?.length || 0) || 0
            : slideDeck.slides?.length || 0
        : 0;
    const currentSlideNumber = totalSlides > 0 ? Math.min(slideIndex + 1, totalSlides) : 0;
    const canGoPrev = slideIndex > 0;
    const canGoNext = totalSlides > 0 ? slideIndex < totalSlides - 1 : false;
    const showSlideControls = hasSlides && (totalSlides > 1 || hasSlideAudio);

    // Use master audio mode if only 1 audio file is provided but multiple slides exist
    const isMasterAudioMode = hasSlideAudio && slideDeck.audio?.length === 1 && (totalSlides > 1 || (slideDeck.slideTimestamps?.length || 0) > 1);

    // Dynamic duration handling to sync progress bar exactly with actual audio files
    const [realDurations, setRealDurations] = useState<number[]>([]);
    const [masterDuration, setMasterDuration] = useState(0);

    useEffect(() => {
        if (slideDeck?.audioDurations) {
            setRealDurations(slideDeck.audioDurations);
        }
    }, [slideDeck]);

    const audioTimeline = useMemo(() => {
        if (!realDurations.length) return [];
        let cursor = 0;
        return realDurations.map((duration) => {
            const start = cursor;
            cursor += duration;
            return { start, end: cursor, duration };
        });
    }, [realDurations]);
    const totalAudioDuration = isMasterAudioMode ? masterDuration : (audioTimeline.length ? audioTimeline[audioTimeline.length - 1].end : 0);

    // --- Audio Control Logic Refactored ---
    
    // 1. Determine the correct audio source URL
    const currentAudioSrc = useMemo(() => {
        if (!hasSlideAudio || !slideDeck?.audio) return null;
        if (isMasterAudioMode) return slideDeck.audio[0];
        // Ensure slideIndex is within bounds
        const idx = Math.min(slideIndex, slideDeck.audio.length - 1);
        return slideDeck.audio[idx];
    }, [hasSlideAudio, slideDeck, isMasterAudioMode, slideIndex]);

    const handleAudioTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
        const currentTime = e.currentTarget.currentTime;
        
        if (isMasterAudioMode && slideDeck.slideTimestamps) {
            setAudioProgress(currentTime);
            // Find which slide corresponds to the current time
            let newIndex = 0;
            for (let i = 0; i < slideDeck.slideTimestamps.length; i++) {
                if (currentTime < slideDeck.slideTimestamps[i]) {
                    newIndex = i;
                    break;
                }
                if (i === slideDeck.slideTimestamps.length - 1) newIndex = i;
            }
            if (newIndex !== slideIndex) {
                setSlideIndex(newIndex);
            }
        } else {
            // Legacy behavior for split files
            const base = audioTimeline[slideIndex]?.start || 0;
            setAudioProgress(Math.min(base + currentTime, totalAudioDuration));
        }
    };

    const handleAudioLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
        const duration = e.currentTarget.duration;
        if (Number.isFinite(duration) && duration > 0) {
            if (isMasterAudioMode) {
                setMasterDuration(duration);
            } else {
                setRealDurations(prev => {
                    const next = [...prev];
                    if (next.length <= slideIndex) while (next.length <= slideIndex) next.push(0);
                    if (Math.abs(next[slideIndex] - duration) > 0.1) {
                        next[slideIndex] = duration;
                        return next;
                    }
                    return prev;
                });
            }
        }
        applyPendingSeek();
    };

    // Debug: Log lesson data
    console.log('[GeneratedDocView] Rendering with lesson:', {
        lessonId: lesson?.lesson_id,
        title: lesson?.title,
        sectionsCount: lesson?.sections?.length,
        firstSectionBlocks: lesson?.sections?.[0]?.content?.length,
        fullLesson: lesson
    });

    useEffect(() => {
        let active = true;
        Promise.all([loadTtsPreferences(language), checkTtsAvailable()])
            .then(([prefs, available]) => {
                if (!active) return;
                setVoiceBadgeUnavailable(!available);
                setVoiceBadgeLabel(
                    available
                        ? getDisplayName(prefs.voice_id, language)
                        : (language === 'jp' ? 'AI音声' : 'AI Voice'),
                );
            })
            .catch(() => {
                if (!active) return;
                setVoiceBadgeUnavailable(true);
                setVoiceBadgeLabel(language === 'jp' ? 'AI音声' : 'AI Voice');
            });
        return () => { active = false; };
    }, [language, location.key]);

    const t = {
        en: {
            tag: courseTitle || "Generated Curriculum",
            onThisPage: "On this page",
            backToCourse: "Back to Course",
            completeChapter: "Complete Lesson",
            takeQuiz: "Take Quiz",
            complete: "Complete",
            doc: "Doc",
            quiz: "Quiz",
            slides: "Slides",
            nextLesson: "Next Lesson",
            prevLesson: "Previous",
            checkAnswers: "Check Answers",
            correct: "Correct!",
            incorrect: "Incorrect",
            score: "Score"
        },
        jp: {
            tag: courseTitle || "生成カリキュラム",
            onThisPage: "このページの目次",
            backToCourse: "コースに戻る",
            completeChapter: "レッスンを完了",
            takeQuiz: "クイズに挑戦",
            complete: "完了",
            doc: "ドキュメント",
            quiz: "クイズ",
            slides: "スライド",
            nextLesson: "次のレッスン",
            prevLesson: "前へ",
            checkAnswers: "回答を確認",
            correct: "正解！",
            incorrect: "不正解",
            score: "スコア"
        }
    }[language];

    const mermaidConfig = {
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'loose',
        fontFamily: '"IBM Plex Sans","Noto Sans JP",ui-sans-serif,system-ui,sans-serif',
        flowchart: {
            curve: 'basis',
            nodeSpacing: 40,
            rankSpacing: 50
        },
        themeVariables: {
            primaryColor: '#ffffff',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#e2e8f0',
            lineColor: '#94a3b8',
            secondaryColor: '#fff7ed',
            tertiaryColor: '#f1f5f9',
            edgeLabelBackground: '#ffffff',
            clusterBkg: '#f8fafc',
            clusterBorder: '#e2e8f0',
            noteBkgColor: '#ecfeff',
            noteTextColor: '#0f172a',
            noteBorderColor: '#67e8f9',
            fontSize: '14px'
        }
    } as const;

    useEffect(() => {
        // Note: Theme is handled by context, no need to override here
        mermaid.initialize(mermaidConfig);
    }, []);

    useEffect(() => {
        setViewMode('doc');
        setQuizAnswers({});
        setQuizSubmitted(false);
        setSlideIndex(0);
        setIsSlidePlaying(false); // Do not autoplay
        setIsSlideMuted(false);
        setSlideDirection('next');
        setPdfPageCount(0);
        setPdfPageWidth(null);
        setPdfContainerEl(null);
        setAudioProgress(0);
        pendingAudioSeek.current = null;
    }, [lesson.lesson_id]);

    useEffect(() => {
        if ((!hasQuiz && viewMode === 'quiz') || (!hasSlides && viewMode === 'slides')) {
            setViewMode('doc');
        }
    }, [hasQuiz, hasSlides, viewMode]);

    useEffect(() => {
        if (effectiveViewMode !== 'slides') return;
        if (!slideDeck || slideDeck.type !== 'pdf') return;
        if (!pdfContainerEl) return;
        if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
        const updateWidth = () => {
            setPdfPageWidth(pdfContainerEl.clientWidth);
        };
        updateWidth();
        const observer = new ResizeObserver(() => updateWidth());
        observer.observe(pdfContainerEl);
        return () => observer.disconnect();
    }, [effectiveViewMode, slideDeck?.pdfUrl, pdfContainerEl]);

    useEffect(() => {
        if (!slideDeck || slideDeck.type !== 'pdf') return;
        if (!pdfPageCount) return;
        if (slideIndex >= pdfPageCount) {
            setSlideIndex(Math.max(0, pdfPageCount - 1));
        }
    }, [pdfPageCount, slideDeck?.type, slideIndex]);

    useEffect(() => {
        if (!hasSlideAudio || !audioTimeline.length) return;
        if (pendingAudioSeek.current !== null) return;
        const startOffset = audioTimeline[slideIndex]?.start || 0;
        setAudioProgress(startOffset);
    }, [slideIndex, hasSlideAudio, audioTimeline]);

    useEffect(() => {
        if (effectiveViewMode !== 'slides') return;
        if (!hasSlides || !slideDeck || slideDeck.type !== 'images') return;
        if (hasSlideAudio) return;
        if (!isSlidePlaying) return;
        const total = slideDeck.slides?.length || 0;
        if (!total) return;
        const timer = window.setInterval(() => {
            setSlideIndex((prev) => (prev + 1) % total);
        }, 6500);
        return () => window.clearInterval(timer);
    }, [effectiveViewMode, hasSlides, slideDeck, isSlidePlaying]);

    const goToNextSlide = (wrap = false) => {
        if (!totalSlides) return;
        setSlideDirection('next');
        setSlideIndex((prev) => {
            const next = prev + 1;
            if (next >= totalSlides) return wrap ? 0 : prev;
            return next;
        });
    };

    const goToPrevSlide = (wrap = false) => {
        if (!totalSlides) return;
        setSlideDirection('prev');
        setSlideIndex((prev) => {
            const next = prev - 1;
            if (next < 0) return wrap ? totalSlides - 1 : prev;
            return next;
        });
    };

    const handleSlideScrub = (value: number) => {
        if (!totalSlides) return;
        const nextIndex = Math.max(0, Math.min(totalSlides - 1, value));
        if (nextIndex === slideIndex) return;
        setSlideDirection(nextIndex > slideIndex ? 'next' : 'prev');
        setSlideIndex(nextIndex);
    };

    const handleAudioScrub = (value: number) => {
        if (!audioTimeline.length) return;
        const clamped = Math.max(0, Math.min(totalAudioDuration, value));
        let targetIndex = 0;
        for (let i = 0; i < audioTimeline.length; i += 1) {
            if (clamped < audioTimeline[i].end) {
                targetIndex = i;
                break;
            }
        }
        const offset = clamped - (audioTimeline[targetIndex]?.start || 0);
        if (targetIndex !== slideIndex) {
            setSlideDirection(targetIndex > slideIndex ? 'next' : 'prev');
            pendingAudioSeek.current = offset;
            setSlideIndex(targetIndex);
        } else if (slideAudioRef.current) {
            slideAudioRef.current.currentTime = Math.max(0, offset);
        }
        setAudioProgress(clamped);
        if (slideAudioRef.current && isSlidePlaying && !isSlideMuted) {
            slideAudioRef.current.play().catch(() => {});
        }
    };

    const handleSlidePlayToggle = () => {
        console.log('[Audio] Play toggle clicked. Current state:', isSlidePlaying);
        const nextState = !isSlidePlaying;
        setIsSlidePlaying(nextState);
        // The effect will handle the actual play/pause
    };

    const handleSlideMuteToggle = () => {
        const nextMuted = !isSlideMuted;
        setIsSlideMuted(nextMuted);
        if (!hasSlideAudio || !slideDeck || !slideAudioRef.current) return;
        if (nextMuted) {
            slideAudioRef.current.pause();
            return;
        }
        if (isSlidePlaying) {
            slideAudioRef.current.play().catch(() => {
                setIsSlidePlaying(false);
            });
        }
    };

    const applyPendingSeek = () => {
        if (!slideAudioRef.current) return;
        if (pendingAudioSeek.current === null) return;
        const target = pendingAudioSeek.current;
        const duration = slideAudioRef.current.duration || target;
        slideAudioRef.current.currentTime = Math.min(target, duration);
        pendingAudioSeek.current = null;
    };

    const formatTime = (value: number) => {
        const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
        const minutes = Math.floor(safeValue / 60);
        const seconds = Math.floor(safeValue % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // 2. Handle Audio Source Changes (Only update src when strictly necessary)
    useEffect(() => {
        const audioEl = slideAudioRef.current;
        if (!audioEl) {
            console.warn('[Audio] Element ref is missing');
            return;
        }
        if (!currentAudioSrc) {
            console.warn('[Audio] Source URL is missing');
            return;
        }

        // Check if src actually needs updating to avoid reloading
        const currentSrcAttr = audioEl.getAttribute('src');
        const needsUpdate = !currentSrcAttr || !currentSrcAttr.endsWith(currentAudioSrc);

        if (needsUpdate) {
            console.log('[Audio] Changing source to:', currentAudioSrc);
            audioEl.src = currentAudioSrc;
            
            if (!isMasterAudioMode) {
                audioEl.currentTime = 0;
            }
        }

        if (isSlidePlaying) {
            console.log('[Audio] Attempting to play...');
            audioEl.play()
                .then(() => console.log('[Audio] Playback started'))
                .catch(e => {
                    console.error('[Audio] Autoplay/Play blocked:', e);
                    setIsSlidePlaying(false);
                });
        }
    }, [currentAudioSrc, isMasterAudioMode, isSlidePlaying]);

    // 3. Handle Play/Pause State
    useEffect(() => {
        const audioEl = slideAudioRef.current;
        if (!audioEl) return;

        if (isSlidePlaying) {
            if (audioEl.paused) audioEl.play().catch(() => setIsSlidePlaying(false));
        } else {
            if (!audioEl.paused) audioEl.pause();
        }
    }, [isSlidePlaying]);

    // 4. Handle Mute State
    useEffect(() => {
        if (slideAudioRef.current) {
            slideAudioRef.current.muted = isSlideMuted;
        }
    }, [isSlideMuted]);

    // Scroll Spy Logic
    useEffect(() => {
        if (effectiveViewMode !== 'doc') return;

        observer.current = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setActiveSection(entry.target.id);
                }
            });
        }, { rootMargin: '-20% 0px -60% 0px' });

        lesson.sections.forEach((section) => {
            const el = document.getElementById(section.id);
            if (el) observer.current?.observe(el);
        });

        return () => observer.current?.disconnect();
    }, [lesson, effectiveViewMode]);

    const scrollToSection = (id: string) => {
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveSection(id);
        }
    };

    // Helper: Navigate to next/prev lesson and scroll to top
    const handleNextLesson = () => {
        if (courseId) {
            setPendingAction('next');
            setShowReflection(true);
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            onNextLesson?.();
        }
    };

    const handleCompleteWithReflection = () => {
        if (courseId) {
            setPendingAction('complete');
            setShowReflection(true);
        } else {
            onComplete();
        }
    };

    const handleReflectionDone = () => {
        setShowReflection(false);
        if (pendingAction === 'next') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            onNextLesson?.();
        } else {
            onComplete();
        }
        setPendingAction(null);
    };

    const handlePrevLesson = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        onPrevLesson?.();
    };

    useEffect(() => {
        if (effectiveViewMode === 'doc') {
            mermaid.contentLoaded();
        }
    }, [lesson, effectiveViewMode]);

    const handleQuizAnswer = (questionId: string, optionId: string) => {
        if (quizSubmitted) return;
        setQuizAnswers(prev => ({ ...prev, [questionId]: optionId }));
    };

    const handleQuizSubmit = () => {
        setQuizSubmitted(true);
    };

    const getQuizScore = () => {
        if (!lesson.quiz) return { correct: 0, total: 0 };
        let correct = 0;
        lesson.quiz.questions.forEach(q => {
            if (quizAnswers[q.id] === q.correctAnswer) correct++;
        });
        return { correct, total: lesson.quiz.questions.length };
    };

    return (
        <div className="min-h-screen bg-white text-slate-800 font-sans">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 z-50 flex items-center justify-between px-4 sm:px-6">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{t.tag}</span>
                        <span className="text-sm font-bold text-slate-800 line-clamp-1">{getText(lesson.title, language)}</span>
                    </div>
                </div>

                {/* View Mode Toggle */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('doc')}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'doc'
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <FileText size={14} />
                        {t.doc}
                    </button>

                    {hasSlides && (
                        <button
                            onClick={() => setViewMode('slides')}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'slides'
                                ? 'bg-white text-purple-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Image size={14} />
                            {t.slides}
                        </button>
                    )}

                    {hasQuiz && (
                        <button
                            onClick={() => setViewMode('quiz')}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'quiz'
                                ? 'bg-white text-purple-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Brain size={14} />
                            {t.quiz}
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {setLanguage && (
                        <div className="flex bg-slate-50 rounded-lg p-1 border border-slate-200/60">
                            <button onClick={() => setLanguage('en')} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-slate-800 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>EN</button>
                            <button onClick={() => setLanguage('jp')} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-slate-800 shadow-sm border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>JP</button>
                        </div>
                    )}
                    <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                        <Clock size={14} /> {getText(lesson.readingTime, language)}
                    </span>
                </div>
            </header>

            {/* Mobile View Mode Toggle */}
            <div className="md:hidden sticky top-16 z-40 bg-white/90 backdrop-blur border-b border-slate-100 px-4 py-2 flex justify-center">
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('doc')}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'doc'
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <FileText size={14} />
                        {t.doc}
                    </button>

                    {hasSlides && (
                        <button
                            onClick={() => setViewMode('slides')}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'slides'
                                ? 'bg-white text-purple-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Image size={14} />
                            {t.slides}
                        </button>
                    )}

                    {hasQuiz && (
                        <button
                            onClick={() => setViewMode('quiz')}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${effectiveViewMode === 'quiz'
                                ? 'bg-white text-purple-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Brain size={14} />
                            {t.quiz}
                        </button>
                    )}
                </div>
            </div>

            {effectiveViewMode === 'doc' && (
                <main className="pt-24 pb-20 max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12">

                    {/* Main Content */}
                    <article className="lg:col-span-8 lg:col-start-2 xl:col-span-7 xl:col-start-3 min-w-0">
                        <header className="mb-12 text-center">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 text-purple-600 text-xs font-bold uppercase tracking-wider mb-6">
                                <BookOpen size={14} /> Lesson
                            </div>
                            <h1 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight tracking-tight break-words">
                                {getText(lesson.title, language)}
                            </h1>
                            <p className="text-xl text-slate-500 leading-relaxed font-serif italic break-words">
                                {getText(lesson.subtitle, language)}
                            </p>
                            {personalization && <PersonalizationBar p={personalization} lang={language} />}
                        </header>

                        <div className="space-y-16">
                            {lesson.sections.map((section) => {
                                // Determine personalization emphasis for this section
                                const sectionType = (section.id || '').replace(/-\d+$/, '');
                                let emphasisClass = '';
                                let emphasisLabel = '';
                                if (personalization) {
                                    if (sectionType === 'practice' && personalization.problem_solving_orientation === 'high') {
                                        emphasisClass = 'border-l-4 border-blue-400 pl-4';
                                        emphasisLabel = language === 'jp' ? '重点セクション' : 'Focus section';
                                    }
                                    if (sectionType === 'checklist' && personalization.credential_orientation === 'high') {
                                        emphasisClass = 'border-l-4 border-amber-400 pl-4';
                                        emphasisLabel = language === 'jp' ? '資格対策' : 'Exam prep';
                                    }
                                    if ((sectionType === 'cautions' || sectionType === 'practice') && personalization.reassurance_need === 'high') {
                                        emphasisClass = emphasisClass || 'border-l-4 border-rose-300 pl-4';
                                    }
                                }
                                return (
                                <section key={section.id} id={section.id} className={`scroll-mt-24 ${emphasisClass}`}>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-3 group cursor-pointer break-words" onClick={() => scrollToSection(section.id)}>
                                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-sm group-hover:bg-purple-100 group-hover:text-purple-600 transition-colors">#</span>
                                        {getText(section.title, language)}
                                        {emphasisLabel && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ml-2">{emphasisLabel}</span>}
                                    </h2>
                                    <div className="space-y-8">
                                        {section.content.map((block, idx) => (
                                            <BlockRenderer key={idx} block={block} language={language} />
                                        ))}
                                    </div>
                                </section>
                                );
                            })}
                        </div>

                        {/* Lesson Footer */}
                        <div className="mt-20 pt-10 border-t border-slate-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                            <div className="flex flex-wrap gap-2">
                                {hasPrev && onPrevLesson && (
                                    <button onClick={handlePrevLesson} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-medium transition-colors px-4 py-2 rounded-lg hover:bg-slate-50">
                                        <ChevronLeft size={16} /> {t.prevLesson}
                                    </button>
                                )}
                                <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-medium transition-colors px-4 py-2 rounded-lg hover:bg-slate-50">
                                    <ArrowLeft size={16} /> {t.backToCourse}
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {hasQuiz ? (
                                    <button
                                        onClick={() => setViewMode('quiz')}
                                        className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                    >
                                        {t.takeQuiz} <Brain size={18} />
                                    </button>
                                ) : hasNext && onNextLesson ? (
                                    <button
                                        onClick={handleNextLesson}
                                        className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                    >
                                        {t.nextLesson} <ChevronRight size={18} />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleCompleteWithReflection}
                                        className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                    >
                                        {t.complete} <CheckCircle2 size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </article>

                    {/* Right Sidebar (TOC) */}
                    <aside className="hidden xl:block col-span-2 relative">
                        <div className="sticky top-32">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <List size={14} /> {t.onThisPage}
                            </h3>
                            <ul className="space-y-1 relative border-l border-slate-100">
                                {lesson.sections.map((section) => (
                                    <li key={section.id} className="relative">
                                        <button
                                            onClick={() => scrollToSection(section.id)}
                                            className={`text-sm py-1.5 pl-4 text-left w-full transition-colors border-l-2 -ml-[2px] ${activeSection === section.id
                                                ? 'border-purple-500 text-purple-600 font-medium'
                                                : 'border-transparent text-slate-500 hover:text-slate-800'
                                                }`}
                                        >
                                            {getText(section.title, language)}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </aside>

                </main>
            )}

            {effectiveViewMode === 'slides' && hasSlides && slideDeck && (
                <main className="pt-24 pb-20 max-w-6xl mx-auto px-4 sm:px-6">
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 sm:p-6 border-b border-slate-100">
                            <div>
                                <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">{t.slides}</p>
                                <h2 className="text-xl font-bold text-slate-900">
                                    {slideDeck.title ? getText(slideDeck.title, language) : getText(lesson.title, language)}
                                </h2>
                                {totalSlides > 0 && (
                                    <p className="text-sm text-slate-500 mt-1">
                                        {currentSlideNumber} / {totalSlides}
                                    </p>
                                )}
                            </div>
                            {showSlideControls && (
                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setShowVoiceSheet(true)}
                                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors inline-flex items-center gap-1.5 ${
                                            voiceBadgeUnavailable
                                                ? 'border-amber-200 text-amber-800 bg-amber-50 hover:bg-amber-100'
                                                : 'border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                        }`}
                                        title={language === 'jp' ? '音声設定を変更' : 'Change voice settings'}
                                        aria-label={language === 'jp' ? '音声設定を変更' : 'Change voice settings'}
                                    >
                                        {voiceBadgeUnavailable && (
                                            <AlertTriangle size={14} className="shrink-0" aria-hidden />
                                        )}
                                        {voiceBadgeLabel}
                                    </button>
                                    <button
                                        onClick={() => goToPrevSlide()}
                                        disabled={!canGoPrev}
                                        className={`p-2 rounded-lg border transition ${canGoPrev ? 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50' : 'border-slate-200 text-slate-300 cursor-not-allowed opacity-50'}`}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    {hasSlideAudio && (
                                        <>
                                            <button
                                                onClick={handleSlidePlayToggle}
                                                className={`p-2 rounded-lg border transition ${isSlidePlaying ? 'border-indigo-200 text-indigo-600 bg-indigo-50' : 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                                            >
                                                {isSlidePlaying ? <Pause size={18} /> : <Play size={18} />}
                                            </button>
                                            <button
                                                onClick={handleSlideMuteToggle}
                                                className={`p-2 rounded-lg border transition ${isSlideMuted ? 'border-amber-200 text-amber-600 bg-amber-50' : 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                                            >
                                                {isSlideMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={() => goToNextSlide()}
                                        disabled={!canGoNext}
                                        className={`p-2 rounded-lg border transition ${canGoNext ? 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50' : 'border-slate-200 text-slate-300 cursor-not-allowed opacity-50'}`}
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {slideDeck.type === 'images' && slideDeck.slides && (
                            <div className="bg-slate-900/5 p-4 sm:p-6">
                                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900 shadow-inner">
                                    <img
                                        src={slideDeck.slides[slideIndex]}
                                        alt={`Slide ${slideIndex + 1}`}
                                        className="w-full h-full object-contain bg-black"
                                    />
                                    <audio
                                        ref={slideAudioRef}
                                        className="hidden"
                                        onError={(e) => console.error('[Audio] Error loading media:', e.currentTarget.error, e.currentTarget.src)}
                                        onLoadedMetadata={handleAudioLoadedMetadata}
                                        onTimeUpdate={handleAudioTimeUpdate}
                                        onEnded={() => {
                                            if (!isSlidePlaying) return;
                                            if (slideIndex >= totalSlides - 1) {
                                                setIsSlidePlaying(false);
                                                return;
                                            }
                                            goToNextSlide();
                                        }}
                                    />
                                </div>
                                {(hasSlideAudio && totalAudioDuration > 0) ? (
                                    <div className="mt-4 space-y-2">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setIsSlidePlaying((prev) => !prev)}
                                                className={`h-9 w-9 rounded-full border flex items-center justify-center transition ${ 
                                                    isSlidePlaying
                                                        ? 'border-indigo-200 text-indigo-600 bg-indigo-50'
                                                        : 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                                }`}
                                                aria-label={isSlidePlaying ? 'Pause audio' : 'Play audio'}
                                            >
                                                {isSlidePlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                                            </button>
                                            <input
                                                type="range"
                                                min={0}
                                                max={totalAudioDuration}
                                                step={0.1}
                                                value={audioProgress}
                                                onChange={(event) => handleAudioScrub(Number(event.target.value))}
                                                className="w-full accent-indigo-500"
                                                aria-label="Audio timeline"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                                            <span>{formatTime(audioProgress)}</span>
                                            <span>{formatTime(totalAudioDuration)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    totalSlides > 1 && (
                                        <div className="mt-4">
                                            <input
                                                type="range"
                                                min={0}
                                                max={totalSlides - 1}
                                                step={1}
                                                value={slideIndex}
                                                onChange={(event) => handleSlideScrub(Number(event.target.value))}
                                                className="w-full accent-indigo-500"
                                                aria-label="Slide position"
                                            />
                                        </div>
                                    )
                                )}
                            </div>
                        )}

                        {slideDeck.type === 'pdf' && slideDeck.pdfUrl && (
                            <div className="bg-slate-900/5 p-4 sm:p-6">
                                <div
                                    ref={setPdfContainerEl}
                                    className="relative w-full aspect-video rounded-xl overflow-hidden bg-white shadow-inner flex items-center justify-center"
                                >
                                    <Document
                                        file={slideDeck.pdfUrl}
                                        onLoadSuccess={({ numPages }) => setPdfPageCount(numPages)}
                                        loading={
                                            <div className="flex items-center gap-2 text-slate-400 text-sm">
                                                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                                                {language === 'jp' ? 'スライドを読み込み中...' : 'Loading slides...'}
                                            </div>
                                        }
                                        error={
                                            <div className="text-sm text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                                                {language === 'jp' ? 'PDFの読み込みに失敗しました。' : 'Failed to load PDF.'}
                                            </div>
                                        }
                                        className="w-full h-full flex items-center justify-center"
                                    >
                                        <div
                                            className="w-full h-full flex items-center justify-center"
                                        >
                                            {(() => {
                                                const zoom = 1.08;
                                                const targetWidth = pdfPageWidth ? Math.ceil(pdfPageWidth * zoom) : undefined;
                                                return (
                                                    <Page
                                                        pageNumber={Math.min(slideIndex + 1, Math.max(1, pdfPageCount || totalSlides || 1))}
                                                        width={targetWidth}
                                                        renderTextLayer={false}
                                                        renderAnnotationLayer={false}
                                                    />
                                                );
                                            })()}
                                        </div>
                                    </Document>
                                </div>
                                {hasSlideAudio && (
                                    <audio
                                        ref={slideAudioRef}
                                        className="hidden"
                                        onError={(e) => console.error('[Audio] Error loading media:', e.currentTarget.error, e.currentTarget.src)}
                                        onLoadedMetadata={handleAudioLoadedMetadata}
                                        onTimeUpdate={handleAudioTimeUpdate}
                                        onEnded={() => {
                                            if (!isSlidePlaying) return;
                                            if (slideIndex >= totalSlides - 1) {
                                                setIsSlidePlaying(false);
                                                return;
                                            }
                                            goToNextSlide();
                                        }}
                                    />
                                )}
                                {(hasSlideAudio && totalAudioDuration > 0) ? (
                                    <div className="mt-4 space-y-2">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setIsSlidePlaying((prev) => !prev)}
                                                className={`h-9 w-9 rounded-full border flex items-center justify-center transition ${ 
                                                    isSlidePlaying
                                                        ? 'border-indigo-200 text-indigo-600 bg-indigo-50'
                                                        : 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                                }`}
                                                aria-label={isSlidePlaying ? 'Pause audio' : 'Play audio'}
                                            >
                                                {isSlidePlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                                            </button>
                                            <input
                                                type="range"
                                                min={0}
                                                max={totalAudioDuration}
                                                step={0.1}
                                                value={audioProgress}
                                                onChange={(event) => handleAudioScrub(Number(event.target.value))}
                                                className="w-full accent-indigo-500"
                                                aria-label="Audio timeline"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                                            <span>{formatTime(audioProgress)}</span>
                                            <span>{formatTime(totalAudioDuration)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    totalSlides > 1 && (
                                        <div className="mt-4">
                                            <input
                                                type="range"
                                                min={0}
                                                max={totalSlides - 1}
                                                step={1}
                                                value={slideIndex}
                                                onChange={(event) => handleSlideScrub(Number(event.target.value))}
                                                className="w-full accent-indigo-500"
                                                aria-label="Slide position"
                                            />
                                        </div>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </main>
            )}

            {/* Quiz View */}
            {effectiveViewMode === 'quiz' && lesson.quiz && (
                <main className="pt-24 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
                    <div className="mb-8">
                        <button onClick={() => setViewMode('doc')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-4">
                            <ArrowLeft size={16} /> Back to Document
                        </button>
                        <h1 className="text-3xl font-bold text-slate-900">{getText(lesson.quiz.title, language)}</h1>
                    </div>

                    <div className="space-y-8">
                        {lesson.quiz.questions.map((question, qIdx) => {
                            const isAnswered = !!quizAnswers[question.id];
                            const isCorrect = quizAnswers[question.id] === question.correctAnswer;

                            return (
                                <div key={question.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                                    <div className="flex items-start gap-4 mb-4">
                                        <span className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm shrink-0">
                                            {qIdx + 1}
                                        </span>
                                        <h3 className="text-lg font-medium text-slate-900">{getText(question.text, language)}</h3>
                                    </div>

                                    <div className="space-y-3 ml-12">
                                        {question.options.map((option) => {
                                            const isSelected = quizAnswers[question.id] === option.id;
                                            const showCorrect = quizSubmitted && option.id === question.correctAnswer;
                                            const showIncorrect = quizSubmitted && isSelected && !isCorrect;

                                            return (
                                                <button
                                                    key={option.id}
                                                    onClick={() => handleQuizAnswer(question.id, option.id)}
                                                    disabled={quizSubmitted}
                                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${showCorrect
                                                        ? 'border-green-500 bg-green-50 text-green-800'
                                                        : showIncorrect
                                                            ? 'border-red-500 bg-red-50 text-red-800'
                                                            : isSelected
                                                                ? 'border-purple-500 bg-purple-50'
                                                                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-purple-500 bg-purple-500' : 'border-slate-300'
                                                            }`}> {isSelected && <Check size={12} className="text-white" />}
                                                        </div>
                                                        <span>{getText(option.text, language)}</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {quizSubmitted && (
                                        <div className={`mt-4 ml-12 p-3 rounded-lg ${isCorrect ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                            <span className="font-bold">{isCorrect ? t.correct : t.incorrect}</span>
                                            {question.explanation && getText(question.explanation, language) && (
                                                <p className="mt-1 text-sm">{getText(question.explanation, language)}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Quiz Footer */}
                    <div className="mt-8 flex justify-between items-center">
                        {quizSubmitted ? (
                            <>
                                <div className="text-lg font-bold">
                                    {t.score}: {getQuizScore().correct} / {getQuizScore().total}
                                </div>
                                {hasNext && onNextLesson ? (
                                    <button
                                        onClick={handleNextLesson}
                                        className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                    >
                                        {t.nextLesson} <ChevronRight size={18} />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleCompleteWithReflection}
                                        className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                                    >
                                        {t.complete} <CheckCircle2 size={18} />
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <div />
                                <button
                                    onClick={handleQuizSubmit}
                                    disabled={Object.keys(quizAnswers).length < (lesson.quiz?.questions.length || 0)}
                                    className="bg-purple-600 text-white px-6 py-3 rounded-full font-bold hover:bg-purple-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {t.checkAnswers} <CheckCircle2 size={18} />
                                </button>
                            </>
                        )}
                    </div>
                </main>
            )}

            {/* Lesson Reflection Modal */}
            {showReflection && courseId && (
                <LessonReflectionModal
                    lessonId={lesson.lesson_id}
                    moduleId={(lesson as any)._moduleId || ''}
                    courseId={courseId}
                    lessonTitle={getText(lesson.title, language)}
                    language={language}
                    onClose={handleReflectionDone}
                    onSubmitted={handleReflectionDone}
                />
            )}

            <VoiceQuickSwitchSheet
                open={showVoiceSheet}
                language={language}
                onClose={() => setShowVoiceSheet(false)}
                onVoiceChange={(_voiceId, displayName) => {
                    setVoiceBadgeLabel(displayName);
                    setVoiceBadgeUnavailable(false);
                }}
                onOpenFullSettings={() => {
                    setShowVoiceSheet(false);
                    navigate('/settings/voice');
                }}
            />
        </div>
    );
};

// --- Mermaid Helpers ---
type MermaidDiagramType = 'flowchart' | 'sequence' | 'er' | 'other';

const detectMermaidType = (chart: string): MermaidDiagramType => {
    const stripped = chart
        .replace(/%%{[\s\S]*?}%%/g, '')
        .replace(/^%%.*$/gm, '')
        .trim();
    const firstLine = stripped.split('\n').find((line) => line.trim().length > 0)?.trim().toLowerCase() || '';
    if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) return 'flowchart';
    if (firstLine.startsWith('sequencediagram')) return 'sequence';
    if (firstLine.startsWith('erdiagram')) return 'er';
    return 'other';
};

const getMermaidThemeForType = (type: MermaidDiagramType) => {
    switch (type) {
        case 'sequence':
            return {
                primaryColor: '#ffffff',
                primaryTextColor: '#0f172a',
                primaryBorderColor: '#bae6fd',
                lineColor: '#38bdf8',
                secondaryColor: '#ecfeff',
                tertiaryColor: '#f0f9ff',
                edgeLabelBackground: '#ffffff',
                noteBkgColor: '#cffafe',
                noteTextColor: '#0f172a',
                noteBorderColor: '#22d3ee',
                actorBkg: '#f0f9ff',
                actorBorder: '#38bdf8',
                actorTextColor: '#0f172a',
                actorLineColor: '#38bdf8',
                signalColor: '#0284c7',
                signalTextColor: '#0f172a'
            };
        case 'er':
            return {
                primaryColor: '#ffffff',
                primaryTextColor: '#0f172a',
                primaryBorderColor: '#c4b5fd',
                lineColor: '#8b5cf6',
                secondaryColor: '#f5f3ff',
                tertiaryColor: '#f8fafc',
                edgeLabelBackground: '#ffffff'
            };
        case 'flowchart':
            return {
                primaryColor: '#ffffff',
                primaryTextColor: '#0f172a',
                primaryBorderColor: '#fed7aa',
                lineColor: '#f59e0b',
                secondaryColor: '#fff7ed',
                tertiaryColor: '#f8fafc',
                edgeLabelBackground: '#ffffff',
                clusterBkg: '#fff7ed',
                clusterBorder: '#fed7aa',
                noteBkgColor: '#fef9c3',
                noteTextColor: '#0f172a',
                noteBorderColor: '#fbbf24'
            };
        default:
            return null;
    }
};

type ImageDocBlock = Extract<LocalizedDocBlock, { type: 'image' }>;
const imagePreviewCache = new Map<string, string>();

const ImageBlock: React.FC<{ block: ImageDocBlock; language: 'en' | 'jp' }> = ({ block, language }) => {
    const cached = block.prompt ? imagePreviewCache.get(block.prompt) : null;
    const [src, setSrc] = useState<string | null>(
        block.prompt ? cached || null : block.src || block.fallbackSrc || null
    );
    const [isLoading, setIsLoading] = useState(false);
    const analysisRef = useRef<string | null>(null);

    useEffect(() => {
        if (!block.prompt) {
            setSrc(block.src || block.fallbackSrc || null);
            return;
        }
        if (imagePreviewCache.has(block.prompt)) {
            setSrc(imagePreviewCache.get(block.prompt) || null);
            setIsLoading(false);
            return;
        }
        let cancelled = false;
        setSrc(null);
        setIsLoading(true);
        generateImagePreview(block.prompt, { aspectRatio: '16:9', imageSize: '1K' })
            .then(({ url }) => {
                if (cancelled) return;
                imagePreviewCache.set(block.prompt || '', url);
                setSrc(url);
            })
            .catch(() => {
                if (cancelled) return;
                setSrc(block.src || block.fallbackSrc || null);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [block.prompt, block.src, block.fallbackSrc]);

    useEffect(() => {
        analysisRef.current = null;
    }, [block.prompt, block.src, block.fallbackSrc]);

    const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
        if (!src || !src.startsWith('data:') || !block.fallbackSrc) return;
        if (analysisRef.current === src) return;
        analysisRef.current = src;

        try {
            const img = event.currentTarget;
            const width = Math.min(img.naturalWidth || 0, 80);
            const height = Math.min(img.naturalHeight || 0, 80);
            if (!width || !height) return;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, width, height);
            const data = ctx.getImageData(0, 0, width, height).data;
            let sum = 0;
            let sumSq = 0;
            let count = 0;
            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha === 0) continue;
                const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
                sum += lum;
                sumSq += lum * lum;
                count += 1;
            }
            if (!count) return;
            const mean = sum / count;
            const variance = sumSq / count - mean * mean;
            if (mean > 0.96 && variance < 0.002) {
                setSrc(block.fallbackSrc);
            }
        } catch {
            // If analysis fails, keep the current image.
        }
    };

    if (!src) {
        return (
            <div className={`my-8 ${block.layout === 'full' ? '-mx-6 md:-mx-12' : ''}`}>
                <div className="w-full h-64 rounded-xl border border-slate-100 bg-gradient-to-br from-slate-100 via-white to-slate-50 animate-pulse" />
            </div>
        );
    }

    return (
        <figure className={`my-8 ${block.layout === 'full' ? '-mx-6 md:-mx-12' : ''}`}>
            <img
                src={src}
                alt={block.alt}
                onLoad={handleImageLoad}
                className={`w-full rounded-xl shadow-md border border-slate-100 ${isLoading ? 'opacity-80' : 'opacity-100'}`}
            />
            {block.caption && (
                <figcaption className="text-center text-xs text-slate-400 mt-2 font-medium">
                    {getText(block.caption, language)}
                </figcaption>
            )}
        </figure>
    );
};

const injectMermaidTheme = (chart: string, type: MermaidDiagramType) => {
    if (/%%{\s*init:/i.test(chart)) return chart;
    const themeVariables = getMermaidThemeForType(type);
    if (!themeVariables) return chart;
    const directive = `%%{init: ${JSON.stringify({ theme: 'base', themeVariables })}}%%`;
    return `${directive}\n${chart}`;
};

const injectFlowchartClasses = (chart: string) => {
    const importantKeywords = [/重要/, /Important/i, /Key/i, /Critical/i, /必須/];
    const warningKeywords = [/注意/, /Warning/i, /Caution/i, /Risk/i, /危険/];
    const patterns = [
        /\b([A-Za-z0-9_]+)\s*\[\[([^\]]+)\]\]/g,
        /\b([A-Za-z0-9_]+)\s*\[([^\]]+)\]/g,
        /\b([A-Za-z0-9_]+)\s*\(\(([^)]+)\)\)/g,
        /\b([A-Za-z0-9_]+)\s*\(([^)]+)\)/g,
        /\b([A-Za-z0-9_]+)\s*\{([^}]+)\}/g
    ];

    const importantNodes = new Set<string>();
    const warningNodes = new Set<string>();

    patterns.forEach((pattern) => {
        for (const match of chart.matchAll(pattern)) {
            const id = match[1];
            const rawLabel = match[2] || '';
            const label = rawLabel.replace(/^["'"]|["'"]$/g, '').trim();
            if (!label) continue;
            if (warningKeywords.some((r) => r.test(label))) {
                warningNodes.add(id);
            } else if (importantKeywords.some((r) => r.test(label))) {
                importantNodes.add(id);
            }
        }
    });

    if (importantNodes.size === 0 && warningNodes.size === 0) return chart;

    const classLines: string[] = [];
    if (!/classDef\s+important\b/i.test(chart)) {
        classLines.push('classDef important fill:#fff7ed,stroke:#fb923c,stroke-width:2.5px,color:#7c2d12;');
    }
    if (!/classDef\s+warning\b/i.test(chart)) {
        classLines.push('classDef warning fill:#fff1f2,stroke:#f97316,stroke-width:2px,stroke-dasharray:4 2,color:#7f1d1d;');
    }
    if (importantNodes.size > 0) {
        classLines.push(`class ${Array.from(importantNodes).join(',')} important;`);
    }
    if (warningNodes.size > 0) {
        classLines.push(`class ${Array.from(warningNodes).join(',')} warning;`);
    }

    return `${chart}\n\n%% auto styles %%\n${classLines.join('\n')}\n`;
};

// --- Mermaid Block Component ---
const MermaidBlock: React.FC<{ chart: string; caption?: LocalizedText | string; language: 'en' | 'jp' }> = ({ chart, caption, language }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svgContent, setSvgContent] = useState<string>('');
    const id = useId().replace(/:/g, '');
    const diagramType = detectMermaidType(chart);
    const containerStyleByType: Record<MermaidDiagramType, { bg: string; border: string; label: string }> = {
        flowchart: {
            bg: 'from-amber-50/70 via-white to-slate-50',
            border: 'border-amber-200/60',
            label: 'text-amber-600'
        },
        sequence: {
            bg: 'from-cyan-50/70 via-white to-slate-50',
            border: 'border-cyan-200/60',
            label: 'text-cyan-600'
        },
        er: {
            bg: 'from-violet-50/70 via-white to-slate-50',
            border: 'border-violet-200/60',
            label: 'text-violet-600'
        },
        other: {
            bg: 'from-slate-50 via-white to-amber-50/60',
            border: 'border-slate-200',
            label: 'text-slate-500'
        }
    };
    const containerStyle = containerStyleByType[diagramType];
    const labelTextByType: Record<MermaidDiagramType, { en: string; jp: string }> = {
        flowchart: { en: 'Flow', jp: 'フロー' },
        sequence: { en: 'Sequence', jp: 'シーケンス' },
        er: { en: 'ER', jp: 'ER' },
        other: { en: 'Diagram', jp: '図' }
    };

    useEffect(() => {
        const renderChart = async () => {
            if (!containerRef.current) return;
            try {
                const themedChart = injectMermaidTheme(
                    diagramType === 'flowchart' ? injectFlowchartClasses(chart) : chart,
                    diagramType
                );
                const uniqueRenderId = `mermaid-svg-${id}-${Date.now()}`;
                const { svg } = await mermaid.render(uniqueRenderId, themedChart);
                setSvgContent(svg);
            } catch (error) {
                console.error('Mermaid rendering failed:', error);
                setSvgContent(`<div class="p-4 bg-red-50 text-red-600 text-sm font-mono rounded">Diagram Error: Invalid Syntax</div>`);
            }
        };
        renderChart();
    }, [chart, id]);

    return (
        <div className={`my-10 p-8 bg-gradient-to-br ${containerStyle.bg} rounded-2xl border ${containerStyle.border} shadow-[0_12px_30px_rgba(15,23,42,0.08)] flex flex-col items-center justify-center relative`}>
            <div className={`absolute top-4 right-4 px-2 py-1 bg-white/90 backdrop-blur rounded-full border border-slate-200 text-[10px] font-bold uppercase tracking-widest ${containerStyle.label}`}>
                {labelTextByType[diagramType][language]}
            </div>
            <div
                ref={containerRef}
                className="w-full flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:rounded-lg [&_svg]:drop-shadow-[0_8px_16px_rgba(15,23,42,0.08)]"
                dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            {caption && <p className="mt-4 text-sm text-slate-500 font-medium text-center">{getText(caption, language)}</p>}
        </div>
    );
};

// --- Block Renderers ---
const BlockRenderer: React.FC<{ block: LocalizedDocBlock; language: 'en' | 'jp' }> = ({ block, language }) => {
    switch (block.type) {
        case 'text':
            return (
                <p className={`
               leading-8 text-slate-700
               ${block.style === 'lead' ? 'text-xl font-light text-slate-600 mb-8' : 'text-base'}
               ${block.style === 'quote' ? 'font-serif text-lg italic text-slate-600 border-l-4 border-slate-200 pl-4 py-1' : ''}
            `}>
                    <GlossaryText text={getText(block.text, language)} />
                </p>
            );

        case 'image':
            return <ImageBlock block={block as ImageDocBlock} language={language} />;

        case 'code':
            return (
                <div className="my-6 rounded-xl overflow-hidden bg-[#1e1e1e] shadow-lg border border-slate-800/50 group">
                    {block.filename && <div className="bg-[#252526] px-4 py-2 text-xs text-slate-400 font-mono border-b border-white/5 flex justify-between items-center"><span>{block.filename}</span><span className="uppercase opacity-50">{block.language}</span></div>}
                    <pre className="p-4 overflow-x-auto text-sm font-mono text-blue-100 leading-relaxed"><code>{block.code}</code></pre>
                </div>
            );

        case 'callout':
            // Guard: if no text, don't render the callout
            if (!block.text && !block.title) return null;
            const variants = {
                info: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-900', icon: Info, iconColor: 'text-blue-500' },
                warning: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-900', icon: AlertTriangle, iconColor: 'text-amber-500' },
                tip: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-900', icon: Lightbulb, iconColor: 'text-emerald-500' },
                success: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-900', icon: CheckCircle2, iconColor: 'text-green-500' },
            };
            const calloutVariant = block.variant || 'info';
            const style = variants[calloutVariant] || variants.info;
            const Icon = style.icon;
            return (
                <div className={`my-8 p-6 rounded-xl border ${style.bg} ${style.border} flex gap-4`}>
                    <div className={`mt-0.5 shrink-0 ${style.iconColor}`}><Icon size={20} /></div>
                    <div>
                        {block.title && (
                            <h4 className={`font-bold text-sm uppercase tracking-wide mb-2 ${style.text} opacity-80`}>
                                <GlossaryText text={getText(block.title, language)} />
                            </h4>
                        )}
                        {block.text && (
                            <p className={`text-sm leading-relaxed ${style.text}`}>
                                <GlossaryText text={getText(block.text, language)} />
                            </p>
                        )}
                    </div>
                </div>
            );

        case 'list':
            if (!block.items || !Array.isArray(block.items)) return null;
            const listBlock = block as any;
            const listStyle = listBlock.style || listBlock.listStyle || 'bullet';
            const isNumbered = listStyle === 'number';
            const isKeyed = listStyle === 'key';
            const renderListItem = (item: LocalizedText) => {
                const text = getText(item, language);
                if (!isKeyed) return <GlossaryText text={text} />;
                const match = text.match(/^(.+?)([:：])(.*)$/);
                if (!match) return <GlossaryText text={text} />;
                const label = match[1].trim();
                const separator = match[2];
                const rest = match[3].trim();
                const spacer = separator === '：' ? '' : ' ';
                return (
                    <span>
                        <span className="font-semibold underline decoration-amber-300 decoration-2 underline-offset-4">
                            <GlossaryText text={`${label}${separator}`} />
                        </span>
                        {rest ? (
                            <span>
                                {spacer}
                                <GlossaryText text={rest} />
                            </span>
                        ) : null}
                    </span>
                );
            };
            return (
                <ul className={`my-6 space-y-3 ${isNumbered ? 'list-decimal pl-5' : ''}`}>
                    {block.items.map((item, i) => (
                        <li key={i} className="flex gap-3 text-slate-700 leading-relaxed group">
                            {!isNumbered && (
                                <span
                                    className={`mt-2 shrink-0 transition-transform ${isKeyed ? 'w-1 h-5 rounded bg-amber-300/80' : 'w-1.5 h-1.5 rounded-full bg-purple-400 group-hover:scale-125'}`}
                                />
                            )}
                            {renderListItem(item)}
                        </li>
                    ))}
                </ul>
            );

        case 'mermaid':
            return <MermaidBlock chart={block.chart} caption={block.caption} language={language} />;

        case 'table':
            if (!block.headers || !block.rows) return null;
            return (
                <div className="my-8 overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-50">
                                {block.headers.map((header, i) => (
                                    <th key={i} className="px-4 py-3 text-left text-sm font-bold text-slate-700 border-b border-slate-200">
                                        <GlossaryText text={getText(header, language)} />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {block.rows.map((row, ri) => (
                                <tr key={ri} className="hover:bg-slate-50">
                                    {row.map((cell, ci) => (
                                        <td key={ci} className="px-4 py-3 text-sm text-slate-600 border-b border-slate-100">
                                            <GlossaryText text={getText(cell, language)} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );

        case 'mindmap':
            return (
                <div className="my-12 p-8 bg-slate-50/50 rounded-3xl border border-slate-100">
                    <div className="flex items-center gap-2 mb-8 text-xs font-bold text-slate-400 uppercase tracking-widest">
                        <Brain size={14} className="text-purple-500" /> Interactive Mind Map
                    </div>
                    <MindMapNode node={block.root} language={language} isRoot />
                </div>
            );

        default:
            return null;
    }
};

// --- MindMap Node Component ---
const MindMapNode: React.FC<{
    node: { text: LocalizedText | string; details?: LocalizedText | string; children?: any[] };
    language: 'en' | 'jp';
    isRoot?: boolean;
}> = ({ node, language, isRoot }) => {
    const [isOpen, setIsOpen] = useState(isRoot);

    return (
        <div className="flex flex-col gap-2">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={`
          p-4 rounded-xl border-2 transition-all cursor-pointer group relative
          ${isRoot
                        ? 'bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-200'
                        : 'bg-white border-slate-100 hover:border-purple-200 text-slate-700 shadow-sm'}
        `}
            >
                <div className="flex items-center justify-between gap-4">
                    <span className={`font-bold ${isRoot ? 'text-lg' : 'text-sm'}`}>
                        <GlossaryText text={getText(node.text, language)} />
                    </span>
                    {node.children && (
                        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                            <ChevronDown size={16} className={isRoot ? 'text-white/70' : 'text-slate-400'} />
                        </div>
                    )}
                </div>

                {isOpen && node.details && (
                    <div className={`mt-2 text-xs leading-relaxed ${isRoot ? 'text-purple-100' : 'text-slate-500'}`}>
                        <GlossaryText text={getText(node.details, language)} />
                    </div>
                )}

                {!isRoot && <div className="absolute -left-4 top-1/2 w-4 h-0.5 bg-slate-100 group-hover:bg-purple-100" />}
            </div>

            {isOpen && node.children && (
                <div className="pl-8 border-l-2 border-purple-50 flex flex-col gap-4 mt-2 ml-4">
                    {node.children.map((child, idx) => (
                        <MindMapNode key={idx} node={child} language={language} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default GeneratedDocView;