import React, { useState, useEffect } from 'react';
import { Wind, Swords, HeartHandshake, Lightbulb, Box, Infinity, Zap, Map, ChevronRight } from 'lucide-react';
import { AssessmentProfile } from '../../../../types';
import { useLanguage } from '../../../../context/LanguageContext';

interface IntroSequenceProps {
  profile: AssessmentProfile;
  onFinish: () => void;
  languageOverride?: 'en' | 'jp' | 'fr';
}

const IntroSequence: React.FC<IntroSequenceProps> = ({ profile, onFinish, languageOverride }) => {
  const { language } = useLanguage();
  const resolvedLang = languageOverride || (language as 'en' | 'jp' | 'fr');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [contentVisible, setContentVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  const typeConfigs: Record<string, { icon: React.ReactNode; bg: string; display: { en: string; jp: string; fr: string }; sub: { en: string; jp: string; fr: string } }> = {
    'character/openness': { icon: <Lightbulb className="w-full h-full" />, bg: 'from-amber-400 to-orange-500', display: { en: 'character/openness', jp: 'character/openness', fr: 'character/openness' }, sub: { en: 'High openness: curious, exploratory, and idea-driven.', jp: '開放性が高く、好奇心と探索力で学びを広げます。', fr: 'Ouverture élevée : curiosité, exploration et créativité.' } },
    '冒険家': { icon: <Wind className="w-full h-full" />, bg: 'from-orange-400 to-red-500', display: { en: 'Explorer', jp: '冒険家', fr: 'Explorateur' }, sub: { en: 'Your curiosity opens new worlds and possibilities.', jp: 'あなたの好奇心は、新しい世界を創り出すエネルギーに満ちています。', fr: 'Votre curiosité ouvre de nouveaux mondes et possibilités.' } },
    '戦略家': { icon: <Swords className="w-full h-full" />, bg: 'from-blue-500 to-indigo-600', display: { en: 'Strategist', jp: '戦略家', fr: 'Stratège' }, sub: { en: 'You derive optimal moves from complex situations.', jp: '混沌とした状況から最適解を導き出す、鋭い洞察力を持っています。', fr: 'Vous trouvez des stratégies optimales dans des situations complexes.' } },
    'サポーター': { icon: <HeartHandshake className="w-full h-full" />, bg: 'from-pink-400 to-rose-500', display: { en: 'Supporter', jp: 'サポーター', fr: 'Soutien' }, sub: { en: 'You strengthen teams with empathy and harmony.', jp: '他者に寄り添い、絆を深めることで、集団に真の強さを与えます。', fr: 'Vous renforcez l’équipe par l’empathie et l’harmonie.' } },
    '思想家': { icon: <Lightbulb className="w-full h-full" />, bg: 'from-purple-500 to-indigo-700', display: { en: 'Thinker', jp: '思想家', fr: 'Penseur' }, sub: { en: 'You seek the essence behind what is seen.', jp: '目に見える現象の裏にある本質を、誰よりも深く追求する性質です。', fr: 'Vous cherchez l’essence derrière les apparences.' } },
    '職人': { icon: <Box className="w-full h-full" />, bg: 'from-amber-400 to-orange-500', display: { en: 'Artisan', jp: '職人', fr: 'Artisan' }, sub: { en: 'You pursue excellence with focus and craft.', jp: '一つのことを極め、完璧な形にするための執念と技術を持っています。', fr: 'Vous visez l’excellence avec concentration et savoir‑faire.' } },
    'バランサー': { icon: <Infinity className="w-full h-full" />, bg: 'from-green-400 to-emerald-600', display: { en: 'Balancer', jp: 'バランサー', fr: 'Équilibré' }, sub: { en: 'You adapt flexibly and keep balance.', jp: 'どんな環境でも自分の場所を見つけ、調和を保つことができる希有な才能です。', fr: 'Vous vous adaptez avec souplesse et maintenez l’équilibre.' } },
  };

  const config = typeConfigs[profile.personalityType] || typeConfigs['バランサー'];
  const displayName = config.display[resolvedLang] || config.display.jp;
  const configSub = config.sub[resolvedLang] || config.sub.jp;

  const t = {
    en: {
      slideIdentity: 'IDENTITY ARCHETYPE',
      slideStrength: 'CORE SUPERPOWER',
      slideGrowth: 'GROWTH STRATEGY',
      highlightIdentity: 'Core Essence',
      highlightStrength: 'Signature Strength',
      highlightGrowth: 'Growth Key',
      defaultStrengthTitle: 'Focused Drive',
      defaultStrengthBody: 'Your strongest capability has emerged.',
      defaultPlanTitle: 'Efficient Learning Plan',
      defaultPlanBody: 'We will propose a learning plan optimized for you.',
      skip: 'Skip to results'
    },
    jp: {
      slideIdentity: 'IDENTITY ARCHETYPE',
      slideStrength: 'CORE SUPERPOWER',
      slideGrowth: 'GROWTH STRATEGY',
      highlightIdentity: '本質の特定',
      highlightStrength: '際立つ強み',
      highlightGrowth: '進化の鍵',
      defaultStrengthTitle: '卓越した集中力',
      defaultStrengthBody: 'あなたの最大の武器が明らかになりました。',
      defaultPlanTitle: '効率的な学習法',
      defaultPlanBody: 'あなたに最適な学習プランを提案します。',
      skip: '結果へスキップ'
    },
    fr: {
      slideIdentity: 'IDENTITY ARCHETYPE',
      slideStrength: 'CORE SUPERPOWER',
      slideGrowth: 'GROWTH STRATEGY',
      highlightIdentity: 'Essence',
      highlightStrength: 'Force clé',
      highlightGrowth: 'Clé de progression',
      defaultStrengthTitle: 'Concentration remarquable',
      defaultStrengthBody: 'Votre force principale vient d’apparaître.',
      defaultPlanTitle: 'Plan d’apprentissage efficace',
      defaultPlanBody: 'Nous proposons un plan adapté à votre style.',
      skip: 'Passer aux résultats'
    }
  } as const;
  const labels = t[resolvedLang];

  const slides = [
    {
      label: labels.slideIdentity,
      title: displayName,
      description: configSub,
      icon: config.icon,
      highlight: labels.highlightIdentity
    },
    {
      label: labels.slideStrength,
      title: profile.aiAdvice?.strengths?.[0]?.title || labels.defaultStrengthTitle,
      description: profile.aiAdvice?.strengths?.[0]?.description || labels.defaultStrengthBody,
      icon: <Zap className="w-full h-full" />,
      highlight: labels.highlightStrength
    },
    {
      label: labels.slideGrowth,
      title: profile.aiAdvice?.learningStrategy?.title || labels.defaultPlanTitle,
      description: profile.aiAdvice?.learningStrategy?.approach
        ? (language === 'jp'
            ? `「${profile.aiAdvice.learningStrategy.approach}」を軸に成長を加速させましょう。`
            : `Accelerate growth by focusing on “${profile.aiAdvice.learningStrategy.approach}”.`)
        : labels.defaultPlanBody,
      icon: <Map className="w-full h-full" />,
      highlight: labels.highlightGrowth
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setContentVisible(false);
      
      setTimeout(() => {
        if (currentSlide < slides.length - 1) {
          setCurrentSlide(prev => prev + 1);
          setContentVisible(true);
        } else {
          setIsExiting(true);
          setTimeout(onFinish, 1000);
        }
      }, 400);
    }, 2500);

    return () => clearInterval(timer);
  }, [currentSlide, slides.length, onFinish]);

  const slide = slides[currentSlide];

  return (
    <div className={`fixed inset-0 z-[100] bg-gradient-to-br ${config.bg} flex flex-col items-center justify-center text-white transition-opacity duration-1000 ${isExiting ? 'opacity-0' : 'opacity-100'}`}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.1)_0%,transparent_60%)] animate-pulse"></div>
      </div>
      
      <div className={`relative z-10 px-8 text-center transition-all duration-700 transform ${contentVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95'}`}>
        
        <div className="inline-flex items-center space-x-3 mb-10 px-4 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
          <span className="w-2 h-2 bg-white rounded-full animate-ping"></span>
          <span className="text-[10px] font-black uppercase tracking-[0.3em]">{slide.label}</span>
        </div>

        <div className="w-20 h-20 bg-white/20 backdrop-blur-2xl rounded-[2rem] flex items-center justify-center p-5 mb-12 mx-auto border border-white/30 shadow-2xl">
          {slide.icon}
        </div>

        <div className="space-y-6 max-w-3xl mx-auto">
          <div className="text-indigo-100 text-sm font-black uppercase tracking-[0.2em] mb-2">{slide.highlight}</div>
          <h2 className="text-5xl md:text-7xl font-black mb-8 tracking-tighter leading-tight drop-shadow-lg">
            {slide.title}
          </h2>
          <p className="text-lg md:text-xl font-medium max-w-xl mx-auto leading-relaxed opacity-90">
            {slide.description.length > 80 ? `${slide.description.slice(0, 77)}...` : slide.description}
          </p>
        </div>
      </div>

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
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">{labels.skip}</span>
        <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center group-hover:bg-white/10">
          <ChevronRight className="w-4 h-4" />
        </div>
      </button>
    </div>
  );
};

export default IntroSequence;
