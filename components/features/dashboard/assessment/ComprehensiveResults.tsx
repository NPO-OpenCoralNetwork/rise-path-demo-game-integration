import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Eye, Compass, CheckCircle2, Wind, Zap, Moon, HeartHandshake, Scale, 
  ShieldCheck, Gem, BarChart3, Quote, Briefcase, Sparkles, Fingerprint, Brain, Infinity, Swords, Box, Lightbulb, Heart, Anchor
} from 'lucide-react';
import { AssessmentProfile } from '../../../../types';
import { useLanguage } from '../../../../context/LanguageContext';
import CharacterRevealPanel from './CharacterRevealPanel';

interface ComprehensiveResultsProps {
  profile: AssessmentProfile;
  onRestart: () => void;
  languageOverride?: 'en' | 'jp' | 'fr';
}

// 特性に応じたリッチなメタデータ定義
const getTraitBadge = (category: string, score: number, language: 'en' | 'jp' | 'fr') => {
  const isHigh = score > 50;
  const configs: Record<string, any> = {
    openness: {
      high: { label: { en: 'Visionary', jp: 'ビジョナリー', fr: 'Visionnaire' }, sub: { en: 'Imagination pioneer', jp: '想像力の開拓者', fr: 'Pionnier de l’imagination' }, icon: <Eye className="w-full h-full" />, colors: ['#f59e0b', '#ef4444'], colorClass: 'from-amber-500 to-red-500' },
      low: { label: { en: 'Pragmatist', jp: 'プラグマティスト', fr: 'Pragmatique' }, sub: { en: 'Grounded practitioner', jp: '現実的な実践者', fr: 'Praticien réaliste' }, icon: <Compass className="w-full h-full" />, colors: ['#94a3b8', '#475569'], colorClass: 'from-slate-400 to-slate-600' }
    },
    conscientiousness: {
      high: { label: { en: 'Master Finisher', jp: 'パーフェクトマスター', fr: 'Finisseur' }, sub: { en: 'Completion-driven pro', jp: '完遂のプロフェッショナル', fr: 'Pro de l’exécution' }, icon: <CheckCircle2 className="w-full h-full" />, colors: ['#3b82f6', '#4f46e5'], colorClass: 'from-blue-500 to-indigo-600' },
      low: { label: { en: 'Free Spirit', jp: 'フリースピリット', fr: 'Esprit libre' }, sub: { en: 'Flexible improviser', jp: '柔軟な即興家', fr: 'Improvisateur flexible' }, icon: <Wind className="w-full h-full" />, colors: ['#38bdf8', '#0ea5e9'], colorClass: 'from-sky-400 to-sky-600' }
    },
    extraversion: {
      high: { label: { en: 'Social Star', jp: 'ソーシャル・スター', fr: 'Star sociale' }, sub: { en: 'Source of energy', jp: 'エネルギーの源泉', fr: 'Source d’énergie' }, icon: <Zap className="w-full h-full" />, colors: ['#fbbf24', '#f59e0b'], colorClass: 'from-yellow-400 to-amber-500' },
      low: { label: { en: 'Deep Observer', jp: 'ディープ・オブザーバー', fr: 'Observateur profond' }, sub: { en: 'Reflective explorer', jp: '内省的観察者', fr: 'Explorateur introspectif' }, icon: <Moon className="w-full h-full" />, colors: ['#312e81', '#1e1b4b'], colorClass: 'from-indigo-900 to-slate-900' }
    },
    agreeableness: {
      high: { label: { en: 'Empathy Guardian', jp: '共感の守護者', fr: 'Gardien empathique' }, sub: { en: 'Harmony maker', jp: '調和をもたらす者', fr: 'Créateur d’harmonie' }, icon: <HeartHandshake className="w-full h-full" />, colors: ['#f472b6', '#e11d48'], colorClass: 'from-pink-400 to-rose-600' },
      low: { label: { en: 'Logical Director', jp: 'ロジカル・ディレクター', fr: 'Directeur logique' }, sub: { en: 'Rational decision-maker', jp: '合理的な意思決定者', fr: 'Décideur rationnel' }, icon: <Scale className="w-full h-full" />, colors: ['#10b981', '#059669'], colorClass: 'from-emerald-500 to-emerald-700' }
    },
    neuroticism: {
      high: { label: { en: 'Sensitive Guard', jp: 'センシティブ・ガード', fr: 'Gardien sensible' }, sub: { en: 'Notices subtle shifts', jp: '微細な変化を捉える感性', fr: 'Capte les variations subtiles' }, icon: <ShieldCheck className="w-full h-full" />, colors: ['#a855f7', '#6366f1'], colorClass: 'from-purple-500 to-indigo-500' },
      low: { label: { en: 'Iron Mind', jp: 'アイアン・マインド', fr: 'Esprit d’acier' }, sub: { en: 'Steady resilience', jp: '揺るぎない精神力', fr: 'Résilience stable' }, icon: <Gem className="w-full h-full" />, colors: ['#22d3ee', '#0ea5e9'], colorClass: 'from-cyan-400 to-blue-500' }
    }
  };

  const trait = configs[category];
  const badge = isHigh ? trait.high : trait.low;
  return {
    ...badge,
    label: badge.label[language] || badge.label.en,
    sub: badge.sub[language] || badge.sub.en
  };
};

