import React from 'react';
import {
  ArrowLeft, CheckCircle2, Lock, Play, Star, MapPin,
  Sparkles, Monitor, Brain, Terminal, Zap, Globe, MessageSquare,
  ArrowRight, Calendar, User
} from 'lucide-react';
import { ViewState } from '../../../types';

interface VibePathViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  language: 'en' | 'jp';
  setLanguage: (lang: 'en' | 'jp') => void;
}

const VibePathView: React.FC<VibePathViewProps> = ({ onBack, onNavigate, language, setLanguage }) => {

  const content = {
    en: {
      back: "Back to Campus",
      tag: "Vibe Coding Path",
      title: "Orchestrating Intelligence",
      subtitle: "Master the art of directing AI to build software. No memorization required.",
      progressTitle: "Track Status",
      level: "Intermediate",
      time: "20 Hours",
      chapters: [
        {
          id: 'ch0',
          title: 'Chapter 0: Sharing the Premise',
          desc: 'Why "No-Code" development works now. Separating Human and AI roles.',
          duration: "30 min",
          image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch1',
          title: 'Chapter 1: Minimum Viable Knowledge',
          desc: 'Frontend, Backend, DB, and Git. The absolute basics you must understand.',
          duration: "45 min",
          image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch2',
          title: 'Chapter 2: Planning with AI',
          desc: 'Wall-boarding with ChatGPT. Translating "Want" into App Structure.',
          duration: "60 min",
          image: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch3',
          title: 'Chapter 3: The Development Cockpit',
          desc: 'Setting up VSCode, Extensions, and the AI-Native editor Cursor.',
          duration: "45 min",
          image: "https://images.unsplash.com/photo-1607799275518-d79f278ec964?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch4',
          title: 'Chapter 4: Generating Frontend',
          desc: 'Google AI Studio basics. Creating UI prototypes with Gemini 3 Pro.',
          duration: "90 min",
          image: "https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch5',
          title: 'Chapter 5: GitHub Workflow',
          desc: 'Understanding Repositories, Commits, and why Git is essential for AI dev.',
          duration: "60 min",
          image: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch6',
          title: 'Chapter 6: Vibe Coding with CLI',
          desc: 'Gemini CLI introduction. Implementing logic with natural language.',
          duration: "120 min",
          image: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch7',
          title: 'Chapter 7: Data with Supabase',
          desc: 'Auth, DB, Storage. Understanding the role of PostgreSQL.',
          duration: "120 min",
          image: "https://images.unsplash.com/photo-1633419461186-7d75076e2609?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch8',
          title: 'Chapter 8: Deployment',
          desc: 'Releasing to Vercel and Render. The checklist for going live.',
          duration: "45 min",
          image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch9',
          title: 'Chapter 9: Failure & Debugging',
          desc: 'How to deal with AI breaking things. Reading logs and error handling.',
          duration: "60 min",
          image: "https://images.unsplash.com/photo-1555861496-0666c8981751?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch10',
          title: 'Chapter 10: Advanced Application',
          desc: 'Applied Game/Service Development. Refining UI/UX with AI.',
          duration: "90 min",
          image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch11',
          title: 'Chapter 11: Future Learning',
          desc: 'What not to learn. Cultivating selection eyes for AI tools.',
          duration: "30 min",
          image: "https://images.unsplash.com/photo-1535378437327-b7149b379bab?auto=format&fit=crop&q=80&w=800"
        }
      ]
    },
    jp: {
      back: "キャンパスに戻る",
      tag: "バイブコーディング・パス",
      title: "知性のオーケストレーション",
      subtitle: "AIを指揮してソフトウェアを構築する技術。暗記は不要です。",
      progressTitle: "コース進捗",
      level: "中級",
      time: "20時間",
      chapters: [
        {
          id: 'ch0',
          title: '第0章｜この時代の前提を共有する',
          desc: 'なぜ「コードを書かない開発」が成立するのか。人間の役割とAIの役割の分離。',
          duration: "30分",
          image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch1',
          title: '第1章｜人間が理解すべき最低ライン',
          desc: 'フロントエンド / バックエンド / DBの関係。UIとAPIの違い。',
          duration: "45分",
          image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch2',
          title: '第2章｜AIと企画する力を身につける',
          desc: 'ChatGPTとの壁打ち設計術。「作りたい」をアプリ構造に翻訳する。',
          duration: "60分",
          image: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch3',
          title: '第3章｜開発環境コックピット',
          desc: 'VSCodeの導入と必須拡張機能。AIネイティブエディタCursorの活用法。',
          duration: "45分",
          image: "https://images.unsplash.com/photo-1607799275518-d79f278ec964?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch4',
          title: '第4章｜フロントエンドをAIで生成する',
          desc: 'Google AI Studioの基本操作。Gemini 3 ProでUIの叩き台を作る思考法。',
          duration: "90分",
          image: "https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch5',
          title: '第5章｜GitHubワークフロー完全理解',
          desc: 'リポジトリとは何か。AI開発でGitが必須な理由と、壊れても戻れる安心設計。',
          duration: "60分",
          image: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch6',
          title: '第6章｜Gemini CLIによるバイブコーディング',
          desc: '自然言語でコードを実装する。AIが複数ファイルを編集する仕組み。',
          duration: "120分",
          image: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch7',
          title: '第7章｜Supabaseでデータを持たせる',
          desc: 'PostgreSQLの超基礎理解。Auth・DB・Storageの役割と環境変数の考え方。',
          duration: "120分",
          image: "https://images.unsplash.com/photo-1633419461186-7d75076e2609?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch8',
          title: '第8章｜デプロイして“世界に出す”',
          desc: 'VercelとRenderでの公開手法。無料枠の制限と、公開後のチェックリスト。',
          duration: "45分",
          image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch9',
          title: '第9章｜失敗と修正を前提にした開発',
          desc: 'AIが壊すポイントとエラーとの付き合い方。ログを見るという行為。',
          duration: "60分",
          image: "https://images.unsplash.com/photo-1555861496-0666c8981751?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch10',
          title: '第10章｜応用：ゲーム・サービス開発へ',
          desc: 'リアルタイム処理の考え方。UI/UXをAIと磨き、小さく作って公開する戦略。',
          duration: "90分",
          image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=800"
        },
        {
          id: 'ch11',
          title: '第11章｜これからの学び方',
          desc: 'プログラミングをどう学ぶか（学ばなくていい範囲）。AIツールの選別力。',
          duration: "30分",
          image: "https://images.unsplash.com/photo-1535378437327-b7149b379bab?auto=format&fit=crop&q=80&w=800"
        }
      ]
    }
  };

  const t = content[language];

            // Map static data to translated content

            const chapters = t.chapters.map((ch, idx) => ({

              ...ch,

              status: idx <= 10 ? 'completed' : (idx === 11 ? 'current' : 'locked'), 

              view: [

                ViewState.VIBE_CHAPTER_0,

                ViewState.VIBE_CHAPTER_1,

                ViewState.VIBE_CHAPTER_2,

                ViewState.VIBE_CHAPTER_3,

                ViewState.VIBE_CHAPTER_4,

                ViewState.VIBE_CHAPTER_5,

                ViewState.VIBE_CHAPTER_6,

                ViewState.VIBE_CHAPTER_7,

                ViewState.VIBE_CHAPTER_8,

                ViewState.VIBE_CHAPTER_9,

                ViewState.VIBE_CHAPTER_10,

                ViewState.VIBE_CHAPTER_11

              ][idx] || null

            }));  return (
    <div className="min-h-screen bg-slate-50/50 font-sans text-slate-600 pb-20">
      {/* Hero Section */}
      <div className="relative h-[300px] w-full overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=1600"
          alt="Vibe Coding Hero"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-purple-900/60 backdrop-blur-[2px]"></div>

        <div className="absolute inset-0 flex flex-col justify-center max-w-5xl mx-auto px-6">
          <div className="flex justify-between items-start w-full mb-2">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm font-medium"
            >
              <ArrowLeft size={16} /> {t.back}
            </button>

            {/* Language Toggle */}
            <div className="flex bg-white/20 backdrop-blur-md rounded-full p-1 border border-white/20">
              <button onClick={() => setLanguage('en')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'en' ? 'bg-white text-purple-900' : 'text-purple-100 hover:text-white'}`}>EN</button>
              <button onClick={() => setLanguage('jp')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${language === 'jp' ? 'bg-white text-purple-900' : 'text-purple-100 hover:text-white'}`}>JP</button>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div className="bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-purple-900/20">
              {t.tag}
            </div>
            <span className="text-purple-100/90 text-sm font-mono tracking-wider">CHAPTER 3 / 4</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">{t.title}</h1>
          <p className="text-purple-100 max-w-2xl text-lg leading-relaxed">
            {t.subtitle}
          </p>
        </div>
      </div>

      {/* Learning Highlights (Inserted) */}
      <div className="max-w-5xl mx-auto px-6 -mt-8 relative z-20 mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: MessageSquare,
            title: language === 'en' ? "Prompt Engineering" : "プロンプトエンジニアリング",
            desc: language === 'en' ? "Master the art of communicating with AI." : "AIと対話する技術を極める。"
          },
          {
            icon: Zap,
            title: language === 'en' ? "AI-Native Editors" : "AIネイティブエディタ",
            desc: language === 'en' ? "Cursor & Copilot workflow mastery." : "CursorとCopilotを使いこなす。"
          },
          {
            icon: Globe,
            title: language === 'en' ? "Open Source" : "オープンソース世界",
            desc: language === 'en' ? "Understand the global ecosystem." : "世界の共有知のエコシステムを理解。"
          }
        ].map((item, idx) => (
          <div key={idx} className="bg-white/90 backdrop-blur-sm border border-purple-100 p-4 rounded-xl flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-purple-50 text-purple-600 p-2 rounded-lg shrink-0">
              <item.icon size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-700 text-sm mb-0.5">{item.title}</h3>
              <p className="text-xs text-slate-500 leading-snug">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress Bar (Floating) - Removed negative margin to float below highlights naturally */}
      <div className="max-w-5xl mx-auto px-6 mb-12">
        <div className="bg-white rounded-xl p-6 shadow-lg shadow-purple-200/50 border border-purple-100 flex items-center justify-between gap-8">
          <div className="flex-1">
            <div className="flex justify-between items-end mb-2">
              <div className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.progressTitle}</div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-purple-600">75%</span>
                <span className="text-xs text-slate-400 font-medium">COMPLETED</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div className="bg-purple-500 h-full rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]" style={{ width: '75%' }}></div>
            </div>
          </div>
          <div className="hidden md:flex gap-8 border-l border-slate-100 pl-8">
            <div>
              <div className="text-xs text-slate-400 font-bold uppercase mb-1">Time</div>
              <div className="font-medium text-slate-700">{t.time}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 font-bold uppercase mb-1">Level</div>
              <div className="font-medium text-slate-700">{t.level}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Roadmap */}
      <div className="max-w-4xl mx-auto px-6">
        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-[27px] top-8 bottom-8 w-0.5 bg-slate-200/80"></div>

          <div className="space-y-8">
            {chapters.map((chapter, index) => (
              <div key={chapter.id} className="relative flex gap-8 group">
                {/* Status Icon */}
                <div className={`
                            relative z-10 w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-[3px] transition-all duration-300 bg-white
                            ${chapter.status === 'completed' ? 'border-purple-500 text-purple-500' : ''}
                            ${chapter.status === 'current' ? 'border-purple-500 text-purple-500 shadow-[0_0_0_4px_rgba(168,85,247,0.15)] scale-110' : ''}
                            ${chapter.status === 'locked' ? 'border-slate-200 text-slate-300' : ''}
                        `}>
                  {chapter.status === 'completed' && <CheckCircle2 size={24} className="fill-purple-50" />}
                  {chapter.status === 'current' && <div className="w-4 h-4 bg-purple-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.8)]"></div>}
                  {chapter.status === 'locked' && <Lock size={20} />}
                </div>

                {/* Content Card */}
                <div className={`flex-1 transition-all duration-300 ${chapter.status === 'current' ? 'transform -translate-y-1' : 'opacity-80 hover:opacity-100'}`}>
                  <div
                    onClick={() => chapter.status !== 'locked' && chapter.view && onNavigate(chapter.view)}
                    className={`
                                    group/card rounded-2xl border overflow-hidden transition-all duration-300 flex flex-col md:flex-row h-full md:h-40
                                    ${chapter.status === 'current'
                        ? 'bg-white border-purple-200/80 shadow-xl shadow-purple-100/40 cursor-pointer hover:border-purple-300 hover:shadow-purple-100/60'
                        : 'bg-white border-slate-100 shadow-sm hover:shadow-lg hover:border-purple-100'}
                                    ${chapter.status === 'locked' ? 'cursor-not-allowed' : 'cursor-pointer'}
                                `}
                  >
                    {/* Image Section */}
                    <div className="w-full md:w-48 relative overflow-hidden shrink-0">
                      <img
                        src={chapter.image}
                        alt={chapter.title}
                        className={`w-full h-full object-cover transition-transform duration-700 ${chapter.status === 'locked' ? 'grayscale opacity-70' : 'group-hover/card:scale-110'}`}
                      />
                      {/* Overlay for locked items */}
                      {chapter.status === 'locked' && <div className="absolute inset-0 bg-slate-100/50 backdrop-grayscale"></div>}

                      {/* Current Label on Image */}
                      {chapter.status === 'current' && (
                        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur text-purple-600 text-[10px] font-bold px-2 py-1 rounded shadow-sm flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></div>
                          NOW LIVE
                        </div>
                      )}
                    </div>

                    {/* Text Content */}
                    <div className="flex-1 p-5 flex flex-col justify-center relative">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`font-bold text-lg tracking-tight ${chapter.status === 'locked' ? 'text-slate-400' : 'text-slate-800'}`}>
                          {chapter.title}
                          {chapter.status === 'completed' && <span className="ml-2 text-xs font-normal text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full align-middle">Done</span>}
                        </h3>
                      </div>

                      <p className={`text-sm leading-relaxed line-clamp-2 md:line-clamp-none ${chapter.status === 'locked' ? 'text-slate-400' : 'text-slate-500'} mb-3`}>
                        {chapter.desc}
                      </p>

                      <div className="flex items-center justify-between mt-auto">
                        <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${chapter.status === 'locked' ? 'text-slate-300' : 'text-slate-400'}`}>
                          <Calendar size={12} /> {chapter.duration}
                        </span>

                        {chapter.status === 'current' ? (
                          <div className="flex items-center gap-2 text-purple-600 font-bold text-sm bg-purple-50 px-4 py-2 rounded-lg group-hover/card:bg-purple-500 group-hover/card:text-white transition-all">
                            Start <ArrowRight size={16} />
                          </div>
                        ) : (
                          chapter.status === 'completed' && (
                            <div className="w-8 h-8 rounded-full bg-slate-50 text-purple-600 flex items-center justify-center">
                              <CheckCircle2 size={16} />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VibePathView;