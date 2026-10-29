import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Zap, BrainCircuit, Loader2, Brain, CheckCircle, ArrowRight, Send, Infinity, User, Bot, RefreshCw, ThumbsUp, ThumbsDown, Paperclip, X as CloseIcon, Palette, LogIn, CloudOff, BookOpen, CalendarClock } from 'lucide-react';
import { GeneratedCourse, ViewState, Message } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { sendAiChat, sendAiDecision, fetchGeneratedCourseById, uploadFile, fetchAiDrafts } from '../../../services/curriculumApi';
import { addLearningEvent } from '../../../services/progressService';
import { dailyLimitKind, dailyLimitResetAt, dailyLimitScope } from '../../../services/aiDailyLimit';
import { aiRefusalOf, type AiRefusal } from '../../../services/safetyApi';
import { AiNotice, AiRefusalNotice } from '../../ui/AiNotice';
import ReactMarkdown from 'react-markdown';

type AiFailure = 'auth' | 'unavailable' | 'daily_limit' | 'paused' | 'upload_limit' | 'upload_paused' | 'upload_too_large' | 'refusal' | 'other';

/** Messages the app wrote itself (the welcome, a restored draft): no AI notice on them. */
const APP_MESSAGE_IDS = new Set(['init', 'restored-draft']);
/** Why the attached file was not sent: today's upload cap, uploads turned off, or too large. */
type UploadNotice = 'limit' | 'paused' | 'too_large';

/** The server's upload limit (server/routes/content.js MAX_UPLOAD_MB); checked here before sending. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The server's limit for a topic or revision message (server/routes/ai.js MESSAGE_MAX_CHARS). */
const MESSAGE_MAX_CHARS = 4000;

// The API client throws plain Errors. A daily cap (429 error_type 'daily_limit_reached') comes first:
// 'embeddings' is the file upload, any other kind is course generation itself; scope 'off' means
// the feature is turned off (no reset time). Then prefer an attached HTTP status; otherwise match
// the messages produced today for 401 (requireAuth on the server) and 503/504 (curriculumApi's
// own wording).
const classifyAiError = (err: unknown): AiFailure => {
  const limitScope = dailyLimitScope(err);
  if (limitScope) {
    if (dailyLimitKind(err) === 'embeddings') return limitScope === 'off' ? 'upload_paused' : 'upload_limit';
    return limitScope === 'off' ? 'paused' : 'daily_limit';
  }
  // Minor safeguards (Phase 0.5): the access gate (403 age_required …, 401 sign_in_required) and
  // the safety screen (422 content_blocked, 503 safety_check_unavailable) get their own card.
  const refusal = aiRefusalOf(err);
  if (refusal?.type === 'access' && refusal.kind === 'sign_in_required') return 'auth';
  if (refusal) return 'refusal';
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 413) return 'upload_too_large';
  if (status === 401 || status === 403) return 'auth';
  if (status === 503 || status === 504) return 'unavailable';
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/authentication required|invalid or expired token|unauthori[sz]ed|\b401\b|ログイン/i.test(message)) return 'auth';
  if (/一時的に利用できません|temporarily unavailable|not configured|service unavailable|\b50[34]\b/i.test(message)) return 'unavailable';
  return 'other';
};

interface CourseGeneratorViewProps {
  onBack: () => void;
  onCourseGenerated: (course: GeneratedCourse) => void;
  onNavigate?: (view: ViewState) => void;
}

