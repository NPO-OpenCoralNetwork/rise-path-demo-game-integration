import React, { useState, useEffect, useRef } from 'react';
import { getLessonForCourse } from '../../services/curriculumData';
import { analyzeWriting, toLlmLocale } from '../../services/llmApi';
import { addLearningEvent } from '../../services/progressService';
import { dailyLimitScope } from '../../services/aiDailyLimit';
import { aiRefusalOf, type AiRefusal } from '../../services/safetyApi';
import { AiNotice, AiRefusalNotice } from '../ui/AiNotice';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AnalysisResult } from '../../types';
import {
  X, ChevronRight, Check, RefreshCw, PenTool, Sparkles, ArrowRight, Mic, StopCircle, Volume2, MessageSquare
} from 'lucide-react';

interface LessonViewProps {
  onBack: () => void;
  courseId?: string;
}

type Step = 'INTRO' | 'DRAFT' | 'ANALYZING' | 'FEEDBACK' | 'REFINE' | 'ROLEPLAY' | 'COMPLETE';

/** The server's daily caps (429 daily_limit_reached, services/aiDailyLimit.ts) by scope. */
type AnalysisError = 'failed' | 'daily_limit' | 'daily_limit_guest' | 'paused';

const analysisErrorFor = (error: unknown): AnalysisError => {
  const scope = dailyLimitScope(error);
  if (!scope) return 'failed';
  if (scope === 'guest') return 'daily_limit_guest';
  return scope === 'off' ? 'paused' : 'daily_limit';
};

/** A guest's draft survives "Sign in" (which ends the guest session) in this tab. */
const draftKey = (courseId?: string) => `rp:writingDraft:${courseId || 'default'}`;
const takeSavedDraft = (courseId?: string): string => {
  try {
    const saved = sessionStorage.getItem(draftKey(courseId)) ?? '';
    sessionStorage.removeItem(draftKey(courseId));
    return saved;
  } catch {
    return '';
  }
};