const TraitBadgeCard: React.FC<{ category: string; score: number; language: 'en' | 'jp' | 'fr' }> = ({ category, score, language }) => {
  const badge = getTraitBadge(category, score, language);

  return (
  <div className="group relative min-w-0">
      <div className={`absolute -inset-1 bg-gradient-to-r ${badge.colorClass} rounded-[2rem] opacity-0 blur-xl group-hover:opacity-15 transition-opacity duration-700`}></div>
      <div className="relative bg-white border border-slate-100 rounded-[1.75rem] sm:rounded-[2rem] p-5 sm:p-6 shadow-xl shadow-slate-200/30 flex flex-col items-center text-center transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl h-full">
        <div className="w-full flex justify-between items-center mb-6">
          <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">{category}</span>
          <div className="flex items-center space-x-1">
            <span className="text-xs font-mono font-black text-slate-900">{score}</span>
            <span className="text-[8px] font-black text-slate-300">LV</span>
          </div>
        </div>

        <div className="relative w-28 h-28 mb-6 flex items-center justify-center">
          <svg className="absolute inset-0 w-28 h-28 -rotate-90">
            <circle cx="56" cy="56" r="45" fill="none" stroke="#f1f5f9" strokeWidth="6" />
            <circle 
              cx="56" cy="56" r="45" 
              fill="none" 
              stroke={`url(#grad-${category})`}
              strokeWidth="7" 
              strokeDasharray={282.6} 
              strokeDashoffset={282.6 - (282.6 * score) / 100}
              strokeLinecap="round"
              className="transition-all duration-[1.5s] ease-out"
            />
            <defs>
              <linearGradient id={`grad-${category}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={badge.colors[0]} />
                <stop offset="100%" stopColor={badge.colors[1]} />
              </linearGradient>
            </defs>
          </svg>
          <div className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${badge.colorClass} flex items-center justify-center p-3 sm:p-4 text-white shadow-lg z-10 group-hover:scale-110 transition-transform duration-500`}>
            {badge.icon}
          </div>
        </div>

        <div className="space-y-2 mt-auto">
          <div className="text-lg sm:text-xl font-black text-slate-800 leading-tight tracking-tight">
            {badge.label}
          </div>
          <div className="text-[11px] font-bold text-slate-400 leading-relaxed px-4 opacity-80 group-hover:opacity-100 transition-opacity">
            {badge.sub}
          </div>
        </div>
      </div>
    </div>
  );
};

const DetailedBar: React.FC<{ label: string; score: number; color: string; icon: React.ReactNode; dimensionLabel: string }> = ({ label, score, color, icon, dimensionLabel }) => (
  <div className="group space-y-3 p-5 bg-slate-50/50 rounded-2xl border border-transparent hover:border-white hover:bg-white hover:shadow-xl transition-all duration-500">
    <div className="flex justify-between items-center">
      <div className="flex items-center space-x-4">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center p-2.5 text-white shadow-md`}>
          {icon}
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest leading-none mb-1">{dimensionLabel}</span>
          <span className="text-sm font-bold text-slate-700">{label}</span>
        </div>
      </div>
      <div className="text-2xl font-mono font-black text-slate-900">
        {score}<span className="text-xs opacity-20 ml-1">%</span>
      </div>
    </div>
    <div className="relative h-2 w-full bg-slate-200/50 rounded-full overflow-hidden">
      <div 
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-[2.5s] ease-out`} 
        style={{ width: `${score}%` }}
      />
    </div>
  </div>
);

