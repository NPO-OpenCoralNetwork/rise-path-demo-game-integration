
import React, { useState, useEffect } from 'react';
import { ViewState, Big5Profile, AssessmentProfile, PersonalityType, AIAdvice } from '../../../../types';
import PersonalityAssessment from './PersonalityAssessment';
import IntroSequence from './IntroSequence';
import { analyzePersonality } from '../../../../services/geminiService';
import { useTheme } from '../../../../context/ThemeContext';
import { Sparkles, ArrowRight } from 'lucide-react';
import { notifyAssessmentProfileChanged } from '../../../../constants/assessment';
import { STORAGE_KEY } from './assessmentConstants';
import { useLanguage } from '../../../../context/LanguageContext';
import { addLearningEvent } from '../../../../services/progressService';
import LoadingScreen from '../../../../ai-learning-diagnosis/components/LoadingScreen';
import ResultScreen from '../../../../ai-learning-diagnosis/components/ResultScreen';
import { DiagnosisResult } from '../../../../ai-learning-diagnosis/types';

interface PersonalAssessmentViewProps {
  onNavigate: (view: ViewState) => void;
}

enum Step {
  OVERVIEW = 'OVERVIEW',
  ASSESSMENT = 'ASSESSMENT',
  ANALYZING = 'ANALYZING',
  INTRO = 'INTRO',
  RESULTS = 'RESULTS'
}

const USE_DEMO_ASSESSMENT = true;

const DEMO_AI_ADVICE_BY_LANG: Record<'en' | 'jp' | 'fr', AIAdvice> = {
  en: {
    strengths: [
      { title: 'Adaptability', description: 'Switches learning approaches as the situation changes.' },
      { title: 'Balanced execution', description: 'Balances depth and speed without losing quality.' },
      { title: 'Collaborative momentum', description: 'Moves forward with the team while keeping alignment.' }
    ],
    growthTips: [
      { title: 'Make progress visible', description: 'Ship a small output weekly and log what you learned.' },
      { title: 'Protect focus time', description: 'Reserve a fixed 30‑minute block daily.' },
      { title: 'Set a challenge scope', description: 'Choose one theme and go deep for a short period.' }
    ],
    learningStrategy: {
      title: 'Short-cycle experimentation',
      approach: 'Try small, reflect fast, iterate',
      steps: [
        { label: 'Step 1', action: 'Solve a 15‑minute mini task' },
        { label: 'Step 2', action: 'Write a 3‑line reflection' },
        { label: 'Step 3', action: 'Improve one thing and retry tomorrow' }
      ]
    },
    careerCompatibility: 'Product building, learning support, team-based creative work',
    relationshipAnalysis: {
      style: 'A calm driver who adapts and keeps the team aligned.',
      idealPartner: 'Pairs well with fast decision-makers.',
      advice: 'Clarify roles to maximize your strengths.'
    },
    businessPartnership: {
      role: 'Project coordinator: strong at alignment and progress tracking.',
      bestSync: 'Best with a builder-type specialist.',
      warning: 'Over-optimizing can slow decisions.'
    },
    hiddenTalent: {
      title: 'Quiet consistency',
      description: 'Steady effort compounds into big results.'
    }
  },
  fr: {
    strengths: [
      { title: "Adaptabilité", description: "Change d’approche selon la situation." },
      { title: "Exécution équilibrée", description: "Concilie profondeur et rapidité." },
      { title: "Élan collaboratif", description: "Avance avec l’équipe tout en gardant l’alignement." }
    ],
    growthTips: [
      { title: "Rendre les progrès visibles", description: "Livrez un petit résultat chaque semaine et notez vos apprentissages." },
      { title: "Protéger le temps de focus", description: "Réservez un créneau fixe de 30 minutes chaque jour." },
      { title: "Définir le périmètre", description: "Choisissez un thème et explorez-le en profondeur sur une courte période." }
    ],
    learningStrategy: {
      title: "Expérimentation en cycles courts",
      approach: "Tester petit, réfléchir vite, itérer",
      steps: [
        { label: "Step 1", action: "Résoudre un mini‑exercice en 15 minutes" },
        { label: "Step 2", action: "Écrire un bilan en 3 lignes" },
        { label: "Step 3", action: "Améliorer un point et réessayer demain" }
      ]
    },
    careerCompatibility: "Développement produit, support à l’apprentissage, création en équipe",
    relationshipAnalysis: {
      style: "Un moteur calme qui s’adapte et garde l’alignement.",
      idealPartner: "Bonne synergie avec des profils décisionnels rapides.",
      advice: "Clarifiez les rôles pour maximiser vos forces."
    },
    businessPartnership: {
      role: "Coordinateur·rice de projet : alignement et suivi solides.",
      bestSync: "Très efficace avec un·e builder spécialiste.",
      warning: "Trop d’optimisation peut ralentir les décisions."
    },
    hiddenTalent: {
      title: "Constance discrète",
      description: "Les efforts réguliers se transforment en grands résultats."
    }
  },
  jp: {
    strengths: [
      { title: '状況適応力', description: '変化に強く、環境に合わせて学習方法を切り替えられる。' },
      { title: 'バランス感覚', description: '深掘りとスピードの両方をほどよく扱える。' },
      { title: '協調的な推進力', description: 'チームに溶け込みながら前進できる。' }
    ],
    growthTips: [
      { title: '成果の見える化', description: '週単位で成果物を作り、学習ログを残す。' },
      { title: '集中時間の確保', description: '1日30分でも固定枠を作り、習慣化する。' },
      { title: '挑戦の範囲を決める', description: '1テーマに絞って深く掘る期間を作る。' }
    ],
    learningStrategy: {
      title: '短いサイクルで試す学習',
      approach: '小さく試して、すぐに振り返るサイクルを回す',
      steps: [
        { label: 'Step 1', action: '15分でミニ課題を解く' },
        { label: 'Step 2', action: '学んだことを3行でメモ' },
        { label: 'Step 3', action: '翌日に1つ改善して再挑戦' }
      ]
    },
    careerCompatibility: 'プロダクト開発、学習支援、チーム型のクリエイティブ領域',
    relationshipAnalysis: {
      style: '相手に合わせて調整しながら、穏やかに推進するタイプ。',
      idealPartner: '意思決定が速い推進型の相棒と好相性。',
      advice: '役割分担を明確にすると、持ち味が最大化します。'
    },
    businessPartnership: {
      role: 'プロジェクト調整役: 進行管理と合意形成が得意。',
      bestSync: '実装に強い職人タイプと組むと成果が早い。',
      warning: '全体最適に寄りすぎると決断が遅くなることがある。'
    },
    hiddenTalent: {
      title: '静かな継続力',
      description: '派手さはなくても、積み上げで大きな成果を出せる。'
    }
  }
};

