import React, { useEffect, useState, useRef } from 'react';
import { ArrowRight, Sparkles, Brain, Zap, Fingerprint, Activity, Layers, Play } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export type AuthEntryMode = 'login' | 'signup';

interface LandingViewProps {
    onAuthClick: (mode: AuthEntryMode) => void;
}

const ExperienceLandingView: React.FC<LandingViewProps> = ({ onAuthClick }) => {
    const { language, selectedLanguage, setLanguage } = useLanguage();
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const heroRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!heroRef.current) return;
            const { left, top, width, height } = heroRef.current.getBoundingClientRect();
            const x = (e.clientX - left) / width - 0.5;
            const y = (e.clientY - top) / height - 0.5;
            setMousePos({ x, y });
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    const copy = {
        en: {
            nav: {
                signIn: 'Enter System',
                signUp: 'Create Account',
                brand: 'Rise Path'
            },
            hero: {
                badge: 'Neuro-Adaptive Learning Engine v2.0',
                titleLine1: 'Learning that',
                titleLine2: 'Feels Like',
                titleHighlight: 'Instinct',
                description: 'Stop memorizing. Start absorbing. Our AI re-architects the curriculum in real-time based on your cognitive patterns, guiding you into a permanent state of Flow.',
                ctaPrimary: 'Initialize Profile',
                ctaSecondary: 'Watch Demo'
            },
            features: [
                {
                    id: 'adaptive',
                    icon: Fingerprint,
                    title: 'Cognitive Fingerprinting',
                    desc: 'The system maps your unique learning DNA—how you abstract concepts, your pace, and your curiosity triggers.'
                },
                {
                    id: 'flow',
                    icon: Activity,
                    title: 'Flow State Engineering',
                    desc: 'Difficulty is dynamically adjusted millisecond-by-millisecond to keep you in the "Zone"—never bored, never overwhelmed.'
                },
                {
                    id: 'symbiosis',
                    icon: Brain,
                    title: 'Symbiotic Intelligence',
                    desc: 'Your AI partner doesn\'t just teach. It evolves with you, anticipating your questions before you ask them.'
                }
            ],
            stats: {
                label: 'Global Neural Network',
                value: 'Active'
            },
            footer: '© 2026 Rise Path. Redefining Human Potential.'
        },
        jp: {
            nav: {
                signIn: 'ログイン',
                signUp: '新規登録',
                brand: 'Rise Path'
            },
            hero: {
                badge: 'ニューロ・アダプティブ学習エンジン v2.0',
                titleLine1: '学習は、',
                titleLine2: 'もっと',
                titleHighlight: '本能的になる',
                description: '「暗記」をやめて、「吸収」しよう。あなたの認知パターンに合わせてリアルタイムに再構築されるカリキュラムが、あなたを永続的な「フロー状態」へと導きます。',
                ctaPrimary: 'プロファイルを初期化',
                ctaSecondary: 'デモを見る'
            },
            features: [
                {
                    id: 'adaptive',
                    icon: Fingerprint,
                    title: '認知フィンガープリント',
                    desc: 'あなたの学習DNAをマッピング。概念の抽象化の癖、理解のペース、好奇心のトリガーを解析します。'
                },
                {
                    id: 'flow',
                    icon: Activity,
                    title: 'フロー・エンジニアリング',
                    desc: '「退屈」と「不安」の間にある"Zone"に留まり続けるよう、難易度をミリ秒単位で動的に調整します。'
                },
                {
                    id: 'symbiosis',
                    icon: Brain,
                    title: '共生型インテリジェンス',
                    desc: 'AIパートナーは単に教えるだけではありません。あなたと共に進化し、あなたが質問する前にその意図を予期します。'
                }
            ],
            stats: {
                label: 'グローバル・ニューラルネットワーク',
                value: '稼働中'
            },
            footer: '© 2026 Rise Path. 人間の可能性を再定義する。'
        }
    } as const;

    const t = copy[language];

    return (
        <div className="min-h-screen bg-black text-white font-sans overflow-hidden selection:bg-rose-500/30">
            
            {/* Ambient Lighting / Noise */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div 
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-rose-900/20 rounded-full blur-[120px] transition-transform duration-75 ease-out"
                    style={{ transform: `translate(${mousePos.x * -30}px, ${mousePos.y * -30}px) translate(-50%, -50%)` }}
                />
                <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-10 mix-blend-overlay"></div>
                
                {/* Grid Lines */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
            </div>

            {/* Navbar */}
            <nav className="fixed top-0 w-full z-50 p-6 flex justify-between items-center mix-blend-difference text-white">
                <div className="flex items-center gap-2">
                    <Layers className="w-6 h-6" />
                    <span className="text-lg font-bold tracking-widest uppercase">{t.nav.brand}</span>
                </div>
                
                <div className="flex items-center gap-6">
                    <div className="hidden md:flex gap-4 text-xs font-mono text-white/50">
                        {(['en', 'jp', 'fr'] as const).map((lang) => (
                            <button
                                key={lang}
                                onClick={() => setLanguage(lang)}
                                className={`uppercase hover:text-white transition-colors ${selectedLanguage === lang ? 'text-white underline decoration-rose-500 underline-offset-4' : ''}`}
                            >
                                {lang}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => onAuthClick('login')}
                        className="border border-white/20 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-wider hover:bg-white hover:text-black transition-all"
                    >
                        {t.nav.signIn}
                    </button>
                </div>
            </nav>

            {/* Main Content */}
            <main ref={heroRef} className="relative z-10 flex flex-col justify-center min-h-screen max-w-7xl mx-auto px-6 pt-20">
                
                {/* Hero */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
                    <div className="lg:col-span-7 space-y-8">
                        <div className="inline-flex items-center gap-2 text-rose-500 text-xs font-mono tracking-[0.2em] uppercase animate-in fade-in slide-in-from-left-4 duration-700">
                            <Zap className="w-3 h-3 fill-current" />
                            {t.hero.badge}
                        </div>

                        <h1 className="text-6xl md:text-8xl font-medium tracking-tight leading-[0.95] animate-in fade-in slide-in-from-bottom-8 duration-1000">
                            <span className="block text-white/40">{t.hero.titleLine1}</span>
                            <span className="block">{t.hero.titleLine2}</span>
                            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-purple-500 to-indigo-500 italic font-serif pr-4 pb-2">
                                {t.hero.titleHighlight}
                            </span>
                        </h1>

                        <p className="text-lg md:text-xl text-white/60 max-w-xl leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
                            {t.hero.description}
                        </p>

                        <div className="flex flex-wrap gap-4 pt-4 animate-in fade-in slide-in-from-bottom-16 duration-1000 delay-300">
                            <button
                                onClick={() => onAuthClick('signup')}
                                className="bg-white text-black px-8 py-4 rounded-full text-sm font-bold uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-3 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
                            >
                                {t.hero.ctaPrimary}
                                <ArrowRight className="w-4 h-4" />
                            </button>
                            <button className="px-8 py-4 rounded-full text-sm font-bold uppercase tracking-widest text-white border border-white/10 hover:bg-white/5 transition-colors flex items-center gap-3">
                                <Play className="w-4 h-4" />
                                {t.hero.ctaSecondary}
                            </button>
                        </div>
                    </div>

                    {/* Abstract Visual / Features */}
                    <div className="lg:col-span-5 relative mt-12 lg:mt-0 animate-in fade-in zoom-in-95 duration-1000 delay-500">
                        {/* Status Indicator */}
                        <div className="absolute -top-12 right-0 flex items-center gap-2 text-xs font-mono text-emerald-500">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            {t.stats.value}
                        </div>

                        <div className="space-y-4">
                            {t.features.map((feature, idx) => (
                                <div 
                                    key={feature.id}
                                    className="group p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-rose-500/30 hover:bg-white/10 transition-all duration-500 cursor-default"
                                    style={{ transform: `translateX(${(mousePos.x * (idx + 1)) * 10}px)` }}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-black border border-white/10 text-white/80 group-hover:text-rose-400 group-hover:border-rose-500/50 transition-colors">
                                            <feature.icon className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold mb-2 group-hover:text-rose-200 transition-colors">{feature.title}</h3>
                                            <p className="text-sm text-white/50 leading-relaxed">
                                                {feature.desc}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </main>

            {/* Footer */}
            <footer className="absolute bottom-6 left-6 right-6 flex justify-between items-end text-white/20 text-[10px] uppercase tracking-widest font-mono">
                <div>{t.footer}</div>
                <button
                    type="button"
                    onClick={() => onAuthClick('login')}
                    className="hidden md:block text-right hover:text-white/50 transition-colors pointer-events-auto"
                >
                    {language === 'jp' ? 'アカウントをお持ちの方はログイン' : 'Already have an account? Sign in'}
                </button>
            </footer>
        </div>
    );
};

export default ExperienceLandingView;