const SectionHeader: React.FC<{ title: string; subtitle: string; icon: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div className="text-center space-y-4 mb-10 sm:mb-14 md:mb-16 relative">
    <div className="inline-flex items-center justify-center w-12 h-12 bg-white rounded-2xl shadow-md border border-slate-50 text-indigo-500 mb-2 p-3 mx-auto">
      {icon}
    </div>
    <div className="space-y-1">
      <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.5em]">{subtitle}</h2>
      <h3 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight">{title}</h3>
    </div>
    <div className="w-8 h-1 bg-indigo-500/20 mx-auto rounded-full mt-4"></div>
  </div>
);

const ComprehensiveResults: React.FC<ComprehensiveResultsProps> = ({ profile, onRestart, languageOverride }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const resolvedLang = languageOverride || (language as 'en' | 'jp' | 'fr');
  const advice = profile.aiAdvice;
  const t = {
    en: {
      profileProtocol: 'Profile Protocol V2.4',
      coreArchetypeTitle: 'Core Archetype',
      coreArchetypeSubtitle: 'Cognitive Structure',
      relationalTitle: 'Relational Sync',
      relationalSubtitle: 'Interpersonal Logic',
      relationshipMode: 'Relationship Mode',
      signatureStyle: 'Signature Style',
      optimalPartner: 'Optimal Partnership',
      relationalGuidance: 'AI Relational Guidance',
      systemIdentityTitle: 'System Identity',
      systemIdentitySubtitle: 'Career Capability',
      professionalRole: 'Professional Role',
      latentEssence: 'Latent Essence',
      insightsTitle: 'Insights Lab',
      insightsSubtitle: 'AI Deep Diagnostics',
      coreCapabilities: 'Core Capabilities',
      strategicGrowth: 'Strategic Growth',
      baselineTitle: 'Baseline Calibration',
      baselineSubtitle: 'Big Five Detailed Log',
      saveReport: 'Save Report',
      restart: 'Retake Diagnosis',
      analysisPending: 'Analysis pending...',
      calculating: 'Calculating synergy...',
      scanningRisks: 'Scanning risks...',
      generating: 'Generating insights...',
      discovering: 'Discovering...',
      unlocking: 'Unlocking potential...',
      processingGrowth: 'Processing growth paths...',
      updateStory: 'Update your story from here.',
      defaultRole: 'Professional Role',
      defaultSync: 'High Synergy Type',
      defaultWarning: 'Risk/Warning',
      dimensionLabel: 'Dimension Log',
      aiCharacterTitle: 'AI Character Assigned',
      aiCharacterSubtitle: 'Personality → Companion',
      aiCharacterCta: 'View character profile'
    },
    jp: {
      profileProtocol: 'Profile Protocol V2.4',
      coreArchetypeTitle: 'Core Archetype',
      coreArchetypeSubtitle: 'Cognitive Structure',
      relationalTitle: 'Relational Sync',
      relationalSubtitle: 'Interpersonal Logic',
      relationshipMode: 'Relationship Mode',
      signatureStyle: 'Signature Style',
      optimalPartner: 'Optimal Partnership',
      relationalGuidance: 'AI Relational Guidance',
      systemIdentityTitle: 'System Identity',
      systemIdentitySubtitle: 'Career Capability',
      professionalRole: 'Professional Role',
      latentEssence: 'Latent Essence',
      insightsTitle: 'Insights Lab',
      insightsSubtitle: 'AI Deep Diagnostics',
      coreCapabilities: 'Core Capabilities',
      strategicGrowth: 'Strategic Growth',
      baselineTitle: 'Baseline Calibration',
      baselineSubtitle: 'ビッグファイブ詳細解析ログ',
      saveReport: '診断レポートを保存',
      restart: '再診断を実行',
      analysisPending: '分析中...',
      calculating: '相性を計算中...',
      scanningRisks: 'リスク分析中...',
      generating: 'インサイト生成中...',
      discovering: '解析中...',
      unlocking: '潜在性を解放中...',
      processingGrowth: '成長パスを処理中...',
      updateStory: 'あなたの物語を、\nここからアップデートする。',
      defaultRole: 'Professional Role',
      defaultSync: 'High Synergy Type',
      defaultWarning: 'Risk/Warning',
      dimensionLabel: 'Dimension Log',
      aiCharacterTitle: 'AIキャラクターが確定しました',
      aiCharacterSubtitle: '性格診断 → 相棒',
      aiCharacterCta: 'キャラクタープロフィールを見る'
    },
    fr: {
      profileProtocol: 'Profile Protocol V2.4',
      coreArchetypeTitle: 'Archétype central',
      coreArchetypeSubtitle: 'Structure cognitive',
      relationalTitle: 'Synchronisation relationnelle',
      relationalSubtitle: 'Logique interpersonnelle',
      relationshipMode: 'Mode relationnel',
      signatureStyle: 'Style signature',
      optimalPartner: 'Partenaire optimal',
      relationalGuidance: 'Conseils relationnels IA',
      systemIdentityTitle: 'Identité système',
      systemIdentitySubtitle: 'Capacité professionnelle',
      professionalRole: 'Rôle professionnel',
      latentEssence: 'Essence latente',
      insightsTitle: 'Lab d’insights',
      insightsSubtitle: 'Diagnostics IA approfondis',
      coreCapabilities: 'Capacités clés',
      strategicGrowth: 'Croissance stratégique',
      baselineTitle: 'Calibration de base',
      baselineSubtitle: 'Journal détaillé Big Five',
      saveReport: 'Enregistrer le rapport',
      restart: 'Refaire le diagnostic',
      analysisPending: 'Analyse en cours...',
      calculating: 'Calcul de la synergie...',
      scanningRisks: 'Analyse des risques...',
      generating: 'Génération des insights...',
      discovering: 'Découverte...',
      unlocking: 'Révélation du potentiel...',
      processingGrowth: 'Traitement des axes de progression...',
      updateStory: 'Mettez à jour votre histoire ici.',
      defaultRole: 'Rôle professionnel',
      defaultSync: 'Synergie élevée',
      defaultWarning: 'Risque / Alerte',
      dimensionLabel: 'Dimension Log',
      aiCharacterTitle: 'Personnage IA attribué',
      aiCharacterSubtitle: 'Personnalité → Compagnon',
      aiCharacterCta: 'Voir le profil du personnage'
    }
  } as const;
  const labels = t[resolvedLang === 'fr' ? 'fr' : resolvedLang];

  // --- Phase 13-A: Auto-save profile to DB ---
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const saveAttempted = useRef(false);

  useEffect(() => {
    if (saveAttempted.current) return;
    saveAttempted.current = true;

    const saveProfile = async () => {
      try {
        const rawProfile = {
          big_five: profile.scores,
          learning_style: profile.learningStyle ? { type: profile.learningStyle } : {},
          motivation: profile.motivation ? { primary: profile.motivation } : {},
        };
        const res = await fetch('/api/v2/learner-profiles/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assessment_type: 'big_five_v1',
            raw_profile: rawProfile,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setSavedVersion(data.profile_version);
          console.log('[Profile] Auto-saved to DB, version:', data.profile_version);
        } else {
          setSaveError(true);
        }
      } catch {
        setSaveError(true);
      }
    };
    saveProfile();
  }, [profile]);
  // --- End Phase 13-A ---

  // Helper to render long "Title: Desc" strings beautifully
  const renderDescriptiveItem = (text: string | undefined, defaultTitle: string) => {
    if (!text) return { title: defaultTitle, body: 'Analyzing...' };
    const match = text.match(/^([^:：]+)[:：](.*)$/);
    if (match) {
      return { title: match[1].trim(), body: match[2].trim() };
    }
    return { title: text, body: '' };
  };

  const roleInfo = renderDescriptiveItem(advice?.businessPartnership?.role, labels.defaultRole);
  const syncInfo = renderDescriptiveItem(advice?.businessPartnership?.bestSync, labels.defaultSync);
  const warningInfo = renderDescriptiveItem(advice?.businessPartnership?.warning, labels.defaultWarning);

  const typeConfigs: Record<string, { icon: React.ReactNode; bg: string; description: { en: string; jp: string }; display: { en: string; jp: string } }> = {
    'character/openness': { icon: <Eye className="w-full h-full" />, bg: 'from-amber-400 to-orange-500', display: { en: 'character/openness', jp: 'character/openness' }, description: { en: 'High openness: curious, imaginative, and experimental.', jp: '開放性が高く、好奇心と想像力で新しい学びに向かうタイプ。' } },
    '冒険家': { icon: <Wind className="w-full h-full" />, bg: 'from-orange-400 to-red-500', display: { en: 'Explorer', jp: '冒険家' }, description: { en: 'Opens new paths with bold ideas and action.', jp: '自由な発想と行動力で、未踏の領域を切り拓く開探者。' } },
    '戦略家': { icon: <Swords className="w-full h-full" />, bg: 'from-blue-500 to-indigo-600', display: { en: 'Strategist', jp: '戦略家' }, description: { en: 'Solves complex problems with logic and long-term vision.', jp: '論理的な分析と長期的な視点で、複雑な課題を解き明かす軍師。' } },
    'サポーター': { icon: <HeartHandshake className="w-full h-full" />, bg: 'from-pink-400 to-rose-500', display: { en: 'Supporter', jp: 'サポーター' }, description: { en: 'Strengthens teams through empathy and harmony.', jp: '高い共感性と調和の精神で、チームの絆を強固にする調整役。' } },
    '思想家': { icon: <Lightbulb className="w-full h-full" />, bg: 'from-purple-500 to-indigo-700', display: { en: 'Thinker', jp: '思想家' }, description: { en: 'Pursues the essence with deep insight and curiosity.', jp: '深い洞察と知的好奇心で、物事の本質を追究する哲学者。' } },
    '職人': { icon: <Box className="w-full h-full" />, bg: 'from-amber-400 to-orange-500', display: { en: 'Artisan', jp: '職人' }, description: { en: 'Delivers excellence through focus and craft.', jp: '緻密な技術と集中力で、完璧な成果物を創り上げる専門家。' } },
    'バランサー': { icon: <Infinity className="w-full h-full" />, bg: 'from-green-400 to-emerald-600', display: { en: 'Balancer', jp: 'バランサー' }, description: { en: 'Adapts flexibly and brings stability.', jp: '柔軟な適応力と安定感で、あらゆる環境に調和をもたらす万能型。' } },
  };

  const config = typeConfigs[profile.personalityType] || { icon: <Zap className="w-full h-full" />, bg: 'from-indigo-500 to-purple-600', display: { en: 'Unique', jp: 'ユニーク' }, description: { en: 'A unique balance of traits.', jp: '独自のバランスを持つユニークな特性。' } };
  const characterCandidates = [
    { id: 'openness', score: profile.scores.openness },
    { id: 'conscientiousness', score: profile.scores.conscientiousness },
    { id: 'extraversion', score: profile.scores.extraversion },
    { id: 'agreeableness', score: profile.scores.agreeableness },
    { id: 'stability', score: 100 - profile.scores.neuroticism }
  ];

  const selectedCharacterId = characterCandidates.sort((a, b) => b.score - a.score)[0]?.id || 'openness';

  const characterMap: Record<string, { name: { en: string; jp: string; fr?: string }; botName: { en: string; jp: string }; description: { en: string; jp: string; fr?: string }; gradient: string; icon: React.ReactNode }> = {
    openness: {
      name: { en: 'The Visionary', jp: 'ビジョナリー', fr: 'Visionnaire' },
      botName: { en: 'Spark', jp: 'スパーク' },
      description: {
        en: 'Creative explorer who unlocks bold ideas and innovative paths.',
        jp: '大胆な発想と新しい可能性を切り拓く創造的な探究者。',
        fr: 'Explorateur créatif qui ouvre de nouvelles idées et voies innovantes.'
      },
      gradient: 'from-purple-500 to-indigo-600',
      icon: <Sparkles className="w-10 h-10" />
    },
    conscientiousness: {
      name: { en: 'The Architect', jp: 'アーキテクト', fr: 'Architecte' },
      botName: { en: 'Focus', jp: 'フォーカス' },
      description: {
        en: 'Strategic planner who builds steady, reliable progress.',
        jp: '着実な前進を設計する戦略家。',
        fr: 'Planificateur stratégique qui construit un progrès fiable.'
      },
      gradient: 'from-blue-500 to-cyan-600',
      icon: <Brain className="w-10 h-10" />
    },
    extraversion: {
      name: { en: 'The Catalyst', jp: 'カタリスト', fr: 'Catalyseur' },
      botName: { en: 'Vibe', jp: 'バイブ' },
      description: {
        en: 'Energizer who boosts momentum and action.',
        jp: '勢いと行動を加速させる起爆剤。',
        fr: 'Un moteur d’énergie qui accélère l’action.'
      },
      gradient: 'from-orange-400 to-red-500',
      icon: <Zap className="w-10 h-10" />
    },
    agreeableness: {
      name: { en: 'The Mediator', jp: 'メディエーター', fr: 'Médiateur' },
      botName: { en: 'Echo', jp: 'エコー' },
      description: {
        en: 'Empathetic partner who supports balance and collaboration.',
        jp: '共感と調和でチームを支える相棒。',
        fr: 'Partenaire empathique qui soutient l’équilibre et la collaboration.'
      },
      gradient: 'from-emerald-400 to-teal-500',
      icon: <Heart className="w-10 h-10" />
    },
    stability: {
      name: { en: 'The Anchor', jp: 'アンカー', fr: 'Ancre' },
      botName: { en: 'Luna', jp: 'ルナ' },
      description: {
        en: 'Calm stabilizer who brings clarity under pressure.',
        jp: '落ち着きと安定感で状況を整える支柱。',
        fr: 'Stabilisateur calme qui apporte de la clarté sous pression.'
      },
      gradient: 'from-slate-500 to-slate-700',
      icon: <Anchor className="w-10 h-10" />
    }
  };

  const selectedCharacter = characterMap[selectedCharacterId];
  const characterName = selectedCharacter?.name[resolvedLang] || selectedCharacter?.name.jp || '';
  const characterBotName = resolvedLang === 'jp' ? selectedCharacter?.botName.jp : selectedCharacter?.botName.en;
  const characterDescription = selectedCharacter?.description[resolvedLang] || selectedCharacter?.description.jp || '';

  const traitMeta = {
    openness: { label: { en: 'Openness', jp: '開放性', fr: 'Ouverture' }, color: 'from-amber-400 to-orange-500', icon: <Eye className="w-5 h-5" /> },
    conscientiousness: { label: { en: 'Conscientiousness', jp: '誠実性', fr: 'Conscience' }, color: 'from-blue-500 to-indigo-600', icon: <CheckCircle2 className="w-5 h-5" /> },
    extraversion: { label: { en: 'Extraversion', jp: '外向性', fr: 'Extraversion' }, color: 'from-yellow-400 to-orange-500', icon: <Zap className="w-5 h-5" /> },
    agreeableness: { label: { en: 'Agreeableness', jp: '協調性', fr: 'Agréabilité' }, color: 'from-pink-400 to-rose-500', icon: <HeartHandshake className="w-5 h-5" /> },
    stability: { label: { en: 'Stability', jp: '安定性', fr: 'Stabilité' }, color: 'from-slate-500 to-slate-700', icon: <Anchor className="w-5 h-5" /> }
  } as const;

  const topTraits = [
    { id: 'openness', score: profile.scores.openness },
    { id: 'conscientiousness', score: profile.scores.conscientiousness },
    { id: 'extraversion', score: profile.scores.extraversion },
    { id: 'agreeableness', score: profile.scores.agreeableness },
    { id: 'stability', score: 100 - profile.scores.neuroticism }
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((trait) => {
      const meta = traitMeta[trait.id as keyof typeof traitMeta];
      const label = meta.label[resolvedLang] || meta.label.jp;
      return {
        id: trait.id,
        label,
        score: Math.round(trait.score),
        color: meta.color,
        icon: meta.icon
      };
    });

  return (
    <div className="max-w-6xl xl:max-w-7xl mx-auto space-y-12 sm:space-y-16 lg:space-y-20 pb-16 sm:pb-20 px-4 sm:px-6 lg:px-8">
      
      <CharacterRevealPanel
        title={labels.aiCharacterTitle}
        subtitle={labels.aiCharacterSubtitle}
        protocolLabel={labels.profileProtocol}
        ctaLabel={labels.aiCharacterCta}
        character={{
          id: selectedCharacterId,
          name: characterName,
          botName: characterBotName || '',
          description: characterDescription,
          gradient: selectedCharacter?.gradient || 'from-indigo-500 to-purple-600',
          icon: selectedCharacter?.icon || <Sparkles className="w-10 h-10" />
        }}
        topTraits={topTraits}
        onOpenProfile={() => navigate(`/character/${selectedCharacterId}`)}
      />

      <section>
        <SectionHeader title={labels.coreArchetypeTitle} subtitle={labels.coreArchetypeSubtitle} icon={<BarChart3 className="w-full h-full" />} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
          <TraitBadgeCard category="openness" score={profile.scores.openness} language={resolvedLang} />
          <TraitBadgeCard category="conscientiousness" score={profile.scores.conscientiousness} language={resolvedLang} />
          <TraitBadgeCard category="extraversion" score={profile.scores.extraversion} language={resolvedLang} />
          <TraitBadgeCard category="agreeableness" score={profile.scores.agreeableness} language={resolvedLang} />
          <TraitBadgeCard category="neuroticism" score={profile.scores.neuroticism} language={resolvedLang} />
        </div>
      </section>

      <section>
        <SectionHeader title={labels.relationalTitle} subtitle={labels.relationalSubtitle} icon={<HeartHandshake className="w-full h-full" />} />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
          <div className="lg:col-span-7 bg-slate-900 p-5 sm:p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl group-hover:scale-125 transition-transform duration-700"></div>
            <h4 className="text-[10px] font-black text-rose-400 uppercase tracking-[0.4em] mb-12 flex items-center">
              <span className="w-8 h-px bg-rose-400/40 mr-4"></span> {labels.relationshipMode}
            </h4>
            <div className="space-y-10 relative z-10">
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{labels.signatureStyle}</span>
                <p className="text-xl sm:text-2xl md:text-3xl font-black leading-tight tracking-tight">{advice?.relationshipAnalysis?.style || labels.analysisPending}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{labels.optimalPartner}</span>
                <p className="text-base sm:text-lg font-bold text-slate-300 leading-relaxed border-l-2 border-rose-500/50 pl-6 italic">
                  {advice?.relationshipAnalysis?.idealPartner || labels.calculating}
                </p>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 bg-white p-5 sm:p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 shadow-xl flex flex-col justify-center text-center relative">
             <Quote className="w-8 h-8 text-indigo-100 mb-8 mx-auto" />
             <p className="text-slate-600 font-medium leading-relaxed italic text-lg sm:text-xl px-2">
               "{advice?.relationshipAnalysis?.advice || labels.generating}"
             </p>
             <div className="mt-10 pt-8 border-t border-slate-50">
               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.3em]">{labels.relationalGuidance}</span>
             </div>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader title={labels.systemIdentityTitle} subtitle={labels.systemIdentitySubtitle} icon={<Briefcase className="w-full h-full" />} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
          <div className="lg:col-span-2 bg-white rounded-[2rem] md:rounded-[2.5rem] p-5 sm:p-6 md:p-8 border border-slate-100 shadow-xl space-y-8 md:space-y-10">
            <div>
              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block mb-2">{labels.professionalRole}</span>
              <h5 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tighter leading-none mb-6">
                {roleInfo.title}
              </h5>
              <p className="text-slate-500 font-medium leading-relaxed text-base sm:text-lg">
                {roleInfo.body}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-8 pt-10 border-t border-slate-50">
              <div className="space-y-3">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{syncInfo.title}</span>
                <p className="font-bold text-slate-700 leading-relaxed">{syncInfo.body || labels.analysisPending}</p>
              </div>
              <div className="space-y-3">
                <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest block">{warningInfo.title}</span>
                <p className="font-bold text-slate-700 leading-relaxed">{warningInfo.body || labels.scanningRisks}</p>
              </div>
            </div>
          </div>
          <div className={`bg-gradient-to-br ${config.bg} rounded-[2rem] md:rounded-[2.5rem] p-5 sm:p-6 md:p-8 text-white shadow-xl relative overflow-hidden flex flex-col group`}>
            <h4 className="text-[10px] font-black text-white/60 uppercase tracking-[0.4em] mb-12">{labels.latentEssence}</h4>
            <div className="relative z-10 mt-auto">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center p-3 text-white mb-6 shadow-inner">
                <Sparkles className="w-full h-full animate-pulse" />
              </div>
              <h5 className="text-2xl sm:text-3xl font-black mb-3 tracking-tight leading-none">{advice?.hiddenTalent?.title || labels.discovering}</h5>
              <p className="text-white/90 text-sm leading-relaxed font-medium italic opacity-80">{advice?.hiddenTalent?.description || labels.unlocking}</p>
            </div>
            <Fingerprint className="text-white/5 w-[18rem] h-[18rem] absolute -bottom-16 -right-16 rotate-12" />
          </div>
        </div>
      </section>

      <section className="bg-slate-950 sm:-mx-6 lg:-mx-8 px-4 sm:px-10 lg:px-16 py-12 sm:py-16 rounded-[2rem] sm:rounded-[2.5rem] md:rounded-[3rem] text-white overflow-hidden relative shadow-2xl">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px] -mr-40 -mt-40"></div>
        <SectionHeader title={labels.insightsTitle} subtitle={labels.insightsSubtitle} icon={<Brain className="w-full h-full" />} />
        <div className="grid lg:grid-cols-2 gap-6 sm:gap-10 mt-8 sm:mt-12 relative z-10">
          <div className="space-y-8 sm:space-y-12">
            <h4 className="text-indigo-400 font-black uppercase tracking-[0.5em] text-[10px] flex items-center">
              <span className="w-12 h-px bg-indigo-400/40 mr-4"></span> {labels.coreCapabilities}
            </h4>
            <div className="grid gap-4 sm:gap-6">
              {advice?.strengths?.map((s, i) => (
                <div key={i} className="group bg-white/5 border border-white/10 p-5 sm:p-6 rounded-[1.75rem] sm:rounded-[2rem] hover:bg-white/[0.08] transition-all">
                  <h5 className="text-lg sm:text-xl font-black text-white mb-2 tracking-tight leading-snug">{s.title}</h5>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed font-medium">{s.description}</p>
                </div>
              )) || <div className="text-slate-500 italic">{labels.analysisPending}</div>}
            </div>
          </div>
          <div className="space-y-8 sm:space-y-12">
            <h4 className="text-purple-400 font-black uppercase tracking-[0.5em] text-[10px] flex items-center">
              <span className="w-12 h-px bg-purple-400/40 mr-4"></span> {labels.strategicGrowth}
            </h4>
            <div className="grid gap-4 sm:gap-6">
              {advice?.growthTips?.map((s, i) => (
                <div key={i} className="group bg-white/5 border border-white/10 p-5 sm:p-6 rounded-[1.75rem] sm:rounded-[2rem] hover:bg-white/[0.08] transition-all">
                  <h5 className="text-lg sm:text-xl font-black text-white mb-2 tracking-tight leading-snug">{s.title}</h5>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed font-medium">{s.description}</p>
                </div>
              )) || <div className="text-slate-500 italic">{labels.processingGrowth}</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="pt-12 sm:pt-16 border-t border-slate-100">
        <div className="max-w-4xl mx-auto space-y-8 sm:space-y-12">
          <div className="text-center">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] mb-4">{labels.baselineTitle}</h4>
            <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{labels.baselineSubtitle}</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 bg-white p-5 sm:p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-50">
            <DetailedBar dimensionLabel={labels.dimensionLabel} label="Openness / 開放性" score={profile.scores.openness} color="from-orange-400 to-amber-500" icon={<Eye className="w-full h-full" />} />
            <DetailedBar dimensionLabel={labels.dimensionLabel} label="Conscientiousness / 誠実性" score={profile.scores.conscientiousness} color="from-blue-500 to-indigo-600" icon={<CheckCircle2 className="w-full h-full" />} />
            <DetailedBar dimensionLabel={labels.dimensionLabel} label="Extraversion / 外向性" score={profile.scores.extraversion} color="from-yellow-400 to-orange-500" icon={<Zap className="w-full h-full" />} />
            <DetailedBar dimensionLabel={labels.dimensionLabel} label="Agreeableness / 協調性" score={profile.scores.agreeableness} color="from-pink-400 to-rose-500" icon={<HeartHandshake className="w-full h-full" />} />
            <DetailedBar dimensionLabel={labels.dimensionLabel} label="Neuroticism / 繊細さ" score={profile.scores.neuroticism} color="from-purple-400 to-indigo-500" icon={<Scale className="w-full h-full" />} />
          </div>
        </div>
      </section>

      <section className="text-center pt-12 sm:pt-16">
        <div className="max-w-3xl mx-auto space-y-8 sm:space-y-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 leading-tight tracking-tighter">
            {resolvedLang === 'jp' ? (
              <>
                あなたの物語を、<br />
                ここからアップデートする。
              </>
            ) : (
              labels.updateStory
            )}
          </h2>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-6">
            <button className="px-6 sm:px-10 py-3 sm:py-4 bg-slate-900 text-white rounded-[1.5rem] sm:rounded-[1.75rem] font-black text-[11px] uppercase tracking-[0.3em] hover:scale-105 transition-all shadow-xl active:scale-95 flex items-center gap-3">
              {savedVersion ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {resolvedLang === 'jp' ? `保存済み v${savedVersion}` : `Saved v${savedVersion}`}
                </>
              ) : saveError ? (
                <>{resolvedLang === 'jp' ? 'オフライン保存' : 'Saved Locally'}</>
              ) : (
                <>{labels.saveReport}</>
              )}
            </button>
            <button 
              onClick={onRestart} 
              className="px-6 sm:px-10 py-3 sm:py-4 bg-white text-slate-500 border-2 border-slate-100 rounded-[1.5rem] sm:rounded-[1.75rem] font-black text-[11px] uppercase tracking-[0.3em] hover:bg-slate-50 transition-all active:scale-95"
            >
              {labels.restart}
            </button>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(2deg); }
          50% { transform: translateY(-12px) rotate(4deg); }
        }
        .animate-float { animation: float 6s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default ComprehensiveResults;
