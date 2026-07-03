import React from 'react';
import {
   Palette, Clock, Globe, Heart, Search, ArrowRight,
   Brush, Gem, Info, Star, Tent
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useEffect } from 'react';

interface ArtMuseumViewProps {
   onNavigate: (view: ViewState) => void;
   language: 'en' | 'jp';
   setLanguage: (lang: 'en' | 'jp') => void;
}

const CollectionCard = ({
   title, subtitle, image, onClick, icon: Icon
}: {
   title: string; subtitle: string; image: string; onClick: () => void; icon: any
}) => (
   <div
      onClick={onClick}
      className="group relative h-[400px] cursor-pointer overflow-hidden rounded-none"
   >
      <div className="absolute inset-0 bg-stone-900 transition-transform duration-700 group-hover:scale-105">
         <img src={image} alt={title} className="h-full w-full object-cover opacity-60 transition-opacity duration-500 group-hover:opacity-40" />
      </div>

      <div className="absolute inset-0 flex flex-col justify-end p-8 transition-transform duration-500">
         <div className="mb-4 text-stone-300 opacity-0 transform translate-y-4 transition-all duration-500 group-hover:opacity-100 group-hover:translate-y-0 flex items-center gap-2">
            <Icon size={16} />
            <span className="text-xs uppercase tracking-widest">{subtitle}</span>
         </div>
         <h3 className="font-serif text-3xl text-white italic mb-2">{title}</h3>
         <div className="w-12 h-0.5 bg-stone-400 transition-all duration-500 group-hover:w-24 group-hover:bg-white"></div>
      </div>
   </div>
);

