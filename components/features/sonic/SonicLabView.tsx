import React from 'react';
import { 
  Activity, Mic2, Waves, Sliders, Play, Speaker, 
  Music, Radio, Headphones, Settings, Disc
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface SonicLabViewProps {
  onNavigate: (view: ViewState) => void;
}

const ModuleCard = ({ 
  title, subtitle, icon: Icon, color, onClick, ctaLabel
}: { 
  title: string; subtitle: string; icon: any; color: string; onClick?: () => void; ctaLabel: string;
}) => (
  <div 
    onClick={onClick}
    className={`bg-slate-900 border border-slate-800 rounded-2xl p-6 cursor-pointer hover:border-${color}-500/50 hover:shadow-[0_0_20px_rgba(0,0,0,0.5)] transition-all group relative overflow-hidden`}
  >
    <div className={`absolute top-0 right-0 p-12 opacity-5 -mr-4 -mt-4 text-${color}-500 group-hover:scale-110 transition-transform`}>
       <Icon size={100} />
    </div>
    
    <div className={`w-12 h-12 rounded-xl bg-${color}-500/10 flex items-center justify-center text-${color}-500 mb-4 border border-${color}-500/20 group-hover:bg-${color}-500 group-hover:text-black transition-colors`}>
       <Icon size={24} />
    </div>
    
    <h3 className="text-xl font-bold text-white mb-1 font-mono">{title}</h3>
    <p className="text-slate-400 text-sm">{subtitle}</p>
    
    <div className="mt-6 flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider group-hover:text-white transition-colors">
       <span>{ctaLabel}</span> <Play size={10} fill="currentColor" />
    </div>
  </div>
);

const SonicLabView: React.FC<SonicLabViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();

  const copy = {
    en: {
      headerLabel: 'Audio Engineering 101',
      headerTitle: 'Sonic Lab',
      masterOutput: 'Master Output',
      interactiveLesson: 'Interactive Lesson',
      featuredTitle: 'The Architecture of Sound',
      featuredDescription: 'Understanding oscillators, filters, and envelopes. Build your first synthesizer patch from scratch.',
      openSynth: 'Open Synthesizer',
      enterLab: 'Enter Lab',
      footer: 'Rise Path Audio Engine v2.0 • 48kHz / 24bit',
      modules: [
        { title: 'Rhythm Construction', subtitle: 'BPM, Time Signatures, and Drum Patterns.' },
        { title: 'Physics of Audio', subtitle: 'Frequency, Amplitude, and Phase relationships.' },
        { title: 'The Mixing Console', subtitle: 'EQ, Compression, and spatial balance.' },
        { title: 'Microphone Tech', subtitle: 'Dynamic vs Condenser. Pickup patterns.' }
      ]
    },
    jp: {
      headerLabel: 'オーディオ工学 101',
      headerTitle: 'ソニックラボ',
      masterOutput: 'マスター出力',
      interactiveLesson: 'インタラクティブレッスン',
      featuredTitle: 'サウンドの設計図',
      featuredDescription: 'オシレーター、フィルター、エンベロープを理解し、初めてのシンセパッチを作ります。',
      openSynth: 'シンセを開く',
      enterLab: 'ラボへ',
      footer: 'Rise Path Audio Engine v2.0 • 48kHz / 24bit',
      modules: [
        { title: 'リズム構築', subtitle: 'BPM、拍子、ドラムパターン。' },
        { title: '音の物理', subtitle: '周波数、振幅、位相の関係。' },
        { title: 'ミキシングコンソール', subtitle: 'EQ、コンプレッション、空間バランス。' },
        { title: 'マイク技術', subtitle: 'ダイナミック vs コンデンサー。指向性。' }
      ]
    }
  } as const;

  const t = copy[language];

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans p-6 md:p-8">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-12 border-b border-slate-800 pb-6">
         <div>
            <div className="flex items-center gap-3 mb-2">
               <Activity size={24} className="text-cyan-400" />
               <span className="text-cyan-400 font-mono text-xs uppercase tracking-[0.2em]">{t.headerLabel}</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">{t.headerTitle}</h1>
         </div>
         <div className="flex gap-4">
            <div className="text-right hidden md:block">
               <div className="text-xs text-slate-500 font-mono">{t.masterOutput}</div>
               <div className="flex gap-1 items-end h-8 mt-1">
                  {[40, 60, 30, 80, 50, 90, 20, 60].map((h, i) => (
                     <div key={i} className="w-1 bg-cyan-500 rounded-full animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }}></div>
                  ))}
               </div>
            </div>
         </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
         
         {/* 1. Synthesis (The Featured Module) */}
         <div 
            onClick={() => onNavigate(ViewState.SONIC_SYNTH)}
            className="col-span-1 md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-8 cursor-pointer hover:border-cyan-500/50 relative overflow-hidden group shadow-2xl"
         >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyan-900/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <div className="flex flex-col md:flex-row gap-8 relative z-10 h-full">
               <div className="flex-1 flex flex-col justify-between">
                  <div>
                     <span className="bg-cyan-500/20 text-cyan-300 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider border border-cyan-500/30">
                        {t.interactiveLesson}
                     </span>
                     <h2 className="text-3xl font-bold text-white mt-4 mb-2">{t.featuredTitle}</h2>
                     <p className="text-slate-400 text-lg leading-relaxed">
                        {t.featuredDescription}
                     </p>
                  </div>
                  <button className="mt-8 bg-cyan-600 text-black px-6 py-3 rounded-full font-bold hover:bg-cyan-500 hover:scale-105 transition-all flex items-center gap-2 w-max">
                     {t.openSynth} <Waves size={18} />
                  </button>
               </div>
               
               {/* Visual: Simulated Synth UI */}
               <div className="w-full md:w-64 bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col gap-4 opacity-80 group-hover:opacity-100 transition-opacity">
                  <div className="h-24 bg-slate-900 rounded border border-slate-800 relative overflow-hidden">
                     <svg className="absolute inset-0 w-full h-full text-cyan-500" preserveAspectRatio="none">
                        <path d="M0 50 Q 25 0, 50 50 T 100 50" fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                     </svg>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                     {[1,2,3].map(i => (
                        <div key={i} className="aspect-square rounded-full border border-slate-700 bg-slate-800 relative">
                           <div className="absolute top-1/2 left-1/2 w-1 h-1/2 bg-slate-500 origin-top transform -rotate-45"></div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </div>

         {/* 2. Rhythm & Beat */}
         <ModuleCard
            title={t.modules[0].title}
            subtitle={t.modules[0].subtitle}
            icon={Disc}
            color="pink"
            ctaLabel={t.enterLab}
            onClick={() => onNavigate(ViewState.SONIC_SYNTH)}
         />

         {/* 3. Physics of Audio */}
         <ModuleCard
            title={t.modules[1].title}
            subtitle={t.modules[1].subtitle}
            icon={Activity}
            color="purple"
            ctaLabel={t.enterLab}
            onClick={() => onNavigate(ViewState.SONIC_SYNTH)}
         />

         {/* 4. Mixing Console */}
         <ModuleCard
            title={t.modules[2].title}
            subtitle={t.modules[2].subtitle}
            icon={Sliders}
            color="yellow"
            ctaLabel={t.enterLab}
            onClick={() => onNavigate(ViewState.SONIC_SYNTH)}
         />

         {/* 5. Microphone Tech */}
         <ModuleCard
            title={t.modules[3].title}
            subtitle={t.modules[3].subtitle}
            icon={Mic2}
            color="red"
            ctaLabel={t.enterLab}
            onClick={() => onNavigate(ViewState.SONIC_SYNTH)}
         />

      </div>

      {/* Footer Info */}
      <div className="mt-12 text-center text-slate-600 text-xs font-mono uppercase tracking-widest">
         {t.footer}
      </div>
    </div>
  );
};

export default SonicLabView;
