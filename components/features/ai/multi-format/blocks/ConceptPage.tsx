import React from 'react';
import { BookOpen } from 'lucide-react';
import { ConceptBlock } from '../../../../../types';
import { useLanguage } from '../../../../../context/LanguageContext';

interface ConceptPageProps {
  block: ConceptBlock;
}

const ConceptPage: React.FC<ConceptPageProps> = ({ block }) => {
  const { language } = useLanguage();
  const copy = {
    en: {
      keyInsight: 'Key Insight',
      keyInsightBody: 'In quantum mechanics, entanglement suggests a fundamental connectedness of the universe rather than classical information exchange.',
      analogy: 'Analogy',
      outro: 'This phenomenon underpins quantum computers, enabling the remarkable power to compute all possibilities at once—something classical machines cannot do.'
    },
    jp: {
      keyInsight: 'キーポイント',
      keyInsightBody: '量子力学における「もつれ」は、古典的な情報のやり取りではなく、宇宙の根底にある接続性を示唆しています。',
      analogy: 'たとえ',
      outro: 'この現象は量子コンピューターの基盤となっており、従来の計算機では不可能だった「全ての可能性を同時に計算する」という驚異的な力を生み出す鍵となります。'
    }
  } as const;
  const t = copy[language];

  return (
    <div className="space-y-12">
      <div className="text-center space-y-4 mb-20">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl text-white shadow-xl mb-4">
          <BookOpen size={32} />
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tighter leading-none">
          {block.title}
        </h1>
        <div className="w-16 h-1.5 bg-indigo-600 mx-auto rounded-full"></div>
      </div>
      
      <div className="prose prose-slate prose-lg max-w-none">
        <p className="text-xl md:text-2xl text-slate-600 leading-relaxed font-medium mb-12">
          {block.content}
        </p>
        <div className="grid md:grid-cols-2 gap-8 my-16">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-1000"></div>
            <h3 className="text-indigo-600 font-black text-xs uppercase tracking-widest mb-4">{t.keyInsight}</h3>
            <p className="text-slate-800 text-lg leading-relaxed relative z-10">
              {t.keyInsightBody}
            </p>
          </div>
          <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden group">
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-16 -mb-16"></div>
            <h3 className="text-indigo-400 font-black text-xs uppercase tracking-widest mb-4">{t.analogy}</h3>
            <p className="text-slate-200 text-lg leading-relaxed italic relative z-10">
              "{block.analogy}"
            </p>
          </div>
        </div>
        <p className="text-lg text-slate-500 leading-relaxed">
            {t.outro}
        </p>
      </div>
    </div>
  );
};

export default ConceptPage;
