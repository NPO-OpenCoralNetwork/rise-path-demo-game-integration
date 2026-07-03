import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ViewState } from '../../types';
import {
  LayoutDashboard,
  Layers, // For Learning Hub
  Map as MapIcon,
  Library as LibraryIcon,
  Sparkles,
  User,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Box,
  Terminal,
  Palette,
  Activity,
  Settings as SettingsIcon,
  ChevronDown,
  Brain,
  FileText,
  Users,
  CheckCircle2,
  Image,
  Trophy,
  BookOpen
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

interface LayoutProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  children: React.ReactNode;
}

type NavItem = {
  view?: ViewState;
  label: string;
  icon: any;
  id?: string;
  children?: NavItem[];
};

const Layout: React.FC<LayoutProps> = ({ currentView, onNavigate, children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>('lab');
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { language, selectedLanguage, setLanguage } = useLanguage();

  useEffect(() => {
    const view = currentView.toString();
    if (view.startsWith('ART_')) {
      setTheme('art');
    } else if (
      (view.startsWith('VIBE_') && view !== 'VIBE_PATH') || // Keep Path light
      (view.startsWith('PROGRAMMING') && !view.includes('WEB')) || // WEB track is light
      view.startsWith('PYTHON_') ||
      view.startsWith('WEB_')
    ) {
      setTheme('vibe');
    } else {
      setTheme('default');
    }
  }, [currentView, setTheme]);

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, left: 0 });
    } else {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

  const getThemeStyles = () => {
    switch (theme) {
      case 'art':
        return {
          sidebar: 'bg-[#1c1917] border-stone-800 text-stone-400',
          sidebarActive: 'bg-stone-800 text-stone-100',
          sidebarHover: 'hover:bg-stone-800 hover:text-stone-200',
          main: 'bg-[#1c1917]',
          text: 'text-stone-400',
          mobileHeader: 'bg-[#1c1917] border-stone-800 text-stone-100'
        };
      case 'vibe':
        return {
          sidebar: 'bg-black border-white/10 text-slate-400',
          sidebarActive: 'bg-white/10 text-white',
          sidebarHover: 'hover:bg-white/5 hover:text-white',
          main: 'bg-black',
          text: 'text-slate-400',
          mobileHeader: 'bg-black border-white/10 text-white'
        };
      default:
        return {
          sidebar: 'bg-white border-slate-200',
          sidebarActive: 'bg-indigo-50 text-indigo-700',
          sidebarHover: 'hover:bg-slate-50 hover:text-slate-900',
          main: 'bg-slate-50',
          text: 'text-slate-600',
          mobileHeader: 'bg-white border-slate-200 text-slate-800'
        };
    }
  };

  const styles = getThemeStyles();

  const copy = {
    en: {
      dashboard: 'Dashboard',
      learningHub: 'Learning Hub',
      aiDiagnosis: 'AI Learning Diagnosis',
      lifeJournal: 'Life Journal',
      courseGenerator: 'AI Course Generator',
      risePathLab: 'Design Samples',
      checklist: 'Checklist Page',
      checklistGenerator: 'Checklist Generator',
      concept: 'Concept Page',
      dialogue: 'Dialogue Page',
      workshop: 'Workshop Page',
      blender: 'Blender Viewport',
      reflection: 'Reflection Page',
      documents: 'Documents',
      aiCharacters: 'AI Characters',
      account: 'Account',
      profile: 'Profile',
      profileOverview: 'Student Card',
      profileDiagnosis: 'AI Diagnosis',
      profileHistory: 'History',
      profileBadges: 'Badges',
      profileGenerated: 'Generated',
      myContent: 'My Content',
      logOut: 'Log Out',
      language: 'Language',
      settings: 'Settings',
    },
    jp: {
      dashboard: 'ダッシュボード',
      learningHub: '学習コンテンツ',
      aiDiagnosis: 'AI学習診断',
      lifeJournal: 'ライフジャーナル',
      courseGenerator: 'AIカリキュラム生成',
      risePathLab: 'デザインサンプル',
      checklist: 'チェックリストページ',
      checklistGenerator: 'チェックリスト生成',
      concept: 'コンセプトページ',
      dialogue: '対話ページ',
      workshop: 'ワークショップページ',
      blender: 'Blenderビューポート',
      reflection: 'リフレクションページ',
      documents: 'ドキュメント',
      aiCharacters: 'AIキャラクター',
      account: 'アカウント',
      profile: 'プロフィール',
      profileOverview: '学生証',
      profileDiagnosis: 'AI診断',
      profileHistory: '履歴',
      profileBadges: 'バッジ',
      profileGenerated: '生成物',
      myContent: 'マイコンテンツ',
      logOut: 'ログアウト',
      language: '言語',
      settings: '設定',
    }
  } as const;

  const t = copy[language];

  const navItems: NavItem[] = [
    { view: ViewState.DASHBOARD, label: t.dashboard, icon: LayoutDashboard },
    { view: ViewState.COURSES, label: t.learningHub, icon: Layers },

    { view: ViewState.AI_DIAGNOSIS, label: t.aiDiagnosis, icon: Brain },
    { view: ViewState.LIFE_JOURNAL, label: t.lifeJournal, icon: BookOpen },
    { view: ViewState.COURSE_GENERATOR, label: t.courseGenerator, icon: MapIcon },
    {
      id: 'lab',
      label: t.risePathLab,
      icon: Sparkles,
      children: [
        { view: ViewState.DEMO_CHECKLIST, label: t.checklist, icon: CheckCircle2 },
        { view: ViewState.DEMO_CHECKLIST_GENERATOR, label: t.checklistGenerator, icon: Image },
        { view: ViewState.DEMO_CONCEPT, label: t.concept, icon: Box },
        { view: ViewState.DEMO_DIALOGUE, label: t.dialogue, icon: Users },
        { view: ViewState.DEMO_WORKSHOP, label: t.workshop, icon: Terminal },
        { view: ViewState.DEMO_BLENDER, label: t.blender, icon: Box },
        { view: ViewState.DEMO_REFLECTION, label: t.reflection, icon: Brain },
      ]
    },
    {
      id: 'documents',
      label: t.documents,
      icon: FileText,
      children: [
        { view: ViewState.AI_CHARACTERS, label: t.aiCharacters, icon: Users },
      ]
    },
    {
      id: 'account',
      label: t.account,
      icon: User,
      children: [
        { view: ViewState.PROFILE, label: t.profileOverview, icon: User },
        { view: ViewState.PROFILE_DIAGNOSIS, label: t.profileDiagnosis, icon: Brain },
        { view: ViewState.PROFILE_HISTORY, label: t.profileHistory, icon: Activity },
        { view: ViewState.PROFILE_BADGES, label: t.profileBadges, icon: Trophy },
        { view: ViewState.PROFILE_GENERATED, label: t.profileGenerated, icon: Sparkles },
        { view: ViewState.MY_CONTENT, label: t.myContent, icon: LibraryIcon }
      ]
    },
  ];

  const isNavItemActive = (itemInfo: NavItem) => {
    if (!itemInfo.view) return false;

    if (currentView === ViewState.LESSON && itemInfo.view === ViewState.DASHBOARD) {
      return true;
    }
    if ((currentView === ViewState.SONIC_SYNTH) && itemInfo.view === ViewState.LEARNING_HUB) {
      return true;
    }

    if ((
      currentView === ViewState.BLENDER || currentView === ViewState.BLENDER_PATH || currentView === ViewState.BLENDER_LESSON ||
      currentView.toString().startsWith('VIBE') || currentView.toString().startsWith('PROGRAMMING') || currentView.toString().startsWith('PYTHON') ||
      currentView.toString().startsWith('ART') ||
      currentView === ViewState.SONIC_LAB
    ) && itemInfo.view === ViewState.LEARNING_HUB) {
      return true;
    }
    if (
      itemInfo.view === ViewState.LIFE_JOURNAL
      && (
        currentView === ViewState.LIFE_JOURNAL
        || currentView === ViewState.LIFE_JOURNAL_MONTHLY
        || currentView === ViewState.LIFE_JOURNAL_INSIGHTS
        || currentView === ViewState.LIFE_JOURNAL_CHAT
      )
    ) {
      return true;
    }
    return currentView === itemInfo.view;
  };

  const isGroupActive = (item: NavItem) => {
    if (item.children) {
      return item.children.some(child => isNavItemActive(child));
    }
    return false;
  };
  const isFullBleedView = (
    currentView === ViewState.DASHBOARD ||
    currentView === ViewState.LESSON ||
    currentView === ViewState.BLENDER_LESSON ||
    currentView === ViewState.GENERATED_LESSON_VIEW ||
    currentView === ViewState.AI_DIAGNOSIS
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      {/* Mobile Header */}
      <div className={`md:hidden fixed w-full z-50 border-b px-4 py-3 flex justify-between items-center ${styles.mobileHeader}`}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">L</div>
          <span className={`font-bold tracking-tight ${theme === 'default' ? 'text-slate-700' : 'text-white'} `}>Rise Path</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-slate-600">
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside className={`
        fixed md:relative z-40 h-full border-r flex flex-col transition-all duration-300 ease-in-out
        ${styles.sidebar}
        ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'}
        ${isCollapsed ? 'md:w-20' : 'md:w-64'}
        pt-16 md:pt-0 group/sidebar relative
      `}>
        {/* Toggle Button - Floating on Border */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`
            absolute -right-3 top-8 z-50
            w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center
            text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-all
            hidden md:flex
          `}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        <div className={`p-4 hidden md:flex items-center ${isCollapsed ? 'justify-center' : 'justify-start'} gap-3 h-16`}>
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold shadow-md text-base shrink-0 transition-all">L</div>
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
            <span className={`text-lg font-bold tracking-tight whitespace-nowrap ${theme === 'default' ? 'text-slate-700' : 'text-white'}`}>Rise Path</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            if (item.children) {
              // Group Item
              const isActiveGroup = isGroupActive(item);
              const isExpanded = expandedMenu === item.id;

              return (
                <div key={item.id} className="space-y-1">
                  <button
                    onClick={() => {
                      if (isCollapsed) {
                        setIsCollapsed(false);
                        setExpandedMenu(item.id || null);
                      } else {
                        setExpandedMenu(isExpanded ? null : item.id || null);
                      }
                    }}
                    className={`
                      flex items-center justify-between rounded-lg transition-all duration-200 font-medium w-full
                      ${isActiveGroup ? styles.sidebarActive : styles.sidebarHover}
                      ${isCollapsed ? 'justify-center w-10 h-10 mx-auto p-0' : 'px-3 py-2.5'}
                    `}
                    title={isCollapsed ? item.label : ''}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon size={20} className={`shrink-0 ${isActiveGroup ? 'text-indigo-600' : styles.text}`} />
                      {!isCollapsed && (
                        <span className="whitespace-nowrap overflow-hidden text-sm">{item.label}</span>
                      )}
                    </div>
                    {!isCollapsed && (
                      <ChevronDown size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} ${styles.text}`} />
                    )}
                  </button>

                  {/* Sub Items */}
                  <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded && !isCollapsed ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="pt-1 pb-2 space-y-1">
                      {item.children.map((child) => {
                        const isActive = isNavItemActive(child);
                        return (
                          <button
                            key={child.view}
                            onClick={() => {
                              if (child.view) onNavigate(child.view);
                              setIsMobileMenuOpen(false);
                            }}
                            className={`
                              flex items-center rounded-lg transition-all duration-200 font-medium w-full pl-10 pr-3 py-2
                              ${isActive ? 'bg-indigo-50/50 text-indigo-600' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'}
                              text-sm
                            `}
                          >
                            <span className="whitespace-nowrap">{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            // Regular Item
            const isActive = isNavItemActive(item);
            return (
              <button
                key={item.view}
                onClick={() => {
                  if (item.view) onNavigate(item.view);
                  setIsMobileMenuOpen(false);
                }}
                className={`
                  flex items-center rounded-lg transition-all duration-200 font-medium
                  ${isActive
                    ? styles.sidebarActive
                    : styles.sidebarHover
                  }
                  ${isCollapsed
                    ? 'justify-center w-10 h-10 mx-auto p-0'
                    : 'w-full gap-3 px-3 py-2.5'
                  }
                `}
                title={isCollapsed ? item.label : ''}
              >
                <item.icon size={20} className={`shrink-0 ${isActive ? 'text-indigo-600' : styles.text}`} />
                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onNavigate(ViewState.SETTINGS);
              setIsMobileMenuOpen(false);
            }}
            className={`
              flex items-center rounded-lg transition-all duration-200 font-medium
              ${(
                currentView === ViewState.SETTINGS
                || currentView === ViewState.SETTINGS_VOICE
                || currentView === ViewState.SETTINGS_DIALOGUE_VOICE
                || currentView === ViewState.SETTINGS_API_KEY
              )
                ? styles.sidebarActive
                : styles.sidebarHover
              }
              ${isCollapsed
                ? 'justify-center w-10 h-10 mx-auto p-0'
                : 'w-full gap-3 px-3 py-2.5'
              }
            `}
            title={isCollapsed ? t.settings : ''}
          >
            <SettingsIcon size={20} className={`shrink-0 ${(
                currentView === ViewState.SETTINGS
                || currentView === ViewState.SETTINGS_VOICE
                || currentView === ViewState.SETTINGS_DIALOGUE_VOICE
                || currentView === ViewState.SETTINGS_API_KEY
            ) ? 'text-indigo-600' : styles.text}`} />
            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
              {t.settings}
            </span>
          </button>

          <div className={`mt-4 ${isCollapsed ? 'px-0' : 'px-1'}`}>
            <div
              className={`
                flex items-center rounded-lg border px-2 py-2
                ${isCollapsed ? 'flex-col gap-2' : 'justify-between'}
                ${theme === 'default' ? 'bg-slate-100 border-slate-200' : 'bg-transparent border-white/10'}
              `}
            >
              {!isCollapsed && (
                <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'default' ? 'text-slate-500' : 'text-slate-400'}`}>
                  {t.language}
                </span>
              )}
              <div className={`flex items-center ${isCollapsed ? 'flex-col gap-1' : 'gap-2'}`}>
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'en'
                    ? (theme === 'default' ? 'bg-slate-900 text-white' : 'bg-white/10 text-white')
                    : (theme === 'default' ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-white')
                  }`}
                  aria-pressed={selectedLanguage === 'en'}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('jp')}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'jp'
                    ? (theme === 'default' ? 'bg-slate-900 text-white' : 'bg-white/10 text-white')
                    : (theme === 'default' ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-white')
                  }`}
                  aria-pressed={selectedLanguage === 'jp'}
                >
                  JP
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('fr')}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold transition-all ${selectedLanguage === 'fr'
                    ? (theme === 'default' ? 'bg-slate-900 text-white' : 'bg-white/10 text-white')
                    : (theme === 'default' ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-white')
                  }`}
                  aria-pressed={selectedLanguage === 'fr'}
                >
                  FR
                </button>
              </div>
            </div>
          </div>
          {/* Sign Out - Unified */}
          <button
            className={`
              flex items-center rounded-lg transition-all duration-200 font-medium mt-auto
              ${styles.sidebarHover} ${styles.text}
              ${isCollapsed
                ? 'justify-center w-10 h-10 mx-auto p-0'
                : 'w-full gap-3 px-3 py-2.5'
              }
            `}
            title={isCollapsed ? t.logOut : ""}
          >
            <LogOut size={18} className="shrink-0" />
            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
              {t.logOut}
            </span>
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main
        ref={mainRef}
        className={`flex-1 min-w-0 overflow-y-auto h-full w-full pt-16 md:pt-0 relative overflow-x-hidden ${styles.main}`}
      >
        <div
          className={`min-h-full w-full ${
            isFullBleedView
              ? ''
              : 'max-w-[1440px] 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8'
          }`}
        >
          <div key={location.pathname} className="page-transition">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default Layout;
