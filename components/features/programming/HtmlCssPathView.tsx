import React from 'react';
import { ViewState } from '../../../types';
import {
    ArrowLeft, CheckCircle2, Circle, Lock, Play, Star,
    BookOpen, Code, Layers, Calendar, ChevronRight, ArrowRight
} from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface HtmlCssPathViewProps {
    onBack: () => void;
    onNavigate: (view: ViewState) => void;
}

const HtmlCssPathView: React.FC<HtmlCssPathViewProps> = ({ onBack, onNavigate }) => {
    const { language } = useLanguage();

    const copy = {
        en: {
            backToCourses: 'Back to Courses',
            badge: 'Beginner Pick',
            moduleLabel: 'MODULE 3 / 5',
            title: 'Modern HTML & CSS Foundations',
            description: 'Master the skills needed for professional web production.\nCovers modern layout techniques with Flexbox and Grid.',
            progressLabel: 'Course Progress',
            completedLabel: 'COMPLETED',
            totalTimeLabel: 'Total Time',
            totalTimeValue: '6.5 Hours',
            levelLabel: 'Level',
            levelValue: 'Beginner',
            heroAlt: 'Web Basics Hero',
            nowLearning: 'NOW LEARNING',
            completedBadge: 'Completed',
            startLabel: 'Start'
        },
        jp: {
            backToCourses: 'コース一覧に戻る',
            badge: '初心者おすすめ',
            moduleLabel: 'モジュール 3 / 5',
            title: 'モダンHTML & CSSの基礎',
            description: 'プロフェッショナルなWeb制作に必要なスキルを、体系的にマスターする実践コース。\nFlexboxやGridを使ったモダンなレイアウト手法まで網羅。',
            progressLabel: 'コース進捗',
            completedLabel: '完了',
            totalTimeLabel: '合計時間',
            totalTimeValue: '6.5時間',
            levelLabel: 'レベル',
            levelValue: '初心者',
            heroAlt: 'Web基礎のヒーロー',
            nowLearning: '学習中',
            completedBadge: '完了',
            startLabel: '開始'
        }
    } as const;

    const t = copy[language];

    const modules = [
        {
            id: 1,
            title: { en: 'How the Web Works & HTML Basics', jp: 'Webの仕組みとHTML基礎' },
            desc: { en: 'Internet fundamentals and the HTML tags that structure content.', jp: 'インターネットの基本構造と、文章構造を作るHTMLタグの基礎。' },
            status: "completed",
            duration: { en: '45 min', jp: '45分' },
            image: "https://images.unsplash.com/photo-1542831371-29b0f74f9713?auto=format&fit=crop&q=80&w=800"
        },
        {
            id: 2,
            title: { en: 'CSS Styling Fundamentals', jp: 'CSSによるスタイリング' },
            desc: { en: 'Core techniques for colors, typography, and backgrounds.', jp: '色、フォント、背景など、Webページを美しく装飾する基本テクニック。' },
            status: "completed",
            duration: { en: '60 min', jp: '60分' },
            image: "https://images.unsplash.com/photo-1507721999472-8ed4421c4af2?auto=format&fit=crop&q=80&w=800"
        },
        {
            id: 3,
            title: { en: 'Modern Layout (Flexbox)', jp: 'モダンレイアウト (Flexbox)' },
            desc: { en: 'Practice the flexible box layout used in modern web development.', jp: '現代のWeb制作に不可欠な、柔軟なボックスレイアウト手法を実践。' },
            status: "current",
            duration: { en: '90 min', jp: '90分' },
            view: ViewState.HTML_CSS_COURSE,
            image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800"
        },
        {
            id: 4,
            title: { en: 'Grid Design (CSS Grid)', jp: 'グリッドデザイン (CSS Grid)' },
            desc: { en: 'Master two-dimensional layouts with CSS Grid.', jp: '2次元の複雑なレイアウトを自在に操る最新仕様。' },
            status: "locked",
            duration: { en: '75 min', jp: '75分' },
            view: ViewState.HTML_CSS_PART_TWO,
            image: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=800"
        },
        {
            id: 5,
            title: { en: 'Final Project: Landing Page', jp: '最終課題：ランディングページ制作' },
            desc: { en: 'Code a pro-quality landing page from scratch using everything you learned.', jp: '学んだ知識を総動員して、プロ品質のLPをゼロからコーディング。' },
            status: "locked",
            duration: { en: '120 min', jp: '120分' },
            image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50/50 font-sans text-slate-600 pb-20">
            {/* Hero Section */}
            <div className="relative h-[300px] w-full overflow-hidden">
                <img
                    src="https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=1600"
                    alt={t.heroAlt}
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"></div>

                <div className="absolute inset-0 flex flex-col justify-center max-w-5xl mx-auto px-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-white/80 hover:text-white transition-colors mb-6 text-sm font-medium w-fit"
                    >
                        <ArrowLeft size={16} /> {t.backToCourses}
                    </button>

                    <div className="flex items-center gap-3 mb-3">
                        <div className="bg-cyan-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-cyan-900/20">
                            {t.badge}
                        </div>
                        <span className="text-cyan-100/90 text-sm font-mono tracking-wider">{t.moduleLabel}</span>
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">{t.title}</h1>
                    <p className="text-slate-200 max-w-2xl text-lg leading-relaxed">
                        {t.description.split('\n').map((line, index) => (
                            <React.Fragment key={line}>
                                {line}
                                {index === 0 && <br className="hidden md:block" />}
                            </React.Fragment>
                        ))}
                    </p>
                </div>
            </div>

            {/* Progress Bar (Floating) */}
            <div className="max-w-5xl mx-auto px-6 -mt-8 relative z-10 mb-12">
                <div className="bg-white rounded-xl p-6 shadow-lg shadow-slate-200/50 border border-slate-100 flex items-center justify-between gap-8">
                    <div className="flex-1">
                        <div className="flex justify-between items-end mb-2">
                            <div className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.progressLabel}</div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-cyan-600">40%</span>
                                <span className="text-xs text-slate-400 font-medium">{t.completedLabel}</span>
                            </div>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                            <div className="bg-cyan-500 h-full rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]" style={{ width: '40%' }}></div>
                        </div>
                    </div>
                    <div className="hidden md:flex gap-8 border-l border-slate-100 pl-8">
                        <div>
                            <div className="text-xs text-slate-400 font-bold uppercase mb-1">{t.totalTimeLabel}</div>
                            <div className="font-medium text-slate-700">{t.totalTimeValue}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-400 font-bold uppercase mb-1">{t.levelLabel}</div>
                            <div className="font-medium text-slate-700">{t.levelValue}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Roadmap */}
            <div className="max-w-4xl mx-auto px-6">
                <div className="relative">
                    {/* Vertical Line */}
                    <div className="absolute left-[27px] top-8 bottom-8 w-0.5 bg-slate-200/80"></div>

                    <div className="space-y-8">
                        {modules.map((module, index) => (
                            <div key={module.id} className="relative flex gap-8 group">
                                {/* Status Icon */}
                                <div className={`
                                    relative z-10 w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-[3px] transition-all duration-300 bg-white
                                    ${module.status === 'completed' ? 'border-cyan-500 text-cyan-500' : ''}
                                    ${module.status === 'current' ? 'border-cyan-500 text-cyan-500 shadow-[0_0_0_4px_rgba(6,182,212,0.15)] scale-110' : ''}
                                    ${module.status === 'locked' ? 'border-slate-200 text-slate-300' : ''}
                                `}>
                                    {module.status === 'completed' && <CheckCircle2 size={24} className="fill-cyan-50" />}
                                    {module.status === 'current' && <div className="w-4 h-4 bg-cyan-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.8)]"></div>}
                                    {module.status === 'locked' && <Lock size={20} />}
                                </div>

                                {/* Content Card */}
                                <div className={`flex-1 transition-all duration-300 ${module.status === 'current' ? 'transform -translate-y-1' : 'opacity-80 hover:opacity-100'}`}>
                                    <div
                                        onClick={() => module.status === 'current' && module.view && onNavigate(module.view)}
                                        className={`
                                            group/card rounded-2xl border overflow-hidden transition-all duration-300 flex flex-col md:flex-row h-full md:h-40
                                            ${module.status === 'current'
                                                ? 'bg-white border-cyan-200/80 shadow-xl shadow-cyan-100/40 cursor-pointer hover:border-cyan-300 hover:shadow-cyan-100/60'
                                                : 'bg-white border-slate-100 shadow-sm hover:shadow-lg hover:border-cyan-100'}
                                        `}
                                    >
                                        {/* Image Section */}
                                        <div className="w-full md:w-48 relative overflow-hidden shrink-0">
                                            <img
                                                src={module.image}
                                                alt={module.title[language]}
                                                className={`w-full h-full object-cover transition-transform duration-700 ${module.status === 'locked' ? 'grayscale opacity-70' : 'group-hover/card:scale-110'}`}
                                            />
                                            {/* Overlay for locked items */}
                                            {module.status === 'locked' && <div className="absolute inset-0 bg-slate-100/50 backdrop-grayscale"></div>}

                                            {/* Current Label on Image */}
                                            {module.status === 'current' && (
                                                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur text-cyan-600 text-[10px] font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                                                    <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></div>
                                                    {t.nowLearning}
                                                </div>
                                            )}
                                        </div>

                                        {/* Text Content */}
                                        <div className="flex-1 p-5 flex flex-col justify-center relative">
                                            <div className="flex justify-between items-start mb-2">
                                                <h3 className={`font-bold text-lg tracking-tight ${module.status === 'locked' ? 'text-slate-400' : 'text-slate-800'}`}>
                                                    {module.title[language]}
                                                    {module.status === 'completed' && <span className="ml-2 text-xs font-normal text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full align-middle">{t.completedBadge}</span>}
                                                </h3>
                                            </div>

                                            <p className={`text-sm leading-relaxed line-clamp-2 md:line-clamp-none ${module.status === 'locked' ? 'text-slate-400' : 'text-slate-500'} mb-3`}>
                                                {module.desc[language]}
                                            </p>

                                            <div className="flex items-center justify-between mt-auto">
                                                <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${module.status === 'locked' ? 'text-slate-300' : 'text-slate-400'}`}>
                                                    <Calendar size={12} /> {module.duration[language]}
                                                </span>

                                                {module.status === 'current' ? (
                                                    <div className="flex items-center gap-2 text-cyan-600 font-bold text-sm bg-cyan-50 px-4 py-2 rounded-lg group-hover/card:bg-cyan-500 group-hover/card:text-white transition-all">
                                                        {t.startLabel} <ArrowRight size={16} />
                                                    </div>
                                                ) : (
                                                    module.status === 'completed' && (
                                                        <div className="w-8 h-8 rounded-full bg-slate-50 text-cyan-600 flex items-center justify-center">
                                                            <CheckCircle2 size={16} />
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helper Icons
const PaletteIcon = ({ size, className }: { size: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.01 17.461 2 12 2z" />
    </svg>
);

const GridIcon = ({ size, className }: { size: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />
    </svg>
);

export default HtmlCssPathView;