const mapProfileToDiagnosisResult = (
  profile: AssessmentProfile,
  language: 'en' | 'jp' | 'fr'
): DiagnosisResult => {
  const traitScores = [
    { subject: language === 'jp' ? '開放性' : language === 'fr' ? 'Ouverture' : 'Openness', A: Math.round(profile.scores.openness), fullMark: 100 },
    { subject: language === 'jp' ? '誠実性' : language === 'fr' ? 'Conscience' : 'Conscientiousness', A: Math.round(profile.scores.conscientiousness), fullMark: 100 },
    { subject: language === 'jp' ? '外向性' : language === 'fr' ? 'Extraversion' : 'Extraversion', A: Math.round(profile.scores.extraversion), fullMark: 100 },
    { subject: language === 'jp' ? '協調性' : language === 'fr' ? 'Agréabilité' : 'Agreeableness', A: Math.round(profile.scores.agreeableness), fullMark: 100 },
    { subject: language === 'jp' ? '安定性' : language === 'fr' ? 'Stabilité' : 'Stability', A: Math.round(100 - profile.scores.neuroticism), fullMark: 100 }
  ];

  const allocationBase = [
    { key: 'explore', value: Math.max(1, profile.scores.openness) },
    { key: 'execute', value: Math.max(1, profile.scores.conscientiousness) },
    { key: 'share', value: Math.max(1, profile.scores.extraversion) }
  ];
  const allocationTotal = allocationBase.reduce((sum, item) => sum + item.value, 0);
  const explore = Math.round((allocationBase[0].value / allocationTotal) * 100);
  const execute = Math.round((allocationBase[1].value / allocationTotal) * 100);
  const share = Math.max(0, 100 - explore - execute);

  const allocationLabels = {
    explore: language === 'jp' ? '探索' : language === 'fr' ? 'Exploration' : 'Explore',
    execute: language === 'jp' ? '実践' : language === 'fr' ? 'Exécution' : 'Execute',
    share: language === 'jp' ? '発信' : language === 'fr' ? 'Partage' : 'Share'
  };

  const studyAllocation = [
    { name: allocationLabels.explore, value: explore },
    { name: allocationLabels.execute, value: execute },
    { name: allocationLabels.share, value: share }
  ];

  const characterMap = {
    openness: {
      en: 'The Visionary',
      jp: 'ビジョナリー',
      fr: 'Visionnaire',
      bot: { en: 'Spark', jp: 'スパーク' },
      description: {
        en: 'Creative explorer who unlocks bold ideas and new paths.',
        jp: '大胆な発想で新しい道を切り拓く創造的な探究者。',
        fr: 'Explorateur créatif qui ouvre de nouvelles voies.'
      }
    },
    conscientiousness: {
      en: 'The Architect',
      jp: 'アーキテクト',
      fr: 'Architecte',
      bot: { en: 'Focus', jp: 'フォーカス' },
      description: {
        en: 'Strategic planner who builds steady, reliable progress.',
        jp: '着実に前進するための設計を描く戦略家。',
        fr: 'Planificateur stratégique au progrès fiable.'
      }
    },
    extraversion: {
      en: 'The Catalyst',
      jp: 'カタリスト',
      fr: 'Catalyseur',
      bot: { en: 'Vibe', jp: 'バイブ' },
      description: {
        en: 'Energizer who boosts momentum and action.',
        jp: '勢いと行動を加速させる起爆剤。',
        fr: 'Un moteur d’énergie qui accélère l’action.'
      }
    },
    agreeableness: {
      en: 'The Mediator',
      jp: 'メディエーター',
      fr: 'Médiateur',
      bot: { en: 'Echo', jp: 'エコー' },
      description: {
        en: 'Empathetic partner who supports balance and collaboration.',
        jp: '共感と調和でチームを支える相棒。',
        fr: 'Partenaire empathique qui soutient la collaboration.'
      }
    },
    stability: {
      en: 'The Anchor',
      jp: 'アンカー',
      fr: 'Ancre',
      bot: { en: 'Luna', jp: 'ルナ' },
      description: {
        en: 'Calm stabilizer who brings clarity under pressure.',
        jp: '落ち着きで状況を整える安定の支柱。',
        fr: 'Stabilisateur calme qui apporte de la clarté.'
      }
    }
  };

  const topTrait = [
    { id: 'openness', score: profile.scores.openness },
    { id: 'conscientiousness', score: profile.scores.conscientiousness },
    { id: 'extraversion', score: profile.scores.extraversion },
    { id: 'agreeableness', score: profile.scores.agreeableness },
    { id: 'stability', score: 100 - profile.scores.neuroticism }
  ].sort((a, b) => b.score - a.score)[0];

  const character = characterMap[topTrait?.id as keyof typeof characterMap] || characterMap.openness;

  const advice = profile.aiAdvice;
  const strengths = advice?.strengths?.map((s) => s.title).slice(0, 4) || [];
  const weaknesses = advice?.growthTips?.map((s) => s.title).slice(0, 4) || [];
  const steps = advice?.learningStrategy?.steps?.map((s) => s.action) || [];

  return {
    archetypeName: language === 'jp' ? character.jp : language === 'fr' ? character.fr : character.en,
    tagline: language === 'jp' ? `AI相棒: ${character.bot.jp}` : language === 'fr' ? `Compagnon IA : ${character.bot.en}` : `AI Companion: ${character.bot.en}`,
    summary: advice?.learningStrategy?.approach || (language === 'jp' ? 'あなたの特性に合わせた学習設計を提案します。' : language === 'fr' ? 'Un parcours optimisé pour votre style.' : 'A learning path optimized for your style.'),
    characterId: topTrait?.id,
    characterBotName: language === 'jp' ? character.bot.jp : character.bot.en,
    characterDescription: character.description[language] || character.description.jp,
    traits: traitScores,
    studyAllocation,
    strengths,
    weaknesses: weaknesses.length ? weaknesses : (language === 'jp' ? ['集中の波を味方にする', '成果の可視化を強化'] : language === 'fr' ? ['Stabiliser le focus', 'Rendre les progrès visibles'] : ['Stabilize focus', 'Make progress visible']),
    recommendedMethod: advice?.learningStrategy?.title || (language === 'jp' ? '短いサイクルで試す学習' : language === 'fr' ? 'Expérimentation en cycles courts' : 'Short-cycle experimentation'),
    dailyRoutineAdvice: steps.length ? steps.join(' / ') : (language === 'jp' ? '1日30分の集中→小さく出力→翌日改善' : language === 'fr' ? '30 min de focus → petite sortie → amélioration le lendemain' : '30 min focus → small output → improve tomorrow'),
    personalityInsight: advice?.relationshipAnalysis?.style || (language === 'jp' ? '柔軟に適応しながら前進できるタイプ。' : language === 'fr' ? 'Vous avancez en restant adaptable.' : 'You move forward with adaptable momentum.'),
    tools: ['Notion', 'Cursor', 'GitHub', 'Figma']
  };
};