const LessonView: React.FC<LessonViewProps> = ({ onBack, courseId }) => {
  const [step, setStep] = useState<Step>('INTRO');
  const [draft, setDraft] = useState(() => takeSavedDraft(courseId));
  const [refinedDraft, setRefinedDraft] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<AnalysisError | null>(null);
  // The access gate or the safety screen refused the analysis (Phase 0.5): its own card.
  const [analysisRefusal, setAnalysisRefusal] = useState<AiRefusal | null>(null);
  const { language } = useLanguage();
  const { logout } = useAuth();

  const copy = {
    en: {
      failed: 'We could not analyze your text right now. Your draft is saved here; please try again in a moment.',
      daily_limit: "Today's limit for AI feedback has been reached. Your draft is saved here; please try again after midnight Japan time.",
      daily_limit_guest: "Today's limit for guest AI feedback has been reached. Your draft is saved here. Sign in to keep getting feedback.",
      paused: 'AI feedback is paused for now. Your draft is saved here.',
      signIn: 'Sign in',
      feedbackTitle: 'AI feedback',
      coachTitle: "Coach's feedback",
      refinedTitle: 'Suggested rewrite',
      finalTitle: 'Final polish',
      finalHint: 'Edit your text to use the feedback.',
      practiceSpeaking: 'Practice speaking',
      skipSpeaking: 'Skip speaking',
      scoresLabel: 'Scores (out of 100)',
      scores: { clarity: 'Clarity', linking: 'Linking', tone: 'Tone' },
      thinking: 'AI is thinking…',
      analyzing: 'Reading your text…',
    },
    jp: {
      failed: '今は文章を分析できませんでした。下書きはそのまま残っています。少し待ってからもう一度お試しください。',
      daily_limit: '今日のAIフィードバックは上限に達しました。下書きはそのまま残っています。日本時間の0時を過ぎたら、もう一度お試しください。',
      daily_limit_guest: 'ゲストのAIフィードバックは、今日の上限に達しました。下書きはそのまま残っています。ログインすると、続けてフィードバックを受けられます。',
      paused: 'AIフィードバックは、今は停止しています。下書きはそのまま残っています。',
      signIn: 'ログイン',
      feedbackTitle: 'AIのフィードバック',
      coachTitle: 'コーチからのアドバイス',
      refinedTitle: '書き直しの例',
      finalTitle: '仕上げ',
      finalHint: 'アドバイスを生かして、文章を直してみましょう。',
      practiceSpeaking: '声に出して練習する',
      skipSpeaking: '声の練習をとばす',
      scoresLabel: 'スコア（100点中）',
      scores: { clarity: 'わかりやすさ', linking: 'つながり', tone: 'ことばの調子' },
      thinking: 'AIが考えています…',
      analyzing: '文章を読んでいます…',
    },
  } as const;
  const t = copy[language];

  const signIn = () => {
    try {
      sessionStorage.setItem(draftKey(courseId), draft);
    } catch {
      // Storage blocked: sign-in still works; the draft is not kept.
    }
    void logout();
  };

  const lesson = getLessonForCourse(courseId || '');

  const handleAnalyze = async () => {
    setStep('ANALYZING');
    setAnalysisError(null);
    setAnalysisRefusal(null);
    try {
      const result = await analyzeWriting(draft, lesson.rubric, {
        locale: toLlmLocale(language),
        lessonTitle: lesson.title,
        goal: lesson.goal,
      });
      setAnalysis(result);
      setRefinedDraft(result.refinedVersion);
      setStep('FEEDBACK');
    } catch (error) {
      console.error('Writing analysis failed:', error);
      const refusal = aiRefusalOf(error);
      if (refusal) setAnalysisRefusal(refusal);
      else setAnalysisError(analysisErrorFor(error));
      setStep('DRAFT');
    }
  };

  const handleStartRoleplay = () => {
    setStep('ROLEPLAY');
  };

  const handleComplete = () => {
    setStep('COMPLETE');
    addLearningEvent({
      type: 'lesson_complete',
      title: { en: `Completed: ${lesson.title}`, jp: `完了: ${lesson.title}` },
      description: { en: lesson.goal, jp: lesson.goal },
    });
  };

  // --- SUB-COMPONENTS FOR STEPS ---

  const IntroView = () => (
    <div className="max-w-2xl mx-auto py-8 px-6">
      <div className="text-center mb-8">
        <span className="text-indigo-600 font-bold tracking-wider text-sm uppercase">Today's Focus</span>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">{lesson.title}</h1>
        <p className="text-slate-500 mt-2 text-lg">{lesson.goal}</p>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 mb-8">
        <h3 className="font-bold text-indigo-900 mb-4 flex items-center gap-2">
          <Sparkles size={18} /> Recommended Templates
        </h3>
        <div className="space-y-3">
          {lesson.templates.map(t => (
            <div key={t.id} className="bg-white p-3 rounded-xl border border-indigo-100 shadow-sm">
              <p className="font-medium text-slate-800 font-mono text-sm">{t.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8">
        <h3 className="font-bold text-slate-900 mb-2">Task</h3>
        <p className="text-slate-600">{lesson.tasks[0].prompt}</p>
      </div>

      <button 
        onClick={() => setStep('DRAFT')}
        className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
      >
        Start Writing <ArrowRight size={20} />
      </button>
    </div>
  );

  const DraftView = () => (
    <div className="max-w-3xl mx-auto py-6 px-6 h-full flex flex-col">
      <div className="mb-4 flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-900">Draft Your Thoughts</h2>
        <button onClick={() => setStep('INTRO')} className="text-sm text-indigo-600 hover:underline">View Templates</button>
      </div>
      
      <div className="flex-1 relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="I'm interested in exploring how..."
          className="w-full h-full p-6 text-lg leading-relaxed bg-white border-2 border-slate-200 rounded-2xl focus:border-indigo-500 focus:ring-0 resize-none outline-none transition-all"
          autoFocus
        />
        <div className="absolute bottom-4 right-4 text-xs text-slate-400 font-bold uppercase">
          {draft.length} chars
        </div>
      </div>

      {analysisRefusal && (
        <AiRefusalNotice refusal={analysisRefusal} onSignIn={signIn} className="mt-4" />
      )}

      {analysisError && (
        <p role="alert" className="mt-4 rounded-control border border-line bg-sunken px-4 py-3 text-small text-fg-2">
          {t[analysisError]}
          {analysisError === 'daily_limit_guest' && (
            <>
              {' '}
              <button type="button" onClick={signIn} className="font-semibold underline underline-offset-2">
                {t.signIn}
              </button>
            </>
          )}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button 
          onClick={handleAnalyze}
          disabled={draft.length < 20}
          className={`px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all
            ${draft.length < 20 
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md'}
          `}
        >
          Analyze <Sparkles size={18} />
        </button>
      </div>
    </div>
  );

  // Writing feedback from the AI (/llm/writing-feedback), with the AI disclosure and report.
  const FeedbackView = () => {
    const answer = [analysis?.feedback, analysis?.refinedVersion].filter(Boolean).join('\n\n');
    return (
      <div className="mx-auto grid h-full max-w-4xl grid-cols-1 gap-8 overflow-y-auto px-6 py-8 md:grid-cols-2">
        <section className="space-y-6" aria-labelledby="writing-feedback-title">
          <h2 id="writing-feedback-title" className="text-h2 text-fg">{t.feedbackTitle}</h2>

          <dl className="grid grid-cols-3 gap-3" aria-label={t.scoresLabel}>
            <ScoreCard label={t.scores.clarity} score={analysis?.clarityScore || 0} />
            <ScoreCard label={t.scores.linking} score={analysis?.linkingScore || 0} />
            <ScoreCard label={t.scores.tone} score={analysis?.toneScore || 0} />
          </dl>

          <div className="rounded-card border border-line bg-surface p-5">
            <h3 className="mb-2 flex items-center gap-2 text-body font-semibold text-fg">
              <Sparkles size={18} aria-hidden="true" className="text-primary-text" /> {t.coachTitle}
            </h3>
            <p className="whitespace-pre-wrap text-body leading-relaxed text-fg-2">{analysis?.feedback}</p>
          </div>

          <div>
            <h3 className="mb-3 text-small font-semibold text-fg-2">{t.refinedTitle}</h3>
            <div className="rounded-card border border-line border-l-4 border-l-primary bg-surface p-5">
              <p className="whitespace-pre-wrap text-body leading-relaxed text-fg">{analysis?.refinedVersion}</p>
            </div>
          </div>

          {answer && (
            <AiNotice
              surface="writing_feedback"
              answer={answer}
              question={draft}
              context={courseId ? { courseId } : undefined}
            />
          )}
        </section>

        <div className="flex h-full flex-col">
          <h2 className="mb-6 text-h2 text-fg">{t.finalTitle}</h2>
          <label htmlFor="writing-final-text" className="mb-2 text-small text-fg-2">{t.finalHint}</label>
          <textarea
            id="writing-final-text"
            value={refinedDraft}
            onChange={(e) => setRefinedDraft(e.target.value)}
            className="mb-6 w-full flex-1 resize-none rounded-card border-2 border-line bg-surface p-5 text-lg leading-relaxed text-fg focus:border-primary"
          />
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleStartRoleplay}
              className="flex w-full items-center justify-center gap-2 rounded-control bg-primary py-4 text-lg font-bold text-on-primary shadow-1 transition-colors hover:bg-primary-hover"
            >
              {t.practiceSpeaking} <Mic size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleComplete}
              className="flex w-full items-center justify-center gap-2 rounded-control border border-line bg-surface py-3 text-small font-bold text-fg-2 transition-colors hover:bg-sunken"
            >
              {t.skipSpeaking}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const RoleplayView = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [audioData, setAudioData] = useState<number[]>(new Array(20).fill(10));
    const [transcript, setTranscript] = useState("");
    const [showResult, setShowResult] = useState(false);
    
    // Simulate audio visualizer
    useEffect(() => {
      let interval: ReturnType<typeof setInterval>;
      if (isRecording) {
        interval = setInterval(() => {
          setAudioData(prev => prev.map(() => Math.random() * 40 + 10));
        }, 100);
      } else {
        setAudioData(new Array(20).fill(5));
      }
      return () => clearInterval(interval);
    }, [isRecording]);

    const toggleRecording = () => {
      if (isRecording) {
        setIsRecording(false);
        // Simulate processing delay then show result
        setTimeout(() => {
          setTranscript(refinedDraft); // In real app, this would be STT result
          setShowResult(true);
        }, 1000);
      } else {
        setIsRecording(true);
        setShowResult(false);
      }
    };

    if (showResult) {
      return (
        <div className="max-w-2xl mx-auto py-8 px-6 text-center h-full flex flex-col items-center justify-center">
           <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6">
              <Check size={40} />
           </div>
           <h2 className="text-2xl font-bold text-slate-900 mb-2">Excellent Pronunciation!</h2>
           <p className="text-slate-500 mb-8">You sounded confident and the linking words were clear.</p>
           
           <div className="bg-slate-50 p-6 rounded-2xl w-full text-left mb-8 border border-slate-200">
             <div className="text-xs font-bold text-slate-400 uppercase mb-2">Transcript</div>
             <p className="text-lg text-slate-800">"{transcript}"</p>
           </div>

           <button 
             onClick={handleComplete}
             className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg"
           >
             Finish Lesson
           </button>
           <button 
             onClick={() => setShowResult(false)}
             className="mt-4 text-slate-500 font-medium hover:text-slate-800"
           >
             Try Again
           </button>
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto py-8 px-6 h-full flex flex-col">
        <div className="text-center mb-12">
           <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Roleplay Mode</span>
           <h2 className="text-3xl font-bold text-slate-900 mt-4">Read your refined text aloud</h2>
           <p className="text-slate-500 mt-2">Imagine you are explaining this to a colleague.</p>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center">
           {/* Visualizer */}
           <div className="h-32 flex items-center justify-center gap-1 mb-12">
             {audioData.map((height, i) => (
               <div 
                 key={i} 
                 className={`w-2 rounded-full transition-all duration-100 ${isRecording ? 'bg-indigo-500' : 'bg-slate-200'}`}
                 style={{ height: `${height}px` }}
               />
             ))}
           </div>

           {/* Mic Button */}
           <button 
             onClick={toggleRecording}
             className={`
               w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl
               ${isRecording 
                 ? 'bg-red-500 text-white scale-110 ring-4 ring-red-100' 
                 : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 ring-4 ring-indigo-100'}
             `}
           >
             {isRecording ? <StopCircle size={40} /> : <Mic size={40} />}
           </button>
           
           <p className="mt-8 text-slate-400 font-medium">
             {isRecording ? "Listening..." : "Tap to start recording"}
           </p>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-xl mt-8 opacity-60 hover:opacity-100 transition-opacity">
           <p className="text-center text-slate-800 font-medium">"{refinedDraft}"</p>
        </div>
      </div>
    );
  };

  // A score on the feedback card: the number and its label (no colour coding).
  const ScoreCard = ({ label, score }: { label: string, score: number }) => (
    <div className="rounded-card border border-line bg-surface p-4 text-center">
      <dt className="text-small font-semibold text-fg-2">{label}</dt>
      <dd className="text-h2 font-bold text-fg tabular">{score}</dd>
    </div>
  );

  const CompleteView = () => (
    <div className="max-w-xl mx-auto py-12 px-6 text-center">
       <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center text-green-600 mx-auto mb-6 animate-bounce">
          <Check size={48} strokeWidth={4} />
       </div>
       <h1 className="text-3xl font-bold text-slate-900 mb-4">Lesson Complete!</h1>
       <p className="text-slate-500 mb-8 text-lg">You've successfully practiced connecting your thoughts and speaking them out loud.</p>
       
       <button 
        onClick={onBack}
        className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-slate-800 transition-colors"
       >
         Back to Dashboard
       </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 md:bg-white">
      {/* Header */}
      <div className="bg-white px-6 py-4 flex items-center justify-between border-b border-slate-100 sticky top-0 z-10 shrink-0">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-600">
          <X size={24} />
        </button>
        <div className="flex items-center gap-2">
           {['INTRO', 'DRAFT', 'FEEDBACK', 'ROLEPLAY', 'COMPLETE'].map((s, i) => {
             const currentIdx = ['INTRO', 'DRAFT', 'ANALYZING', 'FEEDBACK', 'REFINE', 'ROLEPLAY', 'COMPLETE'].indexOf(step);
             const thisIdx = ['INTRO', 'DRAFT', 'FEEDBACK', 'ROLEPLAY', 'COMPLETE'].indexOf(s);
             const active = currentIdx >= thisIdx;
             return (
               <div key={s} className={`w-2 h-2 rounded-full ${active ? 'bg-indigo-600' : 'bg-slate-200'}`} />
             );
           })}
        </div>
        <div className="text-sm font-bold text-slate-400">
          {step === 'ANALYZING' ? t.thinking : step}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {step === 'INTRO' && <IntroView />}
        {/* Called, not mounted as <DraftView />: these are recreated on every render, and as
            components they would remount (losing the field's focus and the report dialog). */}
        {step === 'DRAFT' && DraftView()}
        {step === 'ANALYZING' && (
          <div role="status" className="flex h-full flex-col items-center justify-center text-primary-text">
            <RefreshCw size={48} aria-hidden="true" className="mb-4 motion-safe:animate-spin" />
            <p className="font-medium motion-safe:animate-pulse">{t.analyzing}</p>
          </div>
        )}
        {(step === 'FEEDBACK' || step === 'REFINE') && FeedbackView()}
        {step === 'ROLEPLAY' && <RoleplayView />}
        {step === 'COMPLETE' && <CompleteView />}
      </div>
    </div>
  );
};

export default LessonView;