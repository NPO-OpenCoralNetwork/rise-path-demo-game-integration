import React, { useState } from 'react';
import { 
  ArrowLeft, Sparkles, Brain, Cpu, Zap, XCircle, CheckCircle2, 
  ArrowRight, Scroll, MousePointerClick, Lock
} from 'lucide-react';
import { ViewState } from '../../../types';

interface VibePrologueViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibePrologueView: React.FC<VibePrologueViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {
  const [signed, setSigned] = useState(false);

  const content = {
    en: {
      tag: "The Paradigm Shift",
      title: <>Coding is <span className="line-through text-slate-600">dead</span>.<br/>Long live <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">Coding</span>.</>,
      subtitle: <>We used to write instructions for machines. <br/>Now, we orchestrate intelligence.</>,
      oldWay: {
        title: "The Old Way",
        codeError: "SyntaxError: Unexpected token ';'",
        items: ["Memorizing syntax", "Fighting with semicolons", "Searching StackOverflow"]
      },
      newWay: {
        title: "Vibe Coding",
        prompt: '"Create a login page that feels like a foggy morning in London."',
        items: ['Focus on "What", not "How"', "Natural language is the code", "You are the Director"]
      },
      roles: {
        title: "New Roles",
        human: { title: "You", subtitle: "The Director", desc: "Vision, Logic, Empathy, and Decision Making." },
        ai: { title: "AI", subtitle: "The Engineer", desc: "Syntax, Implementation, Speed, and Tireless Execution." }
      },
      contract: {
        title: "The Creator's Pledge",
        points: [
          "I understand that I do not need to memorize every HTML tag to build something beautiful.",
          "I accept that AI will make mistakes, and my job is to guide it, not fix it manually line-by-line.",
          "I promise to focus on the Value I create, not the Complexity of the code I write."
        ],
        btnAgree: "I Agree",
        btnAccepted: "Pledge Accepted"
      },
      next: {
        ready: "Your environment is ready.",
        btn: "Enter Chapter 1: The Power of Speech"
      }
    },
    jp: {
      tag: "パラダイムシフト",
      title: <>コーディングは<span className="line-through text-slate-600">死んだ</span>。<br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">コーディング</span>万歳。</>,
      subtitle: <>かつて私たちは機械への命令を書いていました。<br/>今は、知性を指揮するのです。</>,
      oldWay: {
        title: "これまでの方法",
        codeError: "SyntaxError: 予期しないトークン ';' です",
        items: ["構文の暗記", "セミコロンとの戦い", "StackOverflowでの検索"]
      },
      newWay: {
        title: "バイブコーディング",
        prompt: "「ロンドンの霧深い朝のようなログインページを作って」",
        items: ['「どうやるか」ではなく「何を」', "自然言語こそがコード", "あなたは監督である"]
      },
      roles: {
        title: "新しい役割",
        human: { title: "あなた", subtitle: "監督 (Director)", desc: "ビジョン、論理、共感、意思決定。" },
        ai: { title: "AI", subtitle: "エンジニア", desc: "構文、実装、スピード、不眠不休の実行力。" }
      },
      contract: {
        title: "クリエイターの誓い",
        points: [
          "美しいものを作るために、すべてのHTMLタグを暗記する必要はないと理解します。",
          "AIはミスを犯すことを受け入れ、一行ずつ手動で直すのではなく、導くことが私の仕事だと理解します。",
          "コードの「複雑さ」ではなく、生み出す「価値」に焦点を当てることを誓います。"
        ],
        btnAgree: "同意する",
        btnAccepted: "誓約完了"
      },
      next: {
        ready: "環境の準備が整いました。",
        btn: "第1章へ進む：言葉の力"
      }
    }
  };

  const t = content[language];

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-purple-500/30 overflow-x-hidden">
      
      {/* Navbar */}
      <div className="fixed top-0 w-full z-50 bg-[#050505]/80 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
         <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
                <ArrowLeft size={24} />
            </button>
            <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-purple-500" />
                <span className="font-bold text-white tracking-wider text-sm">VIBE CODING <span className="text-slate-600">/ PROLOGUE</span></span>
            </div>
         </div>
         
