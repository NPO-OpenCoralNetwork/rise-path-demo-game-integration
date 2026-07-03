
import React, { useState, useEffect, useCallback } from 'react';
import { AssessmentStep, AssessmentProfile, BigFiveScores, PersonalityType } from '../types';
import { STORAGE_KEY } from '../constants';
import PersonalityAssessment from './PersonalityAssessment';
import ComprehensiveResults from './ComprehensiveResults';
import IntroSequence from './IntroSequence';
import { generateCoachAdvice } from '../services/geminiService';

const PersonalizedAssessment: React.FC = () => {
  const [step, setStep] = useState<AssessmentStep>(AssessmentStep.OVERVIEW);
  const [profile, setProfile] = useState<AssessmentProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setProfile(JSON.parse(saved));
      setStep(AssessmentStep.RESULTS);
    }
  }, []);

  const calculateType = (scores: BigFiveScores): PersonalityType => {
    const { openness, conscientiousness, extraversion, agreeableness } = scores;
    if (openness > 70 && extraversion > 70) return '冒険家';
    if (conscientiousness > 75) return '戦略家';
    if (agreeableness > 75) return 'サポーター';
    if (openness > 80) return '思想家';
    if (conscientiousness > 60 && openness > 60) return '職人';
    return 'バランサー';
  };

  const finalizeAssessment = useCallback(async (scores: BigFiveScores, learningStyle: string, motivation: string) => {
    setLoading(true);
    const personalityType = calculateType(scores);
    const newProfile: AssessmentProfile = {
      scores,
      personalityType,
      learningStyle,
      motivation,
      completedAt: new Date().toISOString(),
    };

    // Call Gemini for advice
    const aiAdvice = await generateCoachAdvice(newProfile);
    newProfile.aiAdvice = aiAdvice;

    // Save learner profile to server (best-effort; localStorage is primary)
    try {
      const res = await fetch('/api/v2/learner-profiles/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessment_type: 'big_five_v1',
          raw_profile: {
            big_five: scores,
            learning_style: learningStyle,
            motivation,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('learner_profile_id', data.learner_profile_id);
      }
    } catch {
      // Server save failed — continue with local-only flow
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
    setProfile(newProfile);
    setLoading(false);
    // RESULTSではなく、まずINTROに飛ばす
    setStep(AssessmentStep.INTRO);
  }, []);

  const handlePersonalityComplete = (scores: BigFiveScores) => {
    setStep(AssessmentStep.LEARNING_STYLE);
    setTimeout(() => {
        setStep(AssessmentStep.MOTIVATION);
        setTimeout(() => {
            finalizeAssessment(scores, "視覚的学習", "知的好奇心");
        }, 1200);
    }, 1200);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 p-6">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
            <i className="fas fa-brain text-3xl animate-pulse"></i>
          </div>
        </div>
        <div className="text-center space-y-3">
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">AI解析プロトコル実行中</h2>
          <p className="text-slate-500 font-medium max-w-sm mx-auto leading-relaxed">
            ビッグファイブ・マトリックスに基づき、あなたの認知特性と最適な成長戦略をマッピングしています...
          </p>
        </div>
        <div className="flex space-x-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.2}s` }}></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 pt-8">
      {step === AssessmentStep.OVERVIEW && (
        <div className="max-w-xl mx-auto bg-white/95 rounded-3xl p-10 text-center shadow-2xl border border-white/40">
          <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-3xl mx-auto mb-8 flex items-center justify-center text-4xl text-white shadow-xl">
             <i className="fas fa-sparkles"></i>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-4">パーソナル診断へようこそ</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">
            わずか3分間の診断で、あなたの潜在的な能力、最適な学習アプローチ、そしてキャリアのヒントが見つかります。
          </p>
          <button 
            onClick={() => setStep(AssessmentStep.PERSONALITY)}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-extrabold text-lg transition-all transform hover:scale-[1.02] shadow-xl shadow-indigo-200"
          >
            診断をスタート
          </button>
          <p className="mt-4 text-xs text-slate-400">ビッグファイブ性格診断をベースにしています</p>
        </div>
      )}

      {step === AssessmentStep.PERSONALITY && (
        <PersonalityAssessment onComplete={handlePersonalityComplete} />
      )}

      {(step === AssessmentStep.LEARNING_STYLE || step === AssessmentStep.MOTIVATION) && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-6">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center text-indigo-600">
             <i className={`fas ${step === AssessmentStep.LEARNING_STYLE ? 'fa-book-open' : 'fa-bolt'} text-2xl animate-pulse`}></i>
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight">
            {step === AssessmentStep.LEARNING_STYLE ? "学習スタイルを判定中..." : "モチベーションの源泉を分析中..."}
          </h2>
          <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden border border-slate-100">
             <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 animate-[progress_1.5s_ease-in-out_infinite]"></div>
          </div>
          <style>{`
            @keyframes progress {
              0% { width: 0%; margin-left: 0; }
              50% { width: 40%; margin-left: 30%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {step === AssessmentStep.INTRO && profile && (
        <IntroSequence profile={profile} onFinish={() => setStep(AssessmentStep.RESULTS)} />
      )}

      {step === AssessmentStep.RESULTS && profile && (
        <ComprehensiveResults profile={profile} onRestart={() => {
            localStorage.removeItem(STORAGE_KEY);
            setProfile(null);
            setStep(AssessmentStep.OVERVIEW);
        }} />
      )}
    </div>
  );
};

export default PersonalizedAssessment;
