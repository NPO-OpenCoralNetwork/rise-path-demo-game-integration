import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Zap, BrainCircuit, Loader2, Brain, CheckCircle, ArrowRight, Send, Infinity, User, Bot, RefreshCw, ThumbsUp, ThumbsDown, Paperclip, X as CloseIcon, Palette } from 'lucide-react';
import { GeneratedCourse, ViewState, Message } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { sendAiChat, sendAiDecision, fetchGeneratedCourseById, uploadFile, fetchAiDrafts } from '../../../services/curriculumApi';
import { addLearningEvent } from '../../../services/progressService';
import ReactMarkdown from 'react-markdown';

interface CourseGeneratorViewProps {
  onBack: () => void;
  onCourseGenerated: (course: GeneratedCourse) => void;
  onNavigate?: (view: ViewState) => void;
}

const CourseGeneratorView: React.FC<CourseGeneratorViewProps> = ({ onBack, onCourseGenerated, onNavigate }) => {
  const { language } = useLanguage();
  const [modelType, setModelType] = useState<'standard' | 'pro' | 'gemini-2.5-flash' | 'gemini-2.5-pro'>('gemini-2.5-flash');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeLogs, setActiveLogs] = useState<{agent: string, message: string, status?: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // V2 Flow State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [curriculumId, setCurriculumId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null); // 'requirements' | 'roadmap' | 'curriculum'
  
  // File State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const copy = {
    en: {
      initialMessage: "Hello! I'm your AI Concierge. Tell me what you want to learn today, or upload a document to get started.",
      backToLibrary: 'Back to Library',
      headerTitle: 'Concierge Scoping',
      headerSubtitle: 'AI Curriculum Planning Session',
      inputPlaceholder: 'Tell me what you want to learn...',
      analysisActive: 'Analysis Active',
      generating: 'Thinking...',
      resetChat: 'Reset Chat',
      resetMessage: 'Plan reset. Where should we begin?',
      errorChat: 'Communication failed.',
      approve: 'Approve & Continue',
      revise: 'Request Changes',
      revisePlaceholder: 'What should be changed?',
      statusRequirements: 'Defining Requirements',
      statusRoadmap: 'Drafting Roadmap',
      statusCurriculum: 'Building Curriculum',
      doneTitle: 'Curriculum Ready!',
      doneMessage: 'Your custom course has been generated and saved.',
      demoPromptPython: 'I want an intro to Python for AI development',
      demoPromptArt: 'I want to study art history systematically',
      demoPromptUnity: 'I want to master Unity game development with AI',
      demoCta: 'Start demo',
    },
    jp: {
      initialMessage: 'こんにちは！AIコンシェルジュです。学びたいテーマを教えていただくか、資料をアップロードして開始しましょう。',
      backToLibrary: 'ライブラリに戻る',
      headerTitle: '学習プラン相談',
      headerSubtitle: 'AIカリキュラム設計セッション',
      inputPlaceholder: '学びたいことについて教えてください...',
      analysisActive: '分析中',
      generating: '思考中...',
      resetChat: 'チャットをリセット',
      resetMessage: 'プランをリセットしました。何から始めましょうか？',
      errorChat: '通信に失敗しました。',
      approve: '承認して進む',
      revise: '修正を依頼',
      revisePlaceholder: '修正点を入力...',
      statusRequirements: '要件定義中',
      statusRoadmap: 'ロードマップ作成中',
      statusCurriculum: 'カリキュラム構築中',
      doneTitle: '完成しました！',
      doneMessage: 'あなた専用のコースが生成・保存されました。',
      demoPromptPython: 'AI開発のためのPython入門を学びたい',
      demoPromptArt: '美術史の変遷について体系的に学びたい',
      demoPromptUnity: 'AIを活用したUnityゲーム開発をマスターしたい',
      demoCta: 'デモを開始'
    }
  } as const;

  const t = copy[language];

  // Chat States
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Long-wait timer for generating state
  const [waitElapsed, setWaitElapsed] = useState(0);
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isGenerating) {
      setWaitElapsed(0);
      waitTimerRef.current = setInterval(() => {
        setWaitElapsed(prev => prev + 1);
      }, 1000);
    } else {
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
      setWaitElapsed(0);
    }
    return () => { if (waitTimerRef.current) clearInterval(waitTimerRef.current); };
  }, [isGenerating]);

  // --- Draft Restore: check for in-progress drafts on mount ---
  const draftChecked = useRef(false);
  useEffect(() => {
    if (draftChecked.current) return;
    draftChecked.current = true;

    fetchAiDrafts().then(({ drafts }) => {
      if (drafts.length > 0) {
        const latest = drafts[0];
        const stageMap: Record<string, string> = {
          'draft_requirements': 'requirements',
          'draft_roadmap': 'roadmap',
        };
        const stage = stageMap[latest.status] || 'requirements';
        setCurriculumId(latest.id);
        setSessionId(latest.id);
        setPendingApproval(stage);
        setMessages([{
          id: 'restored-draft',
          role: 'model',
          text: language === 'jp'
            ? `📋 前回の作業を復元しました。「${latest.title}」の${stage === 'requirements' ? '要件定義' : 'ロードマップ'}が承認待ちです。\n\n続行するか、新しいテーマを入力してください。`
            : `📋 Restored your previous session: "${latest.title}". The ${stage} stage is pending approval.\n\nContinue or type a new topic.`,
          timestamp: new Date(),
        }]);
      }
    }).catch(() => { /* ignore restore failure */ });
  }, [language]);

  const animateLogs = async (logs: any[]) => {
    setActiveLogs([]);
    if (!logs || logs.length === 0) return;
    
    for (const log of logs) {
        await new Promise(resolve => setTimeout(resolve, 800));
        setActiveLogs(prev => [...prev, log]);
    }
  };

  useEffect(() => {
    setMessages([
        {
            id: 'init',
            role: 'model',
            text: t.initialMessage,
            timestamp: new Date()
        }
    ]);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating, pendingApproval]);

  const handleSendMessage = async (text?: string) => {
    const msgText = text || inputValue;
    if (!msgText.trim() && !selectedFile) return;
    if (isGenerating) return;

    const isRevision = pendingApproval !== null && pendingApproval !== 'none';
    
    const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text: selectedFile ? `${msgText} (Attached: ${selectedFile.name})`.trim() : msgText,
        timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsGenerating(true);
    setActiveLogs([]); 
    setError(null);

    try {
        let attachments: any[] = [];
        if (selectedFile) {
            const uploadRes = await uploadFile(selectedFile);
            attachments.push({ material_id: uploadRes.material_id });
            setSelectedFile(null);
        }

        let response;
        if (isRevision && curriculumId && sessionId && pendingApproval) {
            response = await sendAiDecision(curriculumId, sessionId, pendingApproval, 'revise', msgText);
        } else {
            response = await sendAiChat(msgText, sessionId || undefined, attachments);
        }

        await handleApiResponse(response);

    } catch (err) {
        console.error("Chat failed:", err);
        setError(t.errorChat);
        setIsGenerating(false);
    }
  };

  const handleApprove = async () => {
    if (!curriculumId || !sessionId || !pendingApproval) {
        setError(`Missing session state. Please reset chat.`);
        return;
    }
    
    setIsGenerating(true);
    setActiveLogs([]); 
    try {
        const response = await sendAiDecision(curriculumId, sessionId, pendingApproval, 'approved');
        await handleApiResponse(response);
    } catch (err) {
        console.error("Approval Error:", err);
        setError(t.errorChat);
        setIsGenerating(false);
    }
  };

  const handleApiResponse = async (data: any) => {
      if (data.session_id) setSessionId(data.session_id);
      if (data.curriculum_id) setCurriculumId(data.curriculum_id);
      
      // Animate logs if present
      if (data.agent_logs) {
          await animateLogs(data.agent_logs);
          await new Promise(resolve => setTimeout(resolve, 600));
      }

      setPendingApproval(data.pending_approval);

      if (data.message) {
          const aiMsg: Message = {
              id: Date.now().toString(),
              role: 'model',
              text: data.message,
              timestamp: new Date()
          };
          setMessages(prev => [...prev, aiMsg]);
      }

      setIsGenerating(false);

      if (data.status === 'approved') {
          const targetId = data.curriculum_id || curriculumId;
          if (targetId) {
              const fullCourse = await fetchGeneratedCourseById(targetId);
              addLearningEvent({
                type: 'course_generated',
                title: { en: `Generated: ${fullCourse.title}`, jp: `生成: ${fullCourse.title}` },
                description: { en: 'AI-generated course added to library', jp: 'AI生成コースをライブラリに追加' },
              });
              onCourseGenerated(fullCourse);
          }
      }
  };

  const getPlainText = (node: React.ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(getPlainText).join('');
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
      return getPlainText(node.props.children);
    }
    return '';
  };

  const renderModuleHeaderIfNeeded = (children: React.ReactNode) => {
    const text = getPlainText(children).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (!/module/i.test(text) && !/モジュール/.test(text)) return null;

    const normalized = text
      .replace(/^Module\s*\d+\s*:\s*/i, '')
      .replace(/^\d+\s*:\s*/i, '')
      .replace(/^Module\s*:/i, '')
      .replace(/^Module\s*/i, '')
      .replace(/^モジュール\s*\d+\s*:\s*/i, '')
      .replace(/^モジュール\s*:/i, '')
      .replace(/^モジュール\s*/i, '')
      .trim();

    return (
      <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 shadow-sm">
        <div className="text-[11px] uppercase tracking-[0.3em] text-indigo-500 font-bold mb-1">Module</div>
        <div className="text-sm font-semibold text-slate-800">{normalized}</div>
      </div>
    );
  };

  const renderRoadmapList = (children: React.ReactNode, getStep?: () => number) => {
    const items = React.Children.toArray(children).filter(
      (child) => React.isValidElement(child) && child.type === 'li'
    ) as React.ReactElement<{ children?: React.ReactNode }>[];
    const normalized = items
      .map((item) => {
        const content = item.props.children;
        const text = getPlainText(content).replace(/\s+/g, ' ').trim();
        return text ? { content, text } : null;
      })
      .filter(Boolean) as Array<{ content: React.ReactNode; text: string }>;

    if (!normalized.length) return null;

    return (
      <div className="relative mt-4 space-y-4 pl-2">
        <div className="absolute left-3 top-2 bottom-2 w-px bg-indigo-100" />
        {normalized.map((item, index) => {
          const stepNumber = getStep ? getStep() : index + 1;
          return (
          <div key={index} className="relative flex items-start gap-4">
            <div className="relative z-10 h-7 w-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shadow-md">
              {stepNumber}
            </div>
            <div className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-sm text-slate-700 leading-relaxed">{item.content}</div>
            </div>
          </div>
        )})}
      </div>
    );
  };

  const renderCardList = (children: React.ReactNode) => {
    const items = React.Children.toArray(children).filter(
      (child) => React.isValidElement(child) && child.type === 'li'
    ) as React.ReactElement<{ children?: React.ReactNode }>[];

    if (!items.length) return null;

    return (
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2">
            <span className="mt-2 h-2 w-2 rounded-full bg-indigo-400" />
            <div className="text-sm text-slate-700 leading-relaxed">{item.props.children}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderCurriculumList = (children: React.ReactNode) => {
    const items = React.Children.toArray(children).filter(
      (child) => React.isValidElement(child) && child.type === 'li'
    ) as React.ReactElement<{ children?: React.ReactNode }>[];

    if (!items.length) return null;

    return (
      <div className="mt-3 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <CheckCircle size={16} className="mt-0.5 text-emerald-500" />
            <div className="text-sm text-slate-700 leading-relaxed">{item.props.children}</div>
          </div>
        ))}
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-6 pt-10 sm:pt-12">
      <div className="max-w-5xl w-full flex flex-col h-[85vh] min-h-[640px]">
        <button 
          onClick={onBack} 
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 mb-6 transition-colors w-fit"
        >
          <ArrowLeft size={20} /> {t.backToLibrary}
        </button>

        <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 flex flex-col overflow-hidden flex-1 min-w-0">
          
          <div className="p-6 sm:p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                    <Sparkles size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1 break-words">{t.headerTitle}</h1>
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">{t.headerSubtitle}</p>
                </div>
            </div>
            
            {pendingApproval && pendingApproval !== 'none' && (
                <div className="px-4 py-2 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse">
                    {pendingApproval === 'requirements' ? t.statusRequirements : 
                     pendingApproval === 'roadmap' ? t.statusRoadmap : t.statusCurriculum}
                </div>
            )}
          </div>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 bg-slate-50/30">
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                    {/* Demo Starter Grid */}
                    {messages.length === 1 && !isGenerating && (
                        <div className="flex flex-col items-center justify-center h-full space-y-6 animate-in fade-in zoom-in duration-500">
                            <div className="text-center max-w-lg">
                                <p className="text-slate-600 text-sm mb-8 font-medium">
                                    {language === 'jp' 
                                        ? '学習したいテーマを選択して、AIエージェントによるカリキュラム生成プロセスを体験してください。' 
                                        : 'Choose a topic to see how AI agents collaborate to build your curriculum.'}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {[
                                        { id: 'python', prompt: t.demoPromptPython, icon: <Zap size={18} />, color: 'border-blue-500 text-blue-600', label: 'Python 入門' },
                                        { id: 'art', prompt: t.demoPromptArt, icon: <Palette size={18} />, color: 'border-orange-500 text-orange-600', label: '美術史' },
                                        { id: 'unity', prompt: t.demoPromptUnity, icon: <Brain size={18} />, color: 'border-indigo-500 text-indigo-600', label: 'Unity開発' }
                                    ].map((demo) => (
                                        <button
                                            key={demo.id}
                                            onClick={() => {
                                                setInputValue(demo.prompt);
                                                setTimeout(() => handleSendMessage(demo.prompt), 100);
                                            }}
                                            className={`flex flex-col items-center gap-3 p-6 bg-white border-2 ${demo.color} hover:bg-slate-50 rounded-2xl transition-all active:scale-95 shadow-md shadow-slate-100 group`}
                                        >
                                            <div className="p-3 rounded-xl bg-slate-50 group-hover:bg-white transition-colors">
                                                {demo.icon}
                                            </div>
                                            <span className="text-xs font-black uppercase tracking-wider">{demo.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error Banner */}
                    {error && (
                        <div className="mx-0 sm:mx-6 mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                            <CloseIcon className="text-red-500 shrink-0" size={20} />
                            <p className="text-xs font-bold text-red-600">{error}</p>
                            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
                                <CloseIcon size={16} />
                            </button>
                        </div>
                    )}
                    
                    {messages.map((msg) => {
                        const text = msg.text || '';
                        const isRoadmapMessage = msg.role === 'model' && /(ロードマップ案|学習ロードマップ|Roadmap)/i.test(text);
                        const isCurriculumMessage = msg.role === 'model' && /(カリキュラム詳細|詳細コンテンツ|Curriculum Details|カリキュラムを確定)/i.test(text);
                        const roadmapLabel = language === 'jp' ? 'ロードマップ' : 'Roadmap';
                        const curriculumLabel = language === 'jp' ? 'カリキュラム詳細' : 'Curriculum';
                        let roadmapStep = 0;
                        const nextRoadmapStep = () => {
                          roadmapStep += 1;
                          return roadmapStep;
                        };
                        return (
                        <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white text-indigo-600 border border-indigo-50'}`}>
                                {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                            </div>
                            <div
                              className={`max-w-[90%] sm:max-w-[80%] p-4 rounded-3xl text-sm leading-relaxed shadow-sm break-words ${
                                msg.role === 'user'
                                  ? 'bg-indigo-600 text-white rounded-tr-none whitespace-pre-wrap'
                                  : `bg-white text-slate-700 border border-slate-100 rounded-tl-none ${
                                      isRoadmapMessage ? 'ring-1 ring-indigo-200/60 shadow-indigo-100/40' : isCurriculumMessage ? 'ring-1 ring-emerald-200/60 shadow-emerald-100/40' : ''
                                    }`
                              }`}
                            >
                              {msg.role === 'user' ? (
                                msg.text
                              ) : (
                                <>
                                  {(isRoadmapMessage || isCurriculumMessage) && (
                                    <div className={`mb-3 inline-flex items-center gap-2 rounded-full text-[11px] font-bold uppercase tracking-widest px-3 py-1 ${
                                      isRoadmapMessage ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                                    }`}>
                                      <Sparkles size={12} />
                                      {isRoadmapMessage ? roadmapLabel : curriculumLabel}
                                    </div>
                                  )}
                                <ReactMarkdown
                                    components={{
                                      h1: ({ children }) => {
                                        const heading = getPlainText(children).trim();
                                        if (!heading) return null;
                                        if (/^(ロードマップ|Roadmap|カリキュラム|Curriculum|Module|モジュール)$/i.test(heading)) return null;
                                        return (
                                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest mb-3">
                                            {children}
                                          </div>
                                        );
                                      },
                                      h2: ({ children }) => {
                                        const heading = getPlainText(children).trim();
                                        if (!heading) return null;
                                        if (/^(ロードマップ|Roadmap|カリキュラム|Curriculum|Module|モジュール)$/i.test(heading)) return null;
                                        return (
                                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest mb-3">
                                            {children}
                                          </div>
                                        );
                                      },
                                      h3: ({ children }) => {
                                        const heading = getPlainText(children).trim();
                                        if (!heading) return null;
                                        if (/^(ロードマップ|Roadmap|カリキュラム|Curriculum|Module|モジュール)$/i.test(heading)) return null;
                                        return (
                                          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-widest mb-3">
                                            {children}
                                          </div>
                                        );
                                      },
                                      p: ({ children }) => (
                                        <p className="text-sm text-slate-700 leading-relaxed mb-2 last:mb-0">
                                          {children}
                                        </p>
                                      ),
                                      strong: ({ children }) => {
                                        const moduleHeader = (isRoadmapMessage || isCurriculumMessage) ? renderModuleHeaderIfNeeded(children) : null;
                                        if (moduleHeader) return moduleHeader;
                                        return (
                                          <strong className="inline-flex items-center gap-1 text-slate-900 font-semibold">
                                            <span className="text-indigo-500">【</span>
                                            <span>{children}</span>
                                            <span className="text-indigo-500">】</span>
                                          </strong>
                                        );
                                      },
                                      em: ({ children }) => (
                                        <em className="text-slate-600 italic">{children}</em>
                                      ),
                                      ul: ({ children }) =>
                                        isRoadmapMessage
                                          ? renderRoadmapList(children, nextRoadmapStep) || (
                                              <div className="mt-3 space-y-2">{children}</div>
                                            )
                                          : isCurriculumMessage
                                            ? renderCurriculumList(children) || (
                                                <div className="mt-3 space-y-2">{children}</div>
                                              )
                                            : renderCardList(children) || (
                                                <div className="mt-3 space-y-2">{children}</div>
                                              ),
                                      ol: ({ children }) =>
                                        isRoadmapMessage
                                          ? renderRoadmapList(children, nextRoadmapStep) || (
                                              <div className="mt-3 space-y-2">{children}</div>
                                            )
                                          : isCurriculumMessage
                                            ? renderCurriculumList(children) || (
                                                <div className="mt-3 space-y-2">{children}</div>
                                              )
                                            : renderCardList(children) || (
                                                <div className="mt-3 space-y-2">{children}</div>
                                              ),
                                      hr: () => (
                                        <div className="my-4 h-px w-full bg-gradient-to-r from-transparent via-indigo-200 to-transparent" />
                                      ),
                                      code: ({ className, children }) => {
                                        const inline = !className?.includes('language-');
                                        return (
                                        <code
                                          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                                            inline ? 'bg-slate-100 text-slate-700' : 'bg-slate-900 text-slate-100'
                                          }`}
                                        >
                                          {children}
                                        </code>
                                        );
                                      },
                                      blockquote: ({ children }) => (
                                        <div className="mt-3 border-l-4 border-indigo-200 bg-indigo-50/50 text-slate-700 px-3 py-2 rounded-r-xl">
                                          {children}
                                        </div>
                                      )
                                    }}
                                  >
                                    {msg.text}
                                </ReactMarkdown>
                                </>
                              )}
                            </div>
                        </div>
                    )})}
                    
                    {!isGenerating && pendingApproval && pendingApproval !== 'none' && (
                        <div className="mx-0 sm:mx-6 mb-6 animate-in fade-in zoom-in duration-300">
                            <div className="bg-white border border-indigo-100 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
                                <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                                    <BrainCircuit size={16} className="text-indigo-500"/> 
                                    {language === 'jp' ? '承認が必要です' : 'Confirmation Required'}
                                </h3>
                                <p className="text-xs text-slate-500 mb-4">
                                    {language === 'jp' 
                                        ? `上記の内容（${pendingApproval === 'requirements' ? '学習要件' : pendingApproval === 'roadmap' ? 'ロードマップ' : 'カリキュラム'}）を確認してください。このまま進めますか？それとも修正が必要ですか？`
                                        : `Please review the ${pendingApproval} above. Proceed or request changes?`
                                    }
                                </p>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={handleApprove}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:translate-y-0"
                                    >
                                        <ThumbsUp size={14} /> {t.approve}
                                    </button>
                                    <button 
                                        onClick={() => { /* Focus input for revision */ }}
                                        className="flex-1 bg-white border border-slate-200 text-slate-600 py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
                                    >
                                        <ThumbsDown size={14} /> {t.revise}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isGenerating && (
                        <div className="flex flex-col gap-4 mx-0 sm:mx-4">
                            <div className="flex gap-4 animate-pulse">
                                <div className="w-10 h-10 rounded-2xl bg-white border border-indigo-50 flex items-center justify-center text-indigo-400">
                                    <Bot size={20} />
                                </div>
                                <div className="bg-white p-4 rounded-3xl rounded-tl-none border border-slate-100 flex gap-1 items-center shadow-sm">
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                                    <span className="ml-2 text-xs text-slate-400 font-medium">
                                      {waitElapsed >= 10 
                                        ? (language === 'jp' ? `まだ生成中です… (${waitElapsed}秒)` : `Still generating… (${waitElapsed}s)`)
                                        : t.generating}
                                    </span>
                                </div>
                            </div>

                            {/* Agent Logs Animation */}
                            <div className="ml-0 sm:ml-14 space-y-2">
                                {activeLogs.map((log, idx) => (
                                    <div key={idx} className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-500">
                                        <div className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                                            {log.agent}
                                        </div>
                                        <div className="text-[11px] text-slate-500 font-medium">
                                            {log.message}
                                        </div>
                                        <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 sm:p-6 bg-white border-t border-slate-100">
                    {selectedFile && (
                        <div className="mb-3 flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl w-fit animate-in fade-in slide-in-from-bottom-1">
                            <Paperclip size={14} className="text-indigo-500" />
                            <span className="text-xs font-bold text-indigo-700 truncate max-w-[200px]">{selectedFile.name}</span>
                            <button onClick={() => setSelectedFile(null)} className="text-indigo-400 hover:text-indigo-600 transition-colors">
                                <CloseIcon size={14} />
                            </button>
                        </div>
                    )}
                    <div className="flex gap-3 relative items-end min-w-0">
                        <input 
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isGenerating}
                            className="p-3 sm:p-4 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-50"
                        >
                            <Paperclip size={20} />
                        </button>
                        <input 
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={pendingApproval && pendingApproval !== 'none' ? t.revisePlaceholder : t.inputPlaceholder}
                            disabled={isGenerating}
                            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-sm focus:outline-none focus:border-indigo-500 transition-all pr-14 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <button 
                            onClick={() => handleSendMessage()}
                            disabled={(!inputValue.trim() && !selectedFile) || isGenerating}
                            className="absolute right-2 top-2 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="w-full md:w-80 border-l border-slate-100 p-6 sm:p-8 space-y-8 bg-slate-50/50">
                <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Current Engine</h4>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="text-indigo-600"><Zap size={14} /></div>
                            <span className="text-xs font-bold text-slate-700 uppercase">{modelType.replace('gemini-', '')}</span>
                        </div>
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    </div>
                </div>

                <div className="mt-auto pt-10 text-center">
                    <button 
                        onClick={() => {
                            setMessages([{ id: 'reset', role: 'model', text: t.resetMessage, timestamp: new Date() }]);
                            setSessionId(null);
                            setCurriculumId(null);
                            setPendingApproval(null);
                        }}
                        className="text-slate-400 hover:text-indigo-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 mx-auto transition-colors"
                    >
                        <RefreshCw size={12} /> {t.resetChat}
                    </button>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseGeneratorView;