const PersonalAssessmentView: React.FC<PersonalAssessmentViewProps> = ({ onNavigate }) => {
  const [step, setStep] = useState<Step>(Step.OVERVIEW);
  const [profile, setProfile] = useState<AssessmentProfile | null>(null);
  const { setProfile: setGlobalProfile } = useTheme();
  const { language } = useLanguage();
  const [assessmentLanguage, setAssessmentLanguage] = useState<'en' | 'jp' | 'fr'>(language === 'jp' ? 'jp' : 'en');

  const t = {
    en: {
      overviewTitle: 'AI Learning Diagnosis Program',
      overviewBody: 'Visualize your potential and build a personalized curriculum that fits your brain.',
      overviewCta: 'Start Analysis',
      poweredBy: 'Powered by Gemini 2.5 Flash • Big Five Matrix',
      assessmentTitle: 'AI Identity Scan',
      assessmentSubtitle: 'Deep Neural Insight Pattern Analysis in Progress',
      analyzingTitle: 'Running analysis protocol...',
      analyzingSubtitle: 'Constructing Personalized Learning Neural Network'
    },
    jp: {
      overviewTitle: 'AI学習診断プログラム',
      overviewBody: 'あなたの潜在能力を可視化し、脳の特性に最もフィットするパーソナライズされたカリキュラムを構築します。',
      overviewCta: '分析を開始する',
      poweredBy: 'Powered by Gemini 2.5 Flash • Big Five Matrix',
      assessmentTitle: 'AI Identity Scan',
      assessmentSubtitle: 'Deep Neural Insight Pattern Analysis in Progress',
      analyzingTitle: '分析プロトコル実行中...',
      analyzingSubtitle: 'Constructing Personalized Learning Neural Network'
    },
    fr: {
      overviewTitle: 'Programme de diagnostic d’apprentissage IA',
      overviewBody: 'Visualisez votre potentiel et construisez un parcours adapté à votre façon d’apprendre.',
      overviewCta: 'Lancer l’analyse',
      poweredBy: 'Powered by Gemini 2.5 Flash • Big Five Matrix',
      assessmentTitle: 'AI Identity Scan',
      assessmentSubtitle: 'Deep Neural Insight Pattern Analysis in Progress',
      analyzingTitle: 'Analyse en cours...',
      analyzingSubtitle: 'Construction du réseau d’apprentissage personnalisé'
    }
  } as const;
  const labels = t[assessmentLanguage];

  const LanguageToggle = () => (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
      {(['en', 'jp', 'fr'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setAssessmentLanguage(lang)}
          className={`px-2 py-1 rounded-full transition-all ${assessmentLanguage === lang
            ? 'bg-slate-900 text-white'
            : 'text-slate-500 hover:text-slate-700 bg-slate-100'}`}
          aria-pressed={assessmentLanguage === lang}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );

  const persistAssessmentProfile = (profile: AssessmentProfile) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      notifyAssessmentProfileChanged();
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    if (step === Step.INTRO && profile) {
      setStep(Step.RESULTS);
    }
  }, [step, profile]);

  const handleAssessmentComplete = async (finalScores: Big5Profile) => {
    setStep(Step.ANALYZING);

    if (USE_DEMO_ASSESSMENT) {
      await new Promise(resolve => setTimeout(resolve, 1400));
      const demoAdvice = DEMO_AI_ADVICE_BY_LANG[assessmentLanguage] || DEMO_AI_ADVICE_BY_LANG.jp;
      const demoProfile: AssessmentProfile = {
        scores: finalScores,
        personalityType: 'character/openness',
        learningStyle: demoAdvice.learningStrategy.title,
        motivation: demoAdvice.learningStrategy.approach,
        completedAt: new Date().toISOString(),
        aiAdvice: demoAdvice
      };
      persistAssessmentProfile(demoProfile);
      setProfile(demoProfile);
      setGlobalProfile(finalScores);
      setStep(Step.INTRO);
      return;
    }

    try {
      // Gemini API で分析を実行
      const advice = await analyzePersonality(finalScores);
      console.log("Gemini Advice:", advice);
      
      const newProfile: AssessmentProfile = {
        scores: finalScores,
        personalityType: (advice?.personalityType || 'バランサー') as PersonalityType,
        learningStyle: advice?.learningStrategy?.title || 'バランス型学習',
        motivation: advice?.learningStrategy?.approach || '継続的な改善',
        completedAt: new Date().toISOString(),
        aiAdvice: advice
      };

      persistAssessmentProfile(newProfile);
      setProfile(newProfile);
      addLearningEvent({
        type: 'diagnosis_complete',
        title: { en: 'Completed AI Diagnosis', jp: 'AI学習診断を完了' },
        description: { en: `Personality: ${newProfile.personalityType}`, jp: `タイプ: ${newProfile.personalityType}` },
      });
      setGlobalProfile(finalScores); // グローバルな性格設定を更新
      setStep(Step.INTRO);
    } catch (error) {
      console.error("Personality analysis failed:", error);
      // エラー時も最低限のプロファイルを作成して結果画面を表示（無限ロード回避）
      const fallbackProfile: AssessmentProfile = {
        scores: finalScores,
        personalityType: 'character/openness',
        learningStyle: '標準学習モード',
        motivation: '安定した成長',
        completedAt: new Date().toISOString(),
      };
      persistAssessmentProfile(fallbackProfile);
      setProfile(fallbackProfile);
      setStep(Step.RESULTS);
    }
  };

  const handleRestart = () => {
    localStorage.removeItem(STORAGE_KEY);
    notifyAssessmentProfileChanged();
    setProfile(null);
    setStep(Step.ASSESSMENT);
  };

  if (step === Step.OVERVIEW) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-white/95 rounded-[2.5rem] p-10 text-center shadow-2xl border border-white/40">
          <div className="flex justify-end mb-4">
            <LanguageToggle />
          </div>
          <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-3xl mx-auto mb-10 flex items-center justify-center text-4xl text-white shadow-xl">
             <Sparkles className="w-12 h-12" />
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">{labels.overviewTitle}</h1>
          <p className="text-slate-600 mb-10 leading-relaxed font-medium text-lg">
            {labels.overviewBody}
          </p>
          <button 
            onClick={() => setStep(Step.ASSESSMENT)}
            className="w-full py-5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-black text-sm uppercase tracking-[0.3em] transition-all transform hover:scale-[1.02] shadow-2xl flex items-center justify-center space-x-3 group"
          >
            <span>{labels.overviewCta}</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
          <p className="mt-8 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {labels.poweredBy}
          </p>
        </div>
      </div>
    );
  }

  if (step === Step.ASSESSMENT) {
    return (
      <div className="min-h-screen pt-12 px-4">
        <div className="text-center mb-12">
          <div className="flex justify-end mb-6">
            <LanguageToggle />
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-4 tracking-tighter uppercase">{labels.assessmentTitle}</h1>
          <p className="text-slate-500 max-w-lg mx-auto font-bold text-xs uppercase tracking-widest opacity-60">
            {labels.assessmentSubtitle}
          </p>
        </div>
        <PersonalityAssessment onComplete={handleAssessmentComplete} languageOverride={assessmentLanguage} />
      </div>
    );
  }

  if (step === Step.ANALYZING) {
    return <LoadingScreen />;
  }

  if (step === Step.INTRO && profile) {
    return null;
  }

  if (step === Step.RESULTS && profile) {
    const result = mapProfileToDiagnosisResult(profile, assessmentLanguage);
    return (
      <div className="bg-white text-slate-900">
        <ResultScreen result={result} onRetake={handleRestart} />
      </div>
    );
  }

  return null;
};

export default PersonalAssessmentView;
