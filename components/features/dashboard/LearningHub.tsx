import React, { useEffect, useState } from 'react';
import {
    Terminal, Box, Palette, BookOpen, Compass,
    Sparkles, Cpu, ArrowRight, Gamepad2, Settings, ChevronUp, ChevronDown
} from 'lucide-react';
import { LearningPortal, LocalizedText, ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { fetchLearningPortals, updateLearningPortal, updateLearningPortalOrder } from '../../../services/learningPortalApi';
import { VIEW_PATHS } from '../../../navigation/viewPaths';
import { features } from '../../../config/features';
import PageHeader from '../../ui/PageHeader';
import CourseCard from '../../ui/CourseCard';
import { Button, ButtonLink } from '../../ui/Button';

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

    const availablePortals = orderedPortals.filter((portal) => !isLabsHidden(resolveViewState(portal.view)));
    const displayPortals = isEditing ? availablePortals : availablePortals.filter((portal) => portal.isActive);

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

    const portalHref = (view: ViewState): string | undefined => VIEW_PATHS[view] || undefined;

    return (
        <div className="mx-auto w-full max-w-wide pb-16 pt-6 sm:pt-8">
            <PageHeader
                title={t.headerTitle}
                description={t.headerSubtitle}
                actions={
                    <>
                        {notice && (
                            <span role="status" className="rounded-full bg-sun-soft px-3 py-1 text-caption font-semibold text-sun-text">
                                {notice}
                            </span>
                        )}
                        <Button
                            variant={isEditing ? 'primary' : 'secondary'}
                            size="sm"
                            aria-pressed={isEditing}
                            leadingIcon={<Settings size={14} aria-hidden="true" />}
                            onClick={() => setIsEditing((prev) => !prev)}
                        >
                            {isEditing ? t.manageDone : t.manageLabel}
                        </Button>
                    </>
                }
            />

            <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5">
                {displayPortals.map((portal) => {
                    const Icon = iconMap[portal.icon] || BookOpen;
                    const subtitle = resolveLocalizedText(portal.subtitle, language);
                    const title = resolveLocalizedText(portal.title, language);
                    const description = resolveLocalizedText(portal.description, language);
                    const viewState = resolveViewState(portal.view);
                    const portalIndex = orderedPortals.findIndex((item) => item.id === portal.id);
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
                                dimmed={isEditing && !portal.isActive}
                                {...(isEditing
                                    ? {}
                                    : href
                                        ? { to: href }
                                        : { onClick: () => onNavigate(viewState) })}
                                footer={
                                    isEditing ? (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                aria-pressed={portal.isActive}
                                                onClick={(event) => handleToggleVisibility(portal, event)}
                                            >
                                                {portal.isActive ? t.visibilityOn : t.visibilityOff}
                                            </Button>
                                            <div className="ml-auto flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={`${t.moveUp}: ${title}`}
                                                    onClick={(event) => handleMove(portal.id, -1, event)}
                                                    disabled={portalIndex <= 0}
                                                >
                                                    <ChevronUp size={16} aria-hidden="true" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={`${t.moveDown}: ${title}`}
                                                    onClick={(event) => handleMove(portal.id, 1, event)}
                                                    disabled={portalIndex === orderedPortals.length - 1}
                                                >
                                                    <ChevronDown size={16} aria-hidden="true" />
                                                </Button>
                                            </div>
                                        </div>
                                    ) : undefined
                                }
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
