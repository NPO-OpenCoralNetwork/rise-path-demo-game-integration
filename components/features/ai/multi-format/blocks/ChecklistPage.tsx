import React, { useState } from 'react';
import { CheckCircle, Circle, ChevronDown, Download, Settings, Image } from 'lucide-react';
import { ChecklistBlock } from '../../../../../types';
import { useLanguage } from '../../../../../context/LanguageContext';

interface ChecklistPageProps {
  block: ChecklistBlock;
}

const ChecklistPage: React.FC<ChecklistPageProps> = ({ block }) => {
  const { language } = useLanguage();
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [expandedTask, setExpandedTask] = useState<string | null>(block.tasks[0]?.id || null);
  const copy = {
    en: {
      intro: 'Complete the first steps to get started with Blender.',
      progress: 'Progress',
      completed: 'Completed',
      screenshot: 'Screenshot'
    },
    jp: {
      intro: 'Blenderを始めるための最初のステップをクリアしましょう。',
      progress: '進捗',
      completed: '完了',
      screenshot: 'スクリーンショット'
    }
  } as const;
  const t = copy[language];

  const toggleTask = (taskId: string) => {
    setCompletedTasks(prev => 
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  const progress = (completedTasks.length / block.tasks.length) * 100;

  return (
    <div className="w-full max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-2xl text-green-600 mb-4">
          <Settings size={32} />
        </div>
        <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter leading-tight">
          {block.title}
        </h1>
        <p className="text-lg text-slate-500 mt-4 max-w-xl mx-auto">
          {t.intro}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="mb-10">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            {t.progress}
          </span>
          <span className="text-sm font-bold text-green-600">
            {completedTasks.length} / {block.tasks.length} {t.completed}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2.5">
          <div 
            className="bg-green-500 h-2.5 rounded-full transition-all duration-500" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-4">
        {block.tasks.map((task, idx) => {
          const isCompleted = completedTasks.includes(task.id);
          const isExpanded = expandedTask === task.id;

          return (
            <div 
              key={task.id}
              className={`
                rounded-2xl border-2 transition-all duration-300
                ${isExpanded ? 'bg-white shadow-lg border-green-200' : 'bg-slate-50 border-transparent'}
                ${isCompleted ? 'opacity-60' : ''}
              `}
            >
              {/* Task Header */}
              <div 
                className="flex items-center gap-4 p-5 cursor-pointer"
                onClick={() => setExpandedTask(isExpanded ? null : task.id)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTask(task.id);
                  }}
                  className="transition-transform hover:scale-110"
                >
                  {isCompleted ? <CheckCircle size={28} className="text-green-500" /> : <Circle size={28} className="text-slate-300" />}
                </button>
                
                <h3 className={`text-lg font-bold flex-1 transition-colors ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {task.label}
                </h3>
                <ChevronDown 
                  size={24} 
                  className={`text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} 
                />
              </div>

              {/* Collapsible Content */}
              {isExpanded && (
                <div className="px-5 pb-6 animate-in fade-in duration-300">
                  <div className="ml-12 border-l-2 border-slate-200 pl-6 space-y-4">
                    <p className="text-slate-600 leading-relaxed">
                      {task.details}
                    </p>
                    {task.linkUrl && (
                      <a
                        href={task.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        {task.linkUrl}
                      </a>
                    )}
                  </div>

                  {task.imageUrl ? (
                    <figure className="mt-4 bg-slate-100 rounded-lg p-4 border border-slate-200 flex flex-col items-center justify-center">
                      <img
                        src={task.imageUrl}
                        alt={task.imageCaption || task.label}
                        className="w-full h-auto max-h-[520px] object-contain rounded-md bg-white"
                        loading="lazy"
                      />
                      {task.imageCaption && (
                        <figcaption className="mt-2 text-xs text-slate-500 text-center">
                          {task.imageCaption}
                        </figcaption>
                      )}
                    </figure>
                  ) : (
                    task.imageKeyword && (
                      <div className="mt-4 bg-slate-100 rounded-lg p-4 border border-slate-200 flex flex-col items-center justify-center h-56 text-slate-400">
                        <Image size={32} className="mb-2" />
                        <span className="text-xs font-medium">{t.screenshot}: "{task.imageKeyword}"</span>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ChecklistPage;
