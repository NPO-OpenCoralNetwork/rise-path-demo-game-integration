import React, { useState } from 'react';
import { ArrowLeft, Sparkles, Hammer, Brush, Heart, ArrowRight, RotateCcw } from 'lucide-react';
import { ViewState } from '../../../types';

interface ArtKintsugiViewProps {
  onBack: () => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const ArtKintsugiView: React.FC<ArtKintsugiViewProps> = ({ onBack, language, setLanguage }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const content = {
    en: {
      title: "Kintsugi",
      back: "Back to Atelier",
      perfect: "Perfect Bowl",
      restart: "Restart Journey",
      steps: [
        {
          id: 1, title: "The Break (Mended)", jp: "割れ (Ware)", icon: Hammer,
          desc: "Kintsugi begins not with creation, but with destruction. A bowl falls. It breaks. In Western philosophy, the object is now 'broken' and 'useless'. In Kintsugi, its history has just begun.",
          action: "Break the Bowl"
        },
        {
          id: 2, title: "The Assembly", jp: "継ぎ (Tsugi)", icon: Brush,
          desc: "We do not hide the damage. We clean the shards and prepare the urushi lacquer. It is a slow, meditative process of fitting the pieces back together.",
          action: "Apply Lacquer"
        },
        {
          id: 3, title: "The Gold", jp: "金 (Kin)", icon: Sparkles,
          desc: "Gold dust is sprinkled onto the sticky lacquer seams. The cracks become veins of gold. The flaw becomes the most beautiful part of the object.",
          action: "Sprinkle Gold"
        },
        {
          id: 4, title: "The Philosophy", jp: "無心 (Mushin)", icon: Heart,
          desc: "Wabi-sabi: Finding beauty in imperfection. Your scars are not things to be hidden. They are proof of your resilience and history. You are more beautiful for having been broken.",
          action: "Finish"
        }
      ]
    },
    jp: {
      title: "金継ぎ",
      back: "アトリエに戻る",
      perfect: "完全な器",
      restart: "旅をやり直す",
      steps: [
        {
          id: 1, title: "割れ", jp: "Ware", icon: Hammer,
          desc: "金継ぎは創造ではなく、破壊から始まります。器が落ち、割れる。西洋哲学では、その物体は「壊れた」「役に立たない」ものとなりますが、金継ぎにおいては、その歴史がまさに始まったところなのです。",
          action: "器を割る"
        },
        {
          id: 2, title: "継ぎ", jp: "Tsugi", icon: Brush,
          desc: "私たちは損傷を隠しません。破片を清め、漆を用意します。これは、破片を元の形に戻す、ゆっくりとした瞑想的なプロセスです。",
          action: "漆を塗る"
        },
        {
          id: 3, title: "金", jp: "Kin", icon: Sparkles,
          desc: "粘着性のある漆の継ぎ目に金粉を蒔きます。ひび割れは金の葉脈となります。欠点は、その物体の最も美しい部分へと変わるのです。",
          action: "金を蒔く"
        },
        {
          id: 4, title: "無心", jp: "Mushin", icon: Heart,
          desc: "侘び寂び：不完全さの中に美を見出すこと。あなたの傷跡は隠すべきものではありません。それはあなたの回復力と歴史の証です。壊れたことがあるからこそ、あなたはより美しいのです。",
          action: "完了"
        }
      ]
    }
  };

  const t = content[language];

  const handleNext = () => {
    setIsAnimating(true);
    setTimeout(() => {
      if (currentStep < t.steps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        // Reset or finish
        setCurrentStep(0);
      }
      setIsAnimating(false);
    }, 1000); // Animation duration
  };

  const step = t.steps[currentStep];

  return (
    <div className="min-h-screen bg-[#1c1917] text-stone-200 font-sans flex flex-col items-center relative overflow-hidden">
      {/* Background Texture */}
      <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/washi.png')]"></div>

      {/* Navbar */}
      <div className="w-full px-8 py-6 flex items-center justify-between z-20">
        <button onClick={onBack} className="flex items-center gap-2 text-stone-400 hover:text-gold-400 transition-colors">
          <ArrowLeft size={20} /> {t.back}
        </button>
        <div className="flex items-center gap-4">
           {/* Simple Language Toggle */}
           <div className="flex bg-stone-800 rounded-full p-1 border border-stone-700">
               <button onClick={() => setLanguage('en')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>EN</button>
               <button onClick={() => setLanguage('jp')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-white'}`}>JP</button>
           </div>
           <span className="font-serif italic text-2xl text-stone-500">{t.title}</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-center gap-12 px-6 relative z-10">
        
        {/* Visual Side */}
        <div className="w-full md:w-1/2 aspect-square relative flex items-center justify-center">
          <div className="relative w-[300px] h-[300px] md:w-[500px] md:h-[500px]">
             {/* Dynamic Visual based on step */}
             <div className={`
                absolute inset-0 transition-all duration-1000 flex items-center justify-center
                ${isAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}
             `}>
                {currentStep === 0 && (
                   <div className="w-64 h-64 bg-stone-800 rounded-full shadow-2xl border border-stone-700 flex items-center justify-center text-stone-600">
                      <span className="font-serif text-sm">{t.perfect}</span>
                   </div>
                )}
                {currentStep === 1 && (
                   <div className="relative w-64 h-64">
                      {/* Shards */}
                      <div className="absolute top-0 left-0 w-32 h-64 bg-stone-800 rounded-l-full border-r-2 border-stone-900 transform -translate-x-4 rotate-[-10deg]"></div>
                      <div className="absolute top-0 right-0 w-32 h-64 bg-stone-800 rounded-r-full border-l-2 border-stone-900 transform translate-x-4 rotate-[10deg]"></div>
                   </div>
                )}
                {currentStep === 2 && (
                   <div className="w-64 h-64 bg-stone-800 rounded-full shadow-2xl border border-stone-700 relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                         <div className="w-0.5 h-full bg-stone-900"></div> {/* The crack */}
                         <div className="w-full h-0.5 bg-stone-900 absolute"></div>
                      </div>
                   </div>
                )}
                {currentStep === 3 && (
                   <div className="w-64 h-64 bg-stone-800 rounded-full shadow-2xl border border-stone-700 relative overflow-hidden">
                       <svg className="absolute inset-0 w-full h-full pointer-events-none">
                          <path d="M128 0 L128 256 M0 128 L256 128" stroke="#FBBF24" strokeWidth="4" strokeLinecap="round" className="animate-draw" />
                       </svg>
                       {/* Gold particles */}
                       <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-yellow-400 rounded-full blur-[2px] shadow-[0_0_10px_gold]"></div>
                   </div>
                )}
             </div>

             {/* Background Circle */}
             <div className="absolute inset-0 rounded-full border border-stone-800 scale-125 opacity-30"></div>
             <div className="absolute inset-0 rounded-full border border-stone-800 scale-150 opacity-10"></div>
          </div>
        </div>

        {/* Text Side */}
        <div className="w-full md:w-1/2 space-y-8 text-center md:text-left">
           <div className="space-y-2">
              <span className="text-yellow-500/80 font-mono text-xs uppercase tracking-widest block">{step.id} / 4</span>
              <h1 className="font-serif text-5xl md:text-6xl text-white mb-2">{step.jp}</h1>
              <h2 className="text-2xl text-stone-400 font-light italic">{step.title}</h2>
           </div>

           <p className="text-lg text-stone-300 leading-relaxed font-light border-l-2 border-stone-700 pl-6 mx-auto md:mx-0 max-w-md">
              {step.desc}
           </p>

           <div className="pt-8">
              <button 
                onClick={handleNext}
                className="group relative inline-flex items-center justify-center px-8 py-4 font-serif text-lg text-stone-900 transition-all duration-200 bg-stone-100 font-medium rounded-sm hover:bg-white hover:px-10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-500 focus:ring-offset-stone-900"
              >
                 {currentStep === 3 ? (
                    <span className="flex items-center gap-2"><RotateCcw size={18}/> {t.restart}</span>
                 ) : (
                    <span className="flex items-center gap-2">{step.action} <step.icon size={18} className="text-stone-600 group-hover:text-yellow-600 transition-colors"/></span>
                 )}
              </button>
           </div>
        </div>
      </div>

    </div>
  );
};

export default ArtKintsugiView;