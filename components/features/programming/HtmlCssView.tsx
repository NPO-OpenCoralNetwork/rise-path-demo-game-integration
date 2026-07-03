import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Layout, Eye, Code2, Layers,
  Monitor, Smartphone, CheckCircle2, ChevronRight,
  BookOpen, PlayCircle, Info
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface HtmlCssViewProps {
  onBack: () => void;
  onNavigate?: (view: ViewState) => void; // Added for navigation
}

const HtmlCssView: React.FC<HtmlCssViewProps> = ({ onBack, onNavigate }) => {
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'html' | 'css'>('html');
  const [htmlCode, setHtmlCode] = useState<string>(`<div class="card">
  <div class="avatar">
    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" />
  </div>
  <div class="content">
    <h2>Felix Lee</h2>
    <p>Frontend Developer</p>
    <button>Follow</button>
  </div>
</div>`);

  const [cssCode, setCssCode] = useState<string>(`/* The container is centered using flexbox on the body */
body {
  font-family: sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: #f0f2f5;
  margin: 0;
}

.card {
  background: white;
  padding: 2rem;
  border-radius: 1rem;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  text-align: center;
  width: 250px;
}

.avatar img {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  margin-bottom: 1rem;
  background: #e2e8f0;
}

h2 {
  margin: 0;
  color: #1e293b;
  font-size: 1.25rem;
}

p {
  color: #64748b;
  margin: 0.5rem 0 1.5rem;
  font-size: 0.875rem;
}

button {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 0.5rem 1.5rem;
  border-radius: 999px;
  font-weight: bold;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: #2563eb;
}`);

  const [srcDoc, setSrcDoc] = useState('');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [isCompleted, setIsCompleted] = useState(false);

  const copy = {
    en: {
      headerTitle: 'Responsive Web Design',
      headerSubtitle: 'Part 1: Flexbox Layouts',
      draftSaved: 'Draft Saved',
      articleTitle: 'Mastering Flexbox Alignment',
      articleBody: 'Flexbox is a one-dimensional layout method for laying out items in rows or columns. Items flex to fill additional space and shrink to fit into smaller spaces. In this lesson, we will focus on the most common use case:',
      articleHighlight: 'centering content',
      keyConceptTitle: 'Key Concept: justify-content & align-items',
      keyConceptBody: 'justify-content controls alignment along the main axis (horizontal by default), while align-items controls the cross axis (vertical).',
      challengeTitle: 'Your Challenge',
      challengeBody: 'Below is a profile card component. Currently, it is just styled with basic CSS. Your task is to center the card perfectly in the middle of the preview window using Flexbox on the body tag.',
      interactiveEditor: 'Interactive Editor',
      niceJob: 'Nice job!',
      keepTrying: 'Keep trying!',
      hint: 'Use display: flex to center the card.',
      nextSection: 'Next Section: CSS Grid'
    },
    jp: {
      headerTitle: 'レスポンシブWebデザイン',
      headerSubtitle: 'パート1：Flexboxレイアウト',
      draftSaved: '下書きを保存しました',
      articleTitle: 'Flexboxの整列をマスター',
      articleBody: 'Flexboxは行や列に並べるための1次元レイアウト手法です。要素は余白を埋めたり小さく縮んだりします。このレッスンでは、最も一般的なユースケースである',
      articleHighlight: '中央揃え',
      keyConceptTitle: '重要概念：justify-content と align-items',
      keyConceptBody: 'justify-contentは主軸（通常は水平）での整列を、align-itemsは交差軸（垂直）での整列を制御します。',
      challengeTitle: 'チャレンジ',
      challengeBody: '以下はプロフィールカードのコンポーネントです。今は基本的なCSSだけが当たっています。bodyタグにFlexboxを使って、プレビュー画面の中央にカードを正確に配置してください。',
      interactiveEditor: 'インタラクティブエディタ',
      niceJob: 'いい感じ！',
      keepTrying: 'もう少し！',
      hint: 'display: flex を使ってカードを中央に配置しましょう。',
      nextSection: '次のセクション：CSS Grid'
    }
  } as const;

  const t = copy[language];

  // Update preview with debounce
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

      // Simple check to see if user changed something relevant (simulated completion)
      if (cssCode.includes('display: flex') && cssCode.includes('justify-content: center')) {
        setIsCompleted(true);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [htmlCode, cssCode]);

  const handleNext = () => {
    if (onNavigate) {
      onNavigate(ViewState.HTML_CSS_PART_TWO);
    }
  };

  // Simple syntax highlighter
  const renderHighlightedCode = (code: string, lang: 'html' | 'css') => {
    return code.split('\n').map((line, i) => (
      <div key={i} className="whitespace-pre min-h-[1.5em]">
        {line.length === 0 ? <br /> :
          lang === 'html' ? (
            <span>
              {line.split(/(<[^>]+>)/g).map((token, j) => {
                if (token.startsWith('<') && token.endsWith('>')) {
                  const parts = token.match(/<\/?([a-z0-9]+)(.*?)>/i);
                  if (parts) {
                    return (
                      <span key={j}>
                        <span className="text-blue-400">&lt;{token.startsWith('</') ? '/' : ''}{parts[1]}</span>
                        {parts[2] && <span className="text-cyan-300">{parts[2]}</span>}
                        <span className="text-blue-400">&gt;</span>
                      </span>
                    );
                  }
                  return <span key={j} className="text-blue-400">{token}</span>;
                }
                return <span key={j} className="text-slate-300">{token}</span>;
              })}
            </span>
          ) : (
            <span>
              {line.split(/([:{};])/).map((token, j) => {
                if (token.includes(':')) return <span key={j} className="text-slate-400">{token}</span>;
                if (token.includes(';')) return <span key={j} className="text-slate-500">{token}</span>;
                if (token.includes('{') || token.includes('}')) return <span key={j} className="text-yellow-400">{token}</span>;
                if (line.includes(':') && line.indexOf(token) < line.indexOf(':')) return <span key={j} className="text-cyan-300">{token}</span>;
                if (line.includes(':') && line.indexOf(token) > line.indexOf(':')) return <span key={j} className="text-orange-300">{token}</span>;
                if (token.startsWith('.')) return <span key={j} className="text-green-400">{token}</span>;
                return <span key={j} className="text-pink-400">{token}</span>;
              })}
            </span>
          )
        }
      </div>
    ));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-600 font-sans">

      {/* Navbar */}
      <div className="border-b border-slate-200/60 bg-white/80 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 -ml-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-cyan-500/10 rounded-lg flex items-center justify-center text-cyan-400 border border-cyan-500/20">
              <Layout size={18} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm">{t.headerTitle}</h1>
              <p className="text-[10px] text-slate-500 font-mono">{t.headerSubtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-white rounded-full text-xs font-bold text-slate-500 border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            {t.draftSaved}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 md:p-12">

        {/* Article Content */}
        <article className="prose prose-invert prose-lg max-w-none mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-6">{t.articleTitle}</h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            {t.articleBody} <strong className="text-cyan-400">{t.articleHighlight}</strong>.
          </p>

          <div className="bg-white border-l-4 border-cyan-500 p-6 my-8 rounded-r-xl shadow-sm border-y border-r border-slate-100">
            <h3 className="text-cyan-600 font-bold text-lg mt-0 mb-2 flex items-center gap-2">
              <BookOpen size={20} /> {t.keyConceptTitle}
            </h3>
            <p className="text-slate-600 text-sm mb-0">
              {t.keyConceptBody}
            </p>
          </div>

          <h3 className="text-2xl font-bold text-slate-900 mt-12 mb-4">{t.challengeTitle}</h3>
          <p className="text-slate-600 mb-6">
            {t.challengeBody}
          </p>
        </article>

        {/* Embedded Editor Widget */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xl ring-4 ring-slate-100 mb-12">
          {/* Widget Header */}
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
            <div className="flex gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded text-xs font-bold text-slate-500 border border-slate-200 shadow-sm">
                <Code2 size={14} className="text-cyan-600" /> {t.interactiveEditor}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewMode('desktop')}
                className={`p-1.5 rounded ${previewMode === 'desktop' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Monitor size={14} />
              </button>
              <button
                onClick={() => setPreviewMode('mobile')}
                className={`p-1.5 rounded ${previewMode === 'mobile' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <Smartphone size={14} />
              </button>
            </div>
          </div>

          {/* Editor Body */}
          <div className="flex flex-col lg:flex-row h-[500px]">
            {/* Left: Code */}
            <div className="flex-1 flex flex-col border-r border-slate-200 min-w-[300px]">
              <div className="flex bg-slate-100 border-b border-slate-200">
                <button
                  onClick={() => setActiveTab('html')}
                  className={`px-4 py-2 text-xs font-bold border-r border-slate-200 ${activeTab === 'html' ? 'bg-[#1e1e1e] text-orange-400' : 'text-slate-500 hover:bg-slate-200'}`}
                >
                  index.html
                </button>
                <button
                  onClick={() => setActiveTab('css')}
                  className={`px-4 py-2 text-xs font-bold border-r border-slate-200 ${activeTab === 'css' ? 'bg-[#1e1e1e] text-cyan-400' : 'text-slate-500 hover:bg-slate-200'}`}
                >
                  style.css
                </button>
              </div>

              <div className="flex-1 relative font-mono text-sm bg-[#1e1e1e]">
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

            {/* Right: Preview */}
            <div className="flex-1 bg-[#f0f2f5] relative flex items-center justify-center p-4">
              <div className={`
                    bg-white shadow-xl overflow-hidden transition-all duration-300
                    ${previewMode === 'mobile' ? 'w-[320px] h-[480px] rounded-3xl border-8 border-slate-800' : 'w-full h-full rounded-lg border border-slate-300'}
                 `}>
                <iframe
                  srcDoc={srcDoc}
                  title="preview"
                  className="w-full h-full bg-white"
                  sandbox="allow-scripts"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="flex flex-col md:flex-row justify-between items-center bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4 md:mb-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isCompleted ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
              {isCompleted ? <CheckCircle2 size={24} /> : <PlayCircle size={24} />}
            </div>
            <div>
              <h4 className="font-bold text-slate-900 text-lg">{isCompleted ? t.niceJob : t.keepTrying}</h4>
              <p className="text-slate-500 text-sm">{t.hint}</p>
            </div>
          </div>

          <button
            onClick={handleNext}
            className={`
               px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all
               ${isCompleted
                ? 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'}
             `}
          >
            {t.nextSection} <ChevronRight size={18} />
          </button>
        </div>

      </div>
    </div>
  );
};

export default HtmlCssView;
