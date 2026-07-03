import React from 'react';
import { ViewState } from '../../../types';
import { Sparkles, Brain, Zap, Heart, Anchor, MessageSquare, Bot, Star, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface AICharacterIntroViewProps {
    onBack?: () => void;
    onNavigate: (view: ViewState) => void;
    onSelectCharacter: (id: string) => void;
}

// --- CHARACTER DATA (Shared with Diagnosis) ---
// Ideally this should be in a shared data file, but for now duplicating for modularity.

type Trait = 'openness' | 'conscientiousness' | 'extraversion' | 'agreeableness' | 'stability';

type LocalizedText = {
    en: string;
    jp: string;
};

type PersonalityType = {
    id: Trait;
    name: LocalizedText;
    botName: string;
    botNameJp?: string;
    botRole: LocalizedText;
    color: string;
    bgGradient: string;
    icon: any;
    description: LocalizedText;
    strengths: {
        en: string[];
        jp: string[];
    };
    catchphrase: LocalizedText;
};

const CHARACTERS: PersonalityType[] = [
    {
        id: 'openness',
        name: { en: 'The Visionary', jp: 'ビジョナリー' },
        botName: 'Spark',
        botNameJp: 'スパーク',
        botRole: { en: 'Innovation Partner', jp: 'イノベーション・パートナー' },
        color: 'text-purple-500',
        bgGradient: 'from-purple-500 to-indigo-600',
        icon: Sparkles,
        description: {
            en: "A source of innovative ideas and creativity. Supports you in tackling new technologies and uncharted territory. Always asks “Why not?” to expand your possibilities.",
            jp: "革新的なアイデアと創造性の源。新しい技術や未踏の領域への挑戦をサポートします。常に「Why not?」と問いかけ、あなたの可能性を広げます。"
        },
        strengths: {
            en: ["Creative thinking", "Curiosity", "Adaptability"],
            jp: ["創造的思考", "好奇心", "適応力"]
        },
        catchphrase: { en: "Let's invent the future together.", jp: "未来を一緒に発明しましょう。" }
    },
    {
        id: 'conscientiousness',
        name: { en: 'The Architect', jp: 'アーキテクト' },
        botName: 'Focus',
        botNameJp: 'フォーカス',
        botRole: { en: 'Productivity Partner', jp: '生産性パートナー' },
        color: 'text-blue-500',
        bgGradient: 'from-blue-500 to-cyan-600',
        icon: Brain,
        description: {
            en: "A partner who draws precise blueprints for your goals. Supports efficient study plans and habit building. When you're unsure, he finds the optimal answer.",
            jp: "目標達成のための精密な設計図を描くパートナー。効率的な学習計画と習慣化を徹底サポート。迷ったときは常に「最適解」を導き出します。"
        },
        strengths: {
            en: ["Planning", "Consistency", "Attention to detail"],
            jp: ["計画力", "一貫性", "細部へのこだわり"]
        },
        catchphrase: { en: "Step by step, steadily to the top.", jp: "一歩ずつ、確実に頂上へ。" }
    },
    {
        id: 'extraversion',
        name: { en: 'The Catalyst', jp: 'カタリスト' },
        botName: 'Vibe',
        botNameJp: 'バイブ',
        botRole: { en: 'Motivation Partner', jp: 'モチベーション・パートナー' },
        color: 'text-orange-500',
        bgGradient: 'from-orange-400 to-red-500',
        icon: Zap,
        description: {
            en: "A bundle of passion and energy. Ignites your motivation and accelerates action. Spreads a learn-by-doing spirit without fear of failure.",
            jp: "情熱とエネルギーの塊。あなたのモチベーションに火をつけ、行動を加速させます。失敗を恐れず、楽しみながら学ぶ姿勢を伝染させます。"
        },
        strengths: {
            en: ["Energy", "Action-oriented", "Communication"],
            jp: ["エネルギー", "行動力", "コミュニケーション"]
        },
        catchphrase: { en: "Just do it! Think while you run.", jp: "Just do it! 走りながら考えよう。" }
    },
    {
        id: 'agreeableness',
        name: { en: 'The Mediator', jp: 'メディエーター' },
        botName: 'Echo',
        botNameJp: 'エコー',
        botRole: { en: 'Empathy Partner', jp: '共感パートナー' },
        color: 'text-emerald-500',
        bgGradient: 'from-emerald-400 to-teal-500',
        icon: Heart,
        description: {
            en: "A gentle listener who stays close to your heart. Supports you through learning worries and anxiety, and teaches the value of user perspective and teamwork.",
            jp: "あなたの心に寄り添う優しい聞き手。学習の悩みや不安を受け止め、メンタル面から支えます。ユーザー視点やチームワークの大切さも教えてくれます。"
        },
        strengths: {
            en: ["Empathy", "Collaboration", "Patience"],
            jp: ["共感力", "協調性", "忍耐力"]
        },
        catchphrase: { en: "It's okay. Let's go at your pace.", jp: "大丈夫、あなたのペースでいきましょう。" }
    },
    {
        id: 'stability',
        name: { en: 'The Anchor', jp: 'アンカー' },
        botName: 'Luna',
        botNameJp: 'ルナ',
        botRole: { en: 'Deep Thinking Partner', jp: '思考深化パートナー' },
        color: 'text-slate-500',
        bgGradient: 'from-slate-600 to-zinc-700',
        icon: Anchor,
        description: {
            en: "A sage who offers deep insight in quiet moments. Encourages fundamental understanding rather than surface fixes. Her calm helps when facing complex bugs or design challenges.",
            jp: "静寂の中で深い洞察を与える賢者。表面的な解決ではなく、本質的な理解を促します。複雑なバグや設計課題に直面したとき、彼女の冷静さが助けになります。"
        },
        strengths: {
            en: ["Analytical thinking", "Risk management", "Resilience"],
            jp: ["分析力", "リスク管理", "レジリエンス"]
        },
        catchphrase: { en: "In quiet, the answer appears.", jp: "静けさの中に、答えはあります。" }
    }
];

const AICharacterIntroView: React.FC<AICharacterIntroViewProps> = ({ onBack, onNavigate, onSelectCharacter }) => {
    const { language } = useLanguage();
    const copy = {
        en: {
            title: 'AI Partners',
            subtitle: 'Rise Path’s dedicated AI mentors. Each supports your growth in their own style.',
            strengthsLabel: 'Strengths',
            chatWith: (name: string) => `Chat with ${name}`,
            comingSoon: 'Coming Soon',
            comingSoonBody: 'New AI partners with specialized skills (security, design, and more) are in training.'
        },
        jp: {
            title: 'AIパートナー',
            subtitle: 'Rise Path専属のAIメンターたち。あなたの成長をそれぞれのスタイルで支えます。',
            strengthsLabel: '得意分野',
            chatWith: (name: string) => `${name}とチャットする`,
            comingSoon: '準備中',
            comingSoonBody: 'セキュリティやデザインなど、専門スキルを持つ新しいAIパートナーがトレーニング中です。'
        }
    } as const;
    const t = copy[language];

    return (
        <div className="min-h-screen bg-slate-50 p-8 pb-24">
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-12">
                <div className="flex items-center gap-4 mb-6">
                    {onBack && (
                        <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                            <ArrowLeft size={24} className="text-slate-600" />
                        </button>
                    )}
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900">{t.title}</h1>
                        <p className="text-slate-500 mt-1">{t.subtitle}</p>
                    </div>
                </div>
            </div>

            {/* Characters Grid */}
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
                {CHARACTERS.map((char) => {
                    const displayName = language === 'jp' ? (char.botNameJp || char.botName) : char.botName;
                    const displayRole = char.botRole[language];
                    const displayTitle = char.name[language];
                    const displayDescription = char.description[language];
                    const displayStrengths = char.strengths[language];
                    const displayCatchphrase = char.catchphrase[language];

                    return (
                    <div
                        key={char.id}
                        onClick={() => onSelectCharacter(char.id)}
                        className="group relative bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-slate-200 flex flex-col cursor-pointer"
                    >
                        {/* Header Background */}
                        <div className={`h-32 bg-gradient-to-r ${char.bgGradient} opacity-90 group-hover:opacity-100 transition-opacity relative`}>
                            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-20"></div>
                            <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-white to-transparent"></div>
                        </div>

                        {/* Icon Avatar */}
                        <div className="px-8 -mt-16 relative z-10 flex justify-between items-end">
                            <div className="w-24 h-24 bg-white rounded-2xl p-1 shadow-lg ring-1 ring-slate-100">
                                <div className={`w-full h-full rounded-xl bg-gradient-to-br ${char.bgGradient} flex items-center justify-center text-white`}>
                                    <char.icon size={40} />
                                </div>
                            </div>
                            <div className="mb-1">
                                <span className={`text-xs font-bold uppercase tracking-wider py-1 px-3 rounded-full bg-slate-100 ${char.color}`}>
                                    {displayRole}
                                </span>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-8 flex-1 flex flex-col">
                            <div className="mb-4">
                                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                                    {displayName}
                                    <span className="text-sm font-normal text-slate-400">/ {displayTitle}</span>
                                </h2>
                                <p className={`text-sm font-medium italic mt-1 opacity-70 ${char.color}`}>"{displayCatchphrase}"</p>
                            </div>

                            <p className="text-slate-600 mb-6 leading-relaxed flex-1">
                                {displayDescription}
                            </p>

                            <div className="mb-8">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{t.strengthsLabel}</h3>
                                <div className="flex flex-wrap gap-2">
                                    {displayStrengths.map(s => (
                                        <span key={s} className="px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-md text-xs font-medium text-slate-600">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => onNavigate(ViewState.AI_DIAGNOSIS)}
                                className={`w-full py-3 rounded-xl border font-bold flex items-center justify-center gap-2 transition-all
                                        bg-white border-slate-200 text-slate-600 hover:border-${char.color.split('-')[1]}-500 hover:text-${char.color.split('-')[1]}-600 hover:bg-slate-50
                             `}
                            >
                                <MessageSquare size={18} /> {t.chatWith(displayName)}
                            </button>
                        </div>
                    </div>
                    );
                })}

                {/* Locked Slot (Teaser) */}
                <div className="bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-12 text-center opacity-70 hover:opacity-100 transition-opacity">
                    <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-400 mb-4">
                        <Bot size={32} />
                    </div>
                    <h3 className="font-bold text-slate-500 text-lg">{t.comingSoon}</h3>
                    <p className="text-slate-400 text-sm max-w-xs mx-auto">
                        {t.comingSoonBody}
                    </p>
                </div>

            </div>
        </div>
    );
};

export default AICharacterIntroView;
