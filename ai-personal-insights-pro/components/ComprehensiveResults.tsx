
import React from 'react';
import { AssessmentProfile } from '../types';

interface ComprehensiveResultsProps {
  profile: AssessmentProfile;
  onRestart: () => void;
}

// 特性に応じたリッチなメタデータ定義
const getTraitBadge = (category: string, score: number) => {
  const isHigh = score > 50;
  const configs: Record<string, any> = {
    openness: {
      high: { label: 'ビジョナリー', sub: '想像力の開拓者', icon: 'fa-eye', colors: ['#f59e0b', '#ef4444'], colorClass: 'from-amber-500 to-red-500' },
      low: { label: 'プラグマティスト', sub: '現実的な実践者', icon: 'fa-compass', colors: ['#94a3b8', '#475569'], colorClass: 'from-slate-400 to-slate-600' }
    },
    conscientiousness: {
      high: { label: 'パーフェクトマスター', sub: '完遂のプロフェッショナル', icon: 'fa-check-double', colors: ['#3b82f6', '#4f46e5'], colorClass: 'from-blue-500 to-indigo-600' },
      low: { label: 'フリースピリット', sub: '柔軟な即興家', icon: 'fa-wind', colors: ['#38bdf8', '#0ea5e9'], colorClass: 'from-sky-400 to-sky-600' }
    },
    extraversion: {
      high: { label: 'ソーシャル・スター', sub: 'エネルギーの源泉', icon: 'fa-bolt', colors: ['#fbbf24', '#f59e0b'], colorClass: 'from-yellow-400 to-amber-500' },
      low: { label: 'ディープ・オブザーバー', sub: '内省的観察者', icon: 'fa-moon', colors: ['#312e81', '#1e1b4b'], colorClass: 'from-indigo-900 to-slate-900' }
    },
    agreeableness: {
      high: { label: '共感の守護者', sub: '調和をもたらす者', icon: 'fa-hand-holding-heart', colors: ['#f472b6', '#e11d48'], colorClass: 'from-pink-400 to-rose-600' },
      low: { label: 'ロジカル・ディレクター', sub: '合理的な意思決定者', icon: 'fa-scale-balanced', colors: ['#10b981', '#059669'], colorClass: 'from-emerald-500 to-emerald-700' }
    },
    neuroticism: {
      high: { label: 'センシティブ・ガード', sub: '微細な変化を捉える感性', icon: 'fa-shield-heart', colors: ['#a855f7', '#6366f1'], colorClass: 'from-purple-500 to-indigo-500' },
      low: { label: 'アイアン・マインド', sub: '揺るぎない精神力', icon: 'fa-gem', colors: ['#22d3ee', '#0ea5e9'], colorClass: 'from-cyan-400 to-blue-500' }
    }
  };

  const trait = configs[category];
  return isHigh ? trait.high : trait.low;
};

const TraitBadgeCard: React.FC<{ category: string; score: number }> = ({ category, score }) => {
  const badge = getTraitBadge(category, score);
  const strokeDasharray = 251.2; // 2 * PI * 40 (r=40)
  const strokeDashoffset = strokeDasharray - (strokeDasharray * score) / 100;

  return (
    <div className="group relative flex-1 min-w-[200px]">
      {/* ホバー時の背景発光エフェクト */}
      <div className={`absolute -inset-1 bg-gradient-to-r ${badge.colorClass} rounded-[2rem] opacity-0 blur-xl group-hover:opacity-15 transition-opacity duration-700`}></div>
      
      {/* メインカードコンテナ */}
      <div className="relative bg-white border border-slate-100 rounded-[2rem] p-6 shadow-xl shadow-slate-200/30 flex flex-col items-center text-center transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl h-full">
        
        {/* カテゴリヘッダー */}
        <div className="w-full flex justify-between items-center mb-6">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">{category}</span>
          <div className="flex items-center space-x-1">
            <span className="text-xs font-mono font-black text-slate-900">{score}</span>
            <span className="text-[8px] font-black text-slate-300">LV</span>
          </div>
        </div>

        {/* ゲージ & アイコン（中央配置を徹底） */}
        <div className="relative w-28 h-28 mb-6 flex items-center justify-center">
          <svg className="absolute inset-0 w-28 h-28 -rotate-90">
            {/* ゲージ背景 */}
            <circle cx="56" cy="56" r="45" fill="none" stroke="#f1f5f9" strokeWidth="6" />
            {/* アクティブゲージ */}
            <circle 
              cx="56" cy="56" r="45" 
              fill="none" 
              stroke={`url(#grad-${category})`}
              strokeWidth="7" 
              strokeDasharray={282.6} // 2 * PI * 45
              strokeDashoffset={282.6 - (282.6 * score) / 100}
              strokeLinecap="round"
              className="transition-all duration-[1.5s] ease-out"
            />
            <defs>
              <linearGradient id={`grad-${category}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={badge.colors[0]} />
                <stop offset="100%" stopColor={badge.colors[1]} />
              </linearGradient>
            </defs>
          </svg>
          
          {/* センターアイコンユニット */}
          <div className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${badge.colorClass} flex items-center justify-center text-2xl text-white shadow-lg z-10 group-hover:scale-110 transition-transform duration-500`}>
            <i className={`fas ${badge.icon}`}></i>
          </div>
        </div>

        {/* ラベル & 詳細テキスト */}
        <div className="space-y-2 mt-auto">
          <div className="text-xl font-black text-slate-800 leading-tight tracking-tight">
            {badge.label}
          </div>
          <div className="text-[11px] font-bold text-slate-400 leading-relaxed px-4 opacity-80 group-hover:opacity-100 transition-opacity">
            {badge.sub}
          </div>
        </div>

        {/* デコレーティブボトム */}
        <div className="mt-6 flex justify-center space-x-1">
          <div className="w-1 h-1 rounded-full bg-slate-200"></div>
          <div className="w-4 h-1 rounded-full bg-slate-100"></div>
          <div className="w-1 h-1 rounded-full bg-slate-200"></div>
        </div>
      </div>
    </div>
  );
};

