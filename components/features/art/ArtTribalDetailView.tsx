import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Pause, Maximize2, Info, X, MapPin, Hand, Eye, Search, Zap, Shield, Ghost, Users, Heart, Layers, Music, Globe, Flame, Sprout, Hammer, Mountain } from 'lucide-react';

interface ArtTribalDetailViewProps {
  chapterId: string;
  onBack: () => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const Text = ({ en, jp, lang }: { en: string; jp: string; lang: 'en' | 'jp' }) => (
  <>{lang === 'en' ? en : jp}</>
);

// --- 1. ENCOUNTER: Flashlight Component ---
const FlashlightExplore = ({ image, title, hint, lang }: { image: string, title: any, hint: any, lang: 'en' | 'jp' }) => {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPos({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      });
    }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-[4/3] md:aspect-video rounded-lg overflow-hidden cursor-none group bg-black shadow-2xl"
      onMouseMove={handleMove}
    >
      {/* Base layer - heavily obscured */}
      <img src={image} alt="Artifact" className="absolute inset-0 w-full h-full object-contain opacity-20 blur-sm grayscale" />
      
      {/* Darkness Mask */}
      <div 
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          background: `radial-gradient(circle 250px at ${pos.x}% ${pos.y}%, transparent 0%, rgba(0,0,0,0.98) 100%)`
        }}
      ></div>

      {/* Reveal Layer */}
      <img 
        src={image} 
        alt="Artifact Reveal" 
        className="absolute inset-0 w-full h-full object-contain pointer-events-none transition-transform duration-100"
        style={{
           maskImage: `radial-gradient(circle 200px at ${pos.x}% ${pos.y}%, black 100%, transparent 100%)`,
           WebkitMaskImage: `radial-gradient(circle 200px at ${pos.x}% ${pos.y}%, black 100%, transparent 100%)`
        }}
      />
      
      {/* Cursor Indicator */}
      <div 
        className="absolute w-12 h-12 border-2 border-orange-500/50 rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center mix-blend-screen"
        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      >
        <div className="w-1 h-1 bg-orange-500 rounded-full shadow-[0_0_10px_orange]"></div>
      </div>

      <div className="absolute bottom-8 left-8 pointer-events-none z-20">
        <h2 className="text-4xl font-bold text-white mb-2 tracking-tighter drop-shadow-lg"><Text {...title} lang={lang} /></h2>
        <p className="text-stone-400 text-sm flex items-center gap-2">
          <Search size={14} className="animate-pulse text-orange-500"/> <Text {...hint} lang={lang} />
        </p>
      </div>
    </div>
  );
};

