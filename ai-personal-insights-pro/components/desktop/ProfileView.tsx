
import React from 'react';

interface ProfileViewProps {
  onStartAssessment: () => void;
  hasExistingProfile: boolean;
}

const ProfileView: React.FC<ProfileViewProps> = ({ onStartAssessment, hasExistingProfile }) => {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/20">
        <div className="flex items-center space-x-6 mb-10">
          <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-0.5 shadow-xl rotate-3">
            <div className="w-full h-full bg-slate-900 rounded-[calc(1.5rem-2px)] flex items-center justify-center overflow-hidden relative">
              <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.4),transparent)] animate-pulse"></div>
              <i className="fas fa-atom text-white text-3xl z-10"></i>
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Personal Core</h1>
            <p className="text-slate-500 font-medium">AIがあなたの本質的な特性を解析します</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 p-8 rounded-3xl text-white relative overflow-hidden group">
            <div className="absolute top-0 right-0 -mr-4 -mt-4 w-32 h-32 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700"></div>
            <h2 className="text-xl font-bold mb-3 flex items-center">
              <i className="fas fa-microchip mr-2 text-indigo-300"></i>AIパーソナル診断
            </h2>
            <p className="text-sm text-indigo-100/80 mb-6 leading-relaxed">
              ビッグファイブ理論に基づき、20の観点から深層心理と行動特性をデジタル化。あなたの「勝ち筋」を特定します。
            </p>
            <button 
              onClick={onStartAssessment}
              className="w-full py-4 bg-white text-indigo-600 rounded-2xl font-bold transition-all shadow-xl hover:bg-indigo-50 flex items-center justify-center space-x-2 active:scale-95"
            >
              <span className="text-lg">{hasExistingProfile ? '診断を再構成' : '解析を開始'}</span>
              <i className="fas fa-bolt"></i>
            </button>
          </div>

          <div className="flex flex-col space-y-4">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
               <div className="flex justify-between items-center mb-4">
                 <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">System Status</span>
                 <span className="flex h-2 w-2 rounded-full bg-green-500 animate-ping"></span>
               </div>
               <div className="space-y-3">
                 <div className="h-1.5 w-full bg-slate-200 rounded-full">
                   <div className="h-full bg-indigo-500 w-3/4 rounded-full"></div>
                 </div>
                 <div className="h-1.5 w-full bg-slate-200 rounded-full">
                   <div className="h-full bg-purple-500 w-1/2 rounded-full"></div>
                 </div>
               </div>
               <p className="mt-4 text-[10px] text-slate-400 font-mono">READY TO SCAN PERSONAL DATA_</p>
            </div>
            <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 flex items-center space-x-3">
              <i className="fas fa-shield-halved text-indigo-400"></i>
              <span className="text-xs text-indigo-600 font-medium">データは暗号化され、ローカルにのみ保存されます</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileView;
