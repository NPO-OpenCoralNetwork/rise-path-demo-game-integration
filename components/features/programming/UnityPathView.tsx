import React from 'react';
import {
  ArrowLeft, CheckCircle2, Lock, Play, Star, MapPin,
  Sparkles, Monitor, Brain, Terminal, Zap, Globe, MessageSquare,
  ArrowRight, Calendar, User, Gamepad2, Layers, Rocket
} from 'lucide-react';
import { ViewState } from '../../../types';

interface UnityPathViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const UnityPathView: React.FC<UnityPathViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {

  const content = {
    en: {
      back: "Back to Campus",
      tag: "Unity AI Game Dev Path",
      title: "Unity x AI Architect",
      subtitle: "Don't just write code. Architect experiences with AI as your subordinate.",
      progressTitle: "Track Status",
      level: "Beginner",
      time: "20 Hours",
      chapters: [
        {
          id: 'ch0',
          title: 'Chapter 0: AI Game Dev Philosophy',
          desc: 'Why "writing code" is decreasing. The role of humans is "Judgment" and "Structure".',
          duration: "10 min",
          image: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch1',
          title: 'Chapter 1: Unity Basics (AI Era)',
          desc: 'Scene, GameObject, Component. The shared language for directing AI.',
          duration: "20 min",
          image: "https://images.unsplash.com/photo-1605347086577-706b21474ed7?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch2',
          title: 'Chapter 2: MonoBehaviour & C# Basics',
          desc: 'Reading AI code without fear. Understanding the Unity lifecycle.',
          duration: "30 min",
          image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch3',
          title: 'Chapter 3: Generating Unity Code with AI',
          desc: 'Prompt design for Unity. How to prevent "broken code".',
          duration: "25 min",
          image: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800"
        }
      ]
    },
    jp: {
      back: "キャンパスに戻る",
      tag: "Unity AI ゲーム開発パス",
      title: "Unity x AI アーキテクト",
      subtitle: "コードを書くな、設計せよ。AIを部下にしてゲームを作る新時代の開発手法。",
      progressTitle: "コース進捗",
      level: "初級",
      time: "20時間",
      chapters: [
        {
          id: 'ch0',
          title: '第0章｜AI時代のゲーム開発思想',
          desc: 'なぜ「書ける人」が減るのか。人間の役割は「判断」と「構造」へ。',
          duration: "10分",
          image: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch1',
          title: '第1章｜Unity基礎（AI時代版）',
          desc: 'Scene / GameObject / Component。AIに指示を出すための共通言語。',
          duration: "20分",
          image: "https://images.unsplash.com/photo-1605347086577-706b21474ed7?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch2',
          title: '第2章｜MonoBehaviourとC#最低限',
          desc: 'AIが書いたコードを「怖がらず読める」ようになる。Unity独自のルール。',
          duration: "30分",
          image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch3',
          title: '第3章｜AIにUnityコードを書かせる',
          desc: '「動かないコード」を書かせないための、Unity特化型プロンプト設計。',
          duration: "25分",
          image: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800"
        }
      ]
    }
  };

  const t = content[language];

  // Map static data to translated content
  const chapters = t.chapters.map((ch, idx) => ({
    ...ch,
    status: idx <= 2 ? 'completed' : (idx === 3 ? 'current' : 'locked'), 
    view: idx === 0 ? ViewState.UNITY_CHAPTER_0 : (
          idx === 1 ? ViewState.UNITY_CHAPTER_1 : (
          idx === 2 ? ViewState.UNITY_CHAPTER_2 : (
          idx === 3 ? ViewState.UNITY_CHAPTER_3 : null)))
  }));

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans text-slate-600 pb-20">
      {/* Hero Section */}
      <div className="relative h-[300px] w-full overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1596727147705-54a9d0a514d7?auto=format&fit=crop&q=80&w=1600"
          alt="Unity AI Hero"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-blue-900/60 backdrop-blur-[2px]"></div>

        <div className="absolute inset-0 flex flex-col justify-center max-w-5xl mx-auto px-6">
          <div className="flex justify-between items-start w-full mb-2">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm font-medium"
            >
              <ArrowLeft size={16} /> {t.back}
            </button>

