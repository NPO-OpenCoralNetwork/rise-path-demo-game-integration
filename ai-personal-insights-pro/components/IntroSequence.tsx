
import React, { useState, useEffect } from 'react';
import { AssessmentProfile } from '../types';

interface IntroSequenceProps {
  profile: AssessmentProfile;
  onFinish: () => void;
}

const IntroSequence: React.FC<IntroSequenceProps> = ({ profile, onFinish }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [contentVisible, setContentVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  const typeConfigs: Record<string, { icon: string; bg: string; message: string; sub: string }> = {
    '冒険家': { icon: 'fa-wind', bg: 'from-orange-400 to-red-500', message: 'あなたは、未知を恐れぬ探求者。', sub: 'あなたの好奇心は、新しい世界を創り出すエネルギーに満ちています。' },
    '戦略家': { icon: 'fa-chess-knight', bg: 'from-blue-500 to-indigo-600', message: 'あなたは、盤面を支配する理知の人。', sub: '混沌とした状況から最適解を導き出す、鋭い洞察力を持っています。' },
    'サポーター': { icon: 'fa-hand-holding-heart', bg: 'from-pink-400 to-rose-500', message: 'あなたは、調和をもたらす慈愛の人。', sub: '他者に寄り添い、絆を深めることで、集団に真の強さを与えます。' },
    '思想家': { icon: 'fa-lightbulb', bg: 'from-purple-500 to-indigo-700', message: 'あなたは、深淵を覗く哲学者。', sub: '目に見える現象の裏にある本質を、誰よりも深く追求する性質です。' },
    '職人': { icon: 'fa-cube', bg: 'from-amber-400 to-orange-500', message: 'あなたは、卓越を追求する専門家。', sub: '一つのことを極め、完璧な形にするための執念と技術を持っています。' },
    'バランサー': { icon: 'fa-yin-yang', bg: 'from-green-400 to-emerald-600', message: 'あなたは、自在に適応する柔軟な人。', sub: 'どんな環境でも自分の場所を見つけ、調和を保つことができる希有な才能です。' },
  };

  const config = typeConfigs[profile.personalityType];

  const slides = [
    {
      label: "IDENTITY ARCHETYPE",
      title: profile.personalityType,
      description: config.sub,
      icon: config.icon,
      highlight: "本質の特定"
    },
    {
      label: "CORE SUPERPOWER",
      title: profile.aiAdvice?.strengths[0].title || "卓越した集中力",
      description: profile.aiAdvice?.strengths[0].description || "あなたの最大の武器が明らかになりました。",
      icon: "fa-bolt-lightning",
      highlight: "際立つ強み"
    },
    {
      label: "GROWTH STRATEGY",
      title: profile.aiAdvice?.learningStrategy.title || "効率的な学習法",
      description: `「${profile.aiAdvice?.learningStrategy.approach}」を軸に成長を加速させましょう。`,
      icon: "fa-route",
      highlight: "進化の鍵"
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      // 次のスライドへ行く前にコンテンツだけフェードアウト
      setContentVisible(false);
      
      setTimeout(() => {
        if (currentSlide < slides.length - 1) {
          setCurrentSlide(prev => prev + 1);
          setContentVisible(true);
        } else {
          // 最後のスライドが終わったら全体をフェードアウトさせて終了
          setIsExiting(true);
          setTimeout(onFinish, 1000);
        }
      }, 800); // フェードアウトの時間
    }, 5000);

    return () => clearInterval(timer);
  }, [currentSlide]);

  const slide = slides[currentSlide];

  return (
    <div className={`fixed inset-0 z-[100] bg-gradient-to-br ${config.bg} flex flex-col items-center justify-center text-white transition-opacity duration-1000 ${isExiting ? 'opacity-0' : 'opacity-100'}`}>
      {/* 背景装飾は常に表示してチラつきを防止 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.1)_0%,transparent_60%)] animate-pulse"></div>
        <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
      </div>
      
      {/* コンテンツレイヤーのみを切り替える */}
      <div className={`relative z-10 px-8 text-center transition-all duration-700 transform ${contentVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
        
        <div className="inline-flex items-center space-x-3 mb-10 px-4 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
          <span className="w-2 h-2 bg-white rounded-full animate-ping"></span>
          <span className="text-[10px] font-black uppercase tracking-[0.3em]">{slide.label}</span>
        </div>

        <div className="w-20 h-20 bg-white/20 backdrop-blur-2xl rounded-[2rem] flex items-center justify-center text-3xl mb-12 mx-auto border border-white/30 shadow-2xl">
          <i className={`fas ${slide.icon}`}></i>
        </div>

        <div className="space-y-6 max-w-3xl mx-auto">
          <div className="text-indigo-100 text-sm font-black uppercase tracking-[0.2em] mb-2">{slide.highlight}</div>
          <h2 className="text-5xl md:text-7xl font-black mb-8 tracking-tighter leading-tight drop-shadow-lg">
            {slide.title}
          </h2>
          <p className="text-lg md:text-xl font-medium max-w-xl mx-auto leading-relaxed opacity-90">
            {slide.description}
          </p>
        </div>
      </div>

      {/* インジケーター */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex space-x-4">
        {slides.map((_, i) => (
          <div 
            key={i} 
            className={`h-1.5 rounded-full transition-all duration-700 ${i === currentSlide ? 'w-16 bg-white' : 'w-4 bg-white/20'}`}
          ></div>
        ))}
      </div>

      <button 
        onClick={() => {
          setIsExiting(true);
          setTimeout(onFinish, 500);
        }}
        className="absolute bottom-10 right-10 flex items-center space-x-3 text-white/60 hover:text-white transition-all group"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Skip to results</span>
        <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center group-hover:bg-white/10">
          <i className="fas fa-chevron-right text-[10px]"></i>
        </div>
      </button>
    </div>
  );
};

export default IntroSequence;
