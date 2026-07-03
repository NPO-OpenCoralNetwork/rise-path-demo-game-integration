import React from 'react';
import { ArrowLeft, ChevronRight, Tent, Users, Move, Repeat, Music, Layers, Globe } from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtTribalViewProps {
  onBack: () => void;
  onSelectChapter: (chapterId: string) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

interface Chapter {
  id: string;
  number: string;
  titleEn: string;
  titleJp: string;
  descEn: string;
  descJp: string;
  icon: any;
  color: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: 'intro',
    number: '11',
    titleEn: 'Introduction: Meaning in Form',
    titleJp: '民族アートとは何か',
    descEn: 'Art without "Artists". Understanding art as a communal tool for survival and ritual.',
    descJp: '作者不在の表現。「ファインアート」との違いと、意味を宿す形について。',
    icon: Tent,
    color: 'text-orange-400'
  },
  {
    id: 'ritual',
    number: '12A',
    titleEn: 'Indigenous & Ritual Art',
    titleJp: '先住民アート・儀礼美術',
    descEn: 'Masks, totems, and spirits. Australia, Africa, and Native American traditions.',
    descJp: '精霊・祖先・土地との関係。アフリカの仮面からドットペインティングまで。',
    icon: Move, // Represents dance/ritual movement
    color: 'text-red-400'
  },
  {
    id: 'patterns',
    number: '12B',
    titleEn: 'Patterns & Language',
    titleJp: '民族文様・パターンアート',
    descEn: 'Ainu, Persian, and African textiles. Geometry as a language of prayer and protection.',
    descJp: '文様は言語である。アイヌ文様からペルシャ絨毯まで、無限反復の美学。',
    icon: Repeat,
    color: 'text-indigo-400'
  },
  {
    id: 'crafts',
    number: '12C',
    titleEn: 'Crafts & Daily Life',
    titleJp: '民族工芸と生活道具',
    descEn: 'Beauty in utility. Local materials and the "Mingei" philosophy of functional beauty.',
    descJp: '使うための美。地産地消の素材と、壊れたら直す文化。',
    icon: Layers,
    color: 'text-amber-400'
  },
  {
    id: 'body',
    number: '12D',
    titleEn: 'Body Art & Identity',
    titleJp: '身体装飾・ボディアート',
    descEn: 'Tattoos, paint, and jewelry. The body as a canvas for social and spiritual identity.',
    descJp: '身体＝キャンバス。タトゥー、ペイント、装身具によるアイデンティティ表現。',
    icon: Users,
    color: 'text-pink-400'
  },
  {
    id: 'rhythm',
    number: '12E',
    titleEn: 'Sound & Vision',
    titleJp: '音・リズム・視覚',
    descEn: 'Drums, dance, and trance. Art as a technology to alter consciousness.',
    descJp: 'アートは「状態をつくる技術」。視覚と聴覚の融合とトランス状態。',
    icon: Music,
    color: 'text-green-400'
  },
  {
    id: 'compare',
    number: '13',
    titleEn: 'East x West Comparison',
    titleJp: '日本工芸 × 民族アート',
    descEn: 'Comparing Wabi-Sabi with Animism. Material, purpose, and spirit.',
    descJp: '素材・目的・思想の比較。日本の「用の美」と世界の「儀礼の美」。',
    icon: Globe,
    color: 'text-cyan-400'
  },
  {
    id: 'future',
    number: '15',
    titleEn: 'Future & Ethics',
    titleJp: 'これからの民族アート',
    descEn: 'Tourism, AI appropriation, and the future of cultural heritage.',
    descJp: '観光化、AIによる学習、そしてコミュニティ主導の再解釈。',
    icon: Layers,
    color: 'text-slate-400'
  }
];

const ArtTribalView: React.FC<ArtTribalViewProps> = ({ onBack, onSelectChapter, language, setLanguage }) => {
  const t = {
    en: {
      title: "Roots & Rituals",
      subtitle: "World Tribal Arts",
      intro: "Before art was decoration, it was a tool for survival. Explore the raw, rhythmic, and communal expressions of humanity.",
      back: "Atelier"
    },
    jp: {
      title: "ルーツと儀礼",
      subtitle: "世界の民族アート",
      intro: "装飾になる前、アートは生存の道具でした。人類の根源的でリズミカルな共同体の表現を探求します。",
      back: "アトリエ"
    }
  }[language];

  return (
    <div className="min-h-screen bg-[#1a1510] text-stone-200 font-sans selection:bg-red-900/30">
      
      {/* Background Texture */}
      <div className="fixed inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/bark.png')] pointer-events-none"></div>

      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#1a1510]/90 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors">
          <ArrowLeft size={20} /> <span className="font-serif italic hidden md:inline">{t.back}</span>
        </button>
        <h1 className="font-serif text-xl tracking-wider text-white flex items-center gap-2">
           <Tent size={18} className="text-orange-600" /> {t.title}
        </h1>
        
        {/* Language Toggle */}
        <div className="flex bg-stone-900 rounded-full p-1 border border-white/10">
           <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-200 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
           <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-200 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <div className="text-center mb-16 space-y-4">
           <span className="text-xs font-bold uppercase tracking-[0.3em] text-orange-600">{t.subtitle}</span>
           <p className="text-stone-400 max-w-2xl mx-auto leading-relaxed text-lg font-serif italic">
              "{t.intro}"
           </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {CHAPTERS.map((chapter) => (
              <div 
                key={chapter.id}
                onClick={() => onSelectChapter(chapter.id)}
                className="group bg-[#241e19] border border-white/5 hover:border-orange-500/30 rounded-xl p-6 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-2xl relative overflow-hidden"
              >
                 <div className={`absolute top-0 right-0 p-8 opacity-5 text-white group-hover:scale-110 transition-transform`}>
                    <chapter.icon size={120} />
                 </div>

                 <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                       <span className="font-mono text-xs text-stone-500 border border-stone-700 px-2 py-1 rounded">
                          CH {chapter.number}
                       </span>
                       <chapter.icon size={20} className={chapter.color} />
                    </div>
                    
                    <h3 className="font-serif text-2xl text-white mb-3 leading-tight group-hover:text-orange-100 transition-colors">
                       {language === 'en' ? chapter.titleEn : chapter.titleJp}
                    </h3>
                    
                    <p className="text-sm text-stone-400 leading-relaxed mb-6">
                       {language === 'en' ? chapter.descEn : chapter.descJp}
                    </p>

                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-600 group-hover:text-orange-500 transition-colors">
                       Explore <ChevronRight size={14} />
                    </div>
                 </div>
                 
                 {/* Bottom Accent Line */}
                 <div className={`absolute bottom-0 left-0 w-full h-1 ${chapter.color.replace('text', 'bg')} opacity-0 group-hover:opacity-100 transition-opacity`}></div>
              </div>
           ))}
        </div>
      </div>

    </div>
  );
};

export default ArtTribalView;