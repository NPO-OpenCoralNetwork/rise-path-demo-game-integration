import React, { useState } from 'react';
import {
  Terminal, Code, Cpu, Globe, Smartphone,
  ChevronRight, Sparkles, Layout, Zap, Hash
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface ProgrammingCurriculumProps {
  onNavigate: (view: ViewState) => void;
  initialTrack?: string;
}

const TRACKS = [
  {
    id: 'web',
    label: { en: 'Web Development', jp: 'Web開発の基礎' },
    description: {
      en: 'Learn HTML/CSS/React to build modern websites.',
      jp: 'HTML/CSS/Reactを学び、モダンなWebサイト構築スキルを習得します。'
    },
    icon: Globe,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10'
  },
  {
    id: 'vibe',
    label: { en: 'Vibe Coding', jp: 'Vibe Coding' },
    description: {
      en: 'Grasp Git/GitHub/OSS concepts through an immersive, story-driven experience.',
      jp: 'Git/GitHub/OSSの概念を、没入型のストーリー体験を通じて直感的に理解します。'
    },
    icon: Sparkles,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10'
  },
  {
    id: 'ai',
    label: { en: 'Gen AI Camp', jp: 'Gen AI Camp' },
    description: {
      en: 'From image, music, and video generation to agent development with LangChain.',
      jp: '画像・音楽・動画生成から、LangChainを使ったエージェント開発まで。'
    },
    icon: Cpu,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10'
  }
];

const COURSES = [
  {
    id: 5,
    title: { en: 'Vibe Coding: The World', jp: 'Vibe Coding: ザ・ワールド' },
    desc: {
      en: 'An immersive learning journey into Git, GitHub, and the OSS ecosystem.',
      jp: 'Git, GitHub, OSSエコシステムの世界へ飛び込む、新感覚の学習体験。'
    },
    level: { en: 'Advanced', jp: '上級' },
    time: { en: '2h 15m', jp: '2時間15分' },
    track: 'vibe',
    progress: 70,
    image: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 1,
    title: { en: 'React Ecosystem Mastery', jp: 'Reactエコシステム完全攻略' },
    desc: {
      en: 'Master Hooks, Context, and the Next.js 14 App Router with hands-on practice.',
      jp: 'Hooks, Context, Next.js 14 App Routerを極める実践コース。'
    },
    level: { en: 'Intermediate', jp: '中級' },
    time: { en: '4h 30m', jp: '4時間30分' },
    track: 'web',
    progress: 65,
    image: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 4,
    title: { en: 'Modern HTML & CSS', jp: 'モダンHTML & CSSの基礎' },
    desc: {
      en: 'Master the fundamentals of Flexbox, Grid, and responsive design.',
      jp: 'Flexbox, Grid, レスポンシブデザインの基礎をマスター。'
    },
    level: { en: 'Beginner', jp: '初心者' },
    time: { en: '1h 45m', jp: '1時間45分' },
    track: 'web',
    progress: 10,
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=800",
    recommended: true,
    badge: { en: 'Beginner Pick', jp: '初心者おすすめ' }
  },
  {
    id: 6,
    title: { en: 'Debugging with DevTools', jp: 'プロ直伝：デバッグ術' },
    desc: {
      en: 'Pro debugging techniques using Chrome DevTools.',
      jp: 'Chrome DevToolsを使ったプロのデバッグ手法。'
    },
    level: { en: 'Beginner', jp: '初心者' },
    time: { en: '45m', jp: '45分' },
    track: 'web',
    progress: 0,
    image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 101,
    title: { en: 'Digital Art Studio', jp: '画像生成AIマスター' },
    desc: {
      en: 'Master prompt engineering for Midjourney and Stable Diffusion.',
      jp: 'Midjourney, Stable Diffusionのプロンプトエンジニアリングを極める。'
    },
    level: { en: 'Beginner', jp: '初心者' },
    time: { en: '2h 00m', jp: '2時間00分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=800",
    recommended: true,
    badge: { en: 'Popular', jp: '人気' }
  },
  {
    id: 102,
    title: { en: 'AI Music Composer', jp: 'AI音楽クリエイター' },
    desc: {
      en: 'Create pro-quality tracks instantly with Suno and Udio.',
      jp: 'Suno, Udioを使って、プロ品質の楽曲を一瞬で生成する方法。'
    },
    level: { en: 'Beginner', jp: '初心者' },
    time: { en: '1h 30m', jp: '1時間30分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 103,
    title: { en: 'Cinematic AI', jp: '動画生成革命' },
    desc: {
      en: 'Create cinematic videos from text with Runway, Sora, and Pika.',
      jp: 'Runway, Sora, Pika。テキストから映画のような映像を作り出す。'
    },
    level: { en: 'Intermediate', jp: '中級' },
    time: { en: '2h 45m', jp: '2時間45分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 104,
    title: { en: 'LangChain Agents', jp: 'AIエージェント開発' },
    desc: {
      en: 'Build autonomous AI applications with Python and LangChain.',
      jp: 'PythonとLangChainで、自律的に考えるAIアプリケーションを作る。'
    },
    level: { en: 'Advanced', jp: '上級' },
    time: { en: '5h 00m', jp: '5時間00分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1531746790731-6c087fecd65a?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 105,
    title: { en: 'Google AI & Gemini', jp: 'Google AI & Gemini' },
    desc: {
      en: 'Learn AI development in Google’s ecosystem: Gemini, Vertex AI, and TensorFlow.',
      jp: 'Gemini, Vertex AI, TensorFlow。GoogleのエコシステムでAI開発を学ぶ。'
    },
    level: { en: 'Intermediate', jp: '中級' },
    time: { en: '3h 30m', jp: '3時間30分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?auto=format&fit=crop&q=80&w=800"
  },
  {
    id: 106,
    title: { en: 'ChatGPT Master', jp: 'ChatGPTマスター' },
    desc: {
      en: 'From prompt engineering to building Custom GPTs.',
      jp: 'プロンプトエンジニアリングからCustom GPTs構築までを網羅。'
    },
    level: { en: 'Beginner', jp: '初心者' },
    time: { en: '2h 15m', jp: '2時間15分' },
    track: 'ai',
    progress: 0,
    image: "https://images.unsplash.com/photo-1684369175836-3d233aec2223?auto=format&fit=crop&q=80&w=800",
    badge: { en: 'Trending', jp: '急上昇' }
  }
];

const ProgrammingCurriculum: React.FC<ProgrammingCurriculumProps> = ({ onNavigate, initialTrack = 'web' }) => {
  const [activeTrack, setActiveTrack] = useState(initialTrack);
  const { language } = useLanguage();

  const copy = {
    en: {
      campusLabel: 'Dev Campus v2.0',
      titlePrefix: 'What will you ',
      titleHighlight: 'build',
      titleSuffix: '?',
      description: 'Learn modern stacks through practical projects.',
      recommendedBadge: 'Recommended',
      noCourses: 'This course is coming soon.',
      proTipLabel: 'Pro Tip:',
      proTipBody: 'Use Cmd + K for quick search (coming soon).'
    },
    jp: {
      campusLabel: 'Dev Campus v2.0',
      titlePrefix: '何を',
      titleHighlight: '開発',
      titleSuffix: 'しますか？',
      description: '実践的なプロジェクトを通じて、最新の技術スタックを習得しましょう。',
      recommendedBadge: '推奨コース',
      noCourses: 'このコースは準備中です。',
      proTipLabel: 'Pro Tip:',
      proTipBody: 'Cmd + K でクイック検索が可能です（近日公開）'
    }
  } as const;

  const t = copy[language];
  const activeTrackData = TRACKS.find(track => track.id === activeTrack);
  const aboutTitle = activeTrackData
    ? (language === 'jp'
      ? `${activeTrackData.label.jp}とは？`
      : `What is ${activeTrackData.label.en}?`)
    : '';

  const handleCourseClick = (courseId: number) => {
    if (courseId === 1) onNavigate(ViewState.PROGRAMMING_PATH);
    else if (courseId === 2) onNavigate(ViewState.PYTHON_COURSE);
    else if (courseId === 4) onNavigate(ViewState.HTML_CSS_PATH); // Navigates to the new Path View
    else if (courseId === 5) onNavigate(ViewState.VIBE_PATH);
    else if (courseId === 6) onNavigate(ViewState.WEB_INSPECTOR);
  };

  const filteredCourses = COURSES.filter(c => c.track === activeTrack);

  return (
    <div className={`min-h-screen font-sans pb-20 transition-colors duration-500 ${activeTrack === 'web' ? 'bg-slate-50' : 'bg-slate-950'}`}>

      {/* Header Info */}
      <div className="max-w-4xl mx-auto px-6 pt-12 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className={`border p-2 rounded-xl ${activeTrack === 'web' ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
            <Code size={20} />
          </div>
          <span className="text-slate-500 font-mono text-xs uppercase tracking-widest">
            {t.campusLabel}
          </span>
        </div>
        <h1 className={`text-4xl md:text-5xl font-bold mb-4 tracking-tight ${activeTrack === 'web' ? 'text-slate-900' : 'text-white'}`}>
          {t.titlePrefix}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{t.titleHighlight}</span>
          {t.titleSuffix}
        </h1>
        <p className={`text-lg max-w-xl ${activeTrack === 'web' ? 'text-slate-600' : 'text-slate-400'}`}>
          {t.description}
        </p>
      </div>

      {/* Track Tabs (Pills) */}
      <div className="max-w-4xl mx-auto px-6 mb-8">


        {/* Active Track Description */}
        <div className={`border rounded-xl p-6 flex items-start gap-4 ${activeTrack === 'web' ? 'bg-cyan-50/30 border-cyan-100 shadow-sm' : 'bg-slate-900/30 border-slate-800'}`}>
          <div className={`p-3 rounded-lg bg-opacity-10 ${activeTrackData?.bg}`}>
            <Sparkles size={20} className={activeTrackData?.color} />
          </div>
          <div>
            <h3 className={`font-bold text-base mb-1 ${activeTrack === 'web' ? 'text-slate-800' : 'text-slate-200'}`}>{aboutTitle}</h3>
            <p className={`text-sm leading-relaxed ${activeTrack === 'web' ? 'text-slate-600' : 'text-slate-400'}`}>
              {activeTrackData ? activeTrackData.description[language] : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Course Grid Layout */}
      <div className="max-w-[1400px] mx-auto px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredCourses.length > 0 ? (
          filteredCourses.map(course => (
            <div
              key={course.id}
              onClick={() => handleCourseClick(course.id)}
              className={`
                group rounded-2xl cursor-pointer transition-all overflow-hidden flex flex-col h-full relative border
                ${activeTrack === 'web'
                  ? (course.recommended
                    ? 'bg-gradient-to-b from-cyan-50/50 to-white border-cyan-200 shadow-md hover:shadow-xl hover:shadow-cyan-100/40 hover:-translate-y-1'
                    : 'bg-white border-slate-100 shadow-sm hover:shadow-lg hover:border-cyan-100 hover:-translate-y-1')
                  : 'bg-slate-900/30 border-slate-800/50 hover:bg-slate-900 hover:border-slate-700'}
              `}
            >
              {/* Image Section (Top, Fixed Height) */}
              <div className={`h-48 w-full relative overflow-hidden shrink-0 ${activeTrack === 'web' ? 'bg-slate-100' : 'bg-slate-800'}`}>
                <img src={course.image} alt={course.title[language]} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />

                {/* Gradient Overlay for Text Polish */}
                <div className={`absolute inset-0 bg-gradient-to-t ${activeTrack === 'web' ? 'from-white/10 to-transparent' : 'from-black/40 to-transparent'}`}></div>

                {/* Badges Floating on Image */}
                <div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
                  {activeTrack === 'web' && course.badge && (
                    <div className="bg-gradient-to-r from-orange-400 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg backdrop-blur-sm border border-white/20">
                      {course.badge[language]}
                    </div>
                  )}
                  {activeTrack === 'web' && course.recommended && (
                    <div className="bg-white/90 backdrop-blur-md text-cyan-600 text-[10px] font-bold px-2 py-1 rounded-md shadow-sm border border-cyan-100 flex items-center gap-1">
                      <Sparkles size={10} className="fill-cyan-600" /> {t.recommendedBadge}
                    </div>
                  )}
                </div>
              </div>

              {/* Content Section (Bottom) */}
              <div className="flex-1 p-6 flex flex-col relative">

                {/* Title Area */}
                <div className="mb-3">
                  <h3 className={`font-bold text-lg leading-tight mb-1 transition-colors ${activeTrack === 'web' ? 'text-slate-800 group-hover:text-cyan-700' : 'text-slate-200 group-hover:text-white'}`}>
                    {course.title[language]}
                  </h3>
                </div>

                {/* Description - Multi-line supported */}
                <p className={`text-sm ${activeTrack === 'web' ? 'text-slate-500' : 'text-slate-400'} line-clamp-3 mb-6 leading-relaxed flex-1`}>
                  {course.desc[language]}
                </p>

                {/* Footer Info (Level, Time, Chevron) */}
                <div className={`pt-4 border-t flex items-center justify-between ${activeTrack === 'web' ? 'border-slate-100' : 'border-slate-800'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md ${activeTrack === 'web' ? 'bg-slate-100 text-slate-500' : 'bg-slate-800 text-slate-400'}`}>
                      {course.level[language]}
                    </span>
                    <span className={`text-xs font-medium flex items-center gap-1.5 ${activeTrack === 'web' ? 'text-slate-400' : 'text-slate-500'}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> {course.time[language]}
                    </span>
                  </div>

                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300
                        ${activeTrack === 'web'
                      ? (course.recommended ? 'bg-cyan-500 text-white shadow-md shadow-cyan-200 group-hover:bg-cyan-600' : 'bg-slate-50 text-slate-400 group-hover:bg-cyan-500 group-hover:text-white')
                      : 'bg-slate-800 text-slate-500 group-hover:bg-slate-700 group-hover:text-white'}
                        `}>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className={`text-center py-24 border border-dashed rounded-3xl ${activeTrack === 'web' ? 'border-slate-300' : 'border-slate-800'}`}>
            <p className="text-slate-500">{t.noCourses}</p>
          </div>
        )}
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

export default ProgrammingCurriculum;
