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
import { onTutorRequest, type TutorChatContext } from '../../services/tutorBridge';
import { isLessonPath } from '../../navigation/viewPaths';

const markdownComponents = {
    h1: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="text-base font-bold text-fg my-2" {...props} />,
    h2: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="text-sm font-bold text-fg my-2" {...props} />,
    h3: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="text-sm font-semibold text-fg my-2" {...props} />,
    p: ({ ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="my-2 leading-relaxed" {...props} />,
    ul: ({ ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
    ol: ({ ...props }: React.HTMLAttributes<HTMLOListElement>) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
    li: ({ ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className="leading-relaxed" {...props} />,
    strong: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold text-fg" {...props} />,
    em: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <em className="italic text-fg-2" {...props} />,
    code: ({ ...props }: React.HTMLAttributes<HTMLElement>) => <code className="px-1.5 py-0.5 rounded-chip bg-sunken text-fg text-xs font-mono" {...props} />,
    blockquote: ({ ...props }: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote className="border-l-2 border-line pl-3 text-fg-2 my-2" {...props} />,
    // Model output: only http(s) links, and images as their alt text so a reply cannot make the
    // browser fetch a URL.
    a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        /^https?:\/\//i.test(href ?? '')
            ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary-text underline">{children}</a>
            : <span>{children}</span>
    ),
    img: ({ alt }: React.ImgHTMLAttributes<HTMLImageElement>) => (alt ? <span>{alt}</span> : null),
};

const makeId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type SendOptions = {
    /** Lesson, anchor, mode and learner state from openTutor(); sent as chat context. */
    tutor?: TutorChatContext;
    /** Free-text context from the legacy glossary event. */
    legacyContext?: string;
};

export const FloatingChatbot: React.FC = () => {
    const { language } = useLanguage();
    const location = useLocation();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    // Set when a reply finishes while the panel is closed; cleared on open.
    const [hasUnread, setHasUnread] = useState(false);
    // Screen readers hear the finished reply once (not every streamed chunk), plus thinking/errors.
    const [announcement, setAnnouncement] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const launcherRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isOpenRef = useRef(isOpen);
    const restoreFocusRef = useRef(false);
    isOpenRef.current = isOpen;

    const copy = {
        en: {
            title: 'Rise Path AI',
            open: 'Open Rise Path AI chat',
            openUnread: 'Open Rise Path AI chat (new reply)',
            minimize: 'Minimize chat',
            inputLabel: 'Message to Rise Path AI',
            send: 'Send',
            placeholder: 'Ask about Unity or Code...',
            welcome: "Hi! I'm here to help with your learning. Click a term in the text or ask me anything!",
            habitChatLink: 'Sleep, focus & habits',
            habitChatHint: 'Open Habit & Learning Chat for journal-based patterns.',
            errorMessage: 'Something went wrong. Please try again.',
            hermesUnavailable: 'AI coach is unavailable. Check Hermes and HERMES_API_KEY.',
            rateLimited: 'Too many requests. Please wait a minute.',
            dailyLimit: "Today's limit for the AI coach has been reached. You can chat again after midnight Japan time.",
            featurePaused: 'The AI coach is paused for now.',
            demoUnavailable: 'AI coach requires the API server (not available in demo mode).',
            loginRequired: 'Please sign in to use the AI coach.',
            thinking: 'Thinking…',
        },
        jp: {
            title: 'Rise Path AI',
            open: 'Rise Path AI チャットを開く',
            openUnread: 'Rise Path AI チャットを開く（新しい返信があります）',
            minimize: 'チャットを最小化',
            inputLabel: 'Rise Path AI へのメッセージ',
            send: '送信',
            placeholder: 'Unityやコードについて質問...',
            welcome: 'こんにちは！学習のサポートをします。わからない用語があれば聞いてくださいね。',
            habitChatLink: '睡眠・集中・習慣の相談',
            habitChatHint: 'ジャーナルに基づく傾向は「生活習慣×学習チャット」で詳しく聞けます。',
            errorMessage: 'エラーが発生しました。もう一度お試しください。',
            hermesUnavailable: 'AI コーチを利用できません。Hermes と HERMES_API_KEY を確認してください。',
            rateLimited: 'リクエストが多すぎます。1分ほどお待ちください。',
            dailyLimit: '今日のAIコーチの利用は上限に達しました。日本時間の0時を過ぎたら、また話しかけてください。',
            featurePaused: 'AIコーチは、今は停止しています。',
            demoUnavailable: 'AI コーチには API サーバーが必要です（デモモードでは利用できません）。',
            loginRequired: 'AI コーチを利用するにはログインが必要です。',
            thinking: '考えています…',
        },
    } as const;
    const t = copy[language];

    const errorCopy = useMemo(() => ({
        genericError: t.errorMessage,
        hermesUnavailable: t.hermesUnavailable,
        rateLimited: t.rateLimited,
        dailyLimit: t.dailyLimit,
        featurePaused: t.featurePaused,
        demoUnavailable: t.demoUnavailable,
        loginRequired: t.loginRequired,
    }), [t]);

    const openPanel = useCallback(() => {
        setIsOpen(true);
        setHasUnread(false);
    }, []);

    const closePanel = useCallback(() => {
        restoreFocusRef.current = true;
        setIsOpen(false);
    }, []);

    const handleSend = useCallback(async (text: string, options: SendOptions = {}) => {
        if (isLoading || !text.trim()) return;

        // The learner sees their question; the legacy glossary context rides along in the message.
        const outgoing = options.legacyContext
            ? `[Context: ${options.legacyContext}]\n\nUser Question: ${text}`
            : text;

        const userMessage: Message = {
            id: makeId(),
            role: 'user',
            text,
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
        setAnnouncement(t.thinking);

        const context = {
            timezone: getClientTimezone(),
            ui_language: language,
            ...options.tutor,
        };
        const payload = {
            skill: 'learning-coach',
            message: outgoing,
            context,
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
                setAnnouncement(result.answer || '');
            } else {
                setMessages((prev) => prev.map((m) => (
                    m.id === assistantId ? { ...m, isStreaming: false } : m
                )));
                setAnnouncement(streamedText);
            }
        } catch (error) {
            const errorText = mapAgentChatError(error, errorCopy);
            setAnnouncement(errorText);
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
            if (!isOpenRef.current) setHasUnread(true);
        }
    }, [errorCopy, isLoading, language, t.thinking]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [messages, isOpen]);

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        } else if (restoreFocusRef.current) {
            restoreFocusRef.current = false;
            launcherRef.current?.focus();
        }
    }, [isOpen]);

    // openTutor() and the legacy glossary event both land here. On lesson routes the reader's
    // inline TutorPanel answers lesson questions (detail.lesson), so this panel ignores them.
    const pathnameRef = useRef(location.pathname);
    pathnameRef.current = location.pathname;
    useEffect(() => onTutorRequest((request) => {
        if (request.tutor.lesson && isLessonPath(pathnameRef.current)) return;
        openPanel();
        void handleSend(request.message, { tutor: request.tutor, legacyContext: request.legacyContext });
    }), [handleSend, openPanel]);

    const lastMessage = messages[messages.length - 1];
    const showStreamLoader = Boolean(lastMessage?.isStreaming && !lastMessage.text);

    if (location.pathname.startsWith('/life-journal/chat')) {
        return null;
    }

    if (!isOpen) {
        // Lesson routes have their own "Ask AI" entry points; the panel still opens from openTutor().
        if (isLessonPath(location.pathname)) return null;
        return (
            <button
                ref={launcherRef}
                type="button"
                onClick={openPanel}
                aria-label={hasUnread ? t.openUnread : t.open}
                className="fixed bottom-6 right-6 z-[9999] w-14 h-14 bg-primary hover:bg-primary-hover text-on-primary rounded-full shadow-3 flex items-center justify-center transition-transform hover:scale-110 animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
                <MessageCircle size={28} aria-hidden="true" />
                {hasUnread && (
                    <span aria-hidden="true" className="absolute top-0 right-0 w-4 h-4 bg-danger rounded-full border-2 border-surface" />
                )}
            </button>
        );
    }

    return (
        <section
            aria-label={t.title}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    closePanel();
                }
            }}
            className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 z-[9999] sm:w-[380px] h-[500px] max-h-[80vh] bg-surface rounded-hero shadow-3 border border-line flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-300 font-sans"
        >
            <div className="bg-primary p-4 flex items-center justify-between text-on-primary shrink-0">
                <div className="flex items-center gap-2">
                    <Brain size={20} aria-hidden="true" />
                    <h2 className="font-bold">{t.title}</h2>
                </div>
                <button
                    type="button"
                    onClick={closePanel}
                    aria-label={t.minimize}
                    className="p-1 hover:bg-white/20 rounded-full transition-colors"
                >
                    <ChevronDown size={20} aria-hidden="true" />
                </button>
            </div>

            <p role="status" className="sr-only">{announcement}</p>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-canvas">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4 text-fg-3 gap-3">
                        <div className="w-12 h-12 bg-primary-soft text-primary-text rounded-card flex items-center justify-center">
                            <Brain size={24} aria-hidden="true" />
                        </div>
                        <p className="text-sm">{t.welcome}</p>
                        <button
                            type="button"
                            onClick={() => navigate('/life-journal/chat')}
                            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5"
                        >
                            {t.habitChatLink}
                        </button>
                        <p className="text-xs text-fg-3 max-w-60">{t.habitChatHint}</p>
                    </div>
                )}

                {messages.map((msg) => {
                    if (msg.role === 'model' && msg.isStreaming && !msg.text) {
                        return null;
                    }

                    return (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`
                            max-w-[85%] rounded-hero px-4 py-3 text-sm leading-relaxed
                            ${msg.role === 'user'
                                ? 'bg-primary text-on-primary rounded-br-none'
                                : 'bg-surface text-fg-2 border border-line shadow-1 rounded-bl-none'}
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
                        <div className="bg-surface border border-line rounded-hero rounded-bl-none px-4 py-3 shadow-1">
                            <div className="flex gap-1">
                                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" />
                                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce delay-100" />
                                <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce delay-200" />
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-surface border-t border-line shrink-0">
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
                        ref={inputRef}
                        name="message"
                        type="text"
                        aria-label={t.inputLabel}
                        placeholder={t.placeholder}
                        className="flex-1 bg-sunken border-0 rounded-full px-4 py-2 text-sm placeholder:text-fg-3 focus:ring-2 focus:ring-focus outline-none"
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        aria-label={t.send}
                        className="w-9 h-9 bg-primary text-on-primary rounded-full flex items-center justify-center hover:bg-primary-hover transition-colors disabled:opacity-50"
                    >
                        <MessageCircle size={16} aria-hidden="true" />
                    </button>
                </form>
            </div>
        </section>
    );
};
