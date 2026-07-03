import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Layout, Code2, Monitor, Smartphone, 
  CheckCircle2, ChevronRight, BookOpen, PlayCircle, Grid
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface HtmlCssPartTwoViewProps {
  onBack: () => void;
  onNavigate?: (view: ViewState) => void; 
}

const HtmlCssPartTwoView: React.FC<HtmlCssPartTwoViewProps> = ({ onBack, onNavigate }) => {
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'html' | 'css'>('css');
  const [htmlCode, setHtmlCode] = useState<string>(`<div class="gallery">
  <div class="item">1</div>
  <div class="item">2</div>
  <div class="item">3</div>
  <div class="item">4</div>
  <div class="item">5</div>
  <div class="item">6</div>
</div>`);

  const [cssCode, setCssCode] = useState<string>(`body {
  font-family: sans-serif;
  background: #111;
  color: white;
  margin: 0;
  padding: 2rem;
}

/* TODO: Turn this into a grid layout */
.gallery {
  display: block; /* Change this to grid */
  gap: 1rem;
  /* Add grid-template-columns here */
}

.item {
  background: #333;
  padding: 2rem;
  border-radius: 0.5rem;
  text-align: center;
  font-size: 2rem;
  font-weight: bold;
  border: 1px solid #444;
}`);

  const [srcDoc, setSrcDoc] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);

  const copy = {
    en: {
      headerTitle: 'Responsive Web Design',
      headerSubtitle: 'Part 2: CSS Grid',
      liveSession: 'Live Session',
      articleTitle: 'Introduction to CSS Grid',
      articleBodyLead: 'While Flexbox is great for one-dimensional layouts,',
      articleHighlight: 'CSS Grid',
      articleBodyEnd: 'is the ultimate tool for two-dimensional layouts (rows and columns simultaneously). It allows you to create complex grid structures with very little code.',
      syntaxTitle: 'Syntax: grid-template-columns',
      syntaxBody: 'Use display: grid on the container. Then define columns with grid-template-columns: 1fr 1fr 1fr; to create 3 equal columns. The unit fr stands for “fraction”.',
      challengeTitle: 'Your Challenge',
      challengeBody: 'Convert the vertical list below into a 3-column grid. Use the repeat() function if you want to be fancy!',
      editorLabel: 'Style Editor',
      gridMaster: 'Grid Master!',
      gridLocked: 'Grid Locked',
      hint: 'Try grid-template-columns: repeat(3, 1fr);',
      nextLabel: 'Next: Inspector'
    },
    jp: {
      headerTitle: 'レスポンシブWebデザイン',
      headerSubtitle: 'パート2：CSS Grid',
      liveSession: 'ライブセッション',
      articleTitle: 'CSS Grid入門',
      articleBodyLead: 'Flexboxは1次元レイアウトに最適ですが、',
      articleHighlight: 'CSS Grid',
      articleBodyEnd: 'は2次元（行と列）に対応する最強ツールです。少ないコードで複雑なグリッドを作れます。',
      syntaxTitle: '構文：grid-template-columns',
      syntaxBody: 'コンテナにdisplay: gridを指定し、grid-template-columns: 1fr 1fr 1fr; で3等分にします。frはfractionの略です。',
      challengeTitle: 'チャレンジ',
      challengeBody: '下の縦並びのリストを3列グリッドに変換してください。repeat()を使ってもOKです！',
      editorLabel: 'スタイルエディタ',
      gridMaster: 'グリッドマスター！',
      gridLocked: 'グリッド未達成',
      hint: 'grid-template-columns: repeat(3, 1fr); を試してみましょう。',
      nextLabel: '次へ：インスペクタ'
    }
  } as const;

  const t = copy[language];

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSrcDoc(`
        <html>
          <head>
            <style>
              ${cssCode}
            </style>
          </head>
          <body>
            ${htmlCode}
          </body>
        </html>
      `);
      
      if (cssCode.includes('display: grid') && (cssCode.includes('grid-template-columns') || cssCode.includes('repeat'))) {
        setIsCompleted(true);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [htmlCode, cssCode]);

  // Syntax Highlighter (reused logic)
  const renderHighlightedCode = (code: string, lang: 'html' | 'css') => {
    return code.split('\n').map((line, i) => (
      <div key={i} className="whitespace-pre min-h-[1.5em]">
          {line.length === 0 ? <br /> : 
           lang === 'html' ? (
             <span>
               {line.split(/(<[^>]+>)/g).map((token, j) => {
                 if (token.startsWith('<') && token.endsWith('>')) return <span key={j} className="text-blue-400">{token}</span>;
                 return <span key={j} className="text-slate-300">{token}</span>;
               })}
             </span>
           ) : (
             <span>
               {line.split(/([:{};])/).map((token, j) => {
                 if (token.includes(':') || token.includes(';')) return <span key={j} className="text-slate-500">{token}</span>;
                 if (token.includes('{') || token.includes('}')) return <span key={j} className="text-yellow-400">{token}</span>;
                 if (line.includes(':') && line.indexOf(token) < line.indexOf(':')) return <span key={j} className="text-cyan-300">{token}</span>;
                 return <span key={j} className="text-pink-400">{token}</span>;
               })}
             </span>
           )
          }
      </div>
    ));
  };

  const handleNext = () => {
    if (onNavigate) {
      onNavigate(ViewState.WEB_INSPECTOR);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0e14] text-slate-300 font-sans">
      
      {/* Navbar */}
      <div className="border-b border-slate-800 bg-[#0d0e14]/95 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
             <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center text-purple-400 border border-purple-500/20">
               <Grid size={18} />
             </div>
             <div>
               <h1 className="font-bold text-slate-100 text-sm">{t.headerTitle}</h1>
               <p className="text-[10px] text-slate-500 font-mono">{t.headerSubtitle}</p>
             </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-800 rounded-full text-xs font-bold text-slate-400 border border-slate-700">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              {t.liveSession}
           </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 md:p-12">
        
        {/* Article Content */}
        <article className="prose prose-invert prose-lg max-w-none mb-12">
          <h1 className="text-4xl font-bold text-white mb-6">{t.articleTitle}</h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            {t.articleBodyLead} <strong className="text-purple-400">{t.articleHighlight}</strong> {t.articleBodyEnd}
          </p>
          
          <div className="bg-slate-900 border-l-4 border-purple-500 p-6 my-8 rounded-r-xl">
             <h3 className="text-purple-400 font-bold text-lg mt-0 mb-2 flex items-center gap-2">
               <BookOpen size={20}/> {t.syntaxTitle}
             </h3>
             <p className="text-slate-300 text-sm mb-0">
               {t.syntaxBody}
             </p>
          </div>

          <h3 className="text-2xl font-bold text-white mt-12 mb-4">{t.challengeTitle}</h3>
          <p className="text-slate-400 mb-6">
            {t.challengeBody}
          </p>
        </article>

        {/* Embedded Editor Widget */}
        <div className="border border-slate-700 rounded-2xl overflow-hidden bg-[#1e1e1e] shadow-2xl ring-4 ring-slate-900/50 mb-12">
           <div className="bg-[#252526] px-4 py-2 border-b border-[#333] flex justify-between items-center">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e1e1e] rounded text-xs font-bold text-slate-300 border border-[#333]">
                 <Code2 size={14} className="text-purple-400" /> {t.editorLabel}
              </div>
           </div>

           <div className="flex flex-col lg:flex-row h-[500px]">
              <div className="flex-1 flex flex-col border-r border-[#333] min-w-[300px]">
                 <div className="flex bg-[#1e1e1e] border-b border-[#333]">
                    <button onClick={() => setActiveTab('html')} className={`px-4 py-2 text-xs font-bold border-r border-[#333] ${activeTab === 'html' ? 'bg-[#252526] text-orange-400' : 'text-slate-500'}`}>index.html</button>
                    <button onClick={() => setActiveTab('css')} className={`px-4 py-2 text-xs font-bold border-r border-[#333] ${activeTab === 'css' ? 'bg-[#252526] text-cyan-400' : 'text-slate-500'}`}>style.css</button>
                 </div>
                 <div className="flex-1 relative font-mono text-sm bg-[#1e1e1e] p-4">
                    <div className="absolute inset-0 p-4 overflow-auto">
                       <div className="relative min-h-full">
                          <div className="absolute inset-0 pointer-events-none z-0 leading-6" aria-hidden="true">
                             {renderHighlightedCode(activeTab === 'html' ? htmlCode : cssCode, activeTab)}
                          </div>
                          <textarea
                             value={activeTab === 'html' ? htmlCode : cssCode}
                             onChange={(e) => activeTab === 'html' ? setHtmlCode(e.target.value) : setCssCode(e.target.value)}
                             className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-white resize-none outline-none z-10 font-mono leading-6"
                             spellCheck="false"
                          />
                       </div>
                    </div>
                 </div>
              </div>

              <div className="flex-1 bg-[#111] relative p-8 flex items-center justify-center">
                 <div className="w-full h-full border border-dashed border-slate-700 rounded-lg overflow-hidden">
                    <iframe srcDoc={srcDoc} title="preview" className="w-full h-full bg-[#111]" sandbox="allow-scripts" />
                 </div>
              </div>
           </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center bg-slate-900 rounded-2xl p-6 border border-slate-800">
           <div className="flex items-center gap-4">
             <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isCompleted ? 'bg-green-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                {isCompleted ? <CheckCircle2 size={24} /> : <PlayCircle size={24} />}
             </div>
             <div>
                <h4 className="font-bold text-white text-lg">{isCompleted ? t.gridMaster : t.gridLocked}</h4>
                <p className="text-slate-400 text-sm">{t.hint}</p>
             </div>
           </div>
           
           <button 
             onClick={handleNext}
             className={`
                px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2
                ${isCompleted ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}
             `}
             disabled={!isCompleted}
           >
             {t.nextLabel} <ChevronRight size={18} />
           </button>
        </div>

      </div>
    </div>
  );
};

export default HtmlCssPartTwoView;
