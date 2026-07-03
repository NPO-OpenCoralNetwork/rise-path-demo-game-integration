import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, Hammer, Leaf, Wind, Flame, Droplet, Star, ArrowDown } from 'lucide-react';

interface ArtCraftDetailViewProps {
  craftId: string;
  onBack: () => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

// Data Store for Crafts
const CRAFT_DATA: Record<string, any> = {
  urushi: {
    titleEn: "Urushi Lacquer",
    titleJp: "漆工芸",
    heroImage: "https://images.unsplash.com/photo-1627885918738-4b7264379761?auto=format&fit=crop&q=80&w=1200",
    icon: Droplet,
    kanji: "漆",
    philosophy: {
      title: "Time & Depth",
      textEn: "Urushi is not painted; it is grown. The sap of the Urushi tree is applied in microscopic layers. It requires humidity to harden, absorbing moisture from the air to become diamond-hard. It is a living art.",
      textJp: "漆は塗るものではなく、育てるものです。漆の木の樹液をミクロの層として塗り重ねます。硬化には湿気が必要で、空気中の水分を吸ってダイヤモンドのように硬くなります。それは生きている芸術です。"
    },
    process: [
      { step: 1, title: "Sapping", desc: "Collecting sap drop by drop (only 200g per tree per year)." },
      { step: 2, title: "Base Coat", desc: "Applying raw lacquer to the wood base to seal it." },
      { step: 3, title: "Polishing", desc: "Polishing with charcoal between every single layer." }
    ]
  },
  dyeing: {
    titleEn: "Indigo Dyeing",
    titleJp: "藍染",
    heroImage: "https://images.unsplash.com/photo-1598556776374-2264821a88b2?auto=format&fit=crop&q=80&w=1200",
    icon: Leaf,
    kanji: "藍",
    philosophy: {
      title: "Japan Blue",
      textEn: "Indigo (Ai) is alive. The dye vat must be fed and kept warm. The color does not sit on the fabric but permeates it. It repels insects and strengthens the fiber. It is the color of the Japanese soul.",
      textJp: "藍は生きています。染料の甕（かめ）は食事を与えられ、温められなければなりません。色は布の上に乗るのではなく、浸透します。虫を寄せ付けず、繊維を強くする。それは日本人の魂の色です。"
    },
    process: [
      { step: 1, title: "Fermentation", desc: "Composting indigo leaves for 100 days to make Sukumo." },
      { step: 2, title: "The Vat", desc: "Mixing with ash lye and keeping it warm to wake the bacteria." },
      { step: 3, title: "Oxidation", desc: "Dipping fabric. It comes out green, then turns blue in the air." }
    ]
  },
  blades: {
    titleEn: "The Blade",
    titleJp: "日本刀",
    heroImage: "https://images.unsplash.com/photo-1592329347810-258af722b5d4?auto=format&fit=crop&q=80&w=1200",
    icon: Flame,
    kanji: "刀",
    philosophy: {
      title: "Steel as Spirit",
      textEn: "The sword is not a weapon of destruction, but a tool of purification. The smith folds the steel thousands of times to remove impurities, creating a balance of hardness and flexibility.",
      textJp: "刀は破壊の武器ではなく、清めの道具です。刀匠は鋼を何千回も折り返し、不純物を取り除き、硬さと柔軟性のバランスを作り出します。"
    },
    process: [
      { step: 1, title: "Tamahagane", desc: "Smelting iron sand for 3 days to create jewel steel." },
      { step: 2, title: "Folding", desc: "Hammering and folding to create thousands of layers." },
      { step: 3, title: "Quenching", desc: "Yaki-ire. Rapid cooling to create the curve and hardened edge." }
    ]
  },
  washi: {
    titleEn: "Washi Paper",
    titleJp: "和紙",
    heroImage: "https://images.unsplash.com/photo-1583225883296-619429302636?auto=format&fit=crop&q=80&w=1200",
    icon: Wind,
    kanji: "紙",
    philosophy: {
      title: "Warmth & Light",
      textEn: "Unlike western paper, Washi fibers are long and entangled. It is strong yet translucent. It filters harsh sunlight into a soft glow, bringing warmth to a room.",
      textJp: "西洋の紙とは異なり、和紙の繊維は長く絡み合っています。強靭でありながら半透明。厳しい日差しを柔らかな光に変え、部屋に温もりをもたらします。"
    },
    process: [
      { step: 1, title: "Kozo", desc: "Harvesting mulberry branches and steaming them." },
      { step: 2, title: "Beating", desc: "Pounding the fibers by hand to separate them." },
      { step: 3, title: "Nagashizuki", desc: "The rhythmic rocking of the screen in water to weave fibers." }
    ]
  },
  // Fallback for others
  default: {
    titleEn: "Traditional Craft",
    titleJp: "伝統工芸",
    heroImage: "https://images.unsplash.com/photo-1579762183204-766723223072?auto=format&fit=crop&q=80&w=1200",
    icon: Star,
    kanji: "匠",
    philosophy: {
      title: "The Spirit of Takumi",
      textEn: "Dedicated to the mastery of material and spirit. A lifelong pursuit of perfection that can never be fully attained.",
      textJp: "素材と精神の熟達への献身。決して完全には到達できない完璧さへの、生涯をかけた追求。"
    },
    process: [
      { step: 1, title: "Material", desc: "Selecting the finest natural resources." },
      { step: 2, title: "Technique", desc: "Skills passed down through generations." },
      { step: 3, title: "Spirit", desc: "Imbuing the object with the creator's soul." }
    ]
  }
};

const ArtCraftDetailView: React.FC<ArtCraftDetailViewProps> = ({ craftId, onBack, language, setLanguage }) => {
  const [scrollProgress, setScrollProgress] = useState(0);
  
  // Get data or fallback
  const data = CRAFT_DATA[craftId] || CRAFT_DATA['default'];

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(scrolled / maxScroll);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#151312] text-stone-200 font-sans selection:bg-orange-900/50">
      
      {/* Navbar */}
      <div className="fixed top-0 w-full z-50 px-6 py-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={onBack} className="text-white hover:text-orange-300 transition-colors flex items-center gap-2 mix-blend-difference">
           <ArrowLeft size={20} /> <span className="font-serif italic hidden md:inline">Return</span>
        </button>
        <div className="flex bg-black/40 backdrop-blur rounded-full p-1 border border-white/10">
           <button onClick={() => setLanguage('en')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}>EN</button>
           <button onClick={() => setLanguage('jp')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}>JP</button>
        </div>
      </div>

      {/* Progress Line */}
      <div className="fixed right-6 top-1/2 -translate-y-1/2 h-32 w-0.5 bg-stone-800 z-50 hidden md:block">
         <div className="absolute top-0 left-0 w-full bg-white transition-all duration-300" style={{ height: `${scrollProgress * 100}%` }}></div>
      </div>

      {/* 1. HERO */}
      <section className="relative h-screen w-full flex items-center justify-center overflow-hidden">
         <div className="absolute inset-0">
            <img src={data.heroImage} alt={data.titleEn} className="w-full h-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-[#151312]"></div>
         </div>
         
         <div className="relative z-10 text-center flex flex-col items-center">
            {/* The Kanji watermark */}
            <div className="text-[12rem] md:text-[20rem] font-serif font-bold text-white/5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none">
               {data.kanji}
            </div>

            <div className="mb-6 p-4 rounded-full border border-white/20 bg-white/5 backdrop-blur-md">
               <data.icon size={32} className="text-orange-200" />
            </div>
            
            <h1 className="text-5xl md:text-8xl font-serif text-white mb-4 tracking-tight">
               {language === 'en' ? data.titleEn : data.titleJp}
            </h1>
            
            <p className="text-stone-300 text-lg uppercase tracking-[0.3em] font-light">
               {language === 'en' ? data.titleJp : data.titleEn}
            </p>

            <div className="absolute bottom-12 animate-bounce text-stone-500">
               <ArrowDown size={24} />
            </div>
         </div>
      </section>

      {/* 2. PHILOSOPHY (Vertical Text Layout attempt) */}
      <section className="py-32 px-6 md:px-20 max-w-6xl mx-auto flex flex-col md:flex-row gap-16 items-center">
         <div className="flex-1 space-y-8">
            <span className="text-orange-500 font-bold text-xs uppercase tracking-[0.2em] block mb-2">Philosophy</span>
            <h2 className="text-4xl md:text-5xl font-serif text-white leading-tight">
               {data.philosophy.title}
            </h2>
            <p className="text-xl text-stone-400 font-light leading-relaxed">
               {language === 'en' ? data.philosophy.textEn : data.philosophy.textJp}
            </p>
         </div>
         
         <div className="flex-1 h-[400px] bg-stone-900 rounded-lg p-8 border border-stone-800 flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')]"></div>
            {/* Decorative vertical text simulation */}
            <div className="writing-vertical-rl text-4xl font-serif text-stone-600 tracking-widest h-full select-none opacity-50 flex items-center justify-center gap-8 border-r border-stone-800 pr-8">
               <span>一期一会</span>
               <span>温故知新</span>
            </div>
         </div>
      </section>

      {/* 3. PROCESS */}
      <section className="py-24 bg-[#100e0d]">
         <div className="max-w-7xl mx-auto px-6">
            <h3 className="text-center font-serif text-3xl text-stone-300 mb-16">The Process</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
               {data.process.map((step: any, idx: number) => (
                  <div key={idx} className="group relative bg-[#1c1917] p-8 rounded-sm border border-stone-800 hover:border-orange-900/50 transition-colors">
                     <div className="absolute top-0 right-0 p-4 text-6xl font-serif text-stone-800 font-bold group-hover:text-stone-700 transition-colors">
                        {step.step}
                     </div>
                     <div className="relative z-10 pt-8">
                        <h4 className="text-xl font-serif text-white mb-4">{step.title}</h4>
                        <p className="text-stone-500 leading-relaxed text-sm">
                           {step.desc}
                        </p>
                     </div>
                  </div>
               ))}
            </div>
         </div>
      </section>

      {/* 4. GALLERY / OUTRO */}
      <section className="py-32 text-center px-6">
         <div className="w-16 h-1 bg-gradient-to-r from-transparent via-orange-500 to-transparent mx-auto mb-12"></div>
         <p className="text-stone-500 max-w-xl mx-auto mb-8 leading-relaxed">
            "We do not create to last forever, but to age beautifully."
         </p>
         <button 
            onClick={onBack}
            className="px-8 py-3 border border-stone-600 rounded-full text-stone-300 hover:text-white hover:border-white transition-all text-sm uppercase tracking-widest"
         >
            Explore Other Crafts
         </button>
      </section>

    </div>
  );
};

export default ArtCraftDetailView;