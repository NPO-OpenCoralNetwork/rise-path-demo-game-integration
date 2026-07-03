import React, { useState, useRef, useEffect } from 'react';
import { ViewState, GeneratedCourse } from '../../../types';
import { Sparkles, Play, Share2, DollarSign, Lock, Globe, Clock, CheckCircle2, Cpu, Image as ImageIcon, Mic, Send, Loader2 } from 'lucide-react';

interface GeneratedContent {
    id: string;
    title: string;
    topic: string;
    duration: string;
    createdAt: string;
    status: 'draft' | 'published';
    views: number;
    earnings: number;
    thumbnail: string;
    tags: string[];
    // Optional fields for compatibility
    description?: string;
    chapters?: any[];
    modelUsed?: GeneratedCourse['modelUsed'];
}

interface Message {
    id: string;
    role: 'ai' | 'user';
    text: string;
}

const INITIAL_CONTENT: GeneratedContent[] = [];

interface MyContentProps {
    onNavigate?: (view: ViewState) => void;
    onSelectCourse?: (course: GeneratedCourse) => void;
    newCourseForLibrary?: GeneratedCourse | null;
}

const MyContent: React.FC<MyContentProps> = ({ onNavigate, onSelectCourse, newCourseForLibrary }) => {
    const [contents, setContents] = useState<GeneratedContent[]>(INITIAL_CONTENT);
    const [isGenerating, setIsGenerating] = useState(false);

    // Chat State
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', role: 'ai', text: "こんにちは！Gemini 3 Pro Architectです。今日は何を学びたいですか？（例：Pythonの基礎、量子力学の概要、美味しいコーヒーの淹れ方など）" }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [conversationStep, setConversationStep] = useState(0); // 0: Topic, 1: Duration, 2: Details, 3: Confirm
    const [draftTopic, setDraftTopic] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const processingRef = useRef(false); // Lock to prevent double generation

    // Simulation State
    const [simStep, setSimStep] = useState(0); // 0: Logic, 1: Visuals, 2: Audio, 3: Finalizing
    const [simLogs, setSimLogs] = useState<string[]>([]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Sync externally generated course into the library as a card
    useEffect(() => {
        if (!newCourseForLibrary) return;
        setContents(prev => {
            const exists = prev.some(c => c.id === newCourseForLibrary.id);
            if (exists) return prev;
            const newContent: GeneratedContent = {
                id: newCourseForLibrary.id,
                title: newCourseForLibrary.title,
                topic: newCourseForLibrary.title,
                duration: newCourseForLibrary.duration,
                createdAt: new Date().toISOString().split('T')[0],
                status: 'draft',
                views: 0,
                earnings: 0,
                thumbnail: "https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&q=80",
                tags: ["New", "Generated"],
                description: newCourseForLibrary.description,
                chapters: newCourseForLibrary.chapters,
                modelUsed: newCourseForLibrary.modelUsed
            };
            return [newContent, ...prev];
        });
    }, [newCourseForLibrary]);

    const handleSendMessage = () => {
        if (!inputValue.trim() || processingRef.current) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', text: inputValue };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');

        // Process Conversation Flow
        setTimeout(() => {
            let aiResponse = "";

            if (conversationStep === 0) {
                setDraftTopic(inputValue);
                aiResponse = `「${inputValue}」ですね、素晴らしいトピックです！\n学習時間はどのくらいを想定していますか？（例：5分、15分、30分）`;
                setConversationStep(1);
            } else if (conversationStep === 1) {
                aiResponse = `承知しました。\n最後に、学習の「深さ」や「スタイル」について教えてください。（例：初心者向けに概念だけ、実装中心のハンズオン、理論重視のDeep Diveなど）`;
                setConversationStep(2);
            } else if (conversationStep === 2) {
                aiResponse = `ありがとうございます。「${draftTopic}」についてのパーソナライズされたカリキュラムパスを設計します。\n準備はよろしいですか？`;
                setConversationStep(3);
            } else if (conversationStep === 3) {
                startGenerationSimulation();
                return;
            }

            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', text: aiResponse }]);
        }, 1000);
    };

    const startGenerationSimulation = () => {
        if (processingRef.current) return;
        processingRef.current = true;
        setIsGenerating(true);
        setConversationStep(4); // Hide chat input

        // Simulation Sequence
        const sequence = [
            { step: 0, log: "Gemini 3 Pro: Analyzing Big5 profile...", time: 500 },
            { step: 0, log: "Gemini 3 Pro: Structuring curriculum logic...", time: 1500 },
            { step: 1, log: "Nano Banana Pro: Generative abstract visual concepts...", time: 3000 },
            { step: 1, log: "Nano Banana Pro: Rendering slide backgrounds (4K)...", time: 5000 },
            { step: 2, log: "Kokoro TTS (jf_alpha): Synthesizing Japanese voiceover...", time: 7000 },
            { step: 2, log: "Kokoro TTS: syncing audio with animation timing...", time: 9000 },
            { step: 3, log: "Finalizing package...", time: 11000 },
            { step: 4, log: "Done!", time: 12000 }
        ];

        sequence.forEach(({ step, log, time }) => {
            setTimeout(() => {
                setSimStep(step);
                setSimLogs(prev => [...prev, log]);

                if (step === 4) {
                    finalizeGeneration();
                }
            }, time);
        });
    };

    const finalizeGeneration = () => {
        const newContent: GeneratedContent = {
            id: Date.now().toString(),
            title: `${draftTopic} - Master Class`,
            topic: draftTopic,
            duration: "12 mins",
            createdAt: new Date().toISOString().split('T')[0],
            status: 'draft',
            views: 0,
            earnings: 0,
            thumbnail: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&q=80",
            tags: ["New", "Personalized", "Gemini 3 Pro"],
            modelUsed: 'pro'
        };
        setContents(prev => [newContent, ...prev]);
        setIsGenerating(false);
        // Reset Chat
        setMessages([{ id: Date.now().toString(), role: 'ai', text: "生成が完了しました！ライブラリに追加された新しいコンテンツをチェックしてみてください。他にも学びたいことはありますか？" }]);
        setConversationStep(0);
        setSimLogs([]);
        processingRef.current = false;
    };

    const handleStartClick = (content: GeneratedContent) => {
        if (onSelectCourse) {
            // Convert to GeneratedCourse
            const courseData: GeneratedCourse = {
                id: content.id,
                title: content.title,
                description: content.description || `A personalized course about ${content.topic}`,
                duration: content.duration,
                chapters: content.chapters || [],
                createdAt: new Date(content.createdAt),
                modelUsed: content.modelUsed || 'standard'
            };
            onSelectCourse(courseData);
        } else if (onNavigate) {
             // Fallback if no selector provided, though App handles this
             onNavigate(ViewState.GENERATED_COURSE_PATH);
        }
    };

    return (
        <div className="max-w-5xl mx-auto w-full pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800 tracking-tight">My Content Library</h2>
                    <p className="text-slate-500 mt-1">Create, manage, and monetize your AI-generated lessons.</p>
                </div>
                <div className="bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">Total Earnings</p>
                    <p className="text-2xl font-bold text-emerald-600 font-mono">¥4,500</p>
                </div>
            </div>

            {/* AI Generator / Chat Interface */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 mb-12 overflow-hidden flex flex-col md:flex-row h-[500px]">

                {/* Chat Section */}
                <div className={`flex flex-col flex-1 transition-all duration-500 ${isGenerating ? 'md:w-1/3 border-r border-slate-100' : 'w-full'}`}>
                    {/* Chat Header */}
                    <div className="bg-indigo-600 p-4 text-white flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                            <Sparkles size={20} className="text-indigo-100" />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm">Gemini 3 Pro Architect</h3>
                            <p className="text-indigo-200 text-xs">Personalized Curriculum Designer</p>
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                                    ? 'bg-indigo-600 text-white rounded-br-none'
                                    : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'
                                    }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    {!isGenerating && (
                        <div className="p-4 bg-white border-t border-slate-100">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                    placeholder={conversationStep === 0 ? "例: 量子力学、マーケティング基礎..." : "ここに入力..."}
                                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all text-sm"
                                    autoFocus
                                />
                                <button
                                    onClick={handleSendMessage}
                                    disabled={!inputValue.trim()}
                                    className="bg-indigo-600 text-white p-3 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send size={20} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Simulation / Info Panel */}
                {isGenerating && (
                    <div className="flex-1 bg-slate-900 text-slate-300 p-8 flex flex-col justify-center relative overflow-hidden">
                        {/* Background Grid */}
                        <div className="absolute inset-0 z-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#6366f1 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

                        <div className="relative z-10 max-w-md mx-auto w-full space-y-8">
                            <div className="text-center mb-8">
                                <h3 className="text-2xl font-bold text-white mb-2">Building "{draftTopic}"</h3>
                                <div className="flex items-center justify-center gap-2 text-xs font-mono text-indigo-400">
                                    <Clock size={12} /> EST. GENERATION TIME: 12.4s
                                </div>
                            </div>

                            {/* Model Steps */}
                            <div className="space-y-6">
                                {/* Step 1: Logic */}
                                <div className={`flex items-center gap-4 transition-all duration-500 ${simStep >= 0 ? 'opacity-100 translate-x-0' : 'opacity-30 translate-x-4'}`}>
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${simStep === 0 ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400 animate-pulse' : simStep > 0 ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-600'}`}>
                                        {simStep > 0 ? <CheckCircle2 size={24} /> : <Cpu size={24} />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white text-sm">Gemini 3 Pro</div>
                                        <div className="text-xs text-slate-400">Constructing Logic & Curriculum</div>
                                    </div>
                                </div>

                                {/* Step 2: Visuals */}
                                <div className={`flex items-center gap-4 transition-all duration-500 ${simStep >= 1 ? 'opacity-100 translate-x-0' : 'opacity-30 translate-x-4'}`}>
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${simStep === 1 ? 'bg-pink-500/20 border-pink-500 text-pink-400 animate-pulse' : simStep > 1 ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-600'}`}>
                                        {simStep > 1 ? <CheckCircle2 size={24} /> : <ImageIcon size={24} />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white text-sm">Nano Banana Pro</div>
                                        <div className="text-xs text-slate-400">Generating 4K Visual Assets</div>
                                    </div>
                                </div>

                                {/* Step 3: Audio */}
                                <div className={`flex items-center gap-4 transition-all duration-500 ${simStep >= 2 ? 'opacity-100 translate-x-0' : 'opacity-30 translate-x-4'}`}>
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${simStep === 2 ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 animate-pulse' : simStep > 2 ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-600'}`}>
                                        {simStep > 2 ? <CheckCircle2 size={24} /> : <Mic size={24} />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white text-sm">Kokoro TTS</div>
                                        <div className="text-xs text-slate-400">Synthesizing Japanese Voiceover</div>
                                    </div>
                                </div>
                            </div>

                            {/* Terminal Log */}
                            <div className="bg-black/50 rounded-lg p-4 font-mono text-[10px] text-emerald-400 h-24 overflow-hidden border border-white/5 relative">
                                <div className="absolute top-0 right-0 p-2 opacity-50"><Loader2 size={12} className="animate-spin" /></div>
                                {simLogs.map((log, i) => (
                                    <div key={i} className="mb-1 opacity-80">&gt; {log}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {contents.map((content) => (
                    <div key={content.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all hover:translate-y-[-2px] group duration-300">
                        {/* Thumbnail */}
                        <div className="h-44 bg-slate-100 relative overflow-hidden">
                            <img src={content.thumbnail} alt={content.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                            <div className="absolute top-3 right-3 flex gap-1 z-10">
                                {content.status === 'published' ? (
                                    <span className="bg-emerald-500/90 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm flex items-center gap-1 border border-white/20">
                                        <Globe size={10} /> Public
                                    </span>
                                ) : (
                                    <span className="bg-slate-900/80 backdrop-blur text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-sm flex items-center gap-1 border border-white/20">
                                        <Lock size={10} /> Private
                                    </span>
                                )}
                            </div>
                            <div className="absolute bottom-3 right-3 text-white text-xs font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                                <Clock size={12} /> {content.duration || '10 mins'}
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-5">
                            <div className="flex gap-2 mb-3">
                                {content.tags.map(tag => (
                                    <span key={tag} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-medium border border-slate-200">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                            <h3 className="font-bold text-slate-800 text-lg mb-1 line-clamp-1 leading-tight group-hover:text-indigo-600 transition-colors">{content.title}</h3>
                            <p className="text-slate-500 text-xs mb-4">Topic: {content.topic}</p>

                            {/* Metrics */}
                            <div className="flex items-center justify-between text-xs text-slate-400 py-3 border-t border-slate-100">
                                <div className="flex gap-4">
                                    <span className="flex items-center gap-1"><Play size={12} /> {content.views}</span>
                                    <span className="flex items-center gap-1 text-emerald-600 font-bold"><DollarSign size={12} /> ¥{content.earnings}</span>
                                </div>
                                <span className="font-mono">{content.createdAt}</span>
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <button
                                    onClick={() => handleStartClick(content)}
                                    className="flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors"
                                >
                                    <Play size={14} /> Start
                                </button>
                                <button className="flex items-center justify-center gap-2 bg-indigo-50 text-indigo-600 py-2.5 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors">
                                    <Share2 size={14} /> {content.status === 'published' ? 'Share' : 'Publish'}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

        </div>
    );
};

export default MyContent;
