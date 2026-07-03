import React, { useState } from 'react';
import { Fingerprint, ChevronLeft } from 'lucide-react';
import { BIG_FIVE_QUESTIONS, RATING_OPTIONS } from './assessmentConstants';
import { Big5Profile, LocalizedText } from '../../../../types';
import { useLanguage } from '../../../../context/LanguageContext';

interface PersonalityAssessmentProps {
  onComplete: (scores: Big5Profile) => void;
  languageOverride?: 'en' | 'jp' | 'fr';
}

const PersonalityAssessment: React.FC<PersonalityAssessmentProps> = ({ onComplete, languageOverride }) => {
  const { language } = useLanguage();
  const effectiveLang = (language as 'en' | 'jp' | 'fr');
  const resolvedLang = languageOverride || (effectiveLang === 'jp' ? 'jp' : effectiveLang === 'fr' ? 'fr' : 'en');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const getText = (text: LocalizedText) => {
    if (typeof text === 'string') return text;
    return text?.[resolvedLang] || text?.en || text?.jp || '';
  };

  const t = {
    en: {
      query: 'QUESTION',
      analyzing: 'Analyzing identity...',
      negative: 'Negative Response',
      positive: 'Positive Response',
      back: 'BACK'
    },
    jp: {
      query: '質問',
      analyzing: '分析中...',
      negative: '否定寄り',
      positive: '肯定寄り',
      back: '戻る'
    },
    fr: {
      query: 'QUESTION',
      analyzing: 'Analyse en cours...',
      negative: 'Réponse négative',
      positive: 'Réponse positive',
      back: 'RETOUR'
    }
  } as const;
  const labels = t[resolvedLang === 'fr' ? 'fr' : resolvedLang];

  const handleAnswer = (value: number) => {
    const newAnswers = { ...answers, [BIG_FIVE_QUESTIONS[currentIdx].id]: value };
    setAnswers(newAnswers);

    if (currentIdx < BIG_FIVE_QUESTIONS.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      calculateResult(newAnswers);
    }
  };

  const calculateResult = (finalAnswers: Record<number, number>) => {
    const totals = { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 };
    const counts = { openness: 0, conscientiousness: 0, extraversion: 0, agreeableness: 0, neuroticism: 0 };

    BIG_FIVE_QUESTIONS.forEach(q => {
      const score = finalAnswers[q.id];
      if (q.category === 'openness') { totals.openness += score; counts.openness++; }
      if (q.category === 'conscientiousness') { totals.conscientiousness += score; counts.conscientiousness++; }
      if (q.category === 'extraversion') { totals.extraversion += score; counts.extraversion++; }
      if (q.category === 'agreeableness') { totals.agreeableness += score; counts.agreeableness++; }
      if (q.category === 'neuroticism') { totals.neuroticism += score; counts.neuroticism++; }
    });

    const scores: Big5Profile = {
      openness: Math.round((totals.openness / (counts.openness * 5)) * 100),
      conscientiousness: Math.round((totals.conscientiousness / (counts.conscientiousness * 5)) * 100),
      extraversion: Math.round((totals.extraversion / (counts.extraversion * 5)) * 100),
      agreeableness: Math.round((totals.agreeableness / (counts.agreeableness * 5)) * 100),
      neuroticism: Math.round((totals.neuroticism / (counts.neuroticism * 5)) * 100),
    };

    onComplete(scores);
  };

  const currentQuestion = BIG_FIVE_QUESTIONS[currentIdx];
  const progress = ((currentIdx + 1) / BIG_FIVE_QUESTIONS.length) * 100;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white/95 rounded-[2.5rem] shadow-2xl p-10 mb-6 border border-white/40">
        <div className="flex justify-between items-center mb-8">
          <div className="px-4 py-1.5 bg-indigo-50 rounded-full">
            <span className="text-indigo-600 font-bold text-sm tracking-widest">
              {labels.query} {String(currentIdx + 1).padStart(2, '0')} / {BIG_FIVE_QUESTIONS.length}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-slate-400">
            <Fingerprint className="w-4 h-4 animate-pulse" />
            <span className="text-[10px] uppercase font-bold tracking-tighter">{labels.analyzing}</span>
          </div>
        </div>

        <div className="w-full bg-slate-100 h-1 rounded-full mb-16 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="min-h-[140px] flex items-center justify-center mb-16">
          <h2 className="text-2xl font-bold text-slate-800 text-center leading-relaxed max-w-xl">
            {getText(currentQuestion.text)}
          </h2>
        </div>

        <div className="flex items-center justify-between px-4 sm:px-10">
          {RATING_OPTIONS.map((option) => (
            <div key={option.value} className="flex flex-col items-center group relative">
              <button
                onClick={() => handleAnswer(option.value)}
                className={`
                  ${option.size} rounded-full transition-all duration-300 
                  hover:scale-125 hover:shadow-lg hover:shadow-indigo-200 
                  ${option.color} flex items-center justify-center
                  border-2 border-transparent hover:border-white
                `}
                aria-label={getText(option.label)}
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-bold">
                  {option.value}
                </div>
              </button>
              <span className="mt-4 text-[10px] sm:text-xs font-bold text-slate-400 group-hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100 absolute top-full whitespace-nowrap pt-2">
                {getText(option.label)}
              </span>
            </div>
          ))}
        </div>
        
        {/* 指導線 */}
        <div className="flex justify-between mt-12 px-2 sm:px-8 border-t border-slate-50 pt-8">
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{labels.negative}</span>
          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{labels.positive}</span>
        </div>
      </div>

      <div className="flex justify-center">
        {currentIdx > 0 && (
          <button 
            onClick={() => setCurrentIdx(currentIdx - 1)}
            className="flex items-center space-x-2 text-slate-400 hover:text-indigo-600 text-xs font-bold transition-all px-4 py-2 rounded-full hover:bg-white/20"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{labels.back}</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default PersonalityAssessment;