const DetailedBar: React.FC<{ label: string; score: number; color: string; icon: string }> = ({ label, score, color, icon }) => (
  <div className="group space-y-3 p-5 bg-slate-50/50 rounded-2xl border border-transparent hover:border-white hover:bg-white hover:shadow-xl transition-all duration-500">
    <div className="flex justify-between items-center">
      <div className="flex items-center space-x-4">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white text-sm shadow-md`}>
          <i className={`fas ${icon}`}></i>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-none mb-1">Dimension Log</span>
          <span className="text-sm font-bold text-slate-700">{label}</span>
        </div>
      </div>
      <div className="text-2xl font-mono font-black text-slate-900">
        {score}<span className="text-xs opacity-20 ml-1">%</span>
      </div>
    </div>
    <div className="relative h-2 w-full bg-slate-200/50 rounded-full overflow-hidden">
      <div 
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-[2.5s] ease-out`} 
        style={{ width: `${score}%` }}
      />
    </div>
  </div>
);

const SectionHeader: React.FC<{ title: string; subtitle: string; icon: string }> = ({ title, subtitle, icon }) => (
  <div className="text-center space-y-4 mb-16 relative">
    <div className="inline-flex items-center justify-center w-12 h-12 bg-white rounded-2xl shadow-md border border-slate-50 text-indigo-500 mb-2">
      <i className={`fas ${icon} text-lg`}></i>
    </div>
    <div className="space-y-1">
      <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.5em]">{subtitle}</h2>
      <h3 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">{title}</h3>
    </div>
    <div className="w-8 h-1 bg-indigo-500/20 mx-auto rounded-full mt-4"></div>
  </div>
);

