import React, { useEffect, useState } from 'react';
import {
    Terminal, Box, Palette, BookOpen, Compass,
    Sparkles, Cpu, ArrowRight, Gamepad2
} from 'lucide-react';
import { LearningPortal, LocalizedText, ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { fetchLearningPortals } from '../../../services/learningPortalApi';
import { VIEW_PATHS } from '../../../navigation/viewPaths';
import { features } from '../../../config/features';
import { getCourse } from '../../../content';
import { trackCopy, type TrackId } from '../../ui/tracks';
import PageHeader from '../../ui/PageHeader';
import CourseCard from '../../ui/CourseCard';
import { ButtonLink } from '../../ui/Button';

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

const VIEW_STATE_LOOKUP = new Set<string>(Object.values(ViewState));

const resolveViewState = (value: string): ViewState => {
    return VIEW_STATE_LOOKUP.has(value) ? (value as ViewState) : ViewState.DASHBOARD;
};

/** World accent for a portal's cover and badge (doc/design/design-system.md §3). */
const WORLD_BY_VIEW: Partial<Record<ViewState, string>> = {
    [ViewState.PROGRAMMING_WEB]: 'web',
    [ViewState.PROGRAMMING_AI]: 'ai',
    [ViewState.PROGRAMMING_VIBE]: 'vibe',
    [ViewState.VIBE_PATH]: 'vibe',
    [ViewState.CLAUDE_CODE]: 'ai',
    [ViewState.P_SCHOOL]: 'pschool',
    [ViewState.UNITY_AI_GAME_DEV]: 'unity',
    [ViewState.BLENDER]: 'blender',
    [ViewState.TEACHER_BOT_LIVE]: 'blender',
    [ViewState.ART_MUSEUM]: 'art',
    [ViewState.SONIC_LAB]: 'sonic',
};

const worldForView = (view: ViewState): string => WORLD_BY_VIEW[view] ?? 'default';

/** Experimental tracks stay hidden unless their labs flag is on (config/features.ts). */
const isLabsHidden = (view: ViewState): boolean =>
    (view === ViewState.TEACHER_BOT_LIVE && !features.labs.teacherBot) ||
    (view === ViewState.SONIC_LAB && !features.labs.sonic);

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

/** Title, badge and description of a shared track (components/ui/tracks.ts) in both locales. */
const trackFields = (id: TrackId) => {
    const course = id === 'vibe' ? getCourse('vibe-coding') : undefined;
    const en = trackCopy(id, 'en', course);
    const jp = trackCopy(id, 'jp', course);
    return {
        title: { en: en.title, jp: jp.title },
        subtitle: { en: en.badge, jp: jp.badge },
        description: { en: en.description, jp: jp.description },
    };
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
                teacherBot: {
                    title: 'Teacher Bot Live',
                    subtitle: 'Blender Sidecar',
                    description: 'Sync the current Blender step on a big screen.'
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
                claudeCode: {
                    title: 'Claude Code in Practice',
                    subtitle: 'AI agent',
                    description: '11 lessons in Japanese. The exercises need a paid plan with Claude Code or a Console account.'
                },
            },
            bannerTitle: 'Learning Path Diagnosis',
            bannerSubtitle: 'We recommend a curriculum tailored to your interests and skills.',
            bannerCta: 'Take the Assessment'
        },
        jp: {
            headerTitle: '学習コンテンツ',
            headerSubtitle: '興味のある分野を選択して、学習を開始してください。',
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
                teacherBot: {
                    title: 'Teacher Bot Live',
                    subtitle: 'Blender サイドカー',
                    description: 'Blenderの現在ステップを大画面で同期表示。'
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
                claudeCode: {
                    title: 'Claude Code 実践',
                    subtitle: 'AIエージェント',
                    description: '全11回です。演習には、Claude Codeが使える有料プランかConsoleアカウントが必要です。'
                },
            },
            bannerTitle: '学習パス診断',
            bannerSubtitle: 'あなたの興味とスキルに最適なカリキュラムを提案します。',
            bannerCta: '診断を受ける'
        }
    } as const;

    const t = copy[language];
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
            ...trackFields('vibe'),
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
            id: 'claude-code',
            title: { en: copy.en.portals.claudeCode.title, jp: copy.jp.portals.claudeCode.title },
            subtitle: { en: copy.en.portals.claudeCode.subtitle, jp: copy.jp.portals.claudeCode.subtitle },
            description: { en: copy.en.portals.claudeCode.description, jp: copy.jp.portals.claudeCode.description },
            icon: 'terminal',
            view: ViewState.CLAUDE_CODE,
            color: 'text-violet-500',
            bg: 'bg-violet-50',
            borderColor: 'border-violet-100',
            image: '',
            isActive: true,
            sortOrder: 35
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
            ...trackFields('unity'),
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
            ...trackFields('blender'),
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
            ...trackFields('art'),
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
                const data = await fetchLearningPortals();
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
    }, []);

    const orderedPortals = [...portals].sort((a, b) => {
        const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
        const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.id.localeCompare(b.id);
    });

    const availablePortals = orderedPortals.filter((portal) => !isLabsHidden(resolveViewState(portal.view)));
    const displayPortals = availablePortals.filter((portal) => portal.isActive);

    const portalHref = (view: ViewState): string | undefined => VIEW_PATHS[view] || undefined;

    return (
        <div className="mx-auto w-full max-w-wide pb-16 pt-6 sm:pt-8">
            <PageHeader
                title={t.headerTitle}
                description={t.headerSubtitle}
            />

            <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5">
                {displayPortals.map((portal) => {
                    const Icon = iconMap[portal.icon] || BookOpen;
                    const subtitle = resolveLocalizedText(portal.subtitle, language);
                    const title = resolveLocalizedText(portal.title, language);
                    const description = resolveLocalizedText(portal.description, language);
                    const viewState = resolveViewState(portal.view);
                    const href = portalHref(viewState);

                    return (
                        <li key={portal.id} className="flex">
                            <CourseCard
                                className="flex-1"
                                headingLevel={2}
                                world={worldForView(viewState)}
                                badge={subtitle}
                                title={title}
                                description={description}
                                image={portal.image || undefined}
                                glyph={<Icon size={44} className="" />}
                                {...(href ? { to: href } : { onClick: () => onNavigate(viewState) })}
                            />
                        </li>
                    );
                })}
            </ul>

            <section
                aria-labelledby="hub-diagnosis"
                className="mt-10 flex flex-col items-start justify-between gap-4 rounded-card border border-line bg-surface p-5 shadow-1 md:flex-row md:items-center md:p-6"
            >
                <div className="flex items-center gap-4">
                    <div aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-text">
                        <Compass size={22} />
                    </div>
                    <div>
                        <h2 id="hub-diagnosis" className="text-h3 text-fg">{t.bannerTitle}</h2>
                        <p className="text-small text-fg-2">{t.bannerSubtitle}</p>
                    </div>
                </div>
                <ButtonLink to={VIEW_PATHS[ViewState.AI_DIAGNOSIS]} variant="secondary" trailingIcon={<ArrowRight size={16} aria-hidden="true" />}>
                    {t.bannerCta}
                </ButtonLink>
            </section>
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
