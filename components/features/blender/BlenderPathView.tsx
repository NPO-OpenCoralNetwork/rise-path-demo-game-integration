import React from 'react';
import {
   ChevronLeft, Play, Box, Layers, Zap, Image as ImageIcon,
   MousePointer2, Camera, CheckCircle2, Lock, Star, Monitor
} from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface BlenderPathViewProps {
   onBack: () => void;
   onStartLesson: (stageId: number) => void;
}

const BlenderPathView: React.FC<BlenderPathViewProps> = ({ onBack, onStartLesson }) => {
   const { language } = useLanguage();

   const copy = {
      en: {
         backToLab: 'Back to Lab',
         currentMission: 'Current Mission',
         resume: 'Resume',
         inProgress: 'In Progress',
         completed: 'Completed',
         project: {
            title: 'Ultimate Blender Course',
            description: 'From the very first cube to photoreal renders, learn every essential skill in this path.',
            level: 'Beginner to Pro',
            duration: '12 hours'
         },
         stageCompleteFallback: 'Complete'
      },
      jp: {
         backToLab: 'ラボに戻る',
         currentMission: '現在のミッション',
         resume: '再開',
         inProgress: '進行中',
         completed: '完了',
         project: {
            title: '究極のBlenderコース',
            description: '最初のキューブからフォトリアルなレンダーまで、必要なスキルをすべてこのパスで丁寧に学びます。',
            level: '初心者からプロまで',
            duration: '12時間'
         },
         stageCompleteFallback: '完了'
      }
   } as const;

   const t = copy[language];

   const project = {
      title: t.project.title,
      description: t.project.description,
      level: t.project.level,
      duration: t.project.duration,
      software: "Blender 4.0",
      thumbnail: "https://images.unsplash.com/photo-1617791160536-598cf32026fb?auto=format&fit=crop&q=80&w=1200",
      stages: [
         {
            id: 1,
            title: { en: 'First Steps in 3D', jp: '3Dの第一歩' },
            desc: {
               en: 'Master viewport navigation, object transforms (G/R/S), and the Blender interface.',
               jp: 'ビューポート操作、オブジェクト移動（G/R/S）、インターフェイスをしっかりマスターします。'
            },
            tools: { en: ['Viewport', 'Transforms'], jp: ['ビューポート', '変形'] },
            status: "completed",
            icon: Monitor
         },
         {
            id: 2,
            title: { en: 'Modeling Basics', jp: 'モデリングの基礎' },
            desc: {
               en: 'Enter Edit Mode and shape forms with extrude, inset, and bevel.',
               jp: '編集モードに入り、押し出し・インセット・ベベルで家具のような複雑な形状を作りましょう。'
            },
            tools: { en: ['Edit Mode', 'Modifiers'], jp: ['編集モード', 'モディファイア'] },
            status: "current",
            icon: Box
         },
         {
            id: 3,
            title: { en: 'Advanced Modeling', jp: '上級モデリング' },
            desc: {
               en: 'Learn arrays, booleans, and sculpting fundamentals with an efficient workflow.',
               jp: '配列モディファイアやブーリアン操作、スカルプトの基本を効率的なワークフローで学びます。'
            },
            tools: { en: ['Sculpting', 'Boolean'], jp: ['スカルプト', 'ブーリアン'] },
            status: "available",
            icon: MousePointer2
         },
         {
            id: 4,
            title: { en: 'Finishing & Render', jp: '仕上げとレンダー' },
            desc: {
               en: 'Polish materials and lighting, then render the final scene.',
               jp: '質感設定とライティングで雰囲気を整え、レンダリングでシーンを完成させます。'
            },
            tools: { en: ['Shading', 'Cycles'], jp: ['シェーディング', 'Cycles'] },
            status: "available",
            icon: Camera
         }
      ]
   };

   const currentStage = project.stages.find(s => s.status === 'current');

   return (
      <div className="min-h-screen bg-slate-50 font-sans text-slate-600 pb-20">

         {/* Cinematic Header (Centered) */}
         <div className="relative h-[400px] w-full bg-slate-900 overflow-hidden flex flex-col items-center justify-center text-center">
            <img
               src={project.thumbnail}
               alt="Course Hero"
               className="absolute inset-0 w-full h-full object-cover opacity-60 blur-sm"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent"></div>

            <div className="absolute top-8 left-8 z-20">
               <button
                  onClick={onBack}
                  className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-xs font-black uppercase tracking-widest bg-black/30 backdrop-blur-md px-4 py-2 rounded-full hover:bg-black/50"
               >
                  <ChevronLeft size={14} /> {t.backToLab}
               </button>
            </div>

            <div className="relative z-10 p-8 max-w-3xl mx-auto space-y-6">
               <div className="flex items-center justify-center gap-3">
                  <span className="bg-orange-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-orange-900/30 border border-orange-400">
                     {project.level}
                  </span>
                  <span className="text-white/80 text-[10px] font-black uppercase tracking-[0.2em] border border-white/20 px-4 py-1.5 rounded-full backdrop-blur-sm">
                     {project.software}
                  </span>
               </div>

               <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter leading-none drop-shadow-xl">{project.title}</h1>
               <p className="text-xl text-slate-200 max-w-xl mx-auto leading-relaxed font-medium drop-shadow-md">{project.description}</p>
            </div>
         </div>

         {/* Main Content: Single Column */}
         <div className="max-w-3xl mx-auto px-6 -mt-16 relative z-20">

            {/* Project Meta Card */}
            <div className="bg-white rounded-[2rem] p-8 shadow-2xl shadow-slate-200/50 border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
               <div className="flex items-center gap-6">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 text-orange-600 flex items-center justify-center shadow-inner border border-orange-100">
                     {currentStage ? <currentStage.icon size={32} /> : <Star size={32} />}
                  </div>
                  <div>
                     <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">{t.currentMission}</div>
                     <div className="text-2xl font-black text-slate-900 tracking-tight">{currentStage?.title[language] || t.stageCompleteFallback}</div>
                  </div>
               </div>

               <button
                  onClick={() => onStartLesson(currentStage?.id || 1)}
                  className="w-full md:w-auto bg-slate-900 text-white px-8 py-4 rounded-xl font-black text-sm hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-900/20 hover:-translate-y-1 hover:shadow-2xl active:translate-y-0 uppercase tracking-widest"
               >
                  {t.resume} <Play size={16} fill="currentColor" />
               </button>
            </div>

            {/* Stages List */}
            <div className="space-y-6">
               {project.stages.map((stage, idx) => {
                  const isCompleted = stage.status === 'completed';
                  const isCurrent = stage.status === 'current';
                  const isLocked = stage.status === 'locked';

                  return (
                     <div
                        key={stage.id}
                        className={`
                     relative flex items-center gap-6 p-6 rounded-[2rem] border transition-all duration-500 group
                     ${isCurrent
                              ? 'bg-white border-orange-200 shadow-xl shadow-orange-500/10 scale-[1.02] z-10'
                              : 'bg-white border-slate-100 hover:border-indigo-100 hover:shadow-lg hover:shadow-indigo-500/5'}
                     ${isLocked ? 'opacity-50 grayscale-[0.8] bg-slate-50' : 'cursor-pointer'}
                   `}
                        onClick={() => !isLocked && onStartLesson(stage.id)}
                     >
                        {/* Status Icon */}
                        <div className={`
                       shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center border-2 transition-colors
                       ${isCompleted ? 'bg-green-50 border-green-100 text-green-600' :
                              isCurrent ? 'bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-200' :
                                 'bg-slate-50 border-slate-100 text-slate-300 group-hover:border-slate-200'}
                    `}>
                           {isCompleted ? <CheckCircle2 size={24} /> :
                              isLocked ? <Lock size={20} /> :
                                 <stage.icon size={24} />}
                        </div>

                        <div className="flex-1">
                           <div className="flex justify-between items-center mb-1">
                              <h3 className={`font-black text-lg tracking-tight ${isCurrent ? 'text-slate-900' : 'text-slate-700'}`}>
                                 {stage.title[language]}
                              </h3>
                              {isCurrent && (
                                 <span className="hidden sm:inline-block text-[9px] font-black text-orange-500 uppercase tracking-[0.2em] bg-orange-50 px-3 py-1 rounded-full border border-orange-100">
                                    {t.inProgress}
                                 </span>
                              )}
                           </div>
                           <p className="text-sm text-slate-500 font-medium leading-relaxed">{stage.desc[language]}</p>
                           
                           {/* Tools Tags */}
                           <div className="flex gap-2 mt-3">
                              {stage.tools[language].map(tool => (
                                 <span key={tool} className="text-[9px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-1 rounded border border-slate-100">
                                    {tool}
                                 </span>
                              ))}
                           </div>
                        </div>

                        {!isLocked && !isCurrent && (
                           <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-6">
                              <div className="bg-slate-900 text-white p-2 rounded-full shadow-lg">
                                 <Play size={16} fill="currentColor" />
                              </div>
                           </div>
                        )}
                     </div>
                  );
               })}
            </div>

         </div>
      </div>
   );
};

export default BlenderPathView;
