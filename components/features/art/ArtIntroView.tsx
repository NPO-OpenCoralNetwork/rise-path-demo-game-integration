import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowDown, Eye, Layers, Globe, ChevronRight, PenTool, CheckCircle2 } from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtIntroViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const ArtIntroView: React.FC<ArtIntroViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  const [activeLens, setActiveLens] = useState<'material' | 'meaning' | 'context'>('material');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(Math.min(scrolled / maxScroll, 1));
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const content = {
    en: {
      chapter: "Chapter 00",
      introLabel: "Introduction",
      heroTitle: <>Why do we <br/><span className="italic text-stone-400">create?</span></>,
      heroDesc: "Human beings are the only species that decorates. Before we built cities, before we wrote laws, we painted.",
      sections: [
        { title: "Survival & Magic", impulse: "01. THE IMPULSE OF", desc: "The earliest art wasn't for a museum. It was a tool. Painting a bison wasn't just capturing its image; it was an attempt to capture its spirit, to ensure the hunt, to survive the winter. Art was **power**." },
        { title: "Order & Divinity", impulse: "02. THE IMPULSE OF", desc: "As civilizations rose, art became a way to impose order on chaos. Temples, statues of gods, geometric patterns—these were attempts to connect with the divine and establish hierarchy in a chaotic world." },
        { title: "Self & Expression", impulse: "03. THE IMPULSE OF", desc: "Only recently in history has art become about the 'artist.' The shift from 'we create for the gods' to 'I create to express myself' marks the birth of the modern mind." },
      ],
      lenses: {
        title: "How to Look at Art",
        items: {
          material: { title: "Material & Technique", desc: "Art is physical. It is made of stone, oil, pigment, and light. The first question is always: 'How was this made?'", detail: "In prehistoric times, artists didn't have tubes of paint. They used charcoal from fires, ochre from the earth, and animal fat as a binder. The constraint of material shapes the art." },
          meaning: { title: "Symbol & Meaning", desc: "Art is a language. Every color, pose, and object conveys a message intended for the viewer.", detail: "A handprint on a cave wall isn't just a dirty hand. It is a signature. It says 'I was here.' It is the first attempt by a human to leave a permanent mark on the universe." },
          context: { title: "Social Context", desc: "Art does not exist in a vacuum. It is a product of its time, politics, religion, and economy.", detail: "Why paint in a dark cave? Perhaps it was a sacred ritual. Art wasn't for 'decoration'—it was a tool for survival, a way to influence the gods or ensure a good hunt." }
        }
      },
      outro: {
        title: "The Stage is Set",
        desc: "You are about to embark on a journey through 30,000 years of human history. We will look not just at pictures, but at the souls of the people who made them.",
        btn: "Begin Chapter 1",
        complete: "Chapter Complete"
      },
      annotations: {
        pigment: "Pigment: Red Ochre",
        method: "Method: Blowing via Reed",
        handprint: '"I was here."',
        exist: "Assertion of Existence"
      }
    },
    jp: {
      chapter: "第00章",
      introLabel: "イントロダクション",
      heroTitle: <>なぜ、人は<br/><span className="italic text-stone-400">創るのか？</span></>,
      heroDesc: "人間は「飾る」唯一の種です。都市を築く前に、法律を書く前に、私たちは描きました。",
      sections: [
        { title: "生存と魔術", impulse: "01. 衝動：", desc: "最初のアートは美術館のためではありませんでした。それは「道具」でした。バイソンを描くことは、単に姿を写すことではなく、その魂を捕らえ、狩りの成功を祈り、冬を生き延びるための試みでした。アートは**力**だったのです。" },
        { title: "秩序と神性", impulse: "02. 衝動：", desc: "文明が起こると、アートは混沌に秩序をもたらす手段となりました。神殿、神像、幾何学模様。これらは神と繋がり、無秩序な世界に階層を確立するための試みでした。" },
        { title: "自己と表現", impulse: "03. 衝動：", desc: "アートが「アーティスト」のものになったのは、歴史上ごく最近のことです。「神のために創る」から「自己表現のために創る」へのシフトは、近代精神の誕生を意味します。" },
      ],
      lenses: {
        title: "アートをどう見るか",
        items: {
          material: { title: "素材と技術", desc: "アートは物理的なものです。石、油、顔料、光で作られています。最初の問いは常に「どうやって作られたか？」です。", detail: "先史時代、絵具チューブはありませんでした。焚き火の炭、大地の黄土、つなぎとしての動物の脂。素材の制約がアートを形作ります。" },
          meaning: { title: "象徴と意味", desc: "アートは言語です。すべての色、ポーズ、物体は、見る人に向けたメッセージを伝えています。", detail: "洞窟の手形は単なる汚れではありません。それは署名です。「私はここにいた」と語っています。人間が宇宙に恒久的な痕跡を残そうとした最初の試みです。" },
          context: { title: "社会的文脈", desc: "アートは真空には存在しません。それは時代の政治、宗教、経済の産物です。", detail: "なぜ暗い洞窟で描いたのか？おそらく神聖な儀式だったのでしょう。アートは「装飾」ではなく、生存のための道具であり、神々に影響を与える手段でした。" }
        }
      },
      outro: {
        title: "舞台は整いました",
        desc: "あなたは今、3万年にわたる人類の歴史への旅に出ようとしています。私たちは単に絵を見るのではなく、それを描いた人々の魂を見つめることになります。",
        btn: "第1章を始める",
        complete: "章を完了"
      },
      annotations: {
        pigment: "顔料：赤色黄土",
        method: "手法：葦による吹き付け",
        handprint: '「私はここにいた」',
        exist: "実存の主張"
      }
    }
  };

  const t = content[language];

  const lensContent = {
    material: { icon: PenTool },
    meaning: { icon: Eye },
    context: { icon: Globe }
  };

  const handleFinishAction = () => {
    setIsCompleted(true);
    setTimeout(() => {
      onBack(); // Or navigate to Chapter 1
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#1c1917] text-stone-200 font-sans selection:bg-orange-900/30">
      
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 h-1 bg-stone-700 z-50 w-full">
        <div className="h-full bg-orange-500 transition-all duration-100" style={{ width: `${scrollProgress * 100}%` }}></div>
      </div>

      {/* Navbar */}
      <div className="fixed top-0 left-0 w-full p-6 z-40 flex justify-between items-center mix-blend-difference text-white">
        <button onClick={onBack} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <ArrowLeft size={24} /> <span className="font-serif italic hidden md:inline">Curriculum</span>
        </button>
        <div className="flex items-center gap-4">
           {/* Toggle */}
           <div className="flex bg-white/10 rounded-full p-1 border border-white/20 pointer-events-auto">
               <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}>EN</button>
               <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}>JP</button>
           </div>
           <span className="font-mono text-xs uppercase tracking-[0.2em] opacity-50">{t.chapter}</span>
        </div>
      </div>

      {/* 1. HERO: The Question */}
      <section className="h-screen flex flex-col items-center justify-center relative overflow-hidden px-6">
        <div className="absolute inset-0 z-0">
           {/* Abstract Cave Wall Texture */}
           <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/concrete-wall.png')] opacity-10"></div>
           <div className="absolute inset-0 bg-gradient-to-b from-[#1c1917] via-transparent to-[#1c1917]"></div>
        </div>

        <div className="relative z-10 text-center max-w-3xl space-y-8">
           <span className="inline-block text-orange-500 font-bold text-xs uppercase tracking-[0.3em] border border-orange-500/30 px-3 py-1 rounded-full mb-4">
             {t.introLabel}
           </span>
           <h1 className="font-serif text-5xl md:text-7xl text-white leading-tight">
             {t.heroTitle}
           </h1>
           <p className="text-xl text-stone-400 font-light leading-relaxed max-w-xl mx-auto">
             {t.heroDesc}
           </p>
        </div>

        <div className="absolute bottom-12 animate-bounce text-stone-600">
           <ArrowDown size={24} />
        </div>
      </section>

      {/* 2. THE THREE IMPULSES (Scroll Reveal) */}
      <section className="py-32 px-6 max-w-5xl mx-auto">
         <div className="border-l border-stone-800 pl-8 md:pl-12 space-y-24">
            
            {t.sections.map((sec, idx) => (
               <div key={idx} className="group">
                  <span className="text-sm font-mono text-stone-600 mb-2 block">{sec.impulse}</span>
                  <h2 className="text-4xl md:text-5xl font-serif text-white mb-6 group-hover:text-orange-400 transition-colors">{sec.title}</h2>
                  <p className="text-lg text-stone-400 leading-relaxed max-w-2xl">
                     {sec.desc}
                  </p>
               </div>
            ))}

         </div>
      </section>

      {/* 3. INTERACTIVE LENS: The Handprint */}
      <section className="py-24 bg-[#151312] border-y border-stone-800 relative overflow-hidden">
         <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            
            {/* Visual Object */}
            <div className="relative aspect-square flex items-center justify-center bg-[#1c1917] rounded-sm border border-stone-800 p-8 shadow-2xl">
               <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/stone.png')]"></div>
               
               {/* The Artifact: A Handprint */}
               <div className={`transition-all duration-700 ${activeLens === 'material' ? 'scale-100 grayscale-0' : activeLens === 'meaning' ? 'scale-110 grayscale brightness-125 contrast-125' : 'scale-90 opacity-80 sepia'}`}>
                  <img 
                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Cueva_de_las_Manos.jpg/800px-Cueva_de_las_Manos.jpg" 
                    alt="Cave Handprints" 
                    className="w-full h-full object-contain rounded shadow-lg"
                  />
                  
                  {/* Annotations based on Lens */}
                  {activeLens === 'material' && (
                     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="absolute -top-10 -left-10 text-xs font-mono text-orange-400 bg-black/80 px-2 py-1 rounded border border-orange-500/30 whitespace-nowrap">
                           {t.annotations.pigment}
                        </div>
                        <div className="absolute bottom-10 right-10 text-xs font-mono text-orange-400 bg-black/80 px-2 py-1 rounded border border-orange-500/30 whitespace-nowrap">
                           {t.annotations.method}
                        </div>
                     </div>
                  )}
                  {activeLens === 'meaning' && (
                     <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black/60 backdrop-blur-sm p-4 text-center border border-white/20 rounded-xl">
                           <p className="text-white font-serif italic text-lg">{t.annotations.handprint}</p>
                           <p className="text-stone-400 text-xs mt-1">{t.annotations.exist}</p>
                        </div>
                     </div>
                  )}
               </div>
            </div>

            {/* Controls */}
            <div>
               <h3 className="text-sm font-bold text-stone-500 uppercase tracking-widest mb-8">
                  {t.lenses.title}
               </h3>
               
               <div className="space-y-4">
                  {(['material', 'meaning', 'context'] as const).map((lens) => (
                     <button
                        key={lens}
                        onClick={() => setActiveLens(lens)}
                        className={`w-full text-left p-6 rounded-xl border transition-all duration-300 flex gap-4 ${
                           activeLens === lens 
                              ? 'bg-stone-800 border-orange-500/50 shadow-lg' 
                              : 'bg-transparent border-stone-800 hover:bg-stone-800/50'
                        }`}
                     >
                        <div className={`p-3 rounded-full h-fit ${activeLens === lens ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400'}`}>
                           {React.createElement(lensContent[lens].icon, { size: 20 })}
                        </div>
                        <div>
                           <h4 className={`text-lg font-serif mb-2 ${activeLens === lens ? 'text-white' : 'text-stone-400'}`}>
                              {t.lenses.items[lens].title}
                           </h4>
                           <p className="text-sm text-stone-500 leading-relaxed mb-3">
                              {t.lenses.items[lens].desc}
                           </p>
                           {activeLens === lens && (
                              <div className="mt-4 pt-4 border-t border-stone-700 animate-in fade-in slide-in-from-top-2">
                                 <p className="text-sm text-stone-300 italic">
                                    "{t.lenses.items[lens].detail}"
                                 </p>
                              </div>
                           )}
                        </div>
                     </button>
                  ))}
               </div>
            </div>

         </div>
      </section>

      {/* 4. OUTRO: The Journey Begins */}
      <section className="py-32 px-6 text-center">
         <div className="max-w-2xl mx-auto">
            <h2 className="font-serif text-4xl text-white mb-8">{t.outro.title}</h2>
            <p className="text-lg text-stone-400 leading-relaxed mb-12">
               {t.outro.desc}
            </p>

            <button 
               onClick={handleFinishAction}
               disabled={isCompleted}
               className={`
                  group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-500 rounded-full
                  ${isCompleted ? 'bg-green-600 scale-105 cursor-default' : 'bg-orange-600 hover:bg-orange-500 hover:scale-105'}
               `}
            >
               {isCompleted ? (
                  <span className="flex items-center gap-2"><CheckCircle2 size={20}/> {t.outro.complete}</span>
               ) : (
                  <span className="flex items-center gap-2">{t.outro.btn} <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform"/></span>
               )}
            </button>
         </div>
      </section>

    </div>
  );
};

export default ArtIntroView;