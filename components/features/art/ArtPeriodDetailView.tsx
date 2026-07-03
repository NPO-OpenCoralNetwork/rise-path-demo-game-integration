import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Play, Pause, Volume2, Maximize2, Move, 
  Layers, Eye, BookOpen, Star, ArrowDown, ChevronRight
} from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtPeriodDetailViewProps {
  onBack: () => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

// Mock Audio Player
const AudioGuide = ({ title, duration }: { title: string, duration: string }) => {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="bg-[#2a2624] border border-stone-700 rounded-full pr-6 p-2 flex items-center gap-4 w-full max-w-sm hover:border-stone-500 transition-colors cursor-pointer group" onClick={() => setPlaying(!playing)}>
      <button className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${playing ? 'bg-orange-600 text-white' : 'bg-stone-200 text-stone-900 group-hover:bg-white'}`}>
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-1" />}
      </button>
      <div className="flex-1">
        <div className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-0.5">Audio Guide</div>
        <div className="text-sm text-stone-300 font-serif italic">{title}</div>
      </div>
      <div className="text-xs text-stone-500 font-mono">{duration}</div>
    </div>
  );
};

const ArtPeriodDetailView: React.FC<ArtPeriodDetailViewProps> = ({ onBack, language, setLanguage }) => {
  const [showPerspective, setShowPerspective] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(scrolled / maxScroll);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const content = {
    en: {
      back: "Back to Timeline",
      golden: "The Golden Age",
      title: "The Renaissance",
      desc: <>The rebirth of classical philosophy, literature, and art. <br/> A shift from the divine to the <span className="text-white border-b border-orange-500">human</span>.</>,
      audio: "Introduction: The Awakening",
      humanism: {
        title: "Humanism",
        p1: "Medieval art focused on the spiritual world—figures were flat, symbolic, and unearthly. Renaissance artists turned their gaze to **nature and humanity**.",
        p2: "Influenced by rediscovered Greek and Roman texts, they celebrated the dignity of the human individual. Bodies gained weight, faces showed emotion, and the world became 3D.",
        quote: '"Man is the measure of all things."',
        quoteAuthor: "— Protagoras",
        monaDesc: "Notice the *Sfumato* technique—soft, smoky transitions between colors that eliminate sharp lines."
      },
      perspective: {
        title: "Linear Perspective",
        desc: "Mathematical precision meets art. Artists learned to create the illusion of depth by having all parallel lines converge at a single **Vanishing Point**.",
        btnShow: "Reveal Perspective",
        btnHide: "Hide Geometry",
        caption: "Notice how all architectural lines converge exactly behind Christ's head, making him the mathematical and spiritual center of the universe."
      },
      trinity: "The High Trinity",
      masters: [
        { name: "Leonardo", role: "The Scientist", desc: "Obsessed with nature, anatomy, and mechanics. Painted very little, but perfected everything." },
        { name: "Michelangelo", role: "The Sculptor", desc: "Believed the figure was trapped inside the stone. Master of the heroic, muscular human form." },
        { name: "Raphael", role: "The Synthesizer", desc: "Combined Leonardo's softness with Michelangelo's strength. The master of grace and harmony." }
      ],
      next: {
        label: "Course Complete",
        title: "What comes next?",
        desc: "The balance and harmony of the Renaissance eventually gave way to the drama, emotion, and motion of the **Baroque**.",
        btnReview: "Review Notes",
        btnReturn: "Return to Timeline"
      }
    },
    jp: {
      back: "年表に戻る",
      golden: "黄金時代",
      title: "ルネサンス",
      desc: <>古典哲学、文学、芸術の再生。<br/>神から<span className="text-white border-b border-orange-500">人間</span>へのシフト。</>,
      audio: "イントロダクション：覚醒",
      humanism: {
        title: "人文主義",
        p1: "中世の芸術は精神世界に焦点を当てており、人物は平面的で象徴的でした。ルネサンスの芸術家たちは、その眼差しを**自然と人間**に向けました。",
        p2: "再発見されたギリシャ・ローマの文献に影響を受け、彼らは人間の尊厳を称えました。身体は重みを持ち、顔は感情を表し、世界は3次元になりました。",
        quote: "「人間は万物の尺度である」",
        quoteAuthor: "— プロタゴラス",
        monaDesc: "「スフマート」技法に注目してください。色と色の境界をぼかし、輪郭線をなくす柔らかく煙のような表現です。"
      },
      perspective: {
        title: "線遠近法",
        desc: "数学的正確さと芸術の融合。画家たちは、すべての平行線が単一の**消失点**に収束するように描くことで、奥行きの錯覚を作り出すことを学びました。",
        btnShow: "遠近法を表示",
        btnHide: "幾何学を隠す",
        caption: "すべての建築的な線がキリストの頭の真後ろに収束し、彼を宇宙の数学的かつ精神的な中心にしていることに注目してください。"
      },
      trinity: "三大巨匠",
      masters: [
        { name: "レオナルド", role: "科学者", desc: "自然、解剖学、力学に執着。寡作であったが、すべてを完璧にした。" },
        { name: "ミケランジェロ", role: "彫刻家", desc: "像は石の中に閉じ込められていると信じていた。英雄的で筋肉質な人体の巨匠。" },
        { name: "ラファエロ", role: "統合者", desc: "レオナルドの柔らかさとミケランジェロの力強さを融合。優美と調和の巨匠。" }
      ],
      next: {
        label: "コース完了",
        title: "次に来るものは？",
        desc: "ルネサンスの均衡と調和は、やがて**バロック**のドラマ、感情、動きへと道を譲ります。",
        btnReview: "ノートを見直す",
        btnReturn: "年表に戻る"
      }
    }
  };

  const t = content[language];

  // Formatting helpers for bold text in descriptions
  const renderDesc = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/);
    return parts.map((part, i) => 
      part.startsWith('**') && part.endsWith('**') 
        ? <strong key={i}>{part.slice(2, -2)}</strong> 
        : part
    );
  };

  const renderMonaDesc = (text: string) => {
     const parts = text.split(/(\*.*?\*)/);
     return parts.map((part, i) => 
       part.startsWith('*') && part.endsWith('*') 
         ? <em key={i} className="text-white not-italic">{part.slice(1, -1)}</em> 
         : part
     );
  };

  const MASTER_IMGS = [
     "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Leonardo_da_Vinci_-_Saint_John_the_Baptist_C2RMF_retouched.jpg/800px-Leonardo_da_Vinci_-_Saint_John_the_Baptist_C2RMF_retouched.jpg",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Michelangelo_Dying_Slave_Louvre_MR1590.jpg/800px-Michelangelo_Dying_Slave_Louvre_MR1590.jpg",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Raffael_054.jpg/800px-Raffael_054.jpg"
  ];

  return (
    <div className="min-h-screen bg-[#1c1917] text-stone-200 font-sans selection:bg-orange-900/50 selection:text-white">
      
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 h-1 bg-orange-600 z-50 transition-all duration-100" style={{ width: `${scrollProgress * 100}%` }}></div>

      {/* Floating Header */}
      <div className="fixed top-0 left-0 w-full p-6 z-40 mix-blend-difference text-white flex justify-between items-center pointer-events-none">
        <button onClick={onBack} className="pointer-events-auto flex items-center gap-2 hover:opacity-70 transition-opacity">
          <ArrowLeft size={24} /> <span className="font-serif italic hidden md:inline">{t.back}</span>
        </button>
        <div className="flex items-center gap-4 pointer-events-auto">
            <div className="flex bg-white/20 rounded-full p-1 border border-white/30 backdrop-blur-sm">
               <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}>EN</button>
               <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}>JP</button>
            </div>
            <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">1400 — 1600</span>
        </div>
      </div>

      {/* 1. HERO SECTION */}
      <section className="relative h-[110vh] w-full overflow-hidden flex flex-col justify-center items-center">
        {/* Parallax Background */}
        <div className="absolute inset-0 z-0">
           <img 
             src="https://upload.wikimedia.org/wikipedia/commons/4/49/0_The_School_of_Athens_-_Raphael_-_Stanza_della_Segnatura.jpg" 
             alt="School of Athens" 
             className="w-full h-full object-cover scale-110 opacity-60"
             style={{ transform: `translateY(${scrollProgress * 100}px) scale(1.1)` }}
           />
           <div className="absolute inset-0 bg-gradient-to-b from-[#1c1917]/30 via-transparent to-[#1c1917]"></div>
        </div>

        <div className="relative z-10 text-center max-w-4xl px-6 -mt-20">
           <span className="block text-orange-500 font-bold text-sm uppercase tracking-[0.4em] mb-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">{t.golden}</span>
           <h1 className="font-serif text-6xl md:text-9xl text-white mb-8 italic animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-100">
             {t.title}
           </h1>
           <p className="text-xl md:text-2xl text-stone-300 font-light leading-relaxed max-w-2xl mx-auto mb-12 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
             {t.desc}
           </p>
           
           <div className="flex justify-center animate-in fade-in zoom-in duration-1000 delay-500">
             <AudioGuide title={t.audio} duration="03:45" />
           </div>
        </div>

        <div className="absolute bottom-10 animate-bounce text-stone-500">
           <ArrowDown size={24} />
        </div>
      </section>

      {/* 2. CONTEXT: HUMANISM */}
      <section className="py-32 px-6 md:px-20 max-w-7xl mx-auto">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
            <div>
               <span className="text-6xl text-stone-700 font-serif block mb-4">I.</span>
               <h2 className="font-serif text-5xl text-white mb-8">{t.humanism.title}</h2>
               <p className="text-lg text-stone-400 leading-relaxed mb-6 font-light">
                  {renderDesc(t.humanism.p1)}
               </p>
               <p className="text-lg text-stone-400 leading-relaxed mb-8 font-light">
                  {renderDesc(t.humanism.p2)}
               </p>
               <div className="pl-6 border-l border-orange-600">
                  <p className="text-2xl font-serif italic text-white">
                     {t.humanism.quote}
                  </p>
                  <p className="text-sm text-stone-500 mt-2 uppercase tracking-wider">{t.humanism.quoteAuthor}</p>
               </div>
            </div>
            <div className="relative">
               <div className="aspect-[3/4] overflow-hidden rounded-sm">
                  <img 
                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/800px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg" 
                    alt="Mona Lisa" 
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-1000"
                  />
               </div>
               <div className="absolute -bottom-6 -left-6 bg-[#2a2624] p-6 max-w-xs border border-stone-800 shadow-2xl">
                  <h3 className="font-serif text-xl text-white italic">Mona Lisa</h3>
                  <p className="text-xs text-stone-500 mt-1 uppercase tracking-wider">Leonardo da Vinci, 1503</p>
                  <p className="text-sm text-stone-400 mt-3 leading-relaxed">
                     {renderMonaDesc(t.humanism.monaDesc)}
                  </p>
               </div>
            </div>
         </div>
      </section>

      {/* 3. TECHNIQUE: PERSPECTIVE (Interactive) */}
      <section className="py-32 bg-[#100e0d] border-y border-stone-800">
         <div className="max-w-7xl mx-auto px-6 text-center mb-16">
            <span className="text-6xl text-stone-800 font-serif block mb-4">II.</span>
            <h2 className="font-serif text-5xl text-white mb-6">{t.perspective.title}</h2>
            <p className="text-lg text-stone-400 font-light max-w-2xl mx-auto">
               {renderDesc(t.perspective.desc)}
            </p>
         </div>

         <div className="relative max-w-6xl mx-auto px-6">
            <div className="relative aspect-video w-full overflow-hidden border border-stone-800 group select-none">
               {/* Base Image */}
               <img 
                 src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg/1280px-The_Last_Supper_-_Leonardo_Da_Vinci_-_High_Resolution_32x16.jpg" 
                 alt="The Last Supper" 
                 className={`w-full h-full object-cover transition-all duration-700 ${showPerspective ? 'brightness-50 grayscale-[0.3]' : ''}`}
               />

               {/* Perspective Overlay Lines (SVG) */}
               <svg 
                  className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-700 ${showPerspective ? 'opacity-100' : 'opacity-0'}`}
                  viewBox="0 0 1280 640"
                  preserveAspectRatio="xMidYMid slice"
               >
                  {/* Vanishing Point */}
                  <circle cx="640" cy="300" r="5" fill="red" className="animate-pulse" />
                  
                  {/* Rays */}
                  <line x1="0" y1="0" x2="640" y2="300" stroke="red" strokeWidth="2" strokeOpacity="0.6" />
                  <line x1="1280" y1="0" x2="640" y2="300" stroke="red" strokeWidth="2" strokeOpacity="0.6" />
                  <line x1="0" y1="640" x2="640" y2="300" stroke="red" strokeWidth="2" strokeOpacity="0.6" />
                  <line x1="1280" y1="640" x2="640" y2="300" stroke="red" strokeWidth="2" strokeOpacity="0.6" />
                  
                  {/* Ceiling lines approximate */}
                  <line x1="200" y1="0" x2="640" y2="300" stroke="red" strokeWidth="1" strokeOpacity="0.4" />
                  <line x1="1080" y1="0" x2="640" y2="300" stroke="red" strokeWidth="1" strokeOpacity="0.4" />
               </svg>

               {/* Toggle Control */}
               <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
                  <button 
                    onClick={() => setShowPerspective(!showPerspective)}
                    className="bg-white text-black px-8 py-3 rounded-full font-bold flex items-center gap-3 hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                  >
                     {showPerspective ? (
                        <><Eye size={20} className="text-stone-400" /> {t.perspective.btnHide}</>
                     ) : (
                        <><Move size={20} className="text-orange-600" /> {t.perspective.btnShow}</>
                     )}
                  </button>
               </div>
            </div>
            
            <div className="mt-6 flex justify-between items-start text-xs text-stone-500 font-mono">
               <div>FIG 2.1: THE LAST SUPPER</div>
               <div className="max-w-md text-right hidden md:block">
                  {t.perspective.caption}
               </div>
            </div>
         </div>
      </section>

      {/* 4. THE MASTERS */}
      <section className="py-32 px-6 max-w-7xl mx-auto">
         <span className="text-6xl text-stone-700 font-serif block mb-12 text-center">III.</span>
         <h2 className="font-serif text-5xl text-white mb-20 text-center">{t.trinity}</h2>
         
         <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {t.masters.map((artist, idx) => (
               <div key={idx} className="group cursor-pointer">
                  <div className="aspect-[2/3] overflow-hidden mb-6 relative">
                     <div className="absolute inset-0 bg-stone-900 z-10 group-hover:opacity-0 transition-opacity duration-500 opacity-20"></div>
                     <img 
                        src={MASTER_IMGS[idx]} 
                        alt={artist.name} 
                        className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700 group-hover:scale-110"
                     />
                  </div>
                  <div className="border-t border-stone-700 pt-6 group-hover:border-white transition-colors">
                     <h3 className="font-serif text-3xl text-white mb-2 italic">{artist.name}</h3>
                     <span className="text-xs font-bold text-orange-500 uppercase tracking-widest block mb-4">{artist.role}</span>
                     <p className="text-stone-400 font-light leading-relaxed text-sm">
                        {artist.desc}
                     </p>
                  </div>
               </div>
            ))}
         </div>
      </section>

      {/* 5. FOOTER / NEXT */}
      <section className="py-24 border-t border-stone-800 bg-[#151312] text-center">
         <p className="text-stone-500 font-mono text-xs uppercase tracking-widest mb-6">{t.next.label}</p>
         <h2 className="font-serif text-4xl text-white mb-8">{t.next.title}</h2>
         <p className="text-stone-400 max-w-lg mx-auto mb-12">
            {renderDesc(t.next.desc)}
         </p>
         
         <div className="flex justify-center gap-6">
            <button className="px-8 py-4 border border-stone-600 text-stone-300 rounded-sm hover:border-white hover:text-white transition-colors font-serif italic">
               {t.next.btnReview}
            </button>
            <button 
               onClick={onBack}
               className="px-8 py-4 bg-white text-stone-900 rounded-sm hover:bg-stone-200 transition-colors font-bold tracking-widest uppercase text-xs flex items-center gap-3"
            >
               {t.next.btnReturn} <ChevronRight size={14} />
            </button>
         </div>
      </section>

    </div>
  );
};

export default ArtPeriodDetailView;