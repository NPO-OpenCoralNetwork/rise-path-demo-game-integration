import React, { useState, useEffect, useRef } from 'react';
import { getLessonForCourse } from '../../services/curriculumData';
import { analyzeWriting } from '../../services/geminiService';
import { addLearningEvent } from '../../services/progressService';
import { AnalysisResult } from '../../types';
import {
  X, ChevronRight, Check, RefreshCw, PenTool, Sparkles, ArrowRight, Mic, StopCircle, Volume2, MessageSquare
} from 'lucide-react';

interface LessonViewProps {
  onBack: () => void;
  courseId?: string;
}

type Step = 'INTRO' | 'DRAFT' | 'ANALYZING' | 'FEEDBACK' | 'REFINE' | 'ROLEPLAY' | 'COMPLETE';

const LessonView: React.FC<LessonViewProps> = ({ onBack, courseId }) => {
  const [step, setStep] = useState<Step>('INTRO');
  const [draft, setDraft] = useState('');
  const [refinedDraft, setRefinedDraft] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  const lesson = getLessonForCourse(courseId || '');

  const handleAnalyze = async () => {
    setStep('ANALYZING');
    const result = await analyzeWriting(draft, lesson.rubric);
    setAnalysis(result);
    setRefinedDraft(result.refinedVersion);
    setStep('FEEDBACK');
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

  const FeedbackView = () => (
    <div className="max-w-4xl mx-auto py-8 px-6 grid grid-cols-1 md:grid-cols-2 gap-8 h-full overflow-y-auto">
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">AI Analysis</h2>
        
        {/* Scores */}
        <div className="grid grid-cols-3 gap-3">
          <ScoreCard label="Clarity" score={analysis?.clarityScore || 0} />
          <ScoreCard label="Linking" score={analysis?.linkingScore || 0} />
          <ScoreCard label="Tone" score={analysis?.toneScore || 0} />
        </div>

        {/* Feedback Text */}
        <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-2xl">
          <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <Sparkles size={18} /> Coach's Feedback
          </h3>
          <p className="text-indigo-800 leading-relaxed">
            {analysis?.feedback}
          </p>
        </div>

        {/* Comparison */}
        <div>
           <h3 className="font-bold text-slate-500 text-sm uppercase tracking-wider mb-3">Suggested Refinement</h3>
           <div className="bg-white border border-green-200 p-5 rounded-2xl shadow-sm relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
             <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{analysis?.refinedVersion}</p>
           </div>
        </div>
      </div>

      <div className="flex flex-col h-full">
         <h2 className="text-2xl font-bold text-slate-900 mb-6">Final Polish</h2>
         <p className="text-slate-500 mb-2 text-sm">Edit your text to incorporate the feedback.</p>
         <textarea 
            value={refinedDraft}
            onChange={(e) => setRefinedDraft(e.target.value)}
            className="flex-1 w-full p-5 bg-white border-2 border-slate-200 rounded-2xl focus:border-green-500 outline-none resize-none text-lg leading-relaxed mb-6"
         />
         <div className="space-y-3">
            <button 
              onClick={handleStartRoleplay}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
            >
              Practice Speaking <Mic size={20} />
            </button>
            <button 
              onClick={handleComplete}
              className="w-full bg-white text-slate-600 border border-slate-200 py-3 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
            >
              Skip Speaking
            </button>
         </div>
      </div>
    </div>
  );

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

  const ScoreCard = ({ label, score }: { label: string, score: number }) => {
    let color = 'text-red-600 bg-red-50 border-red-100';
    if (score >= 80) color = 'text-green-600 bg-green-50 border-green-100';
    else if (score >= 60) color = 'text-yellow-600 bg-yellow-50 border-yellow-100';

    return (
      <div className={`p-4 rounded-2xl border text-center ${color}`}>
        <div className="text-2xl font-bold">{score}</div>
        <div className="text-xs font-bold uppercase opacity-80">{label}</div>
      </div>
    );
  };

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
          {step === 'ANALYZING' ? 'AI Thinking...' : step}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {step === 'INTRO' && <IntroView />}
        {step === 'DRAFT' && <DraftView />}
        {step === 'ANALYZING' && (
          <div className="h-full flex flex-col items-center justify-center text-indigo-600">
            <RefreshCw size={48} className="animate-spin mb-4" />
            <p className="font-medium animate-pulse">Analyzing tone and logic...</p>
          </div>
        )}
        {(step === 'FEEDBACK' || step === 'REFINE') && <FeedbackView />}
        {step === 'ROLEPLAY' && <RoleplayView />}
        {step === 'COMPLETE' && <CompleteView />}
      </div>
    </div>
  );
};

export default LessonView;