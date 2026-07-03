import React from 'react';
import { Award, ChevronRight } from 'lucide-react';
import { ReflectionBlock } from '../../../../../types';

interface ReflectionPageProps {
  block: ReflectionBlock;
}

const ReflectionPage: React.FC<ReflectionPageProps> = ({ block }) => {
  return (
    <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-[3rem] p-8 md:p-16 shadow-2xl mb-8 text-white text-center relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
      
      <div className="relative z-10">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-full mb-10 backdrop-blur-sm shadow-inner">
          <Award size={40} />
        </div>
        <h3 className="text-3xl md:text-5xl font-black mb-12 tracking-tight leading-tight">{block.question}</h3>
        <div className="grid gap-4 max-w-2xl mx-auto">
          {block.options?.map((opt, idx) => (
            <button key={idx} className="w-full bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-6 text-left font-bold text-lg transition-all active:scale-95 flex justify-between items-center group shadow-lg">
              {opt}
              <ChevronRight size={24} className="opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReflectionPage;
