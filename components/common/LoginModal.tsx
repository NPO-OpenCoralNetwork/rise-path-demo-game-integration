import React, { useState } from 'react';
import { X, Mail, ArrowRight, Github } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLogin }) => {
  const { language } = useLanguage();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const copy = {
    en: {
      title: 'Create your account',
      subtitle: 'Save your progress and get personalized AI feedback.',
      emailLabel: 'Email Address',
      creating: 'Creating Account...',
      startLearning: 'Start Learning',
      continueWith: 'Or continue with'
    },
    jp: {
      title: 'アカウントを作成',
      subtitle: '進捗を保存し、パーソナライズされたAIフィードバックを受け取れます。',
      emailLabel: 'メールアドレス',
      creating: 'アカウント作成中...',
      startLearning: '学習を開始',
      continueWith: 'または以下で続行'
    }
  } as const;
  const t = copy[language];

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      onLogin();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>
      
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 overflow-hidden animate-in fade-in zoom-in duration-300">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-2 bg-slate-50 rounded-full"
        >
          <X size={20} />
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mx-auto mb-4 text-2xl font-bold">L</div>
          <h2 className="text-2xl font-bold text-slate-900">{t.title}</h2>
          <p className="text-slate-500 mt-2">{t.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 ml-1">{t.emailLabel}</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                placeholder="alex@example.com"
              />
            </div>
          </div>
          
          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? t.creating : (
              <>{t.startLearning} <ArrowRight size={20} /></>
            )}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500">{t.continueWith}</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => { setIsLoading(true); setTimeout(onLogin, 800); }} className="flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors font-medium text-slate-700">
               <svg className="h-5 w-5" aria-hidden="true" viewBox="0 0 24 24"><path d="M12.0003 20.45c-4.6667 0-8.45-3.7833-8.45-8.45 0-4.6667 3.7833-8.45 8.45-8.45 4.6667 0 8.45 3.7833 8.45 8.45 0 4.6667-3.7833 8.45-8.45 8.45z" fill="#fff" stroke="#94a3b8" strokeWidth="2" /><path d="M12.48 10.87h8.04c.09.57.14 1.15.14 1.74 0 4.1-2.75 7.02-6.96 7.02-4.02 0-7.28-3.26-7.28-7.28s3.26-7.28 7.28-7.28c1.86 0 3.54.65 4.88 1.9l-2.02 2.02c-.67-.64-1.68-1.2-2.86-1.2-2.45 0-4.44 2.03-4.44 4.56s1.99 4.56 4.44 4.56c2.32 0 3.86-1.4 4.14-3.52h-4.32v-2.52z" fill="#4285F4" /></svg>
               Google
            </button>
            <button type="button" onClick={() => { setIsLoading(true); setTimeout(onLogin, 800); }} className="flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors font-medium text-slate-700">
               <Github size={20} /> Github
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;
