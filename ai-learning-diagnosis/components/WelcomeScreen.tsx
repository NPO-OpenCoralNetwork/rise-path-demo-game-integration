import React from 'react';
import { BrainCircuit, Sparkles, ArrowRight, Zap } from 'lucide-react';

interface WelcomeScreenProps {
    onStart: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-4xl mx-auto">
            <div className="mb-8 relative">
                <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 rounded-full"></div>
                <BrainCircuit size={80} className="text-blue-400 relative z-10 animate-pulse" />
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
                AI Learning <span className="gradient-text">Diagnosis</span>
            </h1>
            
            <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-2xl leading-relaxed">
                AIがあなたの潜在的な学習スタイルを即座にシミュレーション・分析します。
                ボタンを押すだけで、パーソナライズされた成長戦略レポートを作成します。
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 w-full">
                <div className="glass-panel p-6 rounded-xl flex flex-col items-center">
                    <Zap className="text-yellow-400 mb-3" size={24} />
                    <h3 className="font-semibold text-slate-200">Instant</h3>
                    <p className="text-sm text-slate-500 mt-2">待ち時間なしで即座に分析</p>
                </div>
                <div className="glass-panel p-6 rounded-xl flex flex-col items-center">
                    <BrainCircuit className="text-purple-400 mb-3" size={24} />
                    <h3 className="font-semibold text-slate-200">Deep Analysis</h3>
                    <p className="text-sm text-slate-500 mt-2">性格特性まで深く洞察</p>
                </div>
                <div className="glass-panel p-6 rounded-xl flex flex-col items-center">
                    <div className="text-green-400 mb-3 font-bold text-xl">%</div>
                    <h3 className="font-semibold text-slate-200">Optimization</h3>
                    <p className="text-sm text-slate-500 mt-2">最適な学習配分を提案</p>
                </div>
            </div>

            <button 
                onClick={onStart}
                className="group relative px-10 py-5 bg-slate-100 text-slate-900 font-bold rounded-full text-xl shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_40px_rgba(255,255,255,0.6)] hover:scale-105 transition-all duration-300 flex items-center gap-3 overflow-hidden"
            >
                <span className="relative z-10">今すぐ診断する</span>
                <ArrowRight className="relative z-10 group-hover:translate-x-1 transition-transform" />
                <div className="absolute inset-0 bg-gradient-to-r from-blue-200 to-purple-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </button>
        </div>
    );
};

export default WelcomeScreen;