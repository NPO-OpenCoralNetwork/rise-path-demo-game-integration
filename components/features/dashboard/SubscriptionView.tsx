import React, { useEffect } from 'react';
import { ArrowLeft, Check, Zap, Crown, Star } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';

interface SubscriptionViewProps {
  onNavigate: (view: ViewState) => void;
}

const SubscriptionView: React.FC<SubscriptionViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();

  useEffect(() => { setTheme('default'); }, [setTheme]);

  const copy = {
    en: {
      title: 'Plans & Pricing',
      subtitle: 'Choose the plan that fits your learning journey.',
      current: 'Current Plan',
      upgrade: 'Upgrade',
      comingSoon: 'Coming Soon',
      back: 'Back',
      free: 'Free',
      freeDesc: 'Explore at your own pace',
      freeFeatures: ['Access to 3 courses', 'Daily vocabulary & grammar', 'Basic AI diagnosis', 'Community access'],
      pro: 'Pro',
      proPrice: '¥980/mo',
      proDesc: 'Unlock your full potential',
      proFeatures: ['All courses unlimited', 'AI course generator', 'Advanced diagnosis', 'Priority support', 'Roleplay speaking practice'],
      premium: 'Premium',
      premiumPrice: '¥1,980/mo',
      premiumDesc: 'For serious learners',
      premiumFeatures: ['Everything in Pro', '1-on-1 AI tutor sessions', 'Certificate of completion', 'Custom learning paths', 'Offline access'],
    },
    jp: {
      title: 'プラン & 料金',
      subtitle: '学習スタイルに合ったプランを選びましょう。',
      current: '現在のプラン',
      upgrade: 'アップグレード',
      comingSoon: '近日公開',
      back: '戻る',
      free: '無料',
      freeDesc: '自分のペースで探索',
      freeFeatures: ['3コースまでアクセス', '日替わり単語・文法', '基本AI診断', 'コミュニティ参加'],
      pro: 'Pro',
      proPrice: '¥980/月',
      proDesc: '可能性を最大限に',
      proFeatures: ['全コース無制限', 'AIコース生成', '詳細な診断', '優先サポート', 'ロールプレイ練習'],
      premium: 'Premium',
      premiumPrice: '¥1,980/月',
      premiumDesc: '本気の学習者向け',
      premiumFeatures: ['Proの全機能', '1対1 AIチューター', '修了証明書', 'カスタム学習パス', 'オフラインアクセス'],
    },
  } as const;

  const t = copy[language];

  const plans = [
    {
      name: t.free,
      desc: t.freeDesc,
      price: null,
      features: t.freeFeatures,
      icon: Star,
      isCurrent: true,
      gradient: 'from-slate-100 to-white',
      border: 'border-slate-200',
      iconColor: 'text-slate-500',
    },
    {
      name: t.pro,
      desc: t.proDesc,
      price: t.proPrice,
      features: t.proFeatures,
      icon: Zap,
      isCurrent: false,
      gradient: 'from-indigo-50 to-white',
      border: 'border-indigo-200',
      iconColor: 'text-indigo-600',
    },
    {
      name: t.premium,
      desc: t.premiumDesc,
      price: t.premiumPrice,
      features: t.premiumFeatures,
      icon: Crown,
      isCurrent: false,
      gradient: 'from-amber-50 to-white',
      border: 'border-amber-200',
      iconColor: 'text-amber-600',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-4xl mx-auto space-y-8">
        <button
          onClick={() => onNavigate(ViewState.PROFILE)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={16} /> {t.back}
        </button>

        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.name}
                className={`bg-gradient-to-b ${plan.gradient} rounded-3xl border ${plan.border} p-6 flex flex-col shadow-sm`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center ${plan.iconColor}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{plan.name}</h3>
                    <p className="text-xs text-slate-500">{plan.desc}</p>
                  </div>
                </div>

                {plan.price && (
                  <div className="text-2xl font-bold text-slate-900 mb-4">{plan.price}</div>
                )}

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {plan.isCurrent ? (
                  <div className="w-full py-3 rounded-xl text-center text-sm font-bold bg-slate-100 text-slate-500 border border-slate-200">
                    {t.current}
                  </div>
                ) : (
                  <button className="w-full py-3 rounded-xl text-center text-sm font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-md">
                    {t.comingSoon}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionView;