const CourseGeneratorView: React.FC<CourseGeneratorViewProps> = ({ onBack, onCourseGenerated, onNavigate }) => {
  const { language } = useLanguage();
  const { user, logout } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeLogs, setActiveLogs] = useState<{agent: string, message: string, status?: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Set when the generation API answers 401 (login required), 503/504 (AI not available) or
  // 429 daily_limit_reached (today's course generation cap until 00:00 JST, or 'paused': turned off).
  const [aiBlocked, setAiBlocked] = useState<'auth' | 'unavailable' | 'daily_limit' | 'paused' | null>(null);
  // When today's cap lifts (reset_at, else the next 00:00 JST): the panel then clears itself.
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);
  // The access gate or the safety screen refused the last call (services/safetyApi.ts aiRefusalOf).
  const [aiRefusal, setAiRefusal] = useState<AiRefusal | null>(null);
  // 'result': the refused call sent no learner text (Approve), so a block is about the AI's stage
  // result and the card must not ask for different words.
  const [refusalVariant, setRefusalVariant] = useState<'ask' | 'result'>('ask');
  const refusalRef = useRef<HTMLDivElement>(null);
  // The blocked panel's body: did the refused message go back into the composer (a send), or was
  // there none (Approve)?
  const [blockedRestored, setBlockedRestored] = useState(false);
  // Read out politely when course generation is available again.
  const [statusMessage, setStatusMessage] = useState('');
  const blockedHeadingRef = useRef<HTMLHeadingElement>(null);
  const blockedPanelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeFileRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next render: the composer input (the panel lifted) or the attached
  // file's remove button (its upload was refused).
  const focusAfterRef = useRef<'input' | 'file' | null>(null);
  const lastAttemptRef = useRef('');
  // The composer stays locked while sending cannot work: no sign-in, or today's cap is reached
  // (until 00:00 JST), or course generation is turned off.
  // An access refusal (age, guardian consent, a safety pause, adults only) locks it too, until
  // the learner has done what its card says.
  const composerLocked = aiBlocked === 'auth' || aiBlocked === 'daily_limit' || aiBlocked === 'paused' || aiRefusal?.type === 'access';
  
  // V2 Flow State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [curriculumId, setCurriculumId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null); // 'requirements' | 'roadmap' | 'curriculum'
  
  // File State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // A file already uploaded for a message that was then refused (a daily cap): it stays attached
  // and goes with that message when it is sent again, without a second upload.
  const [uploadedFile, setUploadedFile] = useState<{ name: string; materialId: string } | null>(null);

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
      demoLabelPython: 'Intro to Python',
      demoLabelArt: 'Art history',
      demoLabelUnity: 'Unity dev',
      missingSession: 'This planning session was lost. Please reset the chat.',
      moduleLabel: 'Module',
      attachFile: 'Attach a file',
      removeFile: 'Remove attached file',
      send: 'Send',
      dismiss: 'Dismiss',
      stepsTitle: 'Planning steps',
      steps: { requirements: 'Requirements', roadmap: 'Roadmap', curriculum: 'Curriculum' },
      authTitle: 'Sign in to generate a curriculum',
      authBody: 'You can keep reading lessons as a guest, but creating a new curriculum needs an account.',
      authBodyExpired: 'Your sign-in has expired. Sign in again to continue planning a curriculum.',
      authAction: 'Sign in',
      authActionAgain: 'Sign in again',
      unavailableTitle: 'AI generation is unavailable right now',
      unavailableBody: 'The AI service could not be reached. Your conversation is kept, so you can try again in a few minutes. The ready-made courses are available meanwhile.',
      retry: 'Try again',
      browseCourses: 'Browse courses',
      dailyLimitTitle: "Today's course generation limit has been reached",
      dailyLimitBody: 'Your conversation and your message are kept here. You can continue after midnight Japan time. The ready-made courses are available meanwhile.',
      pausedTitle: 'Course generation is paused for now',
      pausedBody: 'Your conversation and your message are kept here. The ready-made courses are available meanwhile.',
      dailyLimitBodyKept: 'Your conversation is kept here. You can continue after midnight Japan time. The ready-made courses are available meanwhile.',
      pausedBodyKept: 'Your conversation is kept here. The ready-made courses are available meanwhile.',
      availableAgain: 'Course generation is available again.',
      fileUploaded: 'Uploaded',
      uploadDailyLimit: "Today's limit for file uploads has been reached. Remove the file to keep going, or attach it again after midnight Japan time.",
      uploadPaused: 'File uploads are paused for now. Remove the file to keep going.',
      uploadTooLarge: 'This file is larger than 10 MB. Remove it, or attach a smaller file.',
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
      demoCta: 'デモを開始',
      demoLabelPython: 'Python 入門',
      demoLabelArt: '美術史',
      demoLabelUnity: 'Unity開発',
      missingSession: '作成中のセッション情報が見つかりません。チャットをリセットしてください。',
      moduleLabel: 'モジュール',
      attachFile: 'ファイルを添付',
      removeFile: '添付ファイルを外す',
      send: '送信',
      dismiss: '閉じる',
      stepsTitle: '作成の流れ',
      steps: { requirements: '要件定義', roadmap: 'ロードマップ', curriculum: 'カリキュラム' },
      authTitle: 'カリキュラムの生成にはログインが必要です',
      authBody: 'ゲストのままでも教材は読めますが、新しいカリキュラムを作るにはアカウントが必要です。',
      authBodyExpired: 'ログインの有効期限が切れました。もう一度ログインすると、カリキュラムの作成を続けられます。',
      authAction: 'ログインする',
      authActionAgain: 'もう一度ログイン',
      unavailableTitle: '現在、AIによる生成を利用できません',
      unavailableBody: 'AIサービスに接続できませんでした。会話はそのまま残っているので、数分後にもう一度お試しください。その間も公開中のコースは読めます。',
      retry: 'もう一度試す',
      browseCourses: 'コースを見る',
      dailyLimitTitle: '今日のコース生成は上限に達しました',
      dailyLimitBody: '会話と入力した文はそのまま残っています。日本時間の0時を過ぎたら、続きから作れます。その間も公開中のコースを読めます。',
      pausedTitle: 'コース生成は、今は停止しています',
      pausedBody: '会話と入力した文はそのまま残っています。その間も公開中のコースを読めます。',
      dailyLimitBodyKept: '会話はそのまま残っています。日本時間の0時を過ぎたら、続きから作れます。その間も公開中のコースを読めます。',
      pausedBodyKept: '会話はそのまま残っています。その間も公開中のコースを読めます。',
      availableAgain: 'コース生成を、また使えるようになりました。',
      fileUploaded: 'アップロード済み',
      uploadDailyLimit: '今日のファイルのアップロードは上限に達しました。ファイルを外せば、このまま続けられます。日本時間の0時を過ぎたら、また添付できます。',
      uploadPaused: 'ファイルのアップロードは、今は停止しています。ファイルを外せば、このまま続けられます。',
      uploadTooLarge: 'このファイルは10MBを超えています。ファイルを外すか、小さいファイルを添付してください。',
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

  // The welcome message follows the UI language until the conversation starts.
  useEffect(() => {
    setMessages((prev) => (
      prev.length === 0 || (prev.length === 1 && prev[0].id === 'init')
        ? [{ id: 'init', role: 'model', text: t.initialMessage, timestamp: prev[0]?.timestamp ?? new Date() }]
        : prev
    ));
  }, [t.initialMessage]);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating, pendingApproval, error, aiBlocked, aiRefusal]);

  // The blocked panel takes focus when it appears, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (aiBlocked) blockedHeadingRef.current?.focus();
  }, [aiBlocked]);
  // So does an access refusal (the composer is locked), and a blocked stage result after Approve
  // (nothing was typed); a blocked message or a failed safety check returns focus to the composer
  // instead (focusAfterRef).
  useEffect(() => {
    if (aiRefusal?.type === 'access' || (aiRefusal?.type === 'blocked' && refusalVariant === 'result')) refusalRef.current?.focus();
  }, [aiRefusal, refusalVariant]);

  // Today's cap lifts at 00:00 JST: unlock the composer then (the restored message is still in it),
  // say so politely, and move focus to the input when it was on the panel (or nowhere).
  useEffect(() => {
    if (aiBlocked !== 'daily_limit' || blockedUntil === null) return undefined;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body || blockedPanelRef.current?.contains(active)) focusAfterRef.current = 'input';
      setAiBlocked(null);
      setBlockedUntil(null);
      setStatusMessage(t.availableAgain);
    }, Math.min(Math.max(0, blockedUntil - Date.now()), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [aiBlocked, blockedUntil, t.availableAgain]);

  // Focus requested above (or by a refused upload) once the target is on screen and enabled.
  useEffect(() => {
    if (!focusAfterRef.current || isGenerating || composerLocked) return;
    const target = focusAfterRef.current === 'file' ? removeFileRef.current ?? inputRef.current : inputRef.current;
    focusAfterRef.current = null;
    target?.focus();
  }, [aiBlocked, isGenerating, uploadNotice, composerLocked]);

  const handleSendMessage = async (text?: string) => {
    if (composerLocked) return;
    const msgText = text || inputValue;
    if (!msgText.trim() && !selectedFile && !uploadedFile) return;
    if (isGenerating) return;
    // Too large for the server (413): say so here, before anything is sent or charged.
    if (selectedFile && selectedFile.size > MAX_UPLOAD_BYTES) {
      focusAfterRef.current = 'file';
      setUploadNotice('too_large');
      return;
    }

    const isRevision = pendingApproval !== null && pendingApproval !== 'none';
    const fileName = selectedFile?.name ?? uploadedFile?.name;
    
    const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text: fileName ? `${msgText} (Attached: ${fileName})`.trim() : msgText,
        timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsGenerating(true);
    setActiveLogs([]); 
    setError(null);
    setAiBlocked(null);
    setAiRefusal(null);
    setUploadNotice(null);
    setStatusMessage('');
    lastAttemptRef.current = msgText;
    const attempt = { text: msgText, userMsgId: userMsg.id };

    try {
        let attachments: any[] = [];
        let uploaded = uploadedFile;
        if (selectedFile) {
            const uploadRes = await uploadFile(selectedFile);
            uploaded = { name: selectedFile.name, materialId: uploadRes.material_id };
            // Kept until the message is sent: a refused send keeps the file without a new upload.
            setUploadedFile(uploaded);
            setSelectedFile(null);
        }
        if (uploaded) attachments.push({ material_id: uploaded.materialId });

        let response;
        if (isRevision && curriculumId && sessionId && pendingApproval) {
            response = await sendAiDecision(curriculumId, sessionId, pendingApproval, 'revise', msgText);
        } else {
            response = await sendAiChat(msgText, sessionId || undefined, attachments);
        }
        setUploadedFile(null);

        await handleApiResponse(response);

    } catch (err) {
        handleAiFailure(err, attempt);
    }
  };

  /**
   * `attempt`: the message that failed. When nothing was generated for it (a daily cap, a refused
   * upload), its bubble is taken back and its text returns to the composer for later.
   */
  const handleAiFailure = (err: unknown, attempt?: { text: string; userMsgId: string }) => {
    const failure = classifyAiError(err);
    const restoreAttempt = () => {
      if (!attempt) return;
      setMessages((prev) => prev.filter((m) => m.id !== attempt.userMsgId));
      setInputValue(attempt.text);
    };
    if (failure === 'refusal') {
      const refusal = aiRefusalOf(err);
      setAiRefusal(refusal);
      setRefusalVariant(attempt ? 'ask' : 'result');
      if (refusal?.type === 'blocked') {
        // Nothing usable came back: take the bubble back, but do not put blocked words back in
        // the composer; the card asks for different words. After Approve nothing was typed: the
        // card says the result was held back, and takes focus itself (effect above).
        if (attempt) {
          setMessages((prev) => prev.filter((m) => m.id !== attempt.userMsgId));
          focusAfterRef.current = 'input';
        }
      } else if (refusal?.type === 'check_unavailable') {
        // The message itself was fine: it goes back into the composer to send again later.
        restoreAttempt();
        focusAfterRef.current = 'input';
      } else restoreAttempt();
    } else if (failure === 'other') setError(t.errorChat);
    // The upload was refused before anything was generated: selectedFile stays attached, so the
    // learner can remove it (focus goes to its remove button) and send again.
    else if (failure === 'upload_limit' || failure === 'upload_paused' || failure === 'upload_too_large') {
      focusAfterRef.current = 'file';
      setUploadNotice(failure === 'upload_limit' ? 'limit' : failure === 'upload_paused' ? 'paused' : 'too_large');
      restoreAttempt();
    } else if (failure === 'daily_limit' || failure === 'paused') {
      setBlockedUntil(failure === 'daily_limit' ? dailyLimitResetAt(err) : null);
      setBlockedRestored(Boolean(attempt));
      setAiBlocked(failure);
      restoreAttempt();
    } else setAiBlocked(failure);
    setIsGenerating(false);
  };

  const handleApprove = async () => {
    if (composerLocked || isGenerating) return;
    if (!curriculumId || !sessionId || !pendingApproval) {
        setError(t.missingSession);
        return;
    }
    
    setIsGenerating(true);
    setActiveLogs([]); 
    setAiBlocked(null);
    setAiRefusal(null);
    try {
        const response = await sendAiDecision(curriculumId, sessionId, pendingApproval, 'approved');
        await handleApiResponse(response);
    } catch (err) {
        handleAiFailure(err);
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
        <div className="eyebrow text-indigo-600 mb-1">{t.moduleLabel}</div>
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
                    {messages.length === 1 && !isGenerating && !composerLocked && (
                        <div className="flex flex-col items-center justify-center h-full space-y-6 animate-in fade-in zoom-in duration-500">
                            <div className="text-center max-w-lg">
                                <p className="text-slate-600 text-sm mb-8 font-medium">
                                    {language === 'jp' 
                                        ? '学習したいテーマを選択して、AIエージェントによるカリキュラム生成プロセスを体験してください。' 
                                        : 'Choose a topic to see how AI agents collaborate to build your curriculum.'}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {[
                                        { id: 'python', prompt: t.demoPromptPython, icon: <Zap size={18} aria-hidden="true" />, color: 'border-blue-500 text-blue-600', label: t.demoLabelPython },
                                        { id: 'art', prompt: t.demoPromptArt, icon: <Palette size={18} aria-hidden="true" />, color: 'border-orange-500 text-orange-700', label: t.demoLabelArt },
                                        { id: 'unity', prompt: t.demoPromptUnity, icon: <Brain size={18} aria-hidden="true" />, color: 'border-indigo-500 text-indigo-600', label: t.demoLabelUnity }
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

                    {messages.map((msg, msgIndex) => {
                        const text = msg.text || '';
                        const previous = messages[msgIndex - 1];
                        const showAiNotice = msg.role === 'model' && !APP_MESSAGE_IDS.has(msg.id) && Boolean(text.trim());
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
                                {showAiNotice && (
                                  <AiNotice
                                    surface="course_generation"
                                    answer={text}
                                    question={previous?.role === 'user' ? previous.text : undefined}
                                    context={curriculumId ? { courseId: curriculumId } : undefined}
                                    className="mt-3 border-t border-line pt-2"
                                  />
                                )}
                                </>
                              )}
                            </div>
                        </div>
                    )})}

                    {/* Error Banner */}
                    {error && (
                        <div role="alert" className="mx-0 sm:mx-6 mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                            <CloseIcon className="text-red-500 shrink-0" size={20} aria-hidden="true" />
                            <p className="text-xs font-bold text-red-600">{error}</p>
                            <button type="button" aria-label={t.dismiss} onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
                                <CloseIcon size={16} aria-hidden="true" />
                            </button>
                        </div>
                    )}

                    {/* Access gate or safety screen (Phase 0.5): what is needed, or a calm note. */}
                    {aiRefusal && (
                        <div ref={refusalRef} tabIndex={-1} className="mx-0 sm:mx-6 mb-4 focus:outline-none" data-ai-refusal-panel="">
                            <AiRefusalNotice refusal={aiRefusal} variant={refusalVariant} onSignIn={() => { void logout({ reason: 'reauth' }); }} />
                        </div>
                    )}

                    {/* Login required / AI unavailable / today's generation cap reached / turned off */}
                    {aiBlocked && (
                        <div ref={blockedPanelRef} role="alert" className="mx-0 sm:mx-6 mb-4 rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-sm animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-start gap-4">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${aiBlocked === 'auth' ? 'bg-primary-soft text-primary-text' : 'bg-sunken text-fg-2'}`}>
                                    {aiBlocked === 'auth'
                                        ? <LogIn size={20} aria-hidden="true" />
                                        : aiBlocked === 'daily_limit' || aiBlocked === 'paused'
                                            ? <CalendarClock size={20} aria-hidden="true" />
                                            : <CloudOff size={20} aria-hidden="true" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 ref={blockedHeadingRef} tabIndex={-1} className="text-base font-bold text-fg mb-1 focus:outline-none">
                                        {aiBlocked === 'auth'
                                            ? t.authTitle
                                            : aiBlocked === 'daily_limit' ? t.dailyLimitTitle
                                            : aiBlocked === 'paused' ? t.pausedTitle : t.unavailableTitle}
                                    </h2>
                                    <p className="text-sm text-fg-2 leading-relaxed">
                                        {aiBlocked === 'auth'
                                            ? (user && !user.isGuest ? t.authBodyExpired : t.authBody)
                                            : aiBlocked === 'daily_limit' ? (blockedRestored ? t.dailyLimitBody : t.dailyLimitBodyKept)
                                            : aiBlocked === 'paused' ? (blockedRestored ? t.pausedBody : t.pausedBodyKept) : t.unavailableBody}
                                    </p>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {aiBlocked === 'daily_limit' || aiBlocked === 'paused' ? null : aiBlocked === 'auth' ? (
                                            <button
                                                type="button"
                                                onClick={() => { void logout({ reason: 'reauth' }); }}
                                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-hover transition-colors"
                                            >
                                                <LogIn size={16} aria-hidden="true" />
                                                {user && !user.isGuest ? t.authActionAgain : t.authAction}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    focusAfterRef.current = 'input';
                                                    setAiBlocked(null);
                                                    setInputValue(lastAttemptRef.current);
                                                }}
                                                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-hover transition-colors"
                                            >
                                                <RefreshCw size={16} aria-hidden="true" />
                                                {t.retry}
                                            </button>
                                        )}
                                        {onNavigate && (
                                            <button
                                                type="button"
                                                onClick={() => onNavigate(ViewState.COURSES)}
                                                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-bold text-fg-2 hover:bg-sunken transition-colors"
                                            >
                                                <BookOpen size={16} aria-hidden="true" />
                                                {t.browseCourses}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    
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
                                    {/* Off while generation is locked (a daily cap, paused, sign-in): approving runs the next stage. */}
                                    <button 
                                        type="button"
                                        onClick={handleApprove}
                                        disabled={composerLocked}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                        <ThumbsUp size={14} /> {t.approve}
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => { /* Focus input for revision */ }}
                                        disabled={composerLocked}
                                        className="flex-1 bg-white border border-slate-200 text-slate-600 py-3 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
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
                    {/* The attached file was not sent: a neutral note next to it, not a failure banner. */}
                    {uploadNotice && (
                        <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-line bg-sunken px-4 py-3 text-sm text-fg-2">
                            {uploadNotice === 'too_large'
                                ? <Paperclip size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                : <CalendarClock size={16} aria-hidden="true" className="mt-0.5 shrink-0" />}
                            <span>{uploadNotice === 'limit' ? t.uploadDailyLimit : uploadNotice === 'paused' ? t.uploadPaused : t.uploadTooLarge}</span>
                        </p>
                    )}
                    {(selectedFile || uploadedFile) && (
                        <div className="mb-3 flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl w-fit animate-in fade-in slide-in-from-bottom-1">
                            <Paperclip size={14} className="text-indigo-500" />
                            <span className="text-xs font-bold text-indigo-700 truncate max-w-[200px]">{selectedFile?.name ?? uploadedFile?.name}</span>
                            {!selectedFile && uploadedFile && (
                                <span className="flex items-center gap-1 text-xs text-indigo-700">
                                    <CheckCircle size={12} aria-hidden="true" />
                                    {t.fileUploaded}
                                </span>
                            )}
                            <button
                                ref={removeFileRef}
                                type="button"
                                aria-label={t.removeFile}
                                onClick={() => {
                                    setSelectedFile(null);
                                    setUploadedFile(null);
                                    setUploadNotice(null);
                                    // The chip and its button go away: keep focus in the composer (or on the panel).
                                    const input = inputRef.current;
                                    (input && !input.disabled ? input : blockedHeadingRef.current)?.focus();
                                }}
                                className="text-indigo-500 hover:text-indigo-700 transition-colors"
                            >
                                <CloseIcon size={14} aria-hidden="true" />
                            </button>
                        </div>
                    )}
                    <div className="flex gap-3 relative items-end min-w-0">
                        <input 
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={(e) => {
                                setSelectedFile(e.target.files?.[0] || null);
                                setUploadedFile(null);
                                setUploadNotice(null);
                                // The same file can be picked again after it was removed.
                                e.target.value = '';
                            }}
                        />
                        <button 
                            type="button"
                            aria-label={t.attachFile}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isGenerating || composerLocked}
                            className="p-3 sm:p-4 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-50"
                        >
                            <Paperclip size={20} aria-hidden="true" />
                        </button>
                        <input 
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={pendingApproval && pendingApproval !== 'none' ? t.revisePlaceholder : t.inputPlaceholder}
                            aria-label={pendingApproval && pendingApproval !== 'none' ? t.revisePlaceholder : t.inputPlaceholder}
                            maxLength={MESSAGE_MAX_CHARS}
                            disabled={isGenerating || composerLocked}
                            className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-sm focus:outline-none focus:border-indigo-500 transition-all pr-14 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                        <button 
                            type="button"
                            aria-label={t.send}
                            onClick={() => handleSendMessage()}
                            disabled={(!inputValue.trim() && !selectedFile && !uploadedFile) || isGenerating || composerLocked}
                            className="absolute right-2 top-2 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500 transition-all"
                        >
                            <Send size={20} aria-hidden="true" />
                        </button>
                    </div>
                    <p className="sr-only" role="status">{statusMessage}</p>
                </div>
            </div>

            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-100 p-4 sm:p-6 md:p-8 space-y-8 bg-slate-50/50">
                <div className="hidden md:block space-y-3">
                    <p className="eyebrow text-fg-3">{t.stepsTitle}</p>
                    <ol className="space-y-2">
                        {(['requirements', 'roadmap', 'curriculum'] as const).map((step, index) => {
                            const isCurrent = pendingApproval === step;
                            return (
                                <li
                                    key={step}
                                    aria-current={isCurrent ? 'step' : undefined}
                                    className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${isCurrent ? 'border-indigo-200 bg-indigo-50 text-indigo-700 font-bold' : 'border-slate-200 bg-white text-fg-2'}`}
                                >
                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold tabular ${isCurrent ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-fg-2'}`}>{index + 1}</span>
                                    {t.steps[step]}
                                </li>
                            );
                        })}
                    </ol>
                </div>

                <div className="md:mt-auto md:pt-10 text-center">
                    <button 
                        type="button"
                        onClick={() => {
                            setMessages([{ id: 'reset', role: 'model', text: t.resetMessage, timestamp: new Date() }]);
                            setSessionId(null);
                            setCurriculumId(null);
                            setPendingApproval(null);
                            setAiBlocked(null);
                            setBlockedUntil(null);
                            setUploadNotice(null);
                            setUploadedFile(null);
                            setStatusMessage('');
                        }}
                        className="text-fg-3 hover:text-indigo-600 text-xs font-bold uppercase tracking-widest flex items-center gap-2 mx-auto transition-colors"
                    >
                        <RefreshCw size={12} aria-hidden="true" /> {t.resetChat}
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
