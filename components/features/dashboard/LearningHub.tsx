import React, { useEffect, useState } from 'react';
import {
    Terminal, Box, Palette, BookOpen,
    Sparkles, Cpu, ArrowRight, Gamepad2, Settings, ChevronUp, ChevronDown
} from 'lucide-react';
import { LearningPortal, LocalizedText, ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { fetchLearningPortals, updateLearningPortal, updateLearningPortalOrder } from '../../../services/learningPortalApi';

type IconComponent = React.ComponentType<{ size: number; className: string }>;

const VIEW_STATE_LOOKUP = new Set<string>(Object.values(ViewState));

const resolveViewState = (value: string): ViewState => {
    return VIEW_STATE_LOOKUP.has(value) ? (value as ViewState) : ViewState.DASHBOARD;
};

const iconMap: Record<string, IconComponent> = {
    globe: GlobeIcon,
    cpu: Cpu,
    sparkles: Sparkles,
    gamepad: Gamepad2,
    box: Box,
    terminal: Terminal,
    palette: Palette,
    book: BookOpen,
};

const resolveLocalizedText = (value: LocalizedText, language: 'en' | 'jp'): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return language === 'jp' ? value.jp || value.en || '' : value.en || value.jp || '';
};

interface LearningHubProps {
    onNavigate: (view: ViewState) => void;
}

