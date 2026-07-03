import React from 'react';
import { Course } from '../../../types';
import { ArrowLeft, CheckCircle, Lock, Play, Star } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface CoursePathViewProps {
  course: Course;
  onStartLesson: () => void;
  onBack: () => void;
}

const CoursePathView: React.FC<CoursePathViewProps> = ({ course, onStartLesson, onBack }) => {
  const { language } = useLanguage();

  const resolveText = (text: string | { en: string; jp: string; fr?: string }) => {
    if (typeof text === 'string') return text;
    return text[language] || text.en;
  };

  const copy = {
    en: {
      back: 'Back to Curriculum',
      pathTitle: 'Your Learning Path',
      pathMeta: '4 Weeks / 12 Lessons',
      start: 'Start',
      lessonsCount: '3 Lessons',
      quizCount: '1 Quiz',
      weeks: [
        { id: 1, title: 'Week 1: Core Templates', desc: 'Master the "I’m exploring..." pattern.', status: 'completed' },
        { id: 2, title: 'Week 2: Logic & Linking', desc: 'Connecting ideas with "Therefore" & "However".', status: 'current' },
        { id: 3, title: 'Week 3: Softening & Safety', desc: 'Sounding professional, not aggressive.', status: 'locked' },
        { id: 4, title: 'Week 4: Public Output', desc: 'Bio, Event intro, and Q&A statements.', status: 'locked' },
      ]
    },
    jp: {
      back: 'カリキュラムへ戻る',
      pathTitle: '学習パス',
      pathMeta: '4週間 / 12レッスン',
      start: '開始',
      lessonsCount: '3レッスン',
      quizCount: '1クイズ',
      weeks: [
        { id: 1, title: '第1週: コアテンプレート', desc: '「I’m exploring...」パターンを習得。', status: 'completed' },
        { id: 2, title: '第2週: ロジック & 接続', desc: 'Therefore / However で論理をつなぐ。', status: 'current' },
        { id: 3, title: '第3週: ソフトニング & 安全性', desc: '丁寧でプロフェッショナルな表現。', status: 'locked' },
        { id: 4, title: '第4週: 公開アウトプット', desc: '自己紹介、イベント紹介、Q&A文。', status: 'locked' },
      ]
    }
  } as const;
  const t = copy[language];
  const weeks = t.weeks;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero Header */}
      <div className="relative bg-slate-900 text-white pb-16 sm:pb-20 pt-8">
        <div className="absolute inset-0 overflow-hidden">
          <img src={course.thumbnail} alt="Background" className="w-full h-full object-cover opacity-20 blur-sm" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 to-slate-900"></div>
        </div>
        
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-10">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors mb-6 font-medium"
          >
            <ArrowLeft size={20} /> {t.back}
          </button>
          
          <div className="flex flex-col md:flex-row gap-6 items-start">
             <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center shadow-2xl shrink-0">
                <span className="text-3xl font-bold">{resolveText(course.title).charAt(0)}</span>
             </div>
             <div className="flex-1 min-w-0">
               <div className="flex flex-wrap gap-3 mb-2">
                 <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${course.color.replace('bg-', 'text-')} bg-white`}>
                    {course.category}
                 </span>
               </div>
               <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 break-words">{resolveText(course.title)}</h1>
               <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl break-words">{resolveText(course.description)}</p>
             </div>
          </div>
        </div>
      </div>

      {/* Path Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-10 -mt-12 relative z-10 pb-12">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-6 sm:p-8">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
            <h2 className="text-2xl font-bold text-slate-900">{t.pathTitle}</h2>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
               <Star className="text-yellow-400 fill-yellow-400" size={18} />
               <span>{t.pathMeta}</span>
            </div>
          </div>

          <div className="space-y-0 relative">
            {/* Connecting Line */}
            <div className="absolute left-8 top-8 bottom-8 w-1 bg-slate-100 rounded-full"></div>

            {weeks.map((week, index) => {
               const isLast = index === weeks.length - 1;
               const isLocked = week.status === 'locked';
               const isCurrent = week.status === 'current';
               const isCompleted = week.status === 'completed';

               return (
                 <div key={week.id} className={`relative flex gap-4 sm:gap-6 ${!isLast ? 'mb-8' : ''}`}>
                   {/* Status Icon */}
                   <div className={`
                      w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 z-10 border-4 transition-all
                      ${isCompleted ? 'bg-green-100 border-white text-green-600' : 
                        isCurrent ? 'bg-indigo-600 border-indigo-100 text-white shadow-lg shadow-indigo-200' : 
                        'bg-slate-100 border-white text-slate-300'}
                   `}>
                      {isCompleted ? <CheckCircle size={28} /> : 
                       isLocked ? <Lock size={24} /> : 
                       <span className="font-bold text-xl">{week.id}</span>}
                   </div>

                   {/* Card Content */}
                   <div className={`
                      flex-1 p-5 rounded-2xl border transition-all min-w-0
                      ${isCurrent 
                        ? 'bg-white border-indigo-200 shadow-md ring-1 ring-indigo-50' 
                        : 'bg-slate-50 border-slate-100 opacity-80'}
                   `}>
                      <div className="flex flex-wrap justify-between items-start gap-3">
                        <div className="min-w-0">
                          <h3 className={`font-bold text-lg mb-1 break-words ${isCurrent ? 'text-indigo-900' : 'text-slate-700'}`}>
                            {week.title}
                          </h3>
                          <p className="text-slate-500 text-sm break-words">{week.desc}</p>
                        </div>
                        {isCurrent && (
                          <button 
                            onClick={onStartLesson}
                            className="bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-indigo-700 transition-transform active:scale-95 flex items-center gap-2 shrink-0"
                          >
                            {t.start} <Play size={14} fill="currentColor" />
                          </button>
                        )}
                      </div>
                      
                      {isCurrent && (
                        <div className="mt-4 flex gap-2">
                           <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{t.lessonsCount}</span>
                           <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{t.quizCount}</span>
                        </div>
                      )}
                   </div>
                 </div>
               );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoursePathView;
