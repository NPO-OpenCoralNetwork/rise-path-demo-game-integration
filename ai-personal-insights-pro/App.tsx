
import React, { useState, useEffect } from 'react';
import ProfileView from './components/desktop/ProfileView';
import PersonalizedAssessment from './components/PersonalizedAssessment';
import { STORAGE_KEY } from './constants';

const App: React.FC = () => {
  const [view, setView] = useState<'profile' | 'assessment'>('profile');
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    setHasProfile(!!saved);
  }, []);

  return (
    <div className="min-h-screen py-10 bg-slate-50">
      <nav className="max-w-6xl mx-auto px-6 mb-12 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
            <i className="fas fa-brain text-white text-xl"></i>
          </div>
          <span className="text-xl font-black tracking-tight text-slate-800 uppercase">AI Insights</span>
        </div>
        <div className="flex items-center space-x-6">
          <button 
            onClick={() => setView('profile')}
            className={`text-sm font-black transition-all pb-1 uppercase tracking-widest ${view === 'profile' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 border-b-2 border-transparent hover:text-slate-600'}`}
          >
            Profile
          </button>
          <button 
            onClick={() => setView('assessment')}
            className={`text-sm font-black transition-all pb-1 uppercase tracking-widest ${view === 'assessment' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 border-b-2 border-transparent hover:text-slate-600'}`}
          >
            Assessment
          </button>
        </div>
      </nav>

      <main className="transition-all duration-500 ease-in-out">
        {view === 'profile' ? (
          <ProfileView 
            onStartAssessment={() => setView('assessment')} 
            hasExistingProfile={hasProfile}
          />
        ) : (
          <PersonalizedAssessment />
        )}
      </main>

      <footer className="mt-20 py-12 text-center text-slate-400 text-[10px] font-bold uppercase tracking-[0.3em]">
        <p>© 2024 AI Personal Insights Pro. Powered by Gemini API & Big Five Theory.</p>
      </footer>
    </div>
  );
};

export default App;