const ComprehensiveResults: React.FC<ComprehensiveResultsProps> = ({ profile, onRestart }) => {
  const advice = profile.aiAdvice;
  const typeConfigs: Record<string, { icon: string; bg: string; description: string }> = {
    '冒険家': { icon: 'fa-wind', bg: 'from-orange-400 to-red-500', description: '自由な発想と行動力で、未踏の領域を切り拓く開探者。' },
    '戦略家': { icon: 'fa-chess-knight', bg: 'from-blue-500 to-indigo-600', description: '論理的な分析と長期的な視点で、複雑な課題を解き明かす軍師。' },
    'サポーター': { icon: 'fa-hand-holding-heart', bg: 'from-pink-400 to-rose-500', description: '高い共感性と調和の精神で、チームの絆を強固にする調整役。' },
    '思想家': { icon: 'fa-lightbulb', bg: 'from-purple-500 to-indigo-700', description: '深い洞察と知的好奇心で、物事の本質を追究する哲学者。' },
    '職人': { icon: 'fa-cube', bg: 'from-amber-400 to-orange-500', description: '緻密な技術と集中力で、完璧な成果物を創り上げる専門家。' },
    'バランサー': { icon: 'fa-yin-yang', bg: 'from-green-400 to-emerald-600', description: '柔軟な適応力と安定感で、あらゆる環境に調和をもたらす万能型。' },
  };

  const config = typeConfigs[profile.personalityType] || { icon: 'fa-star', bg: 'from-indigo-500 to-purple-600', description: '独自のバランスを持つユニークな特性。' };

  return (
    <div className="max-w-6xl mx-auto space-y-32 pb-48 px-4">
      
      {/* 1. Hero Entrance */}
      <section className="min-h-[70vh] flex flex-col items-center justify-center text-center relative pt-8">
        <div className={`w-40 h-40 md:w-56 md:h-56 bg-gradient-to-br ${config.bg} rounded-[3rem] flex items-center justify-center text-6xl md:text-7xl text-white shadow-2xl animate-float relative z-10 mb-10`}>
          <i className={`fas ${config.icon}`}></i>
          <div className="absolute inset-0 rounded-[3rem] border-4 border-white/20 scale-110 animate-pulse"></div>
        </div>
        <div className="space-y-6 max-w-4xl">
          <div className="inline-flex items-center px-4 py-1.5 bg-slate-900 text-white rounded-full text-[10px] font-black uppercase tracking-[0.3em] mb-2 shadow-lg">
            Profile Protocol V2.4
          </div>
          <h1 className="text-5xl md:text-8xl font-black text-slate-900 tracking-tighter leading-none filter drop-shadow-sm">
            {profile.personalityType}
          </h1>
          <p className="text-lg md:text-2xl text-slate-500 font-medium italic leading-relaxed opacity-80 max-w-2xl mx-auto">
            "{config.description}"
          </p>
        </div>
      </section>

      {/* 2. Core Matrix: Refined Grid */}
      <section>
        <SectionHeader title="Core Archetype" subtitle="Cognitive Structure" icon="fa-atom" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
          <TraitBadgeCard category="openness" score={profile.scores.openness} />
          <TraitBadgeCard category="conscientiousness" score={profile.scores.conscientiousness} />
          <TraitBadgeCard category="extraversion" score={profile.scores.extraversion} />
          <TraitBadgeCard category="agreeableness" score={profile.scores.agreeableness} />
          <TraitBadgeCard category="neuroticism" score={profile.scores.neuroticism} />
        </div>
      </section>

      {/* 3. Relational Synergy */}
      <section>
        <SectionHeader title="Relational Sync" subtitle="Interpersonal Logic" icon="fa-heart" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 bg-slate-900 p-10 md:p-14 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-700"></div>
            <h4 className="text-[10px] font-black text-rose-400 uppercase tracking-[0.4em] mb-12 flex items-center">
              <span className="w-8 h-px bg-rose-400/40 mr-4"></span> Relationship Mode
            </h4>
            <div className="space-y-10 relative z-10">
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Signature Style</span>
                <p className="text-2xl md:text-3xl font-black leading-tight tracking-tight">{advice?.relationshipAnalysis.style}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Optimal Partnership</span>
                <p className="text-lg font-bold text-slate-300 leading-relaxed border-l-2 border-rose-500/50 pl-6 italic">
                  {advice?.relationshipAnalysis.idealPartner}
                </p>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 bg-white p-10 md:p-14 rounded-[3.5rem] border border-slate-100 shadow-xl flex flex-col justify-center text-center relative">
             <i className="fas fa-quote-left text-3xl text-indigo-50 mb-8 mx-auto"></i>
             <p className="text-slate-600 font-medium leading-relaxed italic text-xl px-2">
               "{advice?.relationshipAnalysis.advice}"
             </p>
             <div className="mt-10 pt-8 border-t border-slate-50">
               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.3em]">AI Relational Guidance</span>
             </div>
          </div>
        </div>
      </section>

      {/* 4. Professional Identity */}
      <section>
        <SectionHeader title="System Identity" subtitle="Career Capability" icon="fa-briefcase" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-[3.5rem] p-10 md:p-14 border border-slate-100 shadow-xl space-y-12">
            <div>
              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-2">Professional Role</span>
              <h5 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter leading-none">
                {advice?.businessPartnership.role}
              </h5>
            </div>
            <div className="grid sm:grid-cols-2 gap-8 pt-6 border-t border-slate-50">
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">High Synergy Type</span>
                <p className="font-bold text-slate-700 leading-relaxed">{advice?.businessPartnership.bestSync}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest block">Risk/Warning</span>
                <p className="font-bold text-slate-700 leading-relaxed">{advice?.businessPartnership.warning}</p>
              </div>
            </div>
          </div>
          <div className={`bg-gradient-to-br ${config.bg} rounded-[3.5rem] p-10 md:p-14 text-white shadow-xl relative overflow-hidden flex flex-col group`}>
            <h4 className="text-[10px] font-black text-white/60 uppercase tracking-[0.4em] mb-12">Latent Essence</h4>
            <div className="relative z-10 mt-auto">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-xl mb-6 shadow-inner">
                <i className="fas fa-sparkles animate-pulse"></i>
              </div>
              <h5 className="text-3xl font-black mb-3 tracking-tight leading-none">{advice?.hiddenTalent.title}</h5>
              <p className="text-white/90 text-sm leading-relaxed font-medium italic opacity-80">{advice?.hiddenTalent.description}</p>
            </div>
            <i className="fas fa-fingerprint text-white/5 text-[18rem] absolute -bottom-16 -right-16 rotate-12"></i>
          </div>
        </div>
      </section>

      {/* 5. Cognitive Lab */}
      <section className="bg-slate-950 -mx-4 md:-mx-8 px-6 md:px-20 py-32 rounded-[4rem] text-white overflow-hidden relative shadow-2xl">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px] -mr-40 -mt-40"></div>
        <SectionHeader title="Insights Lab" subtitle="AI Deep Diagnostics" icon="fa-brain" />
        <div className="grid lg:grid-cols-2 gap-12 mt-16 relative z-10">
          <div className="space-y-12">
            <h4 className="text-indigo-400 font-black uppercase tracking-[0.5em] text-[10px] flex items-center">
              <span className="w-12 h-px bg-indigo-400/40 mr-4"></span> Core Capabilities
            </h4>
            <div className="grid gap-6">
              {advice?.strengths.map((s, i) => (
                <div key={i} className="group bg-white/5 border border-white/10 p-8 rounded-[2rem] hover:bg-white/[0.08] transition-all">
                  <h5 className="text-xl font-black text-white mb-2 tracking-tight">{s.title}</h5>
                  <p className="text-slate-400 text-sm leading-relaxed font-medium">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-12">
            <h4 className="text-purple-400 font-black uppercase tracking-[0.5em] text-[10px] flex items-center">
              <span className="w-12 h-px bg-purple-400/40 mr-4"></span> Strategic Growth
            </h4>
            <div className="grid gap-6">
              {advice?.growthTips.map((s, i) => (
                <div key={i} className="group bg-white/5 border border-white/10 p-8 rounded-[2rem] hover:bg-white/[0.08] transition-all">
                  <h5 className="text-xl font-black text-white mb-2 tracking-tight">{s.title}</h5>
                  <p className="text-slate-400 text-sm leading-relaxed font-medium">{s.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Technical Breakdown */}
      <section className="pt-24 border-t border-slate-100">
        <div className="max-w-4xl mx-auto space-y-16">
          <div className="text-center">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mb-4">Baseline Calibration</h4>
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">ビッグファイブ詳細解析ログ</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 bg-white p-8 md:p-12 rounded-[3.5rem] shadow-xl shadow-slate-200/40 border border-slate-50">
            <DetailedBar label="Openness / 開放性" score={profile.scores.openness} color="from-orange-400 to-amber-500" icon="fa-eye" />
            <DetailedBar label="Conscientiousness / 誠実性" score={profile.scores.conscientiousness} color="from-blue-500 to-indigo-600" icon="fa-check-double" />
            <DetailedBar label="Extraversion / 外向性" score={profile.scores.extraversion} color="from-yellow-400 to-orange-500" icon="fa-bolt" />
            <DetailedBar label="Agreeableness / 協調性" score={profile.scores.agreeableness} color="from-pink-400 to-rose-500" icon="fa-handshake-simple" />
            <DetailedBar label="Neuroticism / 繊細さ" score={profile.scores.neuroticism} color="from-purple-400 to-indigo-500" icon="fa-wave-square" />
          </div>
        </div>
      </section>

      {/* Final Action CTA */}
      <section className="text-center pt-20">
        <div className="max-w-3xl mx-auto space-y-16">
          <h2 className="text-4xl md:text-6xl font-black text-slate-900 leading-tight tracking-tighter">
            あなたの物語を、<br/>
            ここからアップデートする。
          </h2>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-6">
            <button className="px-14 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] hover:scale-105 transition-all shadow-xl active:scale-95">
              診断レポートを保存
            </button>
            <button 
              onClick={onRestart} 
              className="px-14 py-6 bg-white text-slate-500 border-2 border-slate-100 rounded-[2rem] font-black text-[11px] uppercase tracking-[0.3em] hover:bg-slate-50 transition-all active:scale-95"
            >
              再診断を実行
            </button>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(2deg); }
          50% { transform: translateY(-12px) rotate(4deg); }
        }
        .animate-float { animation: float 6s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default ComprehensiveResults;
