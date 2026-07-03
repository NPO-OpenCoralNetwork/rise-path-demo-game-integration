import React, { useEffect, useState } from 'react';
import { ArrowRight, Sparkles, Brain, Palette, Code2, Rocket, Globe, ChevronRight, Zap, Play } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface LandingViewProps {
    onLoginClick: () => void;
}

const LandingView: React.FC<LandingViewProps> = ({ onLoginClick }) => {
    const { language, selectedLanguage, setLanguage } = useLanguage();
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const copy = {
        en: {
            signIn: 'Sign In',
            badge: 'AI-Powered Learning Platform',
            heroTitle: 'Master the Future',
            heroSubtitle: 'of Code & Art',
            heroDescription: 'Unlock your creative potential with personalized AI tutors. From Web Development to Generative Art, experience a learning journey designed for "Flow".',
            startLearning: 'Start Your Journey',
            viewCurriculum: 'Explore Curriculum',
            features: {
                aiTitle: 'AI Partners',
                aiDescription: 'Diagnosis-driven matching with AI mentors like Spark (Visionary) or Focus (Architect).',
                codingTitle: 'Vibe Coding',
                codingDescription: 'Build real apps in a sci-fi narrative. Learn React, TypeScript, and AI integration.',
                artTitle: 'Digital Atelier',
                artDescription: 'Where traditional Art History meets modern Generative AI tools.'
            },
            footer: '© 2026 Rise Path Platform. Designed for the Future.',
            stats: [
                { label: 'AI Mentors', value: '5+' },
                { label: 'Interactive Lessons', value: '100+' },
                { label: 'Flow State', value: '∞' }
            ]
        },
        jp: {
            signIn: 'サインイン',
            badge: 'AI搭載 学習プラットフォーム',
            heroTitle: '未来を実装せよ',
            heroSubtitle: 'コードとアートで',
            heroDescription: '先進AIチューターと共に、あなたの創造性を解き放つ。Web開発から生成アートまで、「没入（Flow）」するための新しい学習体験。',
            startLearning: '旅を始める',
            viewCurriculum: 'カリキュラム探索',
            features: {
                aiTitle: 'AIパートナー',
                aiDescription: '性格診断に基づき、Spark（ビジョナリー）やFocus（設計者）など最適なメンターとマッチング。',
                codingTitle: 'Vibe Coding',
                codingDescription: 'SF的な物語の中でリアルなアプリを開発。React, TypeScript, AI統合を実践的に学ぶ。',
                artTitle: 'デジタル・アトリエ',
                artDescription: '伝統的な美術史と、最新の生成AIツールが交差する場所。'
            },
            footer: '© 2026 Rise Path Platform. Designed for the Future.',
            stats: [
                { label: 'AIメンター', value: '5+' },
                { label: 'レッスン数', value: '100+' },
                { label: '没入体験', value: '∞' }
            ]
        }
    } as const;
    const t = copy[language];

    return (
        <div className="min-h-screen bg-[#050505] text-white font-sans overflow-x-hidden selection:bg-cyan-500/30">
            
            {/* Dynamic Background */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-600/10 rounded-full blur-[120px] animate-pulse delay-1000" />
                <div className="absolute top-[40%] left-[30%] w-[30%] h-[30%] bg-purple-600/5 rounded-full blur-[100px] animate-pulse delay-2000" />
                <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-20 brightness-100 contrast-150 mix-blend-overlay"></div>
            </div>

            {/* Navbar */}
            <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'bg-[#050505]/80 backdrop-blur-md border-b border-white/5 py-4' : 'py-6 bg-transparent'}`}>
                <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
                    <div className="flex items-center gap-3 group cursor-pointer">
                        <div className="relative">
                            <div className="absolute inset-0 bg-cyan-500 blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                            <div className="relative bg-gradient-to-br from-indigo-500 to-cyan-600 p-2.5 rounded-xl border border-white/10 shadow-xl">
                                <Sparkles className="w-5 h-5 text-white" />
                            </div>
                        </div>
                        <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 group-hover:to-white transition-all">Rise Path</span>
                    </div>

                    <div className="flex items-center gap-6">
                        {/* Language Switcher */}
                        <div className="hidden md:flex items-center gap-1 bg-white/5 border border-white/5 p-1 rounded-full backdrop-blur-sm">
                            {(['en', 'jp', 'fr'] as const).map((lang) => (
                                <button
                                    key={lang}
                                    onClick={() => setLanguage(lang)}
                                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase transition-all duration-300 ${selectedLanguage === lang 
                                        ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-lg' 
                                        : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                >
                                    {lang}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={onLoginClick}
                            className="group relative px-6 py-2.5 rounded-full overflow-hidden bg-white text-black font-bold text-sm transition-all hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                {t.signIn} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </span>
                        </button>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-40 pb-20 lg:pt-64 lg:pb-40 px-6 z-10">
                <div className="max-w-7xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-wider mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 backdrop-blur-sm">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                        </span>
                        {t.badge}
                    </div>

                    <h1 className="text-6xl md:text-8xl lg:text-9xl font-bold tracking-tighter mb-8 leading-[0.9] animate-in fade-in slide-in-from-bottom-8 duration-1000">
                        <span className="block bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-500">{t.heroTitle}</span>
                        <span className="block text-4xl md:text-6xl lg:text-7xl font-light text-slate-400 mt-2 md:mt-4">
                            {t.heroSubtitle}
                        </span>
                    </h1>

                    <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
                        {t.heroDescription}
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-16 duration-1000 delay-300">
                        <button
                            onClick={onLoginClick}
                            className="w-full sm:w-auto px-10 py-5 rounded-full bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-bold text-lg hover:scale-105 transition-all shadow-[0_0_40px_rgba(79,70,229,0.3)] hover:shadow-[0_0_60px_rgba(79,70,229,0.5)] flex items-center justify-center gap-3 group"
                        >
                            <Rocket className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                            {t.startLearning}
                        </button>
                        
                        <button className="w-full sm:w-auto px-10 py-5 rounded-full bg-white/5 text-white font-medium hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all backdrop-blur-md flex items-center justify-center gap-2 group">
                            <Play className="w-4 h-4 fill-current group-hover:scale-110 transition-transform" />
                            {t.viewCurriculum}
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="mt-20 flex flex-wrap justify-center gap-12 md:gap-24 animate-in fade-in duration-1000 delay-500 border-t border-white/5 pt-12 max-w-4xl mx-auto">
                        {t.stats.map((stat, i) => (
                            <div key={i} className="text-center">
                                <div className="text-3xl md:text-4xl font-bold text-white mb-1">{stat.value}</div>
                                <div className="text-xs md:text-sm text-slate-500 font-mono uppercase tracking-widest">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Feature Grid (Portals) */}
            <section className="py-32 relative z-10">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
                        
                        {/* Card 1: AI */}
                        <div className="group relative p-1 rounded-3xl bg-gradient-to-b from-white/10 to-white/5 hover:from-indigo-500/50 hover:to-purple-600/50 transition-all duration-500">
                            <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/20 to-purple-600/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative h-full bg-[#0a0a0a] rounded-[1.4rem] p-8 overflow-hidden flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-500">
                                        <Brain className="w-7 h-7" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-3">{t.features.aiTitle}</h3>
                                    <p className="text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                                        {t.features.aiDescription}
                                    </p>
                                </div>
                                <div className="mt-8 flex items-center text-indigo-400 text-sm font-bold uppercase tracking-wider group-hover:text-indigo-300">
                                    <span>Meet Tutors</span> <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>

                        {/* Card 2: Coding (Featured) */}
                        <div className="md:-mt-8 group relative p-1 rounded-3xl bg-gradient-to-b from-cyan-500/30 to-blue-600/30 hover:from-cyan-400 hover:to-blue-600 transition-all duration-500 shadow-2xl shadow-cyan-900/20">
                            <div className="absolute inset-0 bg-gradient-to-b from-cyan-400/30 to-blue-600/30 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative h-full bg-[#0a0a0a] rounded-[1.4rem] p-8 overflow-hidden flex flex-col justify-between">
                                <div className="absolute top-0 right-0 p-4">
                                    <div className="bg-cyan-500 text-black text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                                        Popular
                                    </div>
                                </div>
                                <div>
                                    <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-6 group-hover:scale-110 group-hover:bg-cyan-500 group-hover:text-black transition-all duration-500">
                                        <Code2 className="w-7 h-7" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-3">{t.features.codingTitle}</h3>
                                    <p className="text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                                        {t.features.codingDescription}
                                    </p>
                                </div>
                                <div className="mt-8 flex items-center text-cyan-400 text-sm font-bold uppercase tracking-wider group-hover:text-cyan-300">
                                    <span>Start Coding</span> <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>

                        {/* Card 3: Art */}
                        <div className="group relative p-1 rounded-3xl bg-gradient-to-b from-white/10 to-white/5 hover:from-pink-500/50 hover:to-rose-600/50 transition-all duration-500">
                            <div className="absolute inset-0 bg-gradient-to-b from-pink-500/20 to-rose-600/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="relative h-full bg-[#0a0a0a] rounded-[1.4rem] p-8 overflow-hidden flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 mb-6 group-hover:scale-110 group-hover:bg-pink-500 group-hover:text-white transition-all duration-500">
                                        <Palette className="w-7 h-7" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-3">{t.features.artTitle}</h3>
                                    <p className="text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                                        {t.features.artDescription}
                                    </p>
                                </div>
                                <div className="mt-8 flex items-center text-pink-400 text-sm font-bold uppercase tracking-wider group-hover:text-pink-300">
                                    <span>Enter Atelier</span> <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 border-t border-white/5 bg-[#0a0a0a] relative z-10">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                        <Sparkles className="w-4 h-4" />
                        <span className="font-bold tracking-tight">Rise Path</span>
                    </div>
                    <p className="text-slate-600 text-sm font-mono">{t.footer}</p>
                    <div className="flex gap-6 text-slate-600">
                        <Globe className="w-5 h-5 hover:text-white cursor-pointer transition-colors" />
                        <Zap className="w-5 h-5 hover:text-white cursor-pointer transition-colors" />
                    </div>
                </div>
            </footer>

        </div>
    );
};

export default LandingView;
