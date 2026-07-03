import React, { useState } from 'react';
import { 
  ArrowLeft, BookOpen, Star, ChevronRight, Lock, CheckCircle2, 
  MapPin, Play, Clock, Sparkles 
} from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtCurriculumViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const ArtCurriculumView: React.FC<ArtCurriculumViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  const [hoveredChapter, setHoveredChapter] = useState<number | null>(null);

  // Content Dictionary
  const content = {
    en: {
      title: "Curator's Path",
      subtitle: "History of Art • 15 Chapters",
      level: "Level 2 Curator",
      current: "Current Lesson",
      duration: "15 min",
      heroTitle: "Ancient Civilizations",
      heroDesc: "Chapter 2: Why did Egyptians design for eternity? Explore the massive shift from magical cave art to the orderly design of empires.",
      heroBtn: "Continue",
      action: {
        review: "Review",
        start: "Start Lesson"
      },
      eras: [
        {
          id: 'era_intro', title: 'Perspective', subtitle: 'Introduction',
          chapters: [{ title: 'Introduction', subtitle: 'Why humans create', topics: ['Technology', 'Religion', 'Power', 'Play'] }]
        },
        {
          id: 'era_foundations', title: 'The Foundations', subtitle: 'Prehistory - Middle Ages',
          chapters: [
            { title: 'Primal Art', subtitle: 'Cave paintings & Magic', topics: ['Cave Art', 'Rhythm', 'Ritual'] },
            { title: 'Ancient Civilizations', subtitle: 'Egypt, Greece, Rome', topics: ['Eternity', 'Mythology', 'Realism'] },
            { title: 'Faith & Symbolism', subtitle: 'The Middle Ages', topics: ['Christianity', 'Gothic', 'Anonymous'] }
          ]
        },
        {
          id: 'era_awakening', title: 'The Awakening', subtitle: 'Renaissance - Realism',
          chapters: [
            { title: 'The Renaissance', subtitle: 'Redesigning the World', topics: ['Perspective', 'Da Vinci', 'Humanism'] },
            { title: 'Baroque to Rococo', subtitle: 'Emotion & Light', topics: ['Drama', 'Power', 'Pleasure'] },
            { title: 'Dawn of Modernity', subtitle: 'Realism & Impressionism', topics: ['Industrial Rev', 'Photography', 'Vision'] }
          ]
        },
        {
          id: 'era_modern', title: 'The Breakdown', subtitle: 'Modern Art',
          chapters: [
            { title: 'The Great Shift', subtitle: 'Cubism & Abstraction', topics: ['Deconstruction', 'Meaningless', 'Dada'] },
            { title: 'Art as a Question', subtitle: 'Conceptual & Body', topics: ['Philosophy', 'Performance', 'Definition'] },
            { title: 'Pop & Mass Culture', subtitle: 'Warhol & Replication', topics: ['Ads', 'Business', 'Media'] }
          ]
        },
        {
          id: 'era_now', title: 'Now & Future', subtitle: 'Contemporary - Tomorrow',
          chapters: [
            { title: 'Postmodern Diversity', subtitle: 'No More Authority', topics: ['Context', 'Identity', 'No Answers'] },
            { title: 'Contemporary Art', subtitle: 'Experience & Tech', topics: ['Installation', 'Social', 'AI/NFT'] },
            { title: 'Japanese Art Flow', subtitle: 'Jomon to Contemporary', topics: ['Ukiyo-e', 'Reinterpretation', 'Flat'] },
            { title: 'The Future of Art', subtitle: 'Co-creation with AI', topics: ['Community', 'Maker Society', 'Role'] },
            { title: 'Outro', subtitle: 'From Viewer to Creator', topics: ['Expression', 'Ongoing History'] }
          ]
        }
      ]
    },
    jp: {
      title: "キュレーターの道",
      subtitle: "美術史 • 全15章",
      level: "レベル 2 キュレーター",
      current: "現在のレッスン",
      duration: "15 分",
      heroTitle: "古代文明",
      heroDesc: "第2章：なぜエジプト人は「永遠」をデザインしたのか？ 呪術的な洞窟壁画から、帝国の秩序あるデザインへの巨大なシフトを探ります。",
      heroBtn: "続ける",
      action: {
        review: "復習",
        start: "レッスン開始"
      },
      eras: [
        {
          id: 'era_intro', title: 'パースペクティブ', subtitle: 'イントロダクション',
          chapters: [{ title: '導入', subtitle: 'なぜ人は創るのか', topics: ['技術', '宗教', '権力', '遊び'] }]
        },
        {
          id: 'era_foundations', title: '礎（いしずえ）', subtitle: '先史時代 - 中世',
          chapters: [
            { title: '原初の芸術', subtitle: '洞窟壁画と魔術', topics: ['洞窟壁画', 'リズム', '儀式'] },
            { title: '古代文明', subtitle: 'エジプト、ギリシャ、ローマ', topics: ['永遠', '神話', '写実主義'] },
            { title: '信仰と象徴', subtitle: '中世', topics: ['キリスト教', 'ゴシック', '匿名性'] }
          ]
        },
        {
          id: 'era_awakening', title: '覚醒', subtitle: 'ルネサンス - 写実主義',
          chapters: [
            { title: 'ルネサンス', subtitle: '世界の再設計', topics: ['遠近法', 'ダ・ヴィンチ', '人文主義'] },
            { title: 'バロックからロココへ', subtitle: '感情と光', topics: ['ドラマ', '権力', '快楽'] },
            { title: '近代の夜明け', subtitle: '写実主義と印象派', topics: ['産業革命', '写真', '視覚'] }
          ]
        },
        {
          id: 'era_modern', title: '解体', subtitle: 'モダンアート',
          chapters: [
            { title: '大転換', subtitle: 'キュビズムと抽象', topics: ['脱構築', '無意味', 'ダダ'] },
            { title: '問いとしてのアート', subtitle: 'コンセプチュアル & 身体', topics: ['哲学', 'パフォーマンス', '定義'] },
            { title: 'ポップ & 大衆文化', subtitle: 'ウォーホルと複製', topics: ['広告', 'ビジネス', 'メディア'] }
          ]
        },
        {
          id: 'era_now', title: '現在と未来', subtitle: '現代 - 明日',
          chapters: [
            { title: 'ポストモダンの多様性', subtitle: '権威の喪失', topics: ['文脈', 'アイデンティティ', '答えはない'] },
            { title: '現代アート', subtitle: '体験とテクノロジー', topics: ['インスタレーション', '社会', 'AI/NFT'] },
            { title: '日本美術の流れ', subtitle: '縄文から現代へ', topics: ['浮世絵', '再解釈', 'スーパーフラット'] },
            { title: 'アートの未来', subtitle: 'AIとの共創', topics: ['コミュニティ', 'メイカー社会', '役割'] },
            { title: '終わりに', subtitle: '鑑賞者から創造者へ', topics: ['表現', '続く歴史'] }
          ]
        }
      ]
    }
  };

  const t = content[language];

  // Static structure with images and IDs (merged with dynamic text)
  const BASE_ERAS = [
    {
      id: 'era_intro', color: 'text-stone-300', borderColor: 'border-stone-700',
      chapters: [ { id: 0, image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&q=80&w=800', status: 'completed', specialLink: ViewState.ART_INTRO }]
    },
    {
      id: 'era_foundations', color: 'text-amber-700', borderColor: 'border-amber-900/30',
      chapters: [
        { id: 1, image: 'https://images.unsplash.com/photo-1531515933456-1132679860b7?auto=format&fit=crop&q=80&w=800', status: 'completed' },
        { id: 2, image: 'https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?auto=format&fit=crop&q=80&w=800', status: 'active' },
        { id: 3, image: 'https://images.unsplash.com/photo-1548625361-9872e457e33a?auto=format&fit=crop&q=80&w=800', status: 'locked' }
      ]
    },
    {
      id: 'era_awakening', color: 'text-orange-500', borderColor: 'border-orange-900/30',
      chapters: [
        { id: 4, image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/800px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg', status: 'locked', specialLink: ViewState.ART_PERIOD_DETAIL },
        { id: 5, image: 'https://images.unsplash.com/photo-1578301978018-317957731e73?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 6, image: 'https://images.unsplash.com/photo-1597423244036-ef5020e83f3c?auto=format&fit=crop&q=80&w=800', status: 'locked' }
      ]
    },
    {
      id: 'era_modern', color: 'text-blue-400', borderColor: 'border-blue-900/30',
      chapters: [
        { id: 7, image: 'https://images.unsplash.com/photo-1541963463532-d68292c34b19?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 8, image: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 9, image: 'https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&q=80&w=800', status: 'locked' }
      ]
    },
    {
      id: 'era_now', color: 'text-purple-400', borderColor: 'border-purple-900/30',
      chapters: [
        { id: 10, image: 'https://images.unsplash.com/photo-1492037766660-2a56f9eb3fcb?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 11, image: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 12, image: 'https://images.unsplash.com/photo-1582201942988-13e60e4556ee?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 13, image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800', status: 'locked' },
        { id: 14, image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&q=80&w=800', status: 'locked' }
      ]
    }
  ];

  const handleChapterClick = (chapter: any) => {
    if (chapter.status === 'locked') return;

    if (chapter.specialLink) {
      onNavigate(chapter.specialLink);
    } else {
      // Navigate to ART_PERIOD_DETAIL for all unlocked chapters
      onNavigate(ViewState.ART_PERIOD_DETAIL);
    }
  };

  return (
    <div className="min-h-screen bg-[#1c1917] text-stone-200 font-sans selection:bg-orange-900/30">
      
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#1c1917]/90 backdrop-blur-md border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 text-stone-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-serif italic text-xl text-white">{t.title}</h1>
            <p className="text-xs text-stone-500 uppercase tracking-widest">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-stone-800 rounded-full border border-stone-700">
              <Star size={12} className="text-yellow-500 fill-yellow-500" />
              <span className="text-xs font-bold text-stone-300">{t.level}</span>
           </div>
           {/* Simple Language Toggle */}
           <div className="flex bg-stone-800 rounded-full p-1 border border-stone-700">
               <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
               <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
           </div>
        </div>
      </div>

      {/* Hero / Active Lesson */}
      <div className="relative h-[40vh] w-full overflow-hidden flex items-end p-8 md:p-16 border-b border-stone-800">
         <div className="absolute inset-0">
            <img 
               src="https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?auto=format&fit=crop&q=80&w=2000" 
               className="w-full h-full object-cover opacity-30 grayscale hover:grayscale-0 transition-all duration-1000"
               alt="Hero"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1c1917] via-[#1c1917]/50 to-transparent"></div>
         </div>
         
         <div className="relative z-10 max-w-4xl">
            <div className="flex items-center gap-3 mb-4 animate-in slide-in-from-bottom-4 fade-in duration-700">
               <span className="bg-amber-700/20 text-amber-500 border border-amber-500/30 px-3 py-1 rounded text-xs font-bold uppercase tracking-wider">
                  {t.current}
               </span>
               <span className="text-stone-400 text-sm flex items-center gap-1"><Clock size={14}/> {t.duration}</span>
            </div>
            <h2 className="font-serif text-5xl md:text-6xl text-white mb-6 animate-in slide-in-from-bottom-6 fade-in duration-700 delay-100">
               {t.heroTitle}
            </h2>
            <p className="text-stone-300 text-lg max-w-2xl mb-8 animate-in slide-in-from-bottom-8 fade-in duration-700 delay-200">
               {t.heroDesc}
            </p>
            <button className="bg-white text-stone-900 px-8 py-3 rounded-sm font-serif italic text-lg hover:bg-stone-200 transition-colors flex items-center gap-2 animate-in slide-in-from-bottom-10 fade-in duration-700 delay-300">
               {t.heroBtn} <Play size={16} fill="currentColor" />
            </button>
         </div>
      </div>

      {/* Curriculum List */}
      <div className="max-w-5xl mx-auto px-6 py-16">
         
         {BASE_ERAS.map((baseEra, eraIdx) => {
            const translatedEra = t.eras[eraIdx];
            
            return (
            <div key={baseEra.id} className="mb-24 relative">
               {/* Era Vertical Line */}
               {eraIdx !== BASE_ERAS.length - 1 && (
                  <div className={`absolute left-[19px] top-12 bottom-[-96px] w-0.5 bg-gradient-to-b from-stone-800 via-stone-800 to-transparent z-0`}></div>
               )}

               {/* Era Header */}
               <div className="flex items-start gap-6 mb-10 relative z-10">
                  <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#1c1917] border border-stone-700 text-stone-500 font-serif italic">
                     {eraIdx + 1}
                  </div>
                  <div>
                     <h3 className={`font-serif text-3xl ${baseEra.color}`}>{translatedEra.title}</h3>
                     <p className="text-stone-500 text-sm uppercase tracking-widest mt-1">{translatedEra.subtitle}</p>
                  </div>
               </div>

               {/* Chapters Grid */}
               <div className="pl-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {baseEra.chapters.map((baseChapter, chIdx) => {
                     const translatedChapter = translatedEra.chapters[chIdx];
                     const isLocked = baseChapter.status === 'locked';
                     const isCompleted = baseChapter.status === 'completed';
                     const isActive = baseChapter.status === 'active';

                     return (
                        <div 
                           key={baseChapter.id}
                           onMouseEnter={() => setHoveredChapter(baseChapter.id)}
                           onMouseLeave={() => setHoveredChapter(null)}
                           onClick={() => handleChapterClick(baseChapter)}
                           className={`
                              group relative bg-[#262321] border transition-all duration-300 rounded-sm overflow-hidden flex flex-col
                              ${isActive 
                                 ? `border-stone-500 shadow-xl shadow-${baseEra.color.split('-')[1]}-900/10 scale-105 z-10 cursor-pointer` 
                                 : isLocked 
                                    ? 'border-stone-800 opacity-60 cursor-not-allowed' 
                                    : 'border-stone-800 hover:border-stone-600 cursor-pointer'}
                           `}
                        >
                           {/* Image Area */}
                           <div className="h-40 overflow-hidden relative">
                              <img 
                                 src={baseChapter.image} 
                                 alt={translatedChapter.title} 
                                 className={`w-full h-full object-cover transition-transform duration-700 ${isActive || (hoveredChapter === baseChapter.id && !isLocked) ? 'scale-110 grayscale-0' : 'grayscale'}`}
                              />
                              {isCompleted && (
                                 <div className="absolute top-3 right-3 bg-stone-900/80 text-green-500 p-1 rounded-full">
                                    <CheckCircle2 size={16} />
                                 </div>
                              )}
                              {isLocked && (
                                 <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                    <Lock size={24} className="text-stone-600" />
                                 </div>
                              )}
                           </div>

                           {/* Content Area */}
                           <div className="p-5 flex-1 flex flex-col">
                              <div className="mb-3">
                                 <span className="text-stone-500 font-mono text-[10px] uppercase tracking-widest block mb-1">Chapter {baseChapter.id}</span>
                                 <h4 className={`font-serif text-xl ${isActive ? 'text-white' : 'text-stone-300'} leading-tight`}>
                                    {translatedChapter.title}
                                 </h4>
                              </div>
                              
                              <p className="text-stone-500 text-xs mb-4 line-clamp-2">
                                 {translatedChapter.subtitle}
                              </p>

                              <div className="mt-auto flex flex-wrap gap-2">
                                 {translatedChapter.topics.slice(0, 2).map(topic => (
                                    <span key={topic} className="text-[10px] px-2 py-1 bg-stone-800 text-stone-400 rounded-sm border border-stone-700">
                                       {topic}
                                    </span>
                                 ))}
                              </div>
                           </div>
                           
                           {/* Hover Action */}
                           {!isLocked && (
                              <div className={`absolute bottom-0 left-0 w-full bg-white text-stone-900 text-center py-2 text-xs font-bold uppercase tracking-widest transition-transform duration-300 ${isActive || hoveredChapter === baseChapter.id ? 'translate-y-0' : 'translate-y-full'}`}>
                                 {isCompleted ? t.action.review : t.action.start}
                              </div>
                           )}
                        </div>
                     );
                  })}
               </div>
            </div>
         )})}

      </div>
    </div>
  );
};

export default ArtCurriculumView;