// --- 2. RITUAL: Trance Simulator ---
const RitualMode = ({ lang }: { lang: 'en' | 'jp' }) => {
  const [intensity, setIntensity] = useState(0); // 0 to 100
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setIntensity(prev => (prev >= 100 ? 0 : prev + 0.5));
      }, 50);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const getStageText = (val: number) => {
    if (val < 20) return { title: { en: "Preparation", jp: "準備" }, desc: { en: "The dancer puts on the mask. They are still human.", jp: "踊り手は仮面をつける。まだ人間としての意識がある。" } };
    if (val < 50) return { title: { en: "The Rhythm", jp: "リズム" }, desc: { en: "The drumbeat synchronizes the heartbeat. Identity begins to fade.", jp: "ドラムの鼓動と心臓が同期する。個人のアイデンティティが薄れ始める。" } };
    if (val < 80) return { title: { en: "Transformation", jp: "変容" }, desc: { en: "The human ego dissolves. The spirit enters the vessel.", jp: "エゴが溶解する。精霊が「器」に入り込む。" } };
    return { title: { en: "Possession", jp: "憑依" }, desc: { en: "The human is gone. Only the Spirit remains. This is Art.", jp: "人間は消え去った。そこにいるのは精霊のみ。これこそがアートである。" } };
  };

  const stage = getStageText(intensity);

  return (
    <div className="bg-[#151210] rounded-xl border border-stone-800 p-8 flex flex-col gap-8 relative overflow-hidden">
       {/* Controls */}
       <div className="flex flex-col md:flex-row justify-between items-end gap-6 relative z-10">
          <div>
             <div className="flex items-center gap-3 mb-2">
                <Music size={20} className="text-orange-500"/>
                <h3 className="text-xl font-bold text-white"><Text en="The Trance State" jp="トランス状態のシミュレーション" lang={lang}/></h3>
             </div>
             <p className="text-stone-400 text-sm max-w-md">
                <Text en="Slide to experience how the mask functions during the ritual." jp="スライダーを動かして、儀式中の仮面の機能（見え方の変化）を体験してください。" lang={lang}/>
             </p>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
             <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center text-white hover:bg-stone-700 transition-colors shrink-0"
             >
                {isPlaying ? <Pause size={20}/> : <Play size={20} className="ml-1"/>}
             </button>
             <input 
               type="range" 
               min="0" max="100" 
               value={intensity} 
               onChange={(e) => { setIsPlaying(false); setIntensity(parseInt(e.target.value)); }}
               className="w-full md:w-64 h-2 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-orange-600"
             />
          </div>
       </div>

       {/* Visualizer */}
       <div className="relative aspect-video md:aspect-[21/9] bg-black rounded-lg overflow-hidden border border-stone-800 flex items-center justify-center">
          
          {/* Dynamic Background */}
          <div 
            className="absolute inset-0 transition-opacity duration-300"
            style={{
               background: `radial-gradient(circle, rgba(234,88,12,${intensity/150}) 0%, rgba(0,0,0,1) 70%)`,
               opacity: intensity / 100
            }}
          ></div>

          {/* Glitch/Shake Effects */}
          <div 
             className="relative z-10 transition-all duration-100"
             style={{
                transform: `scale(${1 + (intensity/500)}) translate(${Math.random() * (intensity/10)}px, ${Math.random() * (intensity/10)}px)`,
                filter: `blur(${intensity/30}px) contrast(${100 + intensity}%) saturate(${100 + intensity}%)`
             }}
          >
             <img 
               src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Mask_Dan_Côte_d%27Ivoire_MHNT.jpg/800px-Mask_Dan_Côte_d%27Ivoire_MHNT.jpg" 
               alt="Ritual Mask" 
               className="h-64 md:h-80 object-contain"
             />
             {/* Eye Glow at high intensity */}
             <div 
               className="absolute top-[35%] left-[30%] w-4 h-4 bg-red-500 rounded-full blur-md mix-blend-screen transition-opacity duration-300"
               style={{ opacity: intensity > 80 ? 1 : 0 }}
             ></div>
             <div 
               className="absolute top-[35%] right-[30%] w-4 h-4 bg-red-500 rounded-full blur-md mix-blend-screen transition-opacity duration-300"
               style={{ opacity: intensity > 80 ? 1 : 0 }}
             ></div>
          </div>

          {/* Text Overlay */}
          <div className="absolute bottom-6 left-0 w-full text-center z-20 px-4">
             <span className={`text-xs font-bold uppercase tracking-[0.3em] mb-2 block ${intensity > 80 ? 'text-red-500 animate-pulse' : 'text-stone-500'}`}>
                <Text {...stage.title} lang={lang} />
             </span>
             <p className="text-white font-serif text-lg md:text-xl drop-shadow-md bg-black/50 inline-block px-4 py-1 rounded backdrop-blur-sm">
                <Text {...stage.desc} lang={lang} />
             </p>
          </div>
       </div>
    </div>
  );
};