         {/* Language Toggle */}
         <div className="flex bg-white/10 rounded-full p-1 border border-white/10">
            <button onClick={() => setLanguage('en')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'}`}>EN</button>
            <button onClick={() => setLanguage('jp')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'}`}>JP</button>
         </div>
      </div>

      <div className="max-w-4xl mx-auto pt-32 pb-20 px-6">
        
        {/* Hero Section */}
        <section className="text-center mb-32 animate-in fade-in slide-in-from-bottom-8 duration-1000">
           <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 text-xs font-bold uppercase tracking-widest mb-6">
              {t.tag}
           </div>
           <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
              {t.title}
           </h1>
           <p className="text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
              {t.subtitle}
           </p>
        </section>

        {/* The Problem vs The Solution */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-32">
           {/* Old Way */}
           <div className="bg-[#0a0a0a] border border-white/5 p-8 rounded-3xl relative overflow-hidden group hover:border-red-500/20 transition-colors">
              <div className="absolute top-0 right-0 p-32 bg-red-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              <div className="relative z-10">
                 <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-slate-500 mb-6 border border-white/5">
                    <XCircle size={24} />
                 </div>
                 <h3 className="text-2xl font-bold text-slate-300 mb-4">{t.oldWay.title}</h3>
                 <div className="font-mono text-sm text-slate-500 bg-black p-4 rounded-xl border border-white/5 mb-6">
                    <span className="text-red-400">SyntaxError:</span> {t.oldWay.codeError}<br/>
                    at Line 42:15
                 </div>
                 <ul className="space-y-3 text-slate-400">
                    {t.oldWay.items.map((item, i) => (
                       <li key={i} className="flex gap-3"><span className="text-slate-600">✗</span> {item}</li>
                    ))}
                 </ul>
              </div>
           </div>

           {/* New Way */}
           <div className="bg-[#0a0a0a] border border-purple-500/20 p-8 rounded-3xl relative overflow-hidden group hover:border-purple-500/40 transition-colors">
              <div className="absolute top-0 right-0 p-32 bg-purple-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              <div className="relative z-10">
                 <div className="w-12 h-12 bg-purple-900/20 rounded-2xl flex items-center justify-center text-purple-400 mb-6 border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                    <Zap size={24} />
                 </div>
                 <h3 className="text-2xl font-bold text-white mb-4">{t.newWay.title}</h3>
                 <div className="font-sans text-sm text-purple-200 bg-purple-900/10 p-4 rounded-xl border border-purple-500/20 mb-6 italic">
                    {t.newWay.prompt}
                 </div>
                 <ul className="space-y-3 text-slate-300">
                    {t.newWay.items.map((item, i) => (
                       <li key={i} className="flex gap-3"><span className="text-purple-500">✓</span> {item}</li>
                    ))}
                 </ul>
              </div>
           </div>
        </section>

        {/* Roles */}
        <section className="mb-32">
           <h2 className="text-3xl font-bold text-center text-white mb-16">{t.roles.title}</h2>
           <div className="flex flex-col md:flex-row gap-4 items-center justify-center">
              <div className="text-center">
                 <div className="w-32 h-32 mx-auto bg-gradient-to-b from-blue-500 to-blue-700 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-blue-900/50">
                    <Brain size={48} className="text-white" />
                 </div>
                 <h3 className="text-xl font-bold text-white">{t.roles.human.title}</h3>
                 <p className="text-slate-500 uppercase tracking-wider text-xs font-bold mt-2">{t.roles.human.subtitle}</p>
                 <p className="text-slate-400 mt-4 max-w-xs mx-auto text-sm">{t.roles.human.desc}</p>
              </div>

              <div className="h-24 w-px bg-slate-800 hidden md:block mx-8"></div>
              <div className="w-24 h-px bg-slate-800 md:hidden my-8"></div>

              <div className="text-center">
                 <div className="w-32 h-32 mx-auto bg-gradient-to-b from-purple-500 to-pink-600 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-purple-900/50 relative">
                    <Cpu size={48} className="text-white relative z-10" />
                    <div className="absolute inset-0 bg-white/20 rounded-full animate-ping opacity-20"></div>
                 </div>
                 <h3 className="text-xl font-bold text-white">{t.roles.ai.title}</h3>
                 <p className="text-slate-500 uppercase tracking-wider text-xs font-bold mt-2">{t.roles.ai.subtitle}</p>
                 <p className="text-slate-400 mt-4 max-w-xs mx-auto text-sm">{t.roles.ai.desc}</p>
              </div>
           </div>
        </section>

        {/* The Contract */}
        <section className="max-w-2xl mx-auto bg-[#111] border border-slate-800 p-8 md:p-12 rounded-2xl relative">
           <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#050505] px-4">
              <Scroll size={32} className="text-slate-600" />
           </div>
           
           <h2 className="text-2xl font-bold text-white text-center mb-8 font-serif italic">{t.contract.title}</h2>
           
           <div className="space-y-6 text-slate-400 mb-10 font-mono text-sm leading-relaxed">
              {t.contract.points.map((point, i) => (
                 <p key={i}>
                    <span className="text-purple-500 mr-2">0{i+1}.</span>
                    <span dangerouslySetInnerHTML={{__html: point.replace('Value', '<strong>Value</strong>').replace('Complexity', '<strong>Complexity</strong>').replace('価値', '<strong>価値</strong>').replace('複雑さ', '<strong>複雑さ</strong>')}}></span>
                 </p>
              ))}
           </div>

           <button 
             onClick={() => setSigned(true)}
             disabled={signed}
             className={`
               w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all duration-500
               ${signed 
                 ? 'bg-green-500/10 text-green-500 border border-green-500/20 cursor-default' 
                 : 'bg-white text-black hover:bg-slate-200 hover:scale-[1.02]'}
             `}
           >
             {signed ? (
               <>
                 <CheckCircle2 size={24} /> {t.contract.btnAccepted}
               </>
             ) : (
               <>
                 <MousePointerClick size={24} /> {t.contract.btnAgree}
               </>
             )}
           </button>
        </section>

        {/* Next Step */}
        <div className={`mt-12 text-center transition-all duration-700 ${signed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
           <p className="text-slate-500 mb-6">{t.next.ready}</p>
           <button 
             onClick={() => onNavigate(ViewState.VIBE_CHAPTER_1)}
             className="group bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-4 rounded-full font-bold text-xl shadow-[0_0_20px_rgba(147,51,234,0.5)] hover:shadow-[0_0_40px_rgba(147,51,234,0.7)] hover:scale-105 transition-all flex items-center gap-3 mx-auto"
           >
             {t.next.btn} <ArrowRight size={24} className="group-hover:translate-x-1 transition-transform" />
           </button>
        </div>

      </div>
    </div>
  );
};

export default VibePrologueView;