const LearningHub: React.FC<LearningHubProps> = ({ onNavigate }) => {
    const { setTheme } = useTheme();
    const { language } = useLanguage();

    useEffect(() => {
        setTheme('default');
    }, [setTheme]);

    const copy = {
        en: {
            headerTitle: 'Learning Content',
            headerSubtitle: 'Select a field to start learning.',
            manageLabel: 'Manage',
            manageDone: 'Done',
            visibilityOn: 'Visible',
            visibilityOff: 'Hidden',
            moveUp: 'Move up',
            moveDown: 'Move down',
            updateFailed: 'Update failed. Please try again.',
            portals: {
                web: {
                    title: 'Web Basics',
                    subtitle: 'Web Development Fundamentals',
                    description: 'From HTML, CSS, and React basics to modern UI build workflows.'
                },
                ai: {
                    title: 'Gen AI Camp',
                    subtitle: 'Generative AI & Python',
                    description: 'Learn how LLMs work and build AI apps with Python.'
                },
                vibe: {
                    title: 'Vibe Coding',
                    subtitle: 'Immersive Coding Experience',
                    description: 'Story-driven learning through Git and OSS.'
                },
                blender: {
                    title: 'Blender 3D',
                    subtitle: '3D Modeling',
                    description: 'Basics of 3D creation and spatial design with Blender.'
                },
                teacherBot: {
                    title: 'Teacher Bot Live',
                    subtitle: 'Blender Sidecar',
                    description: 'Sync the current Blender step on a big screen.'
                },
                art: {
                    title: 'Art Atelier',
                    subtitle: 'Art History & Philosophy',
                    description: 'Explore the history and theory of visual arts.'
                },
                english: {
                    title: 'Global Communication',
                    subtitle: 'Practical English & Cross-cultural',
                    description: 'Practical English for engineers, from docs to technical discussions.'
                },
                scratch: {
                    title: 'Scratch game',
                    subtitle: 'Block Coding RPG',
                    description: 'Learn programming by building battle scripts with Scratch-style blocks.'
                },
                unity: {
                    title: 'Unity AI Game Dev',
                    subtitle: 'AI x Unity Game Dev',
                    description: 'Develop games using Unity and AI. Learn the role of an architect.'
                }
            },
            bannerTitle: 'Learning Path Diagnosis',
            bannerSubtitle: 'We recommend a curriculum tailored to your interests and skills.',
            bannerCta: 'Take the Assessment'
        },
        jp: {
            headerTitle: '学習コンテンツ',
            headerSubtitle: '興味のある分野を選択して、学習を開始してください。',
            manageLabel: '管理',
            manageDone: '完了',
            visibilityOn: '公開',
            visibilityOff: '非公開',
            moveUp: '上へ',
            moveDown: '下へ',
            updateFailed: '更新に失敗しました。もう一度お試しください。',
            portals: {
                web: {
                    title: 'Web Basics',
                    subtitle: 'Web開発の基礎',
                    description: 'HTML, CSS, Reactの基礎からモダンなUI構築まで。'
                },
                ai: {
                    title: 'Gen AI Camp',
                    subtitle: '生成AI & Python',
                    description: 'LLMの仕組みとPythonによるAIアプリケーション開発。'
                },
                vibe: {
                    title: 'Vibe Coding',
                    subtitle: '没入型コード体験',
                    description: 'GitとOSSの世界を冒険する、新感覚のストーリー学習。'
                },
                blender: {
                    title: 'Blender 3D',
                    subtitle: '3Dモデリング',
                    description: 'Blenderを使った3DCG制作と空間デザインの基礎。'
                },
                teacherBot: {
                    title: 'Teacher Bot Live',
                    subtitle: 'Blender サイドカー',
                    description: 'Blenderの現在ステップを大画面で同期表示。'
                },
                art: {
                    title: 'Art Atelier',
                    subtitle: '美術史 & 哲学',
                    description: '視覚芸術の歴史と理論。クリエイティブの源泉を探る。'
                },
                english: {
                    title: 'Global Communication',
                    subtitle: '実践英語 & 異文化理解',
                    description: 'エンジニアのための実践的英語力。ドキュメント読解から技術的な議論まで。'
                },
                scratch: {
                    title: 'Scratch game',
                    subtitle: 'ブロックプログラミングRPG',
                    description: 'Scratchブロックでバトルの作戦を組み、遊びながらプログラミングを学ぶ。'
                },
                unity: {
                    title: 'Unity AI Game Dev',
                    subtitle: 'AI x Unity ゲーム開発',
                    description: 'AIと共にUnityでゲームを作る。コードを書くのではなく、設計する力を養う。'
                }
            },
            bannerTitle: '学習パス診断',
            bannerSubtitle: 'あなたの興味とスキルに最適なカリキュラムを提案します。',
            bannerCta: '診断を受ける'
        }
    } as const;

    const t = copy[language];
    const [isEditing, setIsEditing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const fallbackPortals: LearningPortal[] = [
        {
            id: 'web',
            title: { en: copy.en.portals.web.title, jp: copy.jp.portals.web.title },
            subtitle: { en: copy.en.portals.web.subtitle, jp: copy.jp.portals.web.subtitle },
            description: { en: copy.en.portals.web.description, jp: copy.jp.portals.web.description },
            icon: 'globe',
            view: ViewState.PROGRAMMING_WEB,
            color: 'text-cyan-500',
            bg: 'bg-cyan-50',
            borderColor: 'border-cyan-100',
            image: "https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 10
        },
        {
            id: 'ai',
            title: { en: copy.en.portals.ai.title, jp: copy.jp.portals.ai.title },
            subtitle: { en: copy.en.portals.ai.subtitle, jp: copy.jp.portals.ai.subtitle },
            description: { en: copy.en.portals.ai.description, jp: copy.jp.portals.ai.description },
            icon: 'cpu',
            view: ViewState.PROGRAMMING_AI,
            color: 'text-yellow-500',
            bg: 'bg-yellow-50',
            borderColor: 'border-yellow-100',
            image: "/generated/img_7d2e1114b497e75e541a491c179647f9878ff7a0b88b9438e122571a9710e37c.jpg",
            isActive: true,
            sortOrder: 20
        },
        {
            id: 'vibe',
            title: { en: copy.en.portals.vibe.title, jp: copy.jp.portals.vibe.title },
            subtitle: { en: copy.en.portals.vibe.subtitle, jp: copy.jp.portals.vibe.subtitle },
            description: { en: copy.en.portals.vibe.description, jp: copy.jp.portals.vibe.description },
            icon: 'sparkles',
            view: ViewState.PROGRAMMING_VIBE,
            color: 'text-purple-500',
            bg: 'bg-purple-50',
            borderColor: 'border-purple-100',
            image: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 30
        },
        {
            id: 'scratch-game',
            title: { en: 'Block Programming Battle', jp: 'ブロックプログラミングバトル' },
            subtitle: { en: 'Block Coding RPG', jp: 'ブロックプログラミングRPG' },
            description: { en: 'Learn programming by building battle scripts with Scratch-style blocks.', jp: 'Scratchブロックでバトルの作戦を組み、遊びながらプログラミングを学ぶ。' },
            icon: 'gamepad',
            view: ViewState.P_SCHOOL,
            color: 'text-green-600',
            bg: 'bg-green-50',
            borderColor: 'border-green-100',
            image: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 40
        },
        {
            id: 'unity',
            title: { en: copy.en.portals.unity.title, jp: copy.jp.portals.unity.title },
            subtitle: { en: copy.en.portals.unity.subtitle, jp: copy.jp.portals.unity.subtitle },
            description: { en: copy.en.portals.unity.description, jp: copy.jp.portals.unity.description },
            icon: 'gamepad',
            view: ViewState.UNITY_AI_GAME_DEV,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            borderColor: 'border-blue-100',
            image: "https://images.unsplash.com/photo-1596727147705-54a9d0a514d7?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 50
        },
        {
            id: '3d',
            title: { en: copy.en.portals.blender.title, jp: copy.jp.portals.blender.title },
            subtitle: { en: copy.en.portals.blender.subtitle, jp: copy.jp.portals.blender.subtitle },
            description: { en: copy.en.portals.blender.description, jp: copy.jp.portals.blender.description },
            icon: 'box',
            view: ViewState.BLENDER,
            color: 'text-orange-500',
            bg: 'bg-orange-50',
            borderColor: 'border-orange-100',
            image: "https://images.unsplash.com/photo-1617791160536-598cf32026fb?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 60
        },
        {
            id: 'teacher-bot-live',
            title: { en: copy.en.portals.teacherBot.title, jp: copy.jp.portals.teacherBot.title },
            subtitle: { en: copy.en.portals.teacherBot.subtitle, jp: copy.jp.portals.teacherBot.subtitle },
            description: { en: copy.en.portals.teacherBot.description, jp: copy.jp.portals.teacherBot.description },
            icon: 'terminal',
            view: ViewState.TEACHER_BOT_LIVE,
            color: 'text-emerald-500',
            bg: 'bg-emerald-50',
            borderColor: 'border-emerald-100',
            image: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 70
        },
        {
            id: 'art',
            title: { en: copy.en.portals.art.title, jp: copy.jp.portals.art.title },
            subtitle: { en: copy.en.portals.art.subtitle, jp: copy.jp.portals.art.subtitle },
            description: { en: copy.en.portals.art.description, jp: copy.jp.portals.art.description },
            icon: 'palette',
            view: ViewState.ART_MUSEUM,
            color: 'text-stone-600',
            bg: 'bg-stone-100',
            borderColor: 'border-stone-200',
            image: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 80
        },
        {
            id: 'english',
            title: { en: copy.en.portals.english.title, jp: copy.jp.portals.english.title },
            subtitle: { en: copy.en.portals.english.subtitle, jp: copy.jp.portals.english.subtitle },
            description: { en: copy.en.portals.english.description, jp: copy.jp.portals.english.description },
            icon: 'book',
            view: ViewState.COURSES,
            color: 'text-teal-500',
            bg: 'bg-teal-50',
            borderColor: 'border-teal-100',
            image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800",
            isActive: true,
            sortOrder: 90
        }
    ];

    const [portals, setPortals] = useState<LearningPortal[]>(fallbackPortals);

    useEffect(() => {
        let isMounted = true;

        const loadPortals = async () => {
            try {
                const data = await fetchLearningPortals({ includeInactive: isEditing });
                if (!isMounted) return;
                setPortals(data.length ? data : fallbackPortals);
            } catch (error) {
                if (!isMounted) return;
                console.error('Failed to load learning portals:', error);
                setPortals(fallbackPortals);
            }
        };

        loadPortals();

        return () => {
            isMounted = false;
        };
    }, [isEditing]);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 2500);
        return () => clearTimeout(timer);
    }, [notice]);

    const orderedPortals = [...portals].sort((a, b) => {
        const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
        const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.id.localeCompare(b.id);
    });

    const displayPortals = isEditing ? orderedPortals : orderedPortals.filter((portal) => portal.isActive);

    const updatePortalState = (updates: Array<{ id: string; changes: Partial<LearningPortal> }>) => {
        setPortals((prev) =>
            prev.map((portal) => {
                const update = updates.find((item) => item.id === portal.id);
                return update ? { ...portal, ...update.changes } : portal;
            })
        );
    };

    const handleToggleVisibility = async (portal: LearningPortal, event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const nextActive = !portal.isActive;
        updatePortalState([{ id: portal.id, changes: { isActive: nextActive } }]);
        try {
            await updateLearningPortal(portal.id, { isActive: nextActive });
        } catch (error) {
            updatePortalState([{ id: portal.id, changes: { isActive: portal.isActive } }]);
            console.error('Failed to update portal visibility:', error);
            setNotice(t.updateFailed);
        }
    };

    const handleMove = async (
        portalId: string,
        direction: -1 | 1,
        event: React.MouseEvent<HTMLButtonElement>
    ) => {
        event.stopPropagation();
        const index = orderedPortals.findIndex((portal) => portal.id === portalId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= orderedPortals.length) return;

        const current = orderedPortals[index];
        const target = orderedPortals[targetIndex];
        const currentOrder = Number.isFinite(current.sortOrder) ? current.sortOrder : 0;
        const targetOrder = Number.isFinite(target.sortOrder) ? target.sortOrder : 0;

        updatePortalState([
            { id: current.id, changes: { sortOrder: targetOrder } },
            { id: target.id, changes: { sortOrder: currentOrder } },
        ]);

        try {
            await updateLearningPortalOrder([
                { id: current.id, sortOrder: targetOrder },
                { id: target.id, sortOrder: currentOrder },
            ]);
        } catch (error) {
            updatePortalState([
                { id: current.id, changes: { sortOrder: currentOrder } },
                { id: target.id, changes: { sortOrder: targetOrder } },
            ]);
            console.error('Failed to reorder portals:', error);
            setNotice(t.updateFailed);
        }
    };

    return (
        <div className="p-6 md:p-12 max-w-[1600px] mx-auto min-h-screen bg-slate-50/50">
            {/* Header */}
            <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-700 mb-2 tracking-tight">
                        {t.headerTitle}
                    </h1>
                    <p className="text-slate-500">
                        {t.headerSubtitle}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {notice && (
                        <span className="text-xs font-bold text-amber-600 bg-amber-100 px-3 py-1 rounded-full">
                            {notice}
                        </span>
                    )}
                    <button
                        onClick={() => setIsEditing((prev) => !prev)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold border transition-colors ${
                            isEditing
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                    >
                        <Settings size={14} />
                        {isEditing ? t.manageDone : t.manageLabel}
                    </button>
                </div>
            </div>

            {/* 3 Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayPortals.map((portal, index) => {
                    const Icon = iconMap[portal.icon] || BookOpen;
                    const subtitle = resolveLocalizedText(portal.subtitle, language);
                    const title = resolveLocalizedText(portal.title, language);
                    const description = resolveLocalizedText(portal.description, language);
                    const viewState = resolveViewState(portal.view);
                    const borderColor = portal.borderColor || 'border-slate-200';
                    const bgColor = portal.bg || 'bg-slate-100';
                    const iconColor = portal.color || 'text-slate-500';
                    const image = portal.image || '';
                    const portalIndex = orderedPortals.findIndex((item) => item.id === portal.id);
                    const cardDelay = `${index * 90}ms`;
                    const shimmerDelay = `${index * 90 + 160}ms`;

                    return (
                        <div
                            key={portal.id}
                            onClick={() => {
                                if (!isEditing) {
                                    onNavigate(viewState);
                                }
                            }}
                            className={`
                              group relative bg-white rounded-2xl p-0 cursor-pointer portal-card-animate
                              border ${borderColor} shadow-sm hover:shadow-xl hover:-translate-y-1
                              transition-all duration-300 overflow-hidden flex flex-col h-[280px]
                              ${isEditing ? 'cursor-default' : 'cursor-pointer'}
                            `}
                            style={{ animationDelay: cardDelay }}
                        >
                            <div
                                className="portal-card-shimmer"
                                style={{ animationDelay: shimmerDelay }}
                                aria-hidden="true"
                            />
                            {/* Image Header Area (Height 45%) */}
                            <div className="h-[45%] w-full relative overflow-hidden bg-slate-100">
                                <img
                                    src={image}
                                    alt={title}
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                <div className={`absolute inset-0 bg-gradient-to-t from-white via-transparent opacity-80`}></div>

                                {/* Floating Icon Badge */}
                                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur shadow-sm p-2 rounded-lg text-slate-700 group-hover:scale-110 transition-transform">
                                    <Icon size={20} className={iconColor} />
                                </div>
                            </div>

                            {/* Content Area */}
                            <div className="flex-1 p-6 relative z-10">
                                {isEditing && (
                                    <div className="flex items-center gap-2 mb-2">
                                        <button
                                            onClick={(event) => handleToggleVisibility(portal, event)}
                                            className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
                                                portal.isActive
                                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                                                    : 'bg-slate-100 text-slate-500 border-slate-200'
                                            }`}
                                            title={portal.isActive ? t.visibilityOn : t.visibilityOff}
                                        >
                                            {portal.isActive ? t.visibilityOn : t.visibilityOff}
                                        </button>
                                        <div className="ml-auto flex items-center gap-1">
                                            <button
                                                onClick={(event) => handleMove(portal.id, -1, event)}
                                                disabled={portalIndex <= 0}
                                                className="p-1 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={t.moveUp}
                                            >
                                                <ChevronUp size={14} />
                                            </button>
                                            <button
                                                onClick={(event) => handleMove(portal.id, 1, event)}
                                                disabled={portalIndex === orderedPortals.length - 1}
                                                className="p-1 rounded border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={t.moveDown}
                                            >
                                                <ChevronDown size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <div className="mb-1">
                                    <span className={`text-xs font-bold uppercase tracking-wider text-slate-500 bg-opacity-10 px-2 py-0.5 rounded-full ${bgColor}`}>
                                        {subtitle}
                                    </span>
                                </div>
                                <h2 className="text-xl font-bold text-slate-700 mb-2 tracking-tight group-hover:text-indigo-600 transition-colors">
                                    {title}
                                </h2>
                                <p className="text-slate-500 text-sm leading-relaxed line-clamp-2">
                                    {description}
                                </p>

                                <div className="absolute bottom-6 right-6 opacity-0 transform translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                                    <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-indigo-600">
                                        <ArrowRight size={16} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Aptitude Test Banner (Optional, keeping it clean for now) */}
            <div className="mt-12 bg-white rounded-2xl border border-slate-200 p-8 flex flex-col md:flex-row items-center justify-between shadow-sm gap-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                        <BookOpen size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800">{t.bannerTitle}</h3>
                        <p className="text-slate-500 text-sm">{t.bannerSubtitle}</p>
                    </div>
                </div>
                <button className="whitespace-nowrap bg-slate-900 text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-800 transition-colors">
                    {t.bannerCta}
                </button>
            </div>
        </div>
    );
};

// Helper Icon for standard web
function GlobeIcon({ size, className }: { size: number; className: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    );
}

export default LearningHub;