// --- 3. ANATOMY: Material Breakdown (Origin Reveal) ---
const MaterialAnalysis = ({ lang }: { lang: 'en' | 'jp' }) => {
  const [selected, setSelected] = useState<string | null>(null);

  const materials = [
    { 
      id: 'wood',
      name: { en: "Living Wood", jp: "生きた木" }, 
      origin: { en: "Kapok Tree", jp: "カポックの木" },
      desc: { en: "Carved from a living tree. The wood is believed to retain the tree's spirit (Nyama). It is not dead material; it is dormant life.", jp: "生きた木から彫り出されます。木には精霊（ニャマ）が宿ると信じられており、それは死んだ素材ではなく、休眠状態の生命なのです。" }, 
      image: "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&q=80&w=800" 
    },
    { 
      id: 'pigment',
      name: { en: "Earth Pigment", jp: "大地の顔料" }, 
      origin: { en: "Kaolin Clay", jp: "カオリン（白土）" },
      desc: { en: "White clay from the riverbed represents the spirit world (ancestors). Red ochre represents blood and life. Color is code.", jp: "川底から採れる白い粘土は霊界（祖先）を表し、赤い黄土は血と生命を表します。色は装飾ではなく、コード（暗号）なのです。" }, 
      image: "https://images.unsplash.com/photo-1596627706680-79ac47000767?auto=format&fit=crop&q=80&w=800" 
    },
    { 
      id: 'raffia',
      name: { en: "Raffia Fiber", jp: "ラフィア繊維" }, 
      origin: { en: "Palm Fronds", jp: "ヤシの葉" },
      desc: { en: "The costume is as important as the mask. Raffia hides the human form completely, erasing the individual identity.", jp: "衣装は仮面と同じくらい重要です。ラフィアは人間の輪郭を完全に隠し、個人のアイデンティティを抹消します。" }, 
      image: "https://images.unsplash.com/photo-1617456722245-c397c2727409?auto=format&fit=crop&q=80&w=800" 
    }
  ];

  return (
    <div className="flex flex-col md:flex-row gap-8 h-[500px]">
       {/* Interactive List */}
       <div className="w-full md:w-1/3 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-stone-500 uppercase tracking-widest mb-2"><Text en="Select Material" jp="素材を選択" lang={lang}/></h3>
          {materials.map((m) => (
             <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={`
                   text-left p-4 rounded-xl border transition-all flex items-center justify-between group
                   ${selected === m.id 
                     ? 'bg-stone-800 border-orange-500 text-white' 
                     : 'bg-stone-900/50 border-stone-800 text-stone-400 hover:border-stone-600'}
                `}
             >
                <span className="font-serif text-lg"><Text {...m.name} lang={lang} /></span>
                {selected === m.id && <Eye size={16} className="text-orange-500" />}
             </button>
          ))}
       </div>

       {/* Detail View */}
       <div className="flex-1 bg-[#1a1614] rounded-xl border border-stone-800 relative overflow-hidden group">
          {selected ? (
             <div className="absolute inset-0 flex flex-col">
                <div className="relative h-1/2 overflow-hidden">
                   <img 
                     src={materials.find(m => m.id === selected)?.image} 
                     alt="Origin" 
                     className="w-full h-full object-cover transition-transform duration-700 hover:scale-110"
                   />
                   <div className="absolute top-4 left-4 bg-black/60 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-orange-400 border border-orange-500/20 flex items-center gap-2">
                      <Sprout size={12} /> <Text en="Origin: " jp="起源： " lang={lang} /><Text {...materials.find(m => m.id === selected)?.origin} lang={lang} />
                   </div>
                </div>
                <div className="p-8 flex-1 bg-[#1a1614]">
                   <h4 className="text-2xl font-serif text-white mb-4"><Text {...materials.find(m => m.id === selected)?.name} lang={lang} /></h4>
                   <p className="text-stone-400 leading-relaxed border-l-2 border-stone-700 pl-4">
                      <Text {...materials.find(m => m.id === selected)?.desc} lang={lang} />
                   </p>
                </div>
             </div>
          ) : (
             <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-600">
                <Layers size={48} className="mb-4 opacity-50" />
                <p className="font-serif italic"><Text en="Select a material to trace its origin." jp="素材を選択して、その起源を辿ってください。" lang={lang} /></p>
             </div>
          )}
       </div>
    </div>
  );
};