            {/* Language Toggle */}
            <div className="flex bg-white/20 backdrop-blur-md rounded-full p-1 border border-white/20">
              <button onClick={() => setLanguage('en')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-blue-900' : 'text-blue-100 hover:text-white'}`}>EN</button>
              <button onClick={() => setLanguage('jp')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-blue-900' : 'text-blue-100 hover:text-white'}`}>JP</button>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-blue-900/20">
              {t.tag}
            </div>
            <span className="text-blue-100/90 text-sm font-mono tracking-wider">NEW ARRIVAL</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">{t.title}</h1>
          <p className="text-blue-100 max-w-2xl text-lg leading-relaxed">
            {t.subtitle}
          </p>
        </div>
      </div>

      {/* Learning Highlights */}
      <div className="max-w-5xl mx-auto px-6 -mt-8 relative z-20 mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: Brain,
            title: language === 'en' ? "Architect Mindset" : "設計者マインド",
            desc: language === 'en' ? "You are the director, AI is the coder." : "あなたは監督、AIはコーダー。"
          },
          {
            icon: Gamepad2,
            title: language === 'en' ? "Unity x AI" : "Unity x AI",
            desc: language === 'en' ? "Build faster with Prefabs and AI." : "PrefabとAIで爆速開発。"
          },
          {
            icon: Rocket,
            title: language === 'en' ? "Release Focus" : "リリース重視",
            desc: language === 'en' ? "Build, Deploy, and Share." : "作って、出して、共有する。"
          }
        ].map((item, idx) => (
          <div key={idx} className="bg-white/90 backdrop-blur-sm border border-blue-100 p-4 rounded-xl flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg shrink-0">
              <item.icon size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-700 text-sm mb-0.5">{item.title}</h3>
              <p className="text-xs text-slate-500 leading-snug">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress Bar (Floating) */}
      <div className="max-w-5xl mx-auto px-6 mb-12">
        <div className="bg-white rounded-xl p-6 shadow-lg shadow-blue-200/50 border border-blue-100 flex items-center justify-between gap-8">
          <div className="flex-1">
            <div className="flex justify-between items-end mb-2">
              <div className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.progressTitle}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-blue-600">0%</span>
                <span className="text-xs text-slate-400 font-medium">COMPLETED</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div className="bg-blue-500 h-full rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: '0%' }}></div>
            </div>
          </div>
          <div className="hidden md:flex gap-8 border-l border-slate-100 pl-8">
            <div>
              <div className="text-xs text-slate-400 font-bold uppercase mb-1">Time</div>
              <div className="font-medium text-slate-700">{t.time}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 font-bold uppercase mb-1">Level</div>
              <div className="font-medium text-slate-700">{t.level}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Roadmap */}
      <div className="max-w-4xl mx-auto px-6">
        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-[27px] top-8 bottom-8 w-0.5 bg-slate-200/80"></div>

          <div className="space-y-8">
            {chapters.map((chapter, index) => (
              <div key={chapter.id} className="relative flex gap-8 group">
                {/* Status Icon */}
                <div className={`
                            relative z-10 w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-[3px] transition-all duration-300 bg-white
                            ${chapter.status === 'completed' ? 'border-blue-500 text-blue-500' : ''}
                            ${chapter.status === 'current' ? 'border-blue-500 text-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.15)] scale-110' : ''}
                            ${chapter.status === 'locked' ? 'border-slate-200 text-slate-300' : ''}
                        `}>
                  {chapter.status === 'completed' && <CheckCircle2 size={24} className="fill-blue-50" />}
                  {chapter.status === 'current' && <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div>}
                  {chapter.status === 'locked' && <Lock size={20} />}
                </div>

                {/* Content Card */}
                <div className={`flex-1 transition-all duration-300 ${chapter.status === 'current' ? 'transform -translate-y-1' : 'opacity-80 hover:opacity-100'}`}>
                  <div
                    onClick={() => chapter.status !== 'locked' && chapter.view && onNavigate(chapter.view)}
                    className={`
                                    group/card rounded-2xl border overflow-hidden transition-all duration-300 flex flex-col md:flex-row h-full md:h-40
                                    ${chapter.status === 'current'
                        ? 'bg-white border-blue-200/80 shadow-xl shadow-blue-100/40 cursor-pointer hover:border-blue-300 hover:shadow-blue-100/60'
                        : 'bg-white border-slate-100 shadow-sm hover:shadow-lg hover:border-blue-100'}
                                    ${chapter.status === 'locked' ? 'cursor-not-allowed' : 'cursor-pointer'}
                                `}
                  >
                    {/* Image Section */}
                    <div className="w-full md:w-48 relative overflow-hidden shrink-0">
                      <img
                        src={chapter.image}
                        alt={chapter.title}
                        className={`w-full h-full object-cover transition-transform duration-700 ${chapter.status === 'locked' ? 'grayscale opacity-70' : 'group-hover/card:scale-110'}`}
                      />
                      {/* Overlay for locked items */}
                      {chapter.status === 'locked' && <div className="absolute inset-0 bg-slate-100/50 backdrop-grayscale"></div>}

                      {/* Current Label on Image */}
                      {chapter.status === 'current' && (
                        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur text-blue-600 text-[10px] font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                          READY
                        </div>
                      )}
                    </div>

                    {/* Text Content */}
                    <div className="flex-1 p-5 flex flex-col justify-center relative">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`font-bold text-lg tracking-tight ${chapter.status === 'locked' ? 'text-slate-400' : 'text-slate-800'}`}>
                          {chapter.title}
                          {chapter.status === 'completed' && <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full align-middle">Done</span>}
                        </h3>
                      </div>

                      <p className={`text-sm leading-relaxed line-clamp-2 md:line-clamp-none ${chapter.status === 'locked' ? 'text-slate-400' : 'text-slate-500'} mb-3`}>
                        {chapter.desc}
                      </p>

                      <div className="flex items-center justify-between mt-auto">
                        <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${chapter.status === 'locked' ? 'text-slate-300' : 'text-slate-400'}`}>
                          <Calendar size={12} /> {chapter.duration}
                        </span>

                        {chapter.status === 'current' ? (
                          <div className="flex items-center gap-2 text-blue-600 font-bold text-sm bg-blue-50 px-4 py-2 rounded-lg group-hover/card:bg-blue-500 group-hover/card:text-white transition-all">
                            Start <ArrowRight size={16} />
                          </div>
                        ) : (
                          chapter.status === 'completed' && (
                            <div className="w-8 h-8 rounded-full bg-slate-50 text-blue-600 flex items-center justify-center">
                              <CheckCircle2 size={16} />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnityPathView;
