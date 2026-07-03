import React, { useState, useEffect } from 'react';
import { ArrowLeft, Bell, BellOff, Trophy, Lightbulb, Clock, Settings, CheckCheck } from 'lucide-react';
import { ViewState } from '../../../types';
import { useLanguage } from '../../../context/LanguageContext';
import { useTheme } from '../../../context/ThemeContext';
import {
  getNotifications, markAsRead, markAllAsRead, seedDemoNotifications,
  AppNotification
} from '../../../services/notificationService';

interface NotificationsViewProps {
  onNavigate: (view: ViewState) => void;
}

const iconMap: Record<string, React.FC<{ size?: number; className?: string }>> = {
  achievement: Trophy,
  reminder: Clock,
  system: Settings,
  tip: Lightbulb,
};

const colorMap: Record<string, string> = {
  achievement: 'bg-amber-100 text-amber-600',
  reminder: 'bg-blue-100 text-blue-600',
  system: 'bg-slate-100 text-slate-600',
  tip: 'bg-emerald-100 text-emerald-600',
};

const NotificationsView: React.FC<NotificationsViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    setTheme('default');
    seedDemoNotifications();
    setNotifications(getNotifications());
  }, [setTheme]);

  const copy = {
    en: {
      title: 'Notifications',
      subtitle: 'Stay updated on your learning progress.',
      markAll: 'Mark all read',
      empty: 'No notifications yet.',
      back: 'Back',
    },
    jp: {
      title: '通知',
      subtitle: '学習の進捗をチェックしましょう。',
      markAll: 'すべて既読にする',
      empty: '通知はまだありません。',
      back: '戻る',
    },
  } as const;

  const t = copy[language];

  const handleMarkRead = (id: string) => {
    markAsRead(id);
    setNotifications(getNotifications());
  };

  const handleMarkAllRead = () => {
    markAllAsRead();
    setNotifications(getNotifications());
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return language === 'jp' ? 'たった今' : 'Just now';
    if (diffMin < 60) return language === 'jp' ? `${diffMin}分前` : `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return language === 'jp' ? `${diffH}時間前` : `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return language === 'jp' ? `${diffD}日前` : `${diffD}d ago`;
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-2xl mx-auto space-y-8">
        <button
          onClick={() => onNavigate(ViewState.DASHBOARD)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={16} /> {t.back}
        </button>

        <header className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
              {unreadCount > 0 && (
                <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </div>
            <p className="text-slate-500">{t.subtitle}</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors mt-2"
            >
              <CheckCheck size={14} /> {t.markAll}
            </button>
          )}
        </header>

        {notifications.length === 0 ? (
          <div className="text-center py-20">
            <BellOff className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-400 font-medium">{t.empty}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => {
              const Icon = iconMap[n.type] || Bell;
              const color = colorMap[n.type] || 'bg-slate-100 text-slate-600';
              return (
                <button
                  key={n.id}
                  onClick={() => handleMarkRead(n.id)}
                  className={`w-full text-left rounded-2xl border p-4 flex items-start gap-4 transition-all ${
                    n.read
                      ? 'bg-white border-slate-100 opacity-60'
                      : 'bg-white border-slate-200 shadow-sm hover:shadow-md'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`text-sm font-bold ${n.read ? 'text-slate-500' : 'text-slate-800'}`}>
                        {n.title[language]}
                      </h3>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap mt-0.5">{formatDate(n.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{n.body[language]}</p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0 mt-2" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsView;
