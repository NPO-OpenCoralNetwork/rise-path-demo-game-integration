import React, { useState, useEffect } from 'react';
import { ArrowLeft, Camera, Save, Check } from 'lucide-react';
import { ViewState } from '../../../../types';
import { useLanguage } from '../../../../context/LanguageContext';
import { useTheme } from '../../../../context/ThemeContext';
import { useAuth } from '../../../../context/AuthContext';

interface ProfileEditViewProps {
  onNavigate: (view: ViewState) => void;
}

const AVATAR_OPTIONS = [
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
  'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=150&q=80',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80',
];

const ProfileEditView: React.FC<ProfileEditViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [avatar, setAvatar] = useState(user?.avatar || AVATAR_OPTIONS[0]);
  const [saved, setSaved] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  useEffect(() => { setTheme('default'); }, [setTheme]);

  const copy = {
    en: {
      title: 'Edit Profile',
      subtitle: 'Update your display name and avatar.',
      nameLabel: 'Display Name',
      namePlaceholder: 'Enter your name',
      avatarLabel: 'Avatar',
      changeAvatar: 'Change Avatar',
      save: 'Save Changes',
      saved: 'Saved!',
      back: 'Back to Profile',
      email: 'Email',
      emailHint: 'Email cannot be changed here.',
    },
    jp: {
      title: 'プロフィール編集',
      subtitle: '表示名とアバターを更新できます。',
      nameLabel: '表示名',
      namePlaceholder: '名前を入力',
      avatarLabel: 'アバター',
      changeAvatar: 'アバターを変更',
      save: '変更を保存',
      saved: '保存しました！',
      back: 'プロフィールに戻る',
      email: 'メールアドレス',
      emailHint: 'メールアドレスはここでは変更できません。',
    },
  } as const;

  const t = copy[language];

  const handleSave = () => {
    updateProfile({ name: name.trim() || 'Learner', avatar });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-lg mx-auto space-y-8">
        <button
          onClick={() => onNavigate(ViewState.PROFILE)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={16} /> {t.back}
        </button>

        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        {/* Avatar Section */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
          <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.avatarLabel}</label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-2xl object-cover border-2 border-white shadow-md" />
              <button
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="absolute -bottom-2 -right-2 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-indigo-700 transition-colors"
              >
                <Camera size={14} />
              </button>
            </div>
            <button
              onClick={() => setShowAvatarPicker(!showAvatarPicker)}
              className="text-sm text-indigo-600 font-medium hover:underline"
            >
              {t.changeAvatar}
            </button>
          </div>
          {showAvatarPicker && (
            <div className="grid grid-cols-6 gap-3 pt-2">
              {AVATAR_OPTIONS.map((url) => (
                <button
                  key={url}
                  onClick={() => { setAvatar(url); setShowAvatarPicker(false); }}
                  className={`w-12 h-12 rounded-xl overflow-hidden border-2 transition-all ${
                    avatar === url ? 'border-indigo-500 ring-2 ring-indigo-200 scale-110' : 'border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Name Section */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-4">
          <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.nameLabel}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none text-slate-800 text-lg transition-all"
          />
        </div>

        {/* Email (read-only) */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-2">
          <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">{t.email}</label>
          <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-500 text-sm">
            {user?.email || '—'}
          </div>
          <p className="text-xs text-slate-400">{t.emailHint}</p>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saved}
          className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-lg ${
            saved
              ? 'bg-emerald-500 text-white shadow-emerald-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
          }`}
        >
          {saved ? <><Check size={20} /> {t.saved}</> : <><Save size={20} /> {t.save}</>}
        </button>
      </div>
    </div>
  );
};

export default ProfileEditView;
