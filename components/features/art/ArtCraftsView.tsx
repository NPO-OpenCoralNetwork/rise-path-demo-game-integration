import React from 'react';
import { ArrowLeft, ChevronRight, Gem, BookOpen } from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtCraftsViewProps {
  onBack: () => void;
  onSelectCraft: (craftId: string) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

interface CraftCategory {
  id: string;
  nameEn: string;
  nameJp: string;
  kanji: string;
  description: string;
  image: string;
  concept: string; // Philosophical concept (e.g. "Imperfection")
}

const CRAFTS: CraftCategory[] = [
  {
    id: 'kintsugi',
    nameEn: 'Kintsugi',
    nameJp: '金継ぎ',
    kanji: '繕',
    description: 'The art of repairing broken pottery with lacquer and gold, treating breakage as part of history.',
    image: 'https://images.unsplash.com/photo-1615486511484-92e590508b80?auto=format&fit=crop&q=80&w=800',
    concept: 'Wabi-Sabi'
  },
  {
    id: 'urushi',
    nameEn: 'Urushi Lacquer',
    nameJp: '漆工芸',
    kanji: '漆',
    description: 'A deeply durable, natural lacquer technique used for thousands of years to protect and beautify.',
    image: 'https://images.unsplash.com/photo-1627885918738-4b7264379761?auto=format&fit=crop&q=80&w=800',
    concept: 'Time & Depth'
  },
  {
    id: 'dyeing',
    nameEn: 'Dyeing',
    nameJp: '染め物',
    kanji: '染',
    description: 'Indigo (Aizome) and Yuzen. The alchemy of water, plant, and fabric creating living colors.',
    image: 'https://images.unsplash.com/photo-1598556776374-2264821a88b2?auto=format&fit=crop&q=80&w=800',
    concept: 'Nature'
  },
  {
    id: 'blades',
    nameEn: 'Blades',
    nameJp: '刃物',
    kanji: '刀',
    description: 'Katana and kitchen knives. The spiritual discipline of forging steel into perfection.',
    image: 'https://images.unsplash.com/photo-1592329347810-258af722b5d4?auto=format&fit=crop&q=80&w=800',
    concept: 'Soul'
  },
  {
    id: 'washi',
    nameEn: 'Washi Paper',
    nameJp: '和紙',
    kanji: '紙',
    description: 'Traditional paper making. Warm, durable, and filtering light in unique ways.',
    image: 'https://images.unsplash.com/photo-1583225883296-619429302636?auto=format&fit=crop&q=80&w=800',
    concept: 'Warmth'
  },
  {
    id: 'spatial',
    nameEn: 'Spatial Crafts',
    nameJp: '空間工芸',
    kanji: '間',
    description: 'Kumiko, Tatami, and Fusuma. Crafting the space and light itself (Ma).',
    image: 'https://images.unsplash.com/photo-1579762183204-766723223072?auto=format&fit=crop&q=80&w=800',
    concept: 'Ma (Space)'
  },
  {
    id: 'tea',
    nameEn: 'Tea Ceremony',
    nameJp: '茶道',
    kanji: '茶',
    description: 'The way of tea. A synthesis of all arts, focused on hospitality and mindfulness.',
    image: 'https://images.unsplash.com/photo-1558963820-2139b2b93094?auto=format&fit=crop&q=80&w=800',
    concept: 'Harmony'
  },
  {
    id: 'zen',
    nameEn: 'Zen',
    nameJp: '禅',
    kanji: '禅',
    description: 'Meditation and gardens. Finding the infinite in the empty.',
    image: 'https://images.unsplash.com/photo-1599707367072-cd6ad66aa18d?auto=format&fit=crop&q=80&w=800',
    concept: 'Emptiness'
  }
];

const ArtCraftsView: React.FC<ArtCraftsViewProps> = ({ onBack, onSelectCraft, language, setLanguage }) => {
  const t = {
    en: {
      title: "Japanese Aesthetics",
      subtitle: "The Atelier of Masters",
      intro: "Discover the 8 paths of traditional craftsmanship. Each discipline is not just a technique, but a way of seeing the world.",
      back: "Atelier"
    },
    jp: {
      title: "日本の美",
      subtitle: "匠のアトリエ",
      intro: "伝統工芸の8つの道。それぞれの規律は単なる技術ではなく、世界を見るための「眼」なのです。",
      back: "アトリエ"
    }
  }[language];

  return (
    <div className="min-h-screen bg-[#1c1917] text-stone-200 font-sans selection:bg-orange-900/30">
      
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#1c1917]/90 backdrop-blur-md border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors">
          <ArrowLeft size={20} /> <span className="font-serif italic hidden md:inline">{t.back}</span>
        </button>
        <h1 className="font-serif text-xl tracking-wider text-white">{t.title}</h1>
        
        {/* Language Toggle */}
        <div className="flex bg-stone-800 rounded-full p-1 border border-stone-700">
           <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
           <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-16 space-y-4">
           <span className="text-xs font-bold uppercase tracking-[0.3em] text-orange-500">{t.subtitle}</span>
           <p className="text-stone-400 max-w-2xl mx-auto leading-relaxed">
              {t.intro}
           </p>
        </div>

        {/* Masonry-ish Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
           {CRAFTS.map((craft) => (
              <div 
                key={craft.id}
                onClick={() => onSelectCraft(craft.id)}
                className="group relative aspect-[3/4] bg-stone-900 overflow-hidden cursor-pointer rounded-sm border border-stone-800 hover:border-orange-500/50 transition-colors"
              >
                 {/* Background Image */}
                 <div className="absolute inset-0">
                    <img 
                      src={craft.image} 
                      alt={craft.nameEn} 
                      className="w-full h-full object-cover opacity-60 group-hover:scale-110 group-hover:opacity-40 transition-all duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#1c1917] via-transparent to-transparent opacity-80"></div>
                 </div>

                 {/* Content */}
                 <div className="absolute inset-0 p-6 flex flex-col justify-between">
                    <div className="flex justify-between items-start">
                       <span className="text-4xl font-serif text-white/20 font-bold group-hover:text-white/40 transition-colors pointer-events-none select-none">
                          {craft.kanji}
                       </span>
                       <div className="bg-stone-900/50 backdrop-blur px-3 py-1 rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                          <span className="text-[10px] uppercase tracking-widest text-orange-300">{craft.concept}</span>
                       </div>
                    </div>

                    <div>
                       <h3 className="font-serif text-2xl text-white mb-1 group-hover:text-orange-100 transition-colors">
                          {language === 'en' ? craft.nameEn : craft.nameJp}
                       </h3>
                       <p className="text-xs text-stone-400 line-clamp-2 leading-relaxed opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-y-4 group-hover:translate-y-0">
                          {craft.description}
                       </p>
                    </div>
                 </div>
              </div>
           ))}
        </div>
      </div>

    </div>
  );
};

export default ArtCraftsView;