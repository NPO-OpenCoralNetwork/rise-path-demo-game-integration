import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Message } from '../../types';
import { Brain, MessageCircle, ChevronDown } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import ReactMarkdown from 'react-markdown';
import {
    getClientTimezone,
    mapAgentChatError,
    postAgentChat,
    shouldRetryAgentChatWithoutStream,
    streamAgentChat,
} from '../../services/agentApi';

const markdownComponents = {
    h1: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="text-base font-bold text-slate-900 my-2" {...props} />,
    h2: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="text-sm font-bold text-slate-900 my-2" {...props} />,
    h3: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="text-sm font-semibold text-slate-800 my-2" {...props} />,
    p: ({ ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="my-2 leading-relaxed" {...props} />,
    ul: ({ ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
    ol: ({ ...props }: React.HTMLAttributes<HTMLOListElement>) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
    li: ({ ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className="leading-relaxed" {...props} />,
    strong: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold text-slate-900" {...props} />,
    em: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <em className="italic text-slate-700" {...props} />,
    code: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 text-[12px] font-mono" {...props} />,
    blockquote: ({ ...props }: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote className="border-l-2 border-slate-200 pl-3 text-slate-600 my-2" {...props} />,
};

const makeId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const FloatingChatbot: React.FC = () => {
    const { language } = useLanguage();
    const location = useLocation();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const copy = {
        en: {
            title: 'Rise Path AI',
            placeholder: 'Ask about Unity or Code...',
            welcome: "Hi! I'm here to help with your learning. Click a term in the text or ask me anything!",
            habitChatLink: 'Sleep, focus & habits',
            habitChatHint: 'Open Habit & Learning Chat for journal-based patterns.',
            errorMessage: 'Something went wrong. Please try again.',
            hermesUnavailable: 'AI coach is unavailable. Check Hermes and HERMES_API_KEY.',
            rateLimited: 'Too many requests. Please wait a minute.',
            demoUnavailable: 'AI coach requires the API server (not available in demo mode).',
            loginRequired: 'Please sign in to use the AI coach.',
        },
        jp: {
            title: 'Rise Path AI',
            placeholder: 'Unityやコードについて質問...',
            welcome: 'こんにちは！学習のサポートをします。わからない用語があれば聞いてくださいね。',
            habitChatLink: '睡眠・集中・習慣の相談',
            habitChatHint: 'ジャーナルに基づく傾向は「生活習慣×学習チャット」で詳しく聞けます。',
            errorMessage: 'エラーが発生しました。もう一度お試しください。',
            hermesUnavailable: 'AI コーチを利用できません。Hermes と HERMES_API_KEY を確認してください。',
            rateLimited: 'リクエストが多すぎます。1分ほどお待ちください。',
            demoUnavailable: 'AI コーチには API サーバーが必要です（デモモードでは利用できません）。',
            loginRequired: 'AI コーチを利用するにはログインが必要です。',
        },
    } as const;
    const t = copy[language];

    const errorCopy = useMemo(() => ({
        genericError: t.errorMessage,
        hermesUnavailable: t.hermesUnavailable,
        rateLimited: t.rateLimited,
        demoUnavailable: t.demoUnavailable,
        loginRequired: t.loginRequired,
    }), [t]);

    const handleSend = useCallback(async (text: string) => {
        if (isLoading || !text.trim()) return;

        const displayMatch = text.match(/User Question: (.*)/s);
        const displayText = displayMatch ? displayMatch[1] : text;

        const userMessage: Message = {
            id: makeId(),
            role: 'user',
            text: displayText,
            timestamp: new Date(),
        };
        const assistantId = makeId();
        const assistantPlaceholder: Message = {
            id: assistantId,
            role: 'model',
            text: '',
            timestamp: new Date(),
            isStreaming: true,
        };

        setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
        setIsLoading(true);

        const payload = {
            skill: 'learning-coach',
            message: text,
            context: {
                timezone: getClientTimezone(),
                ui_language: language,
            },
            include_diary_excerpts: false,
        };

        const appendAssistantText = (chunk: string) => {
            setMessages((prev) => prev.map((m) => (
                m.id === assistantId ? { ...m, text: `${m.text}${chunk}` } : m
            )));
        };

        try {
            let streamed = false;
            let streamedText = '';
            try {
                await streamAgentChat(payload, (chunk) => {
                    streamedText += chunk;
                    appendAssistantText(chunk);
                });
                streamed = streamedText.trim().length > 0;
            } catch (streamErr) {
                if (!shouldRetryAgentChatWithoutStream(streamErr)) {
                    throw streamErr;
                }
            }

            if (!streamed) {
                const result = await postAgentChat(payload);
                setMessages((prev) => prev.map((m) => (
                    m.id === assistantId
                        ? { ...m, text: result.answer || '', isStreaming: false }
                        : m
                )));
            } else {
                setMessages((prev) => prev.map((m) => (
                    m.id === assistantId ? { ...m, isStreaming: false } : m
                )));
            }
        } catch (error) {
            const errorText = mapAgentChatError(error, errorCopy);
            setMessages((prev) => [
                ...prev.filter((m) => m.id !== assistantId),
                {
                    id: makeId(),
                    role: 'model',
                    text: errorText,
                    timestamp: new Date(),
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }, [errorCopy, isLoading, language]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    useEffect(() => {
        const handleExternalTrigger = (event: Event) => {
            const { message, context } = (event as CustomEvent<{ message: string; context?: string }>).detail;
            setIsOpen(true);

            const finalMessage = context
                ? `[Context: ${context}]\n\nUser Question: ${message}`
                : message;

            void handleSend(finalMessage);
        };
        window.addEventListener('open-rise-path-chat', handleExternalTrigger);
        return () => window.removeEventListener('open-rise-path-chat', handleExternalTrigger);
    }, [handleSend]);

    const lastMessage = messages[messages.length - 1];
    const showStreamLoader = Boolean(lastMessage?.isStreaming && !lastMessage.text);

    if (location.pathname.startsWith('/life-journal/chat')) {
        return null;
    }

    if (!isOpen) {
        return (
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-[9999] w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg shadow-indigo-500/30 flex items-center justify-center transition-transform hover:scale-110 animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
                <MessageCircle size={28} />
                {messages.length === 0 && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white" />
                )}
            </button>
        );
    }

    return (
        <div className="fixed bottom-6 right-6 z-[9999] w-[380px] h-[500px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-300 font-sans">
            <div className="bg-indigo-600 p-4 flex items-center justify-between text-white shrink-0">
                <div className="flex items-center gap-2">
                    <Brain size={20} />
                    <span className="font-bold">{t.title}</span>
                </div>
                <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-white/20 rounded-full transition-colors"
                >
                    <ChevronDown size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400 gap-3">
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-400 rounded-xl flex items-center justify-center">
                            <Brain size={24} />
                        </div>
                        <p className="text-sm">{t.welcome}</p>
                        <button
                            type="button"
                            onClick={() => navigate('/life-journal/chat')}
                            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5"
                        >
                            {t.habitChatLink}
                        </button>
                        <p className="text-[11px] text-slate-400 max-w-[240px]">{t.habitChatHint}</p>
                    </div>
                )}

                {messages.map((msg) => {
                    if (msg.role === 'model' && msg.isStreaming && !msg.text) {
                        return null;
                    }

                    return (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`
                            max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                            ${msg.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-none'
                                : 'bg-white text-slate-700 border border-slate-100 shadow-sm rounded-bl-none'}
                        `}>
                                {msg.role === 'model' ? (
                                    <div className="prose prose-sm prose-slate max-w-none">
                                        <ReactMarkdown components={markdownComponents}>
                                            {msg.text}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                )}
                            </div>
                        </div>
                    );
                })}

                {showStreamLoader && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-slate-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm">
                            <div className="flex gap-1">
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100" />
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200" />
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-slate-100 shrink-0">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const input = form.elements.namedItem('message') as HTMLInputElement;
                        if (input.value.trim()) {
                            void handleSend(input.value);
                            input.value = '';
                        }
                    }}
                    className="flex gap-2"
                >
                    <input
                        name="message"
                        type="text"
                        placeholder={t.placeholder}
                        className="flex-1 bg-slate-100 border-0 rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-9 h-9 bg-indigo-600 text-white rounded-full flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        <MessageCircle size={16} />
                    </button>
                </form>
            </div>
        </div>
    );
};