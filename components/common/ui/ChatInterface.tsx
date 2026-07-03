import React, { useRef, useEffect } from 'react';
import { Send, Loader2, Mic } from 'lucide-react';
import { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

interface ChatInterfaceProps {
    messages: Message[];
    onSend: (text: string) => void;
    isLoading?: boolean;
    placeholder?: string;
    suggestions?: string[];
    header?: React.ReactNode;
    emptyState?: React.ReactNode;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    onSend,
    isLoading = false,
    placeholder = "メッセージを入力...",
    suggestions = [],
    header,
    emptyState
}) => {
    const [input, setInput] = React.useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;
        onSend(input);
        setInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 relative">
            {/* Optional Header */}
            {header && (
                <div className="bg-white border-b border-slate-200 shadow-sm z-10 sticky top-0">
                    {header}
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
                {messages.length === 0 && emptyState ? (
                    <div className="h-full flex flex-col items-center justify-center">
                        {emptyState}
                    </div>
                ) : (
                    <>
                        {messages.map((msg) => (
                            <MessageBubble key={msg.id} message={msg} />
                        ))}
                        {/* Helper to keep some space for the input area if needed, or just scrolling */}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-slate-200">
                {suggestions.length > 0 && messages.length < 3 && (
                    <div className="flex gap-2 overflow-x-auto pb-4 mb-2 scrollbar-hide">
                        {suggestions.map(s => (
                            <button
                                key={s}
                                onClick={() => setInput(s)}
                                className="whitespace-nowrap px-4 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-full text-sm text-slate-600 hover:text-indigo-700 transition-colors font-medium"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                <div className="max-w-4xl mx-auto relative flex items-center gap-2">
                    <div className="relative flex-1">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            className="w-full bg-slate-100 border-none text-slate-900 rounded-xl pl-4 pr-12 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white resize-none max-h-32 transition-colors shadow-inner"
                            rows={1}
                        />
                        <div className="absolute right-2 bottom-2 flex gap-1">
                            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                                <Mic size={18} />
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                className={`p-2 rounded-lg transition-all duration-200 
                  ${input.trim() && !isLoading
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md transform hover:scale-105'
                                        : 'bg-transparent text-slate-300 cursor-not-allowed'
                                    }`}
                            >
                                {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                            </button>
                        </div>
                    </div>
                </div>
                <p className="text-center text-xs text-slate-400 mt-3">
                    AI can make mistakes. Double check content.
                </p>
            </div>
        </div>
    );
};