// --- 4. CONNECTION: Thematic Comparison (Switchable) ---
const CrossCultural = ({ lang }: { lang: 'en' | 'jp' }) => {
  const [topic, setTopic] = useState<'boundary' | 'vessel'>('boundary');

  return (
    <div className="space-y-8">
       {/* Toggle */}
       <div className="flex justify-center">
          <div className="bg-stone-900 p-1 rounded-lg inline-flex border border-stone-800">
             <button 
               onClick={() => setTopic('boundary')}
               className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${topic === 'boundary' ? 'bg-stone-700 text-white shadow' : 'text-stone-500 hover:text-white'}`}
             >
                <Text en="The Boundary" jp="境界としての機能" lang={lang} />
             </button>
             <button 
               onClick={() => setTopic('vessel')}
               className={`px-6 py-2 rounded-md text-sm font-bold transition-all ${topic === 'vessel' ? 'bg-stone-700 text-white shadow' : 'text-stone-500 hover:text-white'}`}
             >
                <Text en="The Vessel" jp="器としての機能" lang={lang} />
             </button>
          </div>
       </div>

       <div className="bg-stone-900 rounded-2xl overflow-hidden flex flex-col md:flex-row relative min-h-[400px]">
          {/* Center Divider */}
          <div className="absolute left-1/2 top-8 bottom-8 w-px bg-stone-800 hidden md:block z-10">
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-stone-900 border border-stone-700 text-stone-400 text-xs px-2 py-1 rounded font-bold">VS</div>
          </div>

          {/* LEFT: Tribal */}
          <div className="flex-1 p-8 relative overflow-hidden group">
             <div className="absolute inset-0 opacity-20 transition-transform duration-700 group-hover:scale-105">
                <img 
                  src={topic === 'boundary' 
                    ? "https://images.unsplash.com/photo-1535579710123-3c0f261c474e?auto=format&fit=crop&q=80&w=800" 
                    : "https://images.unsplash.com/photo-1620610363597-9b2447997361?auto=format&fit=crop&q=80&w=800"} 
                  className="w-full h-full object-cover" 
                  alt="Tribal"
                />
             </div>
             <div className="relative z-10 flex flex-col h-full items-end text-right">
                <span className="text-orange-500 font-bold text-xs uppercase tracking-widest mb-2"><Text en="Tribal Art" jp="民族アート" lang={lang}/></span>
                <h3 className="text-2xl font-serif text-white mb-4">
                   {topic === 'boundary' ? <Text en="The Mask" jp="仮面" lang={lang}/> : <Text en="The Fetish Object" jp="呪物 (Fetish)" lang={lang}/>}
                </h3>
                <p className="text-stone-400 text-sm leading-relaxed max-w-sm">
                   {topic === 'boundary' 
                     ? <Text en="A boundary between the human world and the spirit world. Wearing it allows the spirit to enter." jp="人間界と霊界の境界線。これを身につけることで、精霊がこちらの世界に入り込むことを許す。" lang={lang}/> 
                     : <Text en="An object charged with medicinal or magical substances to hold a spirit." jp="薬草や呪術的な物質を詰め込み、精霊を宿らせるための器。" lang={lang}/>}
                </p>
             </div>
          </div>

          {/* RIGHT: Japan */}
          <div className="flex-1 p-8 relative overflow-hidden group">
             <div className="absolute inset-0 opacity-20 transition-transform duration-700 group-hover:scale-105">
                <img 
                  src={topic === 'boundary' 
                    ? "https://images.unsplash.com/photo-1582201942988-13e60e4556ee?auto=format&fit=crop&q=80&w=800" 
                    : "https://images.unsplash.com/photo-1615486511484-92e590508b80?auto=format&fit=crop&q=80&w=800"} 
                  className="w-full h-full object-cover" 
                  alt="Japan"
                />
             </div>
             <div className="relative z-10 flex flex-col h-full items-start text-left">
                <span className="text-red-400 font-bold text-xs uppercase tracking-widest mb-2"><Text en="Japanese Shinto" jp="日本・神道" lang={lang}/></span>
                <h3 className="text-2xl font-serif text-white mb-4">
                   {topic === 'boundary' ? <Text en="The Torii Gate" jp="鳥居 / 結界" lang={lang}/> : <Text en="Yorishiro" jp="依り代" lang={lang}/>}
                </h3>
                <p className="text-stone-400 text-sm leading-relaxed max-w-sm">
                   {topic === 'boundary' 
                     ? <Text en="A marker separating the profane everyday world from the sacred space of the Kami." jp="俗世（日常）と神域（聖なる場所）を分ける境界線。" lang={lang}/> 
                     : <Text en="Objects (rocks, trees, mirrors) capable of attracting and inhabiting spirits (Kami)." jp="神霊（カミ）が招き寄せられ、宿ることができる物体（岩、木、鏡など）。" lang={lang}/>}
                </p>
             </div>
          </div>
       </div>
    </div>
  );
};

// --- MAIN PAGE ---
const ArtTribalDetailView: React.FC<ArtTribalDetailViewProps> = ({ chapterId, onBack, language, setLanguage }) => {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'ritual' | 'anatomy' | 'connect'>('overview');

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        setScrollProgress(scrolled / maxScroll);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [chapterId]);

  // Tab Navigation Component
  const TabNav = () => (
    <div className="flex justify-center mb-12 sticky top-20 z-40 bg-[#0f0b09]/80 backdrop-blur-md py-4 border-b border-white/5">
       <div className="bg-stone-900 rounded-full p-1 flex gap-1 border border-stone-800">
          {[
            { id: 'overview', label: { en: 'Overview', jp: '概要' }, icon: Eye },
            { id: 'ritual', label: { en: 'Ritual', jp: '儀礼' }, icon: Flame },
            { id: 'anatomy', label: { en: 'Materials', jp: '素材' }, icon: Layers },
            { id: 'connect', label: { en: 'Connect', jp: '比較' }, icon: Globe },
          ].map((tab) => (
             <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`
                   px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all
                   ${activeTab === tab.id 
                     ? 'bg-orange-600 text-white shadow-lg' 
                     : 'text-stone-500 hover:text-white hover:bg-stone-800'}
                `}
             >
                <tab.icon size={14} /> <span className="hidden md:inline"><Text {...tab.label} lang={language} /></span>
             </button>
          ))}
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0b09] text-stone-200 font-sans selection:bg-orange-900/50">
      
      {/* Navbar */}
      <div className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center bg-gradient-to-b from-black/90 to-transparent pointer-events-none">
        <button onClick={onBack} className="pointer-events-auto text-stone-400 hover:text-white transition-colors flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
           <ArrowLeft size={18} /> <span className="font-medium text-sm"><Text en="Map" jp="地図" lang={language} /></span>
        </button>
        <div className="pointer-events-auto flex bg-black/40 backdrop-blur rounded-full p-1 border border-white/10">
           <button onClick={() => setLanguage('en')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-200 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
           <button onClick={() => setLanguage('jp')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-200 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
        </div>
      </div>

      {/* Progress Line */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 h-32 w-0.5 bg-stone-800 z-50 hidden md:block">
         <div className="absolute top-0 left-0 w-full bg-orange-600 transition-all duration-300" style={{ height: `${scrollProgress * 100}%` }}></div>
      </div>

      {/* CONTENT AREA */}
      <div className="pt-24 pb-32 max-w-5xl mx-auto px-6">
         
         <div className="text-center mb-12">
            <span className="text-orange-500 font-bold tracking-widest text-xs uppercase mb-4 block"><Text en="Chapter 12A" jp="第12A章" lang={language} /></span>
            <h1 className="text-4xl md:text-6xl font-serif text-white mb-6"><Text en="The Spirit Mask" jp="精霊の仮面" lang={language} /></h1>
         </div>

         <TabNav />

         <div className="min-h-[500px] animate-in fade-in slide-in-from-bottom-8 duration-500">
            {activeTab === 'overview' && (
               <div className="space-y-12">
                  <FlashlightExplore 
                     image="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Mask_Dan_Côte_d%27Ivoire_MHNT.jpg/800px-Mask_Dan_Côte_d%27Ivoire_MHNT.jpg" 
                     title={{ en: "Encounter", jp: "遭遇" }}
                     hint={{ en: "Explore the dark", jp: "暗闇を探索" }}
                     lang={language}
                  />
                  <div className="prose prose-invert prose-lg max-w-2xl mx-auto">
                     <p>
                        <Text 
                           en="You are standing in the archive. Before you is a mask from the Dan people of Ivory Coast. But remember: this object is 'dead' right now. It is sleeping in a museum case." 
                           jp="あなたはアーカイブに立っています。目の前にあるのは、コートジボワールのダン族の仮面です。しかし覚えておいてください。この物体は今「死んで」います。博物館のケースの中で眠っているのです。" 
                           lang={language} 
                        />
                     </p>
                     <p>
                        <Text 
                           en="To understand it, we must wake it up. We must analyze its materials, hear its rhythm, and connect it to our own understanding of the sacred." 
                           jp="理解するためには、それを目覚めさせなければなりません。素材を分析し、リズムを聴き、私たち自身の「聖なるもの」への理解と接続する必要があります。" 
                           lang={language} 
                        />
                     </p>
                  </div>
               </div>
            )}

            {activeTab === 'ritual' && <RitualMode lang={language} />}
            
            {activeTab === 'anatomy' && <MaterialAnalysis lang={language} />}
            
            {activeTab === 'connect' && (
               <div className="space-y-8">
                  <div className="text-center max-w-2xl mx-auto mb-8">
                     <h2 className="text-2xl font-bold text-white mb-4"><Text en="Global Animism" jp="グローバル・アニミズム" lang={language} /></h2>
                     <p className="text-stone-400">
                        <Text 
                           en="The idea that spirits inhabit objects is not unique to Africa. It connects directly to Japanese Shinto and folklore." 
                           jp="物体に精霊が宿るという考え方は、アフリカ特有のものではありません。それは日本の神道や民俗信仰と直接つながっています。" 
                           lang={language} 
                        />
                     </p>
                  </div>
                  <CrossCultural lang={language} />
               </div>
            )}
         </div>

      </div>

      {/* FOOTER NAV */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
         <button 
            onClick={onBack}
            className="bg-white text-stone-900 px-8 py-3 rounded-full font-bold shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:scale-105 transition-transform flex items-center gap-2"
         >
            <Text en="Complete Fieldwork" jp="調査を完了する" lang={language} /> <ArrowLeft size={18} className="rotate-180" />
         </button>
      </div>

    </div>
  );
};

export default ArtTribalDetailView;