const ArtMuseumView: React.FC<ArtMuseumViewProps> = ({ onNavigate, language, setLanguage }) => {
   const { setTheme } = useTheme();

   useEffect(() => {
      setTheme('art');
   }, [setTheme]);

   const content = {
      en: {
         nav: ["Exhibitions", "Artists", "Magazine"],
         curated: "Curated Knowledge",
         heroTitle: "The Art of Seeing",
         heroDesc: "Explore the history, philosophy, and techniques that have shaped human expression for millennia.",
         btnStart: "Begin Journey",
         cards: {
            path: { title: "Curator's Path", sub: "Complete History Course" },
            timeline: { title: "Timeline of Beauty", sub: "Chronological View" },
            japan: { title: "Japanese Aesthetics", sub: "Crafts, Zen, & Tea" },
            tribal: { title: "Roots & Rituals", sub: "World Tribal Arts" }, // New
            look: { title: "How to Look", sub: "Visual Analysis" },
            tech: { title: "Materials & Tech", sub: "Oil, Charcoal, Digital" }
         },
         insight: {
            label: "Curator's Insight",
            title: "Light, Silence, and the Dutch Golden Age.",
            desc: "Vermeer didn't just paint people; he painted the air around them. In this masterclass, we explore how the usage of the camera obscura might have influenced his unique rendering of light and perspective.",
            btn: "Read Article"
         },
         footer: "Art is for everyone."
      },
      jp: {
         nav: ["展示", "アーティスト", "マガジン"],
         curated: "厳選された知識",
         heroTitle: "「視る」という芸術",
         heroDesc: "数千年にわたり人間の表現を形作ってきた歴史、哲学、そして技術を探求する旅へ。",
         btnStart: "旅を始める",
         cards: {
            path: { title: "キュレーターの道", sub: "美術史完全コース" },
            timeline: { title: "美の年表", sub: "クロノロジカルビュー" },
            japan: { title: "日本の美", sub: "工芸・禅・茶道" },
            tribal: { title: "ルーツと儀礼", sub: "世界の民族アート" }, // New
            look: { title: "鑑賞の技法", sub: "視覚分析" },
            tech: { title: "素材と技術", sub: "油彩、木炭、デジタル" }
         },
         insight: {
            label: "キュレーターの視点",
            title: "光、静寂、そしてオランダ黄金時代",
            desc: "フェルメールは単に人を描いたのではありません。彼は周囲の「空気」を描いたのです。このマスタークラスでは、カメラ・オブスクラの利用が、彼の独特な光と遠近法の表現にどのような影響を与えたかを探ります。",
            btn: "記事を読む"
         },
         footer: "芸術はすべての人のために。"
      }
   };

   const t = content[language];

   return (
      <div className="h-full bg-[#1c1917] text-stone-200 font-sans overflow-y-auto">

         {/* Navbar (Internal) */}
         <div className="flex items-center justify-between px-8 py-6 border-b border-stone-800 bg-[#1c1917]/90 backdrop-blur sticky top-0 z-50">
            <div className="flex items-center gap-3">
               <div className="w-10 h-10 border border-stone-600 rounded-full flex items-center justify-center">
                  <span className="font-serif text-xl italic">L</span>
               </div>
               <span className="font-serif text-xl tracking-wide">Rise Path <span className="italic text-stone-500">Atelier</span></span>
            </div>
            <div className="flex items-center gap-6 text-sm text-stone-400 font-medium tracking-wide">
               <div className="hidden md:flex gap-6">
                  {t.nav.map((item, i) => (
                     <button key={i} className="hover:text-white transition-colors">{item}</button>
                  ))}
               </div>
               <Search size={18} className="cursor-pointer hover:text-white" />

               {/* Language Toggle */}
               <div className="flex bg-stone-800 rounded-full p-1 border border-stone-700 ml-4">
                  <button
                     onClick={() => setLanguage('en')}
                     className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'en' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}
                  >
                     EN
                  </button>
                  <button
                     onClick={() => setLanguage('jp')}
                     className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${language === 'jp' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>
                     JP
                  </button>
               </div>
            </div>
         </div>



         {/* Hero Section */}
         <header className="relative h-[70vh] w-full overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0">
               <img
                  src="https://images.unsplash.com/photo-1544211603-9e4544d62f83?auto=format&fit=crop&q=80&w=2000"
                  alt="Museum Hall"
                  className="w-full h-full object-cover opacity-40"
               />
               <div className="absolute inset-0 bg-gradient-to-t from-[#1c1917] via-transparent to-[#1c1917]/50"></div>
            </div>

            <div className="relative z-10 text-center max-w-4xl px-6">
               <span className="text-xs font-bold uppercase tracking-[0.3em] text-stone-400 mb-4 block">{t.curated}</span>
               <h1 className="font-serif text-6xl md:text-8xl text-white mb-6">{t.heroTitle}</h1>
               <p className="text-xl text-stone-300 font-light max-w-2xl mx-auto leading-relaxed mb-10">
                  {t.heroDesc}
               </p>
               <button
                  onClick={() => onNavigate(ViewState.ART_CURRICULUM)}
                  className="bg-stone-100 text-stone-900 px-8 py-3 rounded-sm font-serif italic text-lg hover:bg-white hover:px-10 transition-all duration-300"
               >
                  {t.btnStart}
               </button>
            </div>
         </header>

         {/* Curriculum Guide / Description Section */}
         <section className="bg-stone-900 border-y border-stone-800">
            <div className="max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-20">
               <div className="grid grid-cols-1 md:grid-cols-3 gap-12 divide-y md:divide-y-0 md:divide-x divide-stone-700/50 text-stone-300">
                  <div className="px-4">
                     <span className="block text-amber-500 font-serif italic text-sm mb-3">01. History</span>
                     <h3 className="text-white font-serif text-2xl mb-4">Art History</h3>
                     <p className="text-stone-300 leading-relaxed font-light">
                        古代洞窟壁画から現代アートまで。人類の創造の歴史を辿り、デザインの文脈を理解する「教養」を身につけます。
                     </p>
                  </div>
                  <div className="px-4 pt-8 md:pt-0">
                     <span className="block text-amber-500 font-serif italic text-sm mb-3">02. Practice</span>
                     <h3 className="text-white font-serif text-2xl mb-4">Technique</h3>
                     <p className="text-stone-300 leading-relaxed font-light">
                        巨匠たちの筆致や色彩構成を分析。デジタルアートに応用できる普遍的なテクニックを体系的に学びます。
                     </p>
                  </div>
                  <div className="px-4 pt-8 md:pt-0">
                     <span className="block text-amber-500 font-serif italic text-sm mb-3">03. Mind</span>
                     <h3 className="text-white font-serif text-2xl mb-4">Philosophy</h3>
                     <p className="text-stone-300 leading-relaxed font-light">
                        不完全さを美とする「金継ぎ」の精神性など、作品に物語と魂を込めるための思考法を探求します。
                     </p>
                  </div>
               </div>
            </div>
         </section>

         {/* Featured Collections Grid */}
         <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0.5 bg-stone-800">
            <CollectionCard
               title={t.cards.path.title}
               subtitle={t.cards.path.sub}
               icon={Clock}
               image="https://images.unsplash.com/photo-1577720580479-7d839d829c73?auto=format&fit=crop&q=80&w=1000"
               onClick={() => onNavigate(ViewState.ART_CURRICULUM)}
            />
            <CollectionCard
               title={t.cards.timeline.title}
               subtitle={t.cards.timeline.sub}
               icon={Clock}
               image="https://images.unsplash.com/photo-1555445054-8488d053258d?auto=format&fit=crop&q=80&w=800"
               onClick={() => onNavigate(ViewState.ART_HISTORY)}
            />
            <CollectionCard
               title={t.cards.japan.title}
               subtitle={t.cards.japan.sub}
               icon={Gem}
               image="https://images.unsplash.com/photo-1528351655744-21f9260a9202?auto=format&fit=crop&q=80&w=1000"
               onClick={() => onNavigate(ViewState.ART_CRAFTS)}
            />
            <CollectionCard
               title={t.cards.tribal.title}
               subtitle={t.cards.tribal.sub}
               icon={Tent}
               image="https://images.unsplash.com/photo-1532152864698-c3093b224177?auto=format&fit=crop&q=80&w=1000"
               onClick={() => onNavigate(ViewState.ART_TRIBAL)}
            />
            <CollectionCard
               title={t.cards.look.title}
               subtitle={t.cards.look.sub}
               icon={Heart}
               image="https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&q=80&w=1000"
               onClick={() => { }}
            />
            <CollectionCard
               title={t.cards.tech.title}
               subtitle={t.cards.tech.sub}
               icon={Brush}
               image="https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&q=80&w=1000"
               onClick={() => { }}
            />
         </section>

         {/* Curator's Pick */}
         <section className="py-24 px-6 md:px-12 bg-[#262321]">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-12 items-center">
               <div className="w-full md:w-1/2 relative">
                  <div className="aspect-[3/4] overflow-hidden">
                     <img
                        src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Meisje_met_de_parel.jpg/800px-Meisje_met_de_parel.jpg"
                        alt="Vermeer Style"
                        className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                     />
                  </div>
                  <div className="absolute -bottom-6 -right-6 bg-stone-100 text-stone-900 p-6 max-w-xs shadow-2xl hidden md:block">
                     <span className="font-serif italic text-xl block mb-2">"Girl with a Pearl Earring"</span>
                     <span className="text-xs uppercase tracking-widest text-stone-500">Johannes Vermeer, 1665</span>
                  </div>
               </div>

               <div className="w-full md:w-1/2 space-y-8">
                  <span className="text-orange-400 font-bold text-xs uppercase tracking-[0.2em] flex items-center gap-2">
                     <Star size={14} /> {t.insight.label}
                  </span>
                  <h2 className="font-serif text-5xl text-stone-100 leading-tight">
                     {t.insight.title}
                  </h2>
                  <p className="text-stone-400 text-lg leading-relaxed font-light">
                     {t.insight.desc}
                  </p>
                  <div className="pt-4">
                     <button className="flex items-center gap-3 text-white border-b border-white pb-1 hover:text-orange-300 hover:border-orange-300 transition-colors">
                        {t.insight.btn} <ArrowRight size={16} />
                     </button>
                  </div>
               </div>
            </div>
         </section>

         {/* Footer */}
         <footer className="py-12 text-center text-stone-600 text-sm">
            <div className="w-8 h-8 border border-stone-800 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-500 font-serif italic">L</div>
            <p>&copy; 2024 Rise Path Atelier. {t.footer}</p>
         </footer>
      </div>
   );
};

export default ArtMuseumView;