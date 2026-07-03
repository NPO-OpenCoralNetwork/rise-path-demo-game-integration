import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, Sparkles, Target, Shield, BookOpen, Zap } from 'lucide-react';
import { useLanguage } from '../../../../context/LanguageContext';

interface LearningMirrorViewProps {}

interface DerivedProfile {
  credential_orientation?: string;
  problem_solving_orientation?: string;
  example_first_preference?: string;
  structure_need?: string;
  reassurance_need?: string;
  practice_intensity?: string;
  pace_preference?: string;
  social_learning_preference?: string;
  feedback_style?: string;
}

const AXIS_META: Record<string, {
  jp: string; en: string;
  icon: React.ReactNode;
  insights: Record<string, { jp: string; en: string }>;
}> = {
  credential_orientation: {
    jp: '資格志向', en: 'Credential Orientation',
    icon: <Target size={18} />,
    insights: {
      high: { jp: 'あなたは資格や認定を目標にすると学びが定着しやすいタイプです。', en: 'You learn best when working toward certifications or credentials.' },
      medium: { jp: '資格取得も視野に入れつつ、実践とのバランスを大事にしましょう。', en: 'You balance credential goals with practical learning.' },
      low: { jp: '資格よりも実践的なスキル習得を重視する傾向があります。', en: 'You prefer practical skill-building over formal credentials.' },
    },
  },
  problem_solving_orientation: {
    jp: '問題解決志向', en: 'Problem Solving Style',
    icon: <Zap size={18} />,
    insights: {
      high: { jp: '課題や問題演習から学ぶのが得意です。実際に手を動かすことで理解が深まります。', en: 'You thrive on challenges and exercises. Hands-on practice deepens your understanding.' },
      medium: { jp: '理論と演習のバランスが効果的です。', en: 'A balance of theory and practice works well for you.' },
      low: { jp: 'まず全体像を掴んでから、徐々に問題に取り組むスタイルが合っています。', en: 'You prefer understanding the big picture before diving into problems.' },
    },
  },
  example_first_preference: {
    jp: '例示優先度', en: 'Example Preference',
    icon: <BookOpen size={18} />,
    insights: {
      high: { jp: '具体的な例やケーススタディから入ると理解しやすいタイプです。', en: 'You understand concepts best when presented with concrete examples first.' },
      medium: { jp: '例と原理のどちらからでも学べる柔軟性があります。', en: 'You can learn from both examples and principles flexibly.' },
      low: { jp: '原理や理論を先に理解してから、例で確認するスタイルが合っています。', en: 'You prefer learning principles first, then confirming with examples.' },
    },
  },
  reassurance_need: {
    jp: '安心感の必要度', en: 'Reassurance Need',
    icon: <Shield size={18} />,
    insights: {
      high: { jp: '「大丈夫、これでOK」という確認があると安心して次に進めます。Rise Pathがサポートします。', en: 'You feel more confident with reassurance along the way. Rise Path will support you.' },
      medium: { jp: '適度な確認とフィードバックで、安定して学習を進められます。', en: 'Moderate feedback helps you learn steadily.' },
      low: { jp: '自分のペースで自律的に学習できるタイプです。', en: 'You learn independently at your own pace.' },
    },
  },
  practice_intensity: {
    jp: '演習の強度', en: 'Practice Intensity',
    icon: <Sparkles size={18} />,
    insights: {
      high: { jp: '多めの演習と繰り返しで知識を定着させるタイプです。', en: 'You benefit from intensive, repeated practice to solidify knowledge.' },
      medium: { jp: '適度な量の演習で効率よく学べます。', en: 'A moderate amount of practice works efficiently for you.' },
      low: { jp: '少ない演習でも概念を掴めるタイプです。コア演習に集中しましょう。', en: 'You grasp concepts with fewer exercises. Focus on core practice.' },
    },
  },
};

const LearningMirrorView: React.FC<LearningMirrorViewProps> = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [derived, setDerived] = useState<DerivedProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/v2/learner-profiles/latest');
        if (res.ok) {
          const data = await res.json();
          setDerived(data.derived_learning_profile || null);
        }
      } catch {
        // Use localStorage fallback: try to derive from stored assessment
        const profileId = localStorage.getItem('learner_profile_id');
        if (!profileId) setDerived(null);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const t = language === 'jp' ? {
    title: '学習の鏡',
    subtitle: 'あなたの学び方の特徴を可視化します',
    empty: 'まだ診断を受けていません。AI診断を実施して、学習スタイルを見つけましょう。',
    cta: '診断を受ける',
    back: '戻る',
  } : {
    title: 'Learning Mirror',
    subtitle: 'Visualize how you learn best',
    empty: 'No diagnosis yet. Take the AI assessment to discover your learning style.',
    cta: 'Take assessment',
    back: 'Back',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!derived) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <button onClick={() => navigate('/profile')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-8">
          <ArrowLeft size={18} /> {t.back}
        </button>
        <div className="max-w-lg mx-auto text-center mt-20">
          <Brain size={48} className="mx-auto text-slate-300 mb-6" />
          <h2 className="text-xl font-bold text-slate-700 mb-3">{t.title}</h2>
          <p className="text-slate-500 mb-8">{t.empty}</p>
          <button
            onClick={() => navigate('/assessment')}
            className="bg-purple-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-purple-700 transition-all"
          >
            {t.cta}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <button onClick={() => navigate('/profile')} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 mb-8">
        <ArrowLeft size={18} /> {t.back}
      </button>

      <div className="max-w-2xl mx-auto">
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-50 text-purple-600 text-sm font-bold mb-4">
            <Brain size={16} /> {t.title}
          </div>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        <div className="space-y-4">
          {Object.entries(AXIS_META).map(([key, meta]) => {
            const value = (derived as Record<string, string | undefined>)[key] || 'medium';
            const insight = meta.insights[value] || meta.insights.medium;
            return (
              <div key={key} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                    {meta.icon}
                  </span>
                  <h3 className="font-bold text-slate-800">{meta[language]}</h3>
                  <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${
                    value === 'high' ? 'bg-emerald-100 text-emerald-700' :
                    value === 'low' ? 'bg-slate-100 text-slate-500' :
                    'bg-blue-50 text-blue-600'
                  }`}>
                    {value}
                  </span>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">{insight[language]}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LearningMirrorView;
