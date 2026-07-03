import React from 'react';
import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Message } from '../../../types';

interface MessageBubbleProps {
  message: Message;
  showAvatar?: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, showAvatar = true }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && showAvatar && (
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex-shrink-0 flex items-center justify-center text-white mt-1 shadow-sm">
          <Bot size={16} />
        </div>
      )}

      <div className={`
        max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-3 shadow-sm
        ${isUser
          ? 'bg-indigo-600 text-white rounded-br-sm'
          : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'}
      `}>
        {message.role === 'model' ? (
          <div className="prose prose-sm prose-slate max-w-none">
            {message.text ? (
              <ReactMarkdown>{message.text}</ReactMarkdown>
            ) : (
              <span className="flex gap-1 items-center h-5">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
              </span>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{message.text}</p>
        )}
      </div>

      {isUser && showAvatar && (
        <div className="w-8 h-8 rounded-full bg-slate-200 flex-shrink-0 flex items-center justify-center text-slate-500 mt-1">
          <User size={16} />
        </div>
      )}
    </div>
  );
};
