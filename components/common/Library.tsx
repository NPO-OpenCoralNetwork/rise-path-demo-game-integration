import React, { useState } from 'react';
import { CORE_TEMPLATES, BRIDGING_TEMPLATES, SOFTENING_TEMPLATES } from '../../services/curriculumData';
import { Copy, Check, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useNavigate } from 'react-router-dom';

const Library: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'core' | 'softening' | 'bridging'>('all');

  const copy = {
    en: {
      title: 'Template Library',
      subtitle: 'Your toolkit for clearer, safer, and more logical English.',
      backToCourses: 'Back to Courses',
      filters: {
        all: 'All',
        core: 'Core Patterns',
        bridging: 'Bridging & Logic',
        softening: 'Softening & Safety'
      },
      categories: {
        core: 'Core',
        bridging: 'Bridging',
        softening: 'Softening'
      }
    },
    jp: {
      title: 'テンプレートライブラリ',
      subtitle: 'より明確で安全、論理的な英語表現のツールキット。',
      backToCourses: 'コース一覧に戻る',
      filters: {
        all: 'すべて',
        core: 'コアパターン',
        bridging: 'ブリッジ & 論理',
        softening: 'ソフト化 & 安全'
      },
      categories: {
        core: 'コア',
        bridging: 'ブリッジ',
        softening: 'ソフト化'
      }
    }
  } as const;

  const t = copy[language];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const allTemplates = [...CORE_TEMPLATES, ...BRIDGING_TEMPLATES, ...SOFTENING_TEMPLATES];
  const displayedTemplates = filter === 'all' 
    ? allTemplates 
    : allTemplates.filter(t => t.category === filter);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <button
          onClick={() => navigate('/courses')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft size={16} />
          {t.backToCourses}
        </button>
        <h1 className="text-3xl font-bold text-slate-900 mt-4">{t.title}</h1>
        <p className="text-slate-500 mt-2">{t.subtitle}</p>
        
        <div className="flex gap-2 mt-6 overflow-x-auto pb-2 scrollbar-hide">
          {[
            { id: 'all', label: t.filters.all },
            { id: 'core', label: t.filters.core },
            { id: 'bridging', label: t.filters.bridging },
            { id: 'softening', label: t.filters.softening }
          ].map((cat) => (
            <button 
              key={cat.id}
              onClick={() => setFilter(cat.id as any)}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors border
                ${filter === cat.id 
                  ? 'bg-indigo-600 text-white border-indigo-600' 
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}
              `}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayedTemplates.map((template) => (
          <div key={template.id} className="bg-white p-5 rounded-2xl border border-slate-200 hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-3">
              <span className={`
                text-xs font-bold uppercase tracking-wider px-2 py-1 rounded
                ${template.category === 'core' ? 'bg-blue-50 text-blue-700' : 
                  template.category === 'bridging' ? 'bg-purple-50 text-purple-700' : 
                  'bg-orange-50 text-orange-700'}
              `}>
                {t.categories[template.category]}
              </span>
              <button 
                onClick={() => handleCopy(template.text, template.id)}
                className="text-slate-400 hover:text-indigo-600 transition-colors"
              >
                {copiedId === template.id ? <Check size={18} className="text-green-500"/> : <Copy size={18} />}
              </button>
            </div>
            <p className="text-lg font-bold text-slate-800 mb-2 font-mono">{template.text}</p>
            <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-600 italic">
               "{template.example}"
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Library;
