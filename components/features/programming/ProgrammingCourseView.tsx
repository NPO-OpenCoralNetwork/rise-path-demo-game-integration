import React, { useState } from 'react';
import { 
  ArrowLeft, GitCommit, GitPullRequest, Terminal, 
  Play, CheckCircle2, Circle, FileCode, Box, 
  Download, ExternalLink, Hash, Layout, Copy, Check
} from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';

interface ProgrammingCourseViewProps {
  onBack: () => void;
}

const ProgrammingCourseView: React.FC<ProgrammingCourseViewProps> = ({ onBack }) => {
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'syllabus' | 'readme'>('syllabus');
  const [copiedCmd, setCopiedCmd] = useState(false);

  const copyInstallCmd = () => {
    navigator.clipboard.writeText('npx create-next-app@latest my-shop');
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const copy = {
    en: {
      publicLabel: 'Public',
      cloneRepo: 'Clone Repo',
      progressLabel: 'Progress',
      courseTitle: 'React Ecosystem Mastery',
      courseDescription: 'Build production-ready applications with Next.js 14, TypeScript, Tailwind CSS, and Prisma.',
      moduleProgress: 'Module 3/10',
      kernelReady: 'Kernel Ready',
      projectAssets: 'Project Assets',
      figmaDesign: 'Figma Design',
      commitsTab: 'Commits (Syllabus)',
      readmeTab: 'README.md',
      inProgress: 'In Progress',
      continueCoding: 'Continue Coding',
      gettingStarted: 'Getting Started',
      runDevServer: 'First, run the development server:',
      folderStructure: 'Folder Structure',
      folderApp: 'Next.js App Router',
      folderComponents: 'Reusable UI components',
      folderLib: 'Utility functions & Prisma client',
      folderPrisma: 'DB Schema'
    },
    jp: {
      publicLabel: '公開',
      cloneRepo: 'リポジトリを複製',
      progressLabel: '進捗',
      courseTitle: 'Reactエコシステム完全攻略',
      courseDescription: 'Next.js 14、TypeScript、Tailwind CSS、Prismaで本番品質のアプリを構築します。',
      moduleProgress: 'モジュール 3/10',
      kernelReady: 'カーネル準備完了',
      projectAssets: 'プロジェクト素材',
      figmaDesign: 'Figmaデザイン',
      commitsTab: 'コミット（シラバス）',
      readmeTab: 'README.md',
      inProgress: '進行中',
      continueCoding: 'コーディングを続ける',
      gettingStarted: 'はじめに',
      runDevServer: 'まず開発サーバーを起動します：',
      folderStructure: 'フォルダ構成',
      folderApp: 'Next.js App Router',
      folderComponents: '再利用可能なUIコンポーネント',
      folderLib: 'ユーティリティ関数 & Prismaクライアント',
      folderPrisma: 'DBスキーマ'
    }
  } as const;

  const t = copy[language];

  const modules = [
    {
      id: 'm1',
      type: 'commit',
      sha: 'a1b2c3d',
      message: { en: 'chore: Initial Setup & Next.js Config', jp: 'chore: 初期セットアップとNext.js設定' },
      description: {
        en: 'Setting up the development environment, ESLint, Prettier, and folder structure.',
        jp: '開発環境、ESLint、Prettier、フォルダ構成を整えます。'
      },
      status: 'completed',
      duration: { en: '45m', jp: '45分' }
    },
    {
      id: 'm2',
      type: 'commit',
      sha: 'e5f6g7h',
      message: { en: 'feat: Build Responsive Layout with Tailwind', jp: 'feat: Tailwindでレスポンシブレイアウト' },
      description: {
        en: 'Implementing the mobile-first grid system and dark mode theming.',
        jp: 'モバイルファーストのグリッドとダークモードを実装。'
      },
      status: 'completed',
      duration: { en: '1h 15m', jp: '1時間15分' }
    },
    {
      id: 'm3',
      type: 'pr',
      prNumber: 42,
      message: { en: 'feat: State Management with Zustand', jp: 'feat: Zustandによる状態管理' },
      description: {
        en: 'MERGED: Create a global store for the shopping cart without Redux boilerplate.',
        jp: 'MERGED: Reduxなしでショッピングカートのグローバルストアを構築。'
      },
      status: 'current',
      duration: { en: '2h 00m', jp: '2時間00分' }
    },
    {
      id: 'm4',
      type: 'commit',
      sha: 'i8j9k0l',
      message: { en: 'feat: Integrate Stripe Payment Intent', jp: 'feat: Stripe Payment Intentの統合' },
      description: {
        en: 'Handling secure checkout flows and webhooks.',
        jp: '安全な決済フローとWebhookを実装。'
      },
      status: 'locked',
      duration: { en: '1h 30m', jp: '1時間30分' }
    },
    {
      id: 'm5',
      type: 'commit',
      sha: 'm1n2o3p',
      message: { en: 'fix: Performance Optimization & SEO', jp: 'fix: パフォーマンス最適化とSEO' },
      description: {
        en: 'Image optimization, metadata API, and Lighthouse auditing.',
        jp: '画像最適化、Metadata API、Lighthouse監査。'
      },
      status: 'locked',
      duration: { en: '1h 00m', jp: '1時間00分' }
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-cyan-500/30">
      
      {/* Navbar */}
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 -ml-2 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-mono text-sm">rise-path/courses/</span>
            <span className="text-cyan-400 font-bold text-sm">react-mastery</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-xs text-slate-400 border border-slate-700">{t.publicLabel}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           <button className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-xs font-bold transition-colors">
              <Download size={14} /> {t.cloneRepo}
           </button>
           <div className="flex items-center gap-2">
             <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 p-[1px]">
               <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
                 <span className="text-xs font-bold text-white">AJ</span>
               </div>
             </div>
           </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-8">
        
        {/* Left Sidebar (Desktop) / Top Info (Mobile) */}
        <div className="lg:col-span-3 p-6 lg:border-r border-slate-800 lg:min-h-[calc(100vh-65px)] space-y-8">
           
           <div>
              <div className="w-16 h-16 bg-cyan-500/10 rounded-xl flex items-center justify-center text-cyan-400 mb-6 border border-cyan-500/20">
                <Layout size={32} />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">{t.courseTitle}</h1>
              <p className="text-slate-500 text-sm leading-relaxed mb-6">
                {t.courseDescription}
              </p>
              
              <div className="space-y-3">
                 <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-mono">{t.progressLabel}</span>
                    <span className="text-cyan-400 font-mono">45%</span>
                 </div>
                 <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 w-[45%] shadow-[0_0_10px_rgba(6,182,212,0.4)]"></div>
                 </div>
              </div>
           </div>

           {/* .Env Style Config Card */}
           <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
              <div className="bg-slate-800/50 px-3 py-2 border-b border-slate-800 flex items-center gap-2">
                 <FileCode size={12} className="text-slate-400"/>
                 <span className="text-xs font-mono font-bold text-slate-400">package.json</span>
              </div>
              <div className="p-4 font-mono text-xs space-y-2 text-slate-400">
                 <div className="flex justify-between">
                    <span className="text-purple-400">"react"</span>
                    <span className="text-slate-500">"^18.3.1"</span>
                 </div>
                 <div className="flex justify-between">
                    <span className="text-purple-400">"next"</span>
                    <span className="text-slate-500">"14.1.0"</span>
                 </div>
                 <div className="flex justify-between">
                    <span className="text-purple-400">"tailwindcss"</span>
                    <span className="text-slate-500">"^3.4.1"</span>
                 </div>
                 <div className="flex justify-between">
                    <span className="text-purple-400">"zustand"</span>
                    <span className="text-slate-500">"^4.5.0"</span>
                 </div>
              </div>
           </div>

           {/* Quick Actions */}
           <div className="space-y-2">
              <button className="w-full text-left px-4 py-3 rounded-lg border border-slate-800 hover:bg-slate-900 transition-colors flex items-center gap-3 text-sm font-medium text-slate-400 hover:text-white group">
                 <Box size={16} className="group-hover:text-cyan-400"/> {t.projectAssets}
              </button>
              <button className="w-full text-left px-4 py-3 rounded-lg border border-slate-800 hover:bg-slate-900 transition-colors flex items-center gap-3 text-sm font-medium text-slate-400 hover:text-white group">
                 <ExternalLink size={16} className="group-hover:text-cyan-400"/> {t.figmaDesign}
              </button>
           </div>

        </div>

        {/* Center Content */}
        <div className="lg:col-span-9 p-0 lg:p-8">
           
           {/* Tabs */}
           <div className="flex border-b border-slate-800 px-6 lg:px-0 mb-8 sticky top-[65px] bg-slate-950/95 backdrop-blur z-20">
              <button 
                onClick={() => setActiveTab('syllabus')}
                className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'syllabus' ? 'border-cyan-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                {t.commitsTab}
              </button>
              <button 
                onClick={() => setActiveTab('readme')}
                className={`px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'readme' ? 'border-cyan-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
              >
                {t.readmeTab}
              </button>
           </div>

           {/* Tab Content */}
           <div className="px-6 lg:px-0 pb-12">
              {activeTab === 'syllabus' ? (
                <div className="relative border-l-2 border-slate-800 ml-4 lg:ml-8 space-y-8">
                   {modules.map((mod, idx) => {
                      const isCompleted = mod.status === 'completed';
                      const isCurrent = mod.status === 'current';
                      
                      return (
                        <div key={mod.id} className="relative pl-8 lg:pl-12 group">
                           {/* Timeline Node */}
                           <div className={`
                              absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 transition-all
                              ${isCompleted ? 'bg-slate-950 border-green-500' : 
                                isCurrent ? 'bg-cyan-500 border-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.6)] scale-125' : 
                                'bg-slate-950 border-slate-700'}
                           `}></div>

                           {/* Content Card */}
                           <div className={`
                              rounded-xl border p-5 lg:p-6 transition-all relative overflow-hidden
                              ${isCurrent 
                                ? 'bg-slate-900 border-cyan-500/50 shadow-lg shadow-cyan-900/10' 
                                : isCompleted ? 'bg-slate-900/40 border-slate-800 hover:bg-slate-900 hover:border-slate-700' : 'bg-slate-950 border-slate-800 opacity-60'}
                           `}>
                              {isCurrent && (
                                <div className="absolute top-0 right-0 p-3">
                                   <div className="flex items-center gap-2">
                                      <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                                    </span>
                                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">{t.inProgress}</span>
                                   </div>
                                </div>
                              )}

                              <div className="flex items-start gap-4 mb-3">
                                 <div className={`mt-1 p-2 rounded bg-slate-950 border ${isCurrent ? 'border-cyan-900 text-cyan-400' : 'border-slate-800 text-slate-500'}`}>
                                    {mod.type === 'pr' ? <GitPullRequest size={18} /> : <GitCommit size={18} />}
                                 </div>
                                 <div>
                                    <div className="flex items-center gap-3 mb-1">
                                       <span className="font-mono text-xs text-slate-500">{mod.sha || `#${mod.prNumber}`}</span>
                                       <span className="text-xs text-slate-600">•</span>
                                       <span className="text-xs text-slate-500">{mod.duration[language]}</span>
                                    </div>
                                    <h3 className={`font-mono font-bold text-base lg:text-lg ${isCurrent ? 'text-white' : 'text-slate-300'}`}>
                                      {mod.message[language]}
                                    </h3>
                                 </div>
                              </div>
                              
                              <p className="text-slate-400 text-sm leading-relaxed mb-6 pl-[52px]">
                                {mod.description[language]}
                              </p>

                              {isCurrent && (
                                 <div className="pl-[52px]">
                                    <button className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2.5 rounded-lg font-bold text-sm transition-all shadow-lg shadow-cyan-900/20 hover:shadow-cyan-500/20 active:scale-95">
                                       <Terminal size={16} /> {t.continueCoding}
                                    </button>
                                 </div>
                              )}
                           </div>
                        </div>
                      );
                   })}
                </div>
              ) : (
                <div className="prose prose-invert prose-slate max-w-none">
                   <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                      <h3 className="text-white mt-0">{t.gettingStarted}</h3>
                      <p>{t.runDevServer}</p>
                      
                      <div className="relative group">
                        <div className="bg-black rounded-lg p-4 font-mono text-sm text-slate-300 border border-slate-800 flex justify-between items-center">
                           <code>
                              <span className="text-green-400">$</span> npm run dev
                           </code>
                           <button 
                             onClick={copyInstallCmd}
                             className="text-slate-500 hover:text-white transition-colors"
                           >
                              {copiedCmd ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                           </button>
                        </div>
                      </div>

                      <h3 className="text-white">{t.folderStructure}</h3>
                      <ul className="font-mono text-sm text-slate-400 list-none pl-0 space-y-2">
                        <li>├── app/ <span className="text-slate-600">// {t.folderApp}</span></li>
                        <li>├── components/ <span className="text-slate-600">// {t.folderComponents}</span></li>
                        <li>├── lib/ <span className="text-slate-600">// {t.folderLib}</span></li>
                        <li>└── prisma/ <span className="text-slate-600">// {t.folderPrisma}</span></li>
                      </ul>
                   </div>
                </div>
              )}
           </div>

        </div>

      </div>
    </div>
  );
};

export default ProgrammingCourseView;
