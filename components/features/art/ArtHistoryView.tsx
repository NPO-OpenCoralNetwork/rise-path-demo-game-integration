import React, { useRef } from 'react';
import { ArrowLeft, ChevronRight, Info } from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtHistoryViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const ArtHistoryView: React.FC<ArtHistoryViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const content = {
    en: {
      title: "Timeline of Beauty",
      subtitle: "From Caves to Code",
      explore: "Explore Era",
      continued: "To be continued...",
      periods: [
        { id: 'prehistoric', title: 'Prehistoric', desc: 'Cave paintings, fertility goddesses, and megalithic structures.' },
        { id: 'classical', title: 'Classical Greek', desc: 'Idealized human forms, harmony, proportion, and order.' },
        { id: 'renaissance', title: 'The Renaissance', desc: 'Rebirth of classical learning, perspective, humanism. Click to explore specifically.' },
        { id: 'baroque', title: 'Baroque', desc: 'Drama, intense light/shadow (Chiaroscuro), emotional realism.' },
        { id: 'impressionism', title: 'Impressionism', desc: 'Capturing fleeting moments, light, outdoors (En plein air).' },
        { id: 'modern', title: 'Modernism', desc: 'Abstraction, Cubism, Surrealism. Breaking traditional rules.' },
        { id: 'contemporary', title: 'Contemporary', desc: 'Conceptual art, digital media, social commentary, installation.' }
      ]
    },
    jp: {
      title: "美の年表",
      subtitle: "洞窟からコードまで",
      explore: "時代を探求",
      continued: "つづく...",
      periods: [
        { id: 'prehistoric', title: '先史時代', desc: '洞窟壁画、豊穣の女神、巨石建造物。' },
        { id: 'classical', title: '古典ギリシャ', desc: '理想化された人体、調和、比例、秩序。' },
        { id: 'renaissance', title: 'ルネサンス', desc: '古典の再生、遠近法、人文主義。クリックして詳細を探求。' },
        { id: 'baroque', title: 'バロック', desc: 'ドラマ、強烈な光と影（キアロスクーロ）、感情的リアリズム。' },
        { id: 'impressionism', title: '印象派', desc: '移ろう瞬間、光、戸外制作（アン・プレネール）。' },
        { id: 'modern', title: 'モダニズム', desc: '抽象、キュビズム、シュルレアリスム。伝統的なルールの破壊。' },
        { id: 'contemporary', title: '現代アート', desc: 'コンセプチュアルアート、デジタルメディア、社会批評、インスタレーション。' }
      ]
    }
  };

  const t = content[language];

  // Merge static data (images/years) with dynamic text
  const STATIC_PERIODS = [
    { id: 'prehistoric', year: '30,000 BCE', image: 'https://images.unsplash.com/photo-1531515933456-1132679860b7?auto=format&fit=crop&q=80&w=800' },
    { id: 'classical', year: '500 BCE', image: 'https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?auto=format&fit=crop&q=80&w=800' },
    { id: 'renaissance', year: '1400', image: 'https://images.unsplash.com/photo-1577720580479-7d839d829c73?auto=format&fit=crop&q=80&w=800', linkable: true },
    { id: 'baroque', year: '1600', image: 'https://images.unsplash.com/photo-1578301978018-317957731e73?auto=format&fit=crop&q=80&w=800' },
    { id: 'impressionism', year: '1870', image: 'https://images.unsplash.com/photo-1597423244036-ef5020e83f3c?auto=format&fit=crop&q=80&w=800' },
    { id: 'modern', year: '1900', image: 'https://images.unsplash.com/photo-1541963463532-d68292c34b19?auto=format&fit=crop&q=80&w=800' },
    { id: 'contemporary', year: '1970 - Present', image: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=800' }
  ];

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === 'left' ? -400 : 400;
      current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handlePeriodClick = (periodId: string) => {
    if (periodId === 'renaissance') {
      onNavigate(ViewState.ART_PERIOD_DETAIL);
    }
  };

  return (
    <div className="h-screen bg-[#1c1917] text-stone-200 flex flex-col font-sans overflow-hidden">
      
      {/* Header */}
      <div className="px-8 py-6 flex items-center justify-between border-b border-stone-800 z-10 bg-[#1c1917]">
         <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/5 rounded-full text-stone-400 hover:text-white transition-colors">
               <ArrowLeft size={24} />
            </button>
            <div>
               <h1 className="font-serif text-2xl italic text-white">{t.title}</h1>
               <p className="text-xs text-stone-500 uppercase tracking-widest">{t.subtitle}</p>
            </div>
         </div>
         <div className="flex items-center gap-4">
            {/* Language Toggle */}
            <div className="flex bg-stone-800 rounded-full p-1 border border-stone-700">
               <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
               <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
            </div>
            <div className="flex gap-2">
               <button onClick={() => scroll('left')} className="p-3 border border-stone-700 hover:bg-stone-800 rounded-full transition-colors">
                  <ArrowLeft size={16} />
               </button>
               <button onClick={() => scroll('right')} className="p-3 border border-stone-700 hover:bg-stone-800 rounded-full transition-colors">
                  <ChevronRight size={16} />
               </button>
            </div>
         </div>
      </div>

      {/* Horizontal Scroll Area */}
      <div 
         ref={scrollRef}
         className="flex-1 overflow-x-auto flex items-center gap-0 scrollbar-hide snap-x snap-mandatory"
      >
         {/* Start Padding */}
         <div className="w-[10vw] shrink-0"></div>

         {/* Line Background */}
         <div className="fixed top-1/2 left-0 right-0 h-px bg-stone-800 z-0 pointer-events-none"></div>

         {STATIC_PERIODS.map((staticPeriod, idx) => {
            const periodText = t.periods[idx];
            return (
            <div key={staticPeriod.id} className="w-[400px] md:w-[600px] shrink-0 h-[70vh] p-8 snap-center flex flex-col justify-center relative group">
               
               {/* Year Marker on Line */}
               <div className="absolute top-1/2 left-8 w-4 h-4 bg-stone-900 border-2 border-stone-600 rounded-full z-10 -translate-y-1/2 group-hover:bg-white group-hover:border-white transition-colors duration-500"></div>
               <div className="absolute top-[48%] left-16 font-mono text-stone-500 text-sm group-hover:text-white transition-colors">{staticPeriod.year}</div>

               {/* Content Card - Alternating Top/Bottom */}
               <div 
                  onClick={() => handlePeriodClick(staticPeriod.id)}
                  className={`
                    relative z-10 w-full bg-[#262321] border border-stone-800 p-0 overflow-hidden shadow-2xl transition-transform duration-700 group-hover:scale-105
                    ${idx % 2 === 0 ? 'mb-24' : 'mt-24'}
                    ${staticPeriod.linkable ? 'cursor-pointer hover:border-orange-400/50' : ''}
               `}>
                  <div className="aspect-video overflow-hidden relative">
                     <img 
                        src={staticPeriod.image} 
                        alt={periodText.title} 
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110 opacity-80 group-hover:opacity-100"
                     />
                     {staticPeriod.linkable && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                           <span className="border border-white text-white px-4 py-2 rounded-full font-serif italic">Enter Gallery</span>
                        </div>
                     )}
                  </div>
                  <div className="p-8">
                     <h2 className="font-serif text-3xl text-white mb-2">{periodText.title}</h2>
                     <p className="text-stone-400 font-light leading-relaxed mb-6 border-l-2 border-stone-700 pl-4 group-hover:border-white transition-colors">
                        {periodText.desc}
                     </p>
                     <button className="text-xs font-bold uppercase tracking-widest text-stone-500 group-hover:text-white flex items-center gap-2 transition-colors">
                        {t.explore} <ChevronRight size={14} />
                     </button>
                  </div>
               </div>

            </div>
         )})}

         {/* End Padding */}
         <div className="w-[20vw] shrink-0 flex items-center justify-center text-stone-600">
            <span className="font-serif italic">{t.continued}</span>
         </div>
      </div>

    </div>
  );
};

export default ArtHistoryView;