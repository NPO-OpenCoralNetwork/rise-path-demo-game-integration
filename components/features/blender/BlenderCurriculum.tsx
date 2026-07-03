import React, { useState } from 'react';
import {
  Box, Layers, Play, Clock, Zap, Palette, Move3d,
  ChevronRight, Star, Command, Cuboid
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { getCourseProgress } from '../../../services/progressService';

interface BlenderCurriculumProps {
  onNavigate: (view: ViewState) => void;
}

const BLENDER_COURSES = [
  {
    id: 'b1',
    title: { en: 'The Donut Tutorial', jp: 'ドーナツ・チュートリアル' },
    desc: {
      en: 'Blender’s rite of passage. Learn the basics of modeling, sculpting, and rendering through the classic donut project.',
      jp: 'Blenderの登竜門。モデリング、スカルプト、レンダリングの基礎をドーナツ制作を通して学ぶ。'
    },
    thumbnail: 'https://images.unsplash.com/photo-1626808642875-0aa545482dfb?auto=format&fit=crop&q=80&w=800',
    level: { en: 'Beginner', jp: '初心者' },
    duration: { en: '4h 30m', jp: '4時間30分' },
    tags: ['Modeling', 'Shading', 'Particles'],
    progress: 0,
    recommended: true,
    badge: { en: 'START HERE', jp: '最初にやるべき' }
  },
  {
    id: 'b2',
    title: { en: 'Low Poly Isometric Room', jp: 'ローポリ・アイソメトリックルーム' },
    desc: {
      en: 'Learn hard-surface modeling, lighting, and composition by building a cozy isometric room.',
      jp: 'ハードサーフェスモデリング、ライティング、そして魅力的な構図の作り方。'
    },
    thumbnail: 'https://images.unsplash.com/photo-1617347454431-f49d7ff5c3b1?auto=format&fit=crop&q=80&w=800',
    level: { en: 'Beginner', jp: '初心者' },
    duration: { en: '3h 15m', jp: '3時間15分' },
    tags: ['Hard Surface', 'Lighting', 'Composition'],
    progress: 0
  },
  {
    id: 'b3',
    title: { en: 'Cozy Character Sculpting', jp: 'キャラクター・スカルプティング' },
    desc: {
      en: 'Sculpt organic forms, learn remeshing, and cover character rigging fundamentals.',
      jp: '有機的な形状のスカルプト、リメッシュ、そしてキャラクターリギングの基礎。'
    },
    thumbnail: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?auto=format&fit=crop&q=80&w=800',
    level: { en: 'Intermediate', jp: '中級' },
    duration: { en: '6h 00m', jp: '6時間00分' },
    tags: ['Sculpting', 'Character', 'Rigging'],
    progress: 0
  },
  {
    id: 'b4',
    title: { en: 'Procedural Geometry Nodes', jp: 'ジオメトリノードの魔術' },
    desc: {
      en: 'Generate plants and buildings with endless variation using a node-based workflow.',
      jp: 'ノードベースのワークフローで、無限のバリエーションを持つ植物や建物を生成する。'
    },
    thumbnail: 'https://images.unsplash.com/photo-1633412803524-d96562450871?auto=format&fit=crop&q=80&w=800',
    level: { en: 'Advanced', jp: '上級' },
    duration: { en: '8h 20m', jp: '8時間20分' },
    tags: ['Geo Nodes', 'Math', 'Procedural'],
    progress: 0
  },
  {
    id: 'b5',
    title: { en: 'Realistic Product Viz', jp: '写実的プロダクトビジュアライズ' },
    desc: {
      en: 'Master studio lighting, glass materials, and commercial-style fluid simulations.',
      jp: 'スタジオライティング、ガラスマテリアル、そしてCMのような流体シミュレーション。'
    },
    thumbnail: 'https://images.unsplash.com/photo-1595475207225-428b62bda831?auto=format&fit=crop&q=80&w=800',
    level: { en: 'Intermediate', jp: '中級' },
    duration: { en: '5h 45m', jp: '5時間45分' },
    tags: ['Physics', 'Cycles', 'Commercial'],
    progress: 0
  }
];

const BlenderCurriculum: React.FC<BlenderCurriculumProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState('All');
  const { language } = useLanguage();

  // Merge persisted progress into course data
  const courses = BLENDER_COURSES.map(course => ({
    ...course,
    progress: getCourseProgress(course.id).progress,
  }));

  const copy = {
    en: {
      labLabel: '3D Lab v1.0',
      titlePrefix: 'What will you ',
      titleHighlight: 'create',
      titleSuffix: '?',
      description: 'Manipulate vertices, shape light, and unleash your imagination in 3D space.',
      aboutTitle: 'What is Blender?',
      aboutBody: 'The world’s most popular open-source 3D creation suite. Modeling, animation, and VFX in one place.',
      recommendedBadge: 'Core',
      comingSoon: 'More projects coming soon...',
      proTipLabel: 'Pro Tip:',
      proTipBody: 'Press B for box select, and C for circle select.'
    },
    jp: {
      labLabel: '3Dラボ v1.0',
      titlePrefix: '何を',
      titleHighlight: '創造',
      titleSuffix: 'しますか？',
      description: '頂点を操作し、光を操り、あなたの想像力を3次元の世界へ解き放ちましょう。',
      aboutTitle: 'Blenderとは？',
      aboutBody: '世界で最も人気のあるオープンソース3DCG制作スイート。モデリング、アニメーション、VFXまでこれ一つで完結します。',
      recommendedBadge: '必修',
      comingSoon: '近日、さらにプロジェクトを追加予定...',
      proTipLabel: 'Pro Tip:',
      proTipBody: 'B でボックス選択、C でサークル選択が可能です。'
    }
  } as const;

  const t = copy[language];

  const handleProjectClick = () => {
    onNavigate(ViewState.BLENDER_PATH);
  };

  return (
    <div className="min-h-screen font-sans pb-20 bg-slate-50 transition-colors duration-500">

      {/* Header Info */}
      <div className="max-w-4xl mx-auto px-6 pt-12 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="border p-2 rounded-xl bg-white border-slate-200 text-orange-500">
            <Box size={20} />
          </div>
          <span className="text-slate-500 font-mono text-xs uppercase tracking-widest">
            {t.labLabel}
          </span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-slate-900">
          {t.titlePrefix}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500">{t.titleHighlight}</span>
          {t.titleSuffix}
        </h1>
        <p className="text-lg max-w-xl text-slate-600">
          {t.description}
        </p>
      </div>

      {/* Active Track Description (Static for Blender for now) */}
      <div className="max-w-4xl mx-auto px-6 mb-8">
        <div className="border rounded-xl p-6 flex items-start gap-4 bg-orange-50/30 border-orange-100 shadow-sm">
          <div className="p-3 rounded-lg bg-orange-500/10">
            <Move3d size={20} className="text-orange-500" />
          </div>
          <div>
            <h3 className="font-bold text-base mb-1 text-slate-800">{t.aboutTitle}</h3>
            <p className="text-sm leading-relaxed text-slate-600">
              {t.aboutBody}
            </p>
          </div>
        </div>
      </div>

      {/* Course Grid Layout */}
      <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {courses.map(course => (
          <div
            key={course.id}
            onClick={handleProjectClick}
            className={`
              group rounded-2xl cursor-pointer transition-all overflow-hidden flex flex-col h-full relative border
              bg-white border-slate-100 shadow-sm hover:shadow-lg hover:border-orange-100 hover:-translate-y-1
            `}
          >
            {/* Image Section (Top, Fixed Height) */}
            <div className="h-48 w-full relative overflow-hidden shrink-0 bg-slate-100">
              <img
                src={course.thumbnail}
                alt={typeof course.title === 'string' ? course.title : (course.title[language] || course.title.en)}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              />

              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>

              {/* Badges */}
              <div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
                {course.badge && (
                  <div className="bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg backdrop-blur-sm border border-white/20">
                    {course.badge[language]}
                  </div>
                )}
                {course.recommended && (
                  <div className="bg-white/90 backdrop-blur-md text-orange-600 text-[10px] font-bold px-2 py-1 rounded-md shadow-sm border border-orange-100 flex items-center gap-1">
                    <Star size={10} className="fill-orange-600" /> {t.recommendedBadge}
                  </div>
                )}
              </div>
            </div>

            {/* Content Section (Bottom) */}
            <div className="flex-1 p-6 flex flex-col relative">

              {/* Title Area */}
              <div className="mb-3">
                <h3 className="font-bold text-lg leading-tight mb-1 transition-colors text-slate-800 group-hover:text-orange-600">
                  {course.title[language]}
                </h3>
              </div>

              {/* Description */}
              <p className="text-sm text-slate-500 line-clamp-3 mb-6 leading-relaxed flex-1">
                {course.desc[language]}
              </p>

              {/* Footer Info */}
              <div className="pt-4 border-t flex items-center justify-between border-slate-100">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-500">
                    {course.level[language]}
                  </span>
                  <span className="text-xs font-medium flex items-center gap-1.5 text-slate-400">
                    <Clock size={12} /> {course.duration[language]}
                  </span>
                </div>

                <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 bg-slate-50 text-slate-400 group-hover:bg-orange-500 group-hover:text-white">
                  <ChevronRight size={16} />
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Helper Card: Coming Soon */}
        <div className="text-center py-24 border border-dashed rounded-3xl border-slate-300 flex flex-col items-center justify-center gap-4 opacity-60 hover:opacity-100 transition-opacity">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
          <Cuboid size={20} />
        </div>
        <p className="text-slate-500 font-medium">{t.comingSoon}</p>
      </div>
      </div>

      {/* Footer / Tip */}
      <div className="max-w-4xl mx-auto px-6 mt-16 text-center">
        <p className="text-slate-500 text-sm">
          {t.proTipLabel} {t.proTipBody}
        </p>
      </div>

    </div>
  );
};

export default BlenderCurriculum;
