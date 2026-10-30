import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ViewState } from '../../types';
import {
  LayoutDashboard,
  Layers,
  Map as MapIcon,
  Library as LibraryIcon,
  Sparkles,
  User,
  IdCard,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Activity,
  Settings as SettingsIcon,
  ChevronDown,
  Brain,
  Users,
  Trophy,
  BookOpen,
  Blocks,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage, type SelectedLanguage } from '../../context/LanguageContext';
import { VIEW_PATHS, pathToNavKey, isLessonPath, type NavKey } from '../../navigation/viewPaths';
import { features } from '../../config/features';
import { useReviewQueue } from '../review/reviewClient';
import BrandMark from './BrandMark';
import { shellThemeForView } from './shellTheme';

interface LayoutProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onLogout?: () => void;
  /** A bar above the page (Phase 4: components/legal/LegalNoticeBar). It sits in the same frame as
   *  ordinary pages, also above full-bleed ones (the dashboard, lessons). With the flag on the frame
   *  is always there: it holds the bar's live region, which has no height while it is empty. */
  notice?: React.ReactNode;
  children: React.ReactNode;
}

type NavItem = {
  key: NavKey;
  view: ViewState;
  label: string;
  icon: LucideIcon;
  /** Phase 6: a count after the label (the review cards left today); null or absent: none. */
  count?: number | null;
};

type NavGroup = {
  id: 'account' | 'samples';
  label: string;
  icon: LucideIcon;
  children: NavItem[];
};

const isGroup = (entry: NavItem | NavGroup): entry is NavGroup => 'children' in entry;

// Pages that live in the Account group (it opens itself when one is current).
const ACCOUNT_KEYS = new Set<NavKey>(['passport', 'history', 'badges', 'generated', 'myContent', 'characters']);

const LANGUAGE_OPTIONS: { value: SelectedLanguage; short: string; name: string; lang: string }[] = [
  { value: 'en', short: 'EN', name: 'English', lang: 'en' },
  { value: 'jp', short: 'JP', name: '日本語', lang: 'ja' },
  { value: 'fr', short: 'FR', name: 'Français', lang: 'fr' },
];

/** The content frame of ordinary (not full-bleed) pages; the notice slot uses it on every page. */
const CONTENT_FRAME = 'max-w-wide 2xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8';

const Layout: React.FC<LayoutProps> = ({ currentView, onNavigate, onLogout, notice, children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { language, selectedLanguage, setLanguage } = useLanguage();

  const activeKey = pathToNavKey(location.pathname);
  // Lesson reader routes get a 64px rail and the full width.
  const railMode = isLessonPath(location.pathname);
  // The mobile drawer always shows labels, whatever the desktop collapse state is.
  const collapsed = (railMode || isCollapsed) && !isMobileMenuOpen;

  const [openGroups, setOpenGroups] = useState<Set<NavGroup['id']>>(() => (
    new Set(activeKey && ACCOUNT_KEYS.has(activeKey) ? ['account'] : [])
  ));

  useEffect(() => {
    setTheme(shellThemeForView(currentView.toString()));
  }, [currentView, setTheme]);

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, left: 0 });
    } else {
      window.scrollTo(0, 0);
    }
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Open the group that holds the current page.
  useEffect(() => {
    if (activeKey && ACCOUNT_KEYS.has(activeKey)) {
      setOpenGroups((prev) => (prev.has('account') ? prev : new Set(prev).add('account')));
    }
  }, [activeKey]);

  // Mobile drawer: focus the first link on open, Esc closes and returns focus.
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    // Wait a tick: the drawer is visibility:hidden until its slide-in starts.
    const timer = window.setTimeout(() => {
      navRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    }, 50);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      // Keep Tab inside the drawer: the menu button and the drawer's controls, in a loop.
      if (event.key !== 'Tab') return;
      const sidebar = document.getElementById('app-sidebar');
      const items = [
        menuButtonRef.current,
        ...Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []),
      ].filter((el): el is HTMLElement => Boolean(el) && el!.offsetParent !== null);
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = index < 0
        ? 0
        : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      event.preventDefault();
      items[nextIndex].focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobileMenuOpen]);

  // The drawer is mobile-only; drop it when the viewport grows past md.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMobileMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Art and Vibe keep their dark shell; everything else uses the design tokens.
  const getThemeStyles = () => {
    switch (theme) {
      case 'art':
        return {
          dark: true,
          sidebar: 'bg-[#1c1917] border-stone-800 text-stone-400',
          sidebarActive: 'bg-stone-800 text-stone-100',
          sidebarHover: 'hover:bg-stone-800 hover:text-stone-200',
          main: 'bg-[#1c1917]',
          text: 'text-stone-400',
          mobileHeader: 'bg-[#1c1917] border-stone-800 text-stone-100',
          brandText: 'text-stone-100',
          iconButton: 'text-stone-300 hover:bg-stone-800 hover:text-stone-100',
          panel: 'bg-transparent border-stone-800',
          langOn: 'bg-stone-800 text-stone-100',
          langOff: 'text-stone-400 hover:text-stone-100',
        };
      case 'vibe':
        return {
          dark: true,
          sidebar: 'bg-black border-white/10 text-slate-400',
          sidebarActive: 'bg-white/10 text-white',
          sidebarHover: 'hover:bg-white/5 hover:text-white',
          main: 'bg-black',
          text: 'text-slate-400',
          mobileHeader: 'bg-black border-white/10 text-white',
          brandText: 'text-white',
          iconButton: 'text-white/80 hover:bg-white/10 hover:text-white',
          panel: 'bg-transparent border-white/10',
          langOn: 'bg-white/10 text-white',
          langOff: 'text-white/70 hover:text-white',
        };
      default:
        return {
          dark: false,
          sidebar: 'bg-surface border-line text-fg-2',
          sidebarActive: 'bg-primary-soft text-primary-text',
          sidebarHover: 'hover:bg-sunken hover:text-fg',
          main: 'bg-canvas',
          text: 'text-fg-3',
          mobileHeader: 'bg-surface border-line text-fg',
          brandText: 'text-fg',
          iconButton: 'text-fg-2 hover:bg-sunken hover:text-fg',
          panel: 'bg-sunken border-line',
          langOn: 'bg-fg text-canvas',
          langOff: 'text-fg-2 hover:text-fg',
        };
    }
  };

  const styles = getThemeStyles();

  const copy = {
    en: {
      skipToContent: 'Skip to content',
      mainNav: 'Main',
      openMenu: 'Open menu',
      openMenuReviews: (n: number) => `Open menu (${n} ${n === 1 ? 'review' : 'reviews'} due today)`,
      closeMenu: 'Close menu',
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Expand sidebar',
      dashboard: 'Dashboard',
      learningHub: 'Learning Content',
      review: 'Review',
      reviewDue: (n: number) => `${n} due today`,
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
      blocksGallery: 'Blocks Gallery',
      aiCharacters: 'AI Characters',
      account: 'Account',
      profileOverview: 'Student ID',
      profileHistory: 'History',
      profileBadges: 'Badges',
      profileGenerated: 'Generated',
      myContent: 'My Content',
      logOut: 'Log Out',
      language: 'Language',
      settings: 'Settings',
    },
    jp: {
      skipToContent: '本文へスキップ',
      mainNav: 'メイン',
      openMenu: 'メニューを開く',
      openMenuReviews: (n: number) => `メニューを開く（今日の復習 ${n} 枚）`,
      closeMenu: 'メニューを閉じる',
      collapseSidebar: 'サイドバーを折りたたむ',
      expandSidebar: 'サイドバーを広げる',
      dashboard: 'ダッシュボード',
      learningHub: '学習コンテンツ',
      review: '復習',
      reviewDue: (n: number) => `今日 ${n} 枚`,
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
      blocksGallery: 'ブロック見本帳',
      aiCharacters: 'AIキャラクター',
      account: 'アカウント',
      profileOverview: '学生証',
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

  // Phase 6: the review entry and today's count from the server (components/review/reviewClient.ts).
  // No entry while the server has no reviews (an older API); no count unless the server said so
  // (never a made-up zero for guests, errors or while loading).
  const review = useReviewQueue();
  const reviewCount = review.status === 'ready' && review.data && review.data.remainingToday > 0 ? review.data.remainingToday : null;

  const navEntries: (NavItem | NavGroup)[] = [
    { key: 'dashboard', view: ViewState.DASHBOARD, label: t.dashboard, icon: LayoutDashboard },
    { key: 'learning', view: ViewState.LEARNING_HUB, label: t.learningHub, icon: Layers },
    ...(review.status === 'unsupported' ? [] : [
      { key: 'review' as const, view: ViewState.REVIEW, label: t.review, icon: RotateCw, count: reviewCount },
    ]),
    { key: 'generator', view: ViewState.COURSE_GENERATOR, label: t.courseGenerator, icon: MapIcon },
    { key: 'diagnosis', view: ViewState.AI_DIAGNOSIS, label: t.aiDiagnosis, icon: Brain },
    { key: 'journal', view: ViewState.LIFE_JOURNAL, label: t.lifeJournal, icon: BookOpen },
    {
      id: 'account',
      label: t.account,
      icon: User,
      children: [
        { key: 'passport', view: ViewState.PROFILE, label: t.profileOverview, icon: IdCard },
        { key: 'history', view: ViewState.PROFILE_HISTORY, label: t.profileHistory, icon: Activity },
        { key: 'badges', view: ViewState.PROFILE_BADGES, label: t.profileBadges, icon: Trophy },
        { key: 'generated', view: ViewState.PROFILE_GENERATED, label: t.profileGenerated, icon: Sparkles },
        { key: 'myContent', view: ViewState.MY_CONTENT, label: t.myContent, icon: LibraryIcon },
        { key: 'characters', view: ViewState.AI_CHARACTERS, label: t.aiCharacters, icon: Users },
      ]
    },
    ...(features.devSamples ? [{
      id: 'samples' as const,
      label: t.risePathLab,
      icon: Sparkles,
      children: [
        { key: 'demoChecklist', view: ViewState.DEMO_CHECKLIST, label: t.checklist, icon: Sparkles },
        { key: 'demoChecklistGenerator', view: ViewState.DEMO_CHECKLIST_GENERATOR, label: t.checklistGenerator, icon: Sparkles },
        { key: 'demoConcept', view: ViewState.DEMO_CONCEPT, label: t.concept, icon: Sparkles },
        { key: 'demoDialogue', view: ViewState.DEMO_DIALOGUE, label: t.dialogue, icon: Sparkles },
        { key: 'demoWorkshop', view: ViewState.DEMO_WORKSHOP, label: t.workshop, icon: Sparkles },
        { key: 'demoBlender', view: ViewState.DEMO_BLENDER, label: t.blender, icon: Sparkles },
        { key: 'demoReflection', view: ViewState.DEMO_REFLECTION, label: t.reflection, icon: Sparkles },
        { key: 'devBlocks', view: ViewState.DEV_BLOCKS, label: t.blocksGallery, icon: Blocks },
      ] satisfies NavItem[],
    }] : []),
    { key: 'settings', view: ViewState.SETTINGS, label: t.settings, icon: SettingsIcon },
  ];

  const languageOptions = LANGUAGE_OPTIONS.filter((option) => option.value !== 'fr' || features.frLocale);

  const isFullBleedView = (
    railMode ||
    currentView === ViewState.DASHBOARD ||
    currentView === ViewState.LESSON ||
    currentView === ViewState.BLENDER_LESSON ||
    currentView === ViewState.GENERATED_LESSON_VIEW ||
    currentView === ViewState.AI_DIAGNOSIS
  );

  // Plain clicks navigate in-app; modified clicks keep the browser's link behaviour.
  const handleNavClick = (event: React.MouseEvent<HTMLAnchorElement>, view: ViewState) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(view);
    setIsMobileMenuOpen(false);
  };

  const toggleGroup = (group: NavGroup) => {
    if (railMode) {
      // The rail cannot expand; open the group's first page instead.
      onNavigate(group.children[0].view);
      return;
    }
    if (collapsed) {
      setIsCollapsed(false);
      setOpenGroups((prev) => new Set(prev).add(group.id));
      return;
    }
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group.id)) next.delete(group.id);
      else next.add(group.id);
      return next;
    });
  };

  const rowClass = `flex items-center rounded-control transition-colors duration-200 font-medium ${collapsed
    ? 'justify-center w-10 h-10 mx-auto p-0'
    : 'w-full gap-3 px-3 py-2.5 min-h-11 md:min-h-10'
  }`;

  const renderItem = (item: NavItem, nested = false) => {
    const isActive = activeKey === item.key;
    const count = typeof item.count === 'number' && item.count > 0 ? item.count : null;
    const countText = count !== null && item.key === 'review' ? t.reviewDue(count) : null;
    return (
      <li key={item.key}>
        <a
          href={VIEW_PATHS[item.view]}
          onClick={(event) => handleNavClick(event, item.view)}
          aria-current={isActive ? 'page' : undefined}
          title={collapsed ? (countText ? `${item.label} (${countText})` : item.label) : undefined}
          className={`${rowClass} ${nested ? 'pl-11 text-sm' : 'text-body'} ${isActive ? styles.sidebarActive : styles.sidebarHover} ${collapsed && countText ? 'relative' : ''}`}
        >
          {!nested && (
            <item.icon size={20} aria-hidden="true" className={`shrink-0 ${isActive ? '' : styles.text}`} />
          )}
          <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
          {countText ? (
            collapsed ? (
              <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
            ) : (
              <span aria-hidden="true" className="ml-auto rounded-full bg-primary-soft px-2 text-caption text-primary-text tabular-nums">{count}</span>
            )
          ) : null}
          {countText ? <span className="sr-only">{language === 'jp' ? `（${countText}）` : ` (${countText})`}</span> : null}
        </a>
      </li>
    );
  };

  const renderGroup = (group: NavGroup) => {
    const isOpen = !collapsed && openGroups.has(group.id);
    const hasActiveChild = group.children.some((child) => child.key === activeKey);
    const panelId = `nav-group-${group.id}`;
    return (
      <li key={group.id}>
        <button
          type="button"
          onClick={() => toggleGroup(group)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          title={collapsed ? group.label : undefined}
          className={`${rowClass} text-body ${collapsed ? '' : 'justify-between'} ${hasActiveChild && !isOpen ? styles.sidebarActive : styles.sidebarHover}`}
        >
          <span className="flex items-center gap-3 min-w-0">
            <group.icon size={20} aria-hidden="true" className={`shrink-0 ${hasActiveChild && !isOpen ? '' : styles.text}`} />
            <span className={collapsed ? 'sr-only' : 'truncate'}>{group.label}</span>
          </span>
          {!collapsed && (
            <ChevronDown size={14} aria-hidden="true" className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${styles.text}`} />
          )}
        </button>
        <ul id={panelId} hidden={!isOpen} className="pt-1 pb-2 space-y-1">
          {group.children.map((child) => renderItem(child, true))}
        </ul>
      </li>
    );
  };

  const skipToContent = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  // Print (the legal pages, design §2.4): the frame grows with its content and the app's chrome is
  // hidden, so a printout carries the whole page and not only the first screen of <main>.
  return (
    <div className="flex h-screen w-full overflow-hidden bg-canvas print:h-auto print:overflow-visible">
      <a
        href="#main-content"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-3"
      >
        {t.skipToContent}
      </a>

      {/* Mobile Header (the lesson reader brings its own bar) */}
      {!railMode && (
        <header
          data-theme={styles.dark ? 'dark' : undefined}
          className={`md:hidden fixed inset-x-0 top-0 z-50 h-14 border-b px-4 flex justify-between items-center print:hidden ${styles.mobileHeader}`}
        >
          <div className="flex items-center gap-2">
            <BrandMark size={28} />
            <span className={`font-bold tracking-tight ${styles.brandText}`}>Rise Path</span>
          </div>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-label={isMobileMenuOpen ? t.closeMenu : reviewCount !== null ? t.openMenuReviews(reviewCount) : t.openMenu}
            aria-expanded={isMobileMenuOpen}
            aria-controls="app-sidebar"
            className={`relative -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-control transition-colors ${styles.iconButton}`}
          >
            {isMobileMenuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
            {/* Phase 8: today's review count on the closed button (its name carries it; the open drawer shows it in the entry).
                In the corner, 2 px above the icon's top line: it never covers the line, whatever the number of digits. */}
            {!isMobileMenuOpen && reviewCount !== null ? (
              <span aria-hidden="true" className="absolute -right-0.5 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-caption leading-4 text-on-primary tabular-nums">
                {reviewCount}
              </span>
            ) : null}
          </button>
        </header>
      )}

      {/* Sidebar Navigation */}
      <div
        id="app-sidebar"
        data-theme={styles.dark ? 'dark' : undefined}
        className={`
          fixed md:relative z-40 h-full border-r flex flex-col transition-all duration-300 ease-in-out print:hidden
          ${styles.sidebar}
          ${isMobileMenuOpen ? 'translate-x-0' : 'max-md:invisible -translate-x-full md:translate-x-0'}
          w-(--rp-sidebar) ${collapsed ? 'md:w-(--rp-rail)' : 'md:w-(--rp-sidebar)'}
          pt-14 md:pt-0
        `}
      >
        {/* Collapse toggle, floating on the border */}
        {!railMode && (
          <button
            type="button"
            onClick={() => setIsCollapsed((value) => !value)}
            aria-label={isCollapsed ? t.expandSidebar : t.collapseSidebar}
            aria-expanded={!isCollapsed}
            aria-controls="app-sidebar"
            className="absolute -right-3 top-8 z-50 hidden md:flex w-6 h-6 rounded-full bg-surface border border-line shadow-1 items-center justify-center text-fg-3 hover:text-primary-text hover:border-primary transition-colors"
          >
            {isCollapsed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronLeft size={12} aria-hidden="true" />}
          </button>
        )}

        <div className={`hidden md:flex items-center gap-3 h-16 shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
          <BrandMark size={32} />
          {!collapsed && (
            <span className={`text-lg font-bold tracking-tight whitespace-nowrap ${styles.brandText}`}>Rise Path</span>
          )}
        </div>

        <nav
          ref={navRef}
          aria-label={t.mainNav}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-4 flex flex-col"
        >
          <ul className="space-y-1">
            {navEntries.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderItem(entry)))}
          </ul>

          <div className="mt-auto pt-4 space-y-1">
            <div
              role="group"
              aria-label={t.language}
              className={`flex items-center rounded-control border ${styles.panel} ${collapsed ? 'flex-col gap-1 px-0 py-1' : 'justify-between px-2 py-1.5'}`}
            >
              {!collapsed && (
                <span aria-hidden="true" className={`eyebrow ${styles.text}`}>{t.language}</span>
              )}
              <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'gap-1'}`}>
                {languageOptions.map((option) => {
                  const isSelected = selectedLanguage === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLanguage(option.value)}
                      aria-pressed={isSelected}
                      aria-label={option.name}
                      lang={option.lang}
                      className={`min-w-9 min-h-8 px-2 rounded-full text-xs font-bold transition-colors ${isSelected ? styles.langOn : styles.langOff}`}
                    >
                      {option.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLogout?.();
              }}
              title={collapsed ? t.logOut : undefined}
              className={`${rowClass} text-body ${styles.sidebarHover} ${styles.text}`}
            >
              <LogOut size={18} aria-hidden="true" className="shrink-0" />
              <span className={collapsed ? 'sr-only' : 'truncate'}>{t.logOut}</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Main Content Area */}
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        inert={isMobileMenuOpen || undefined}
        // scroll-pt-14: a heading scrolled or focused into view (a #section link, the table of
        // contents) lands below the fixed phone header, not under it.
        className={`flex-1 min-w-0 overflow-y-auto h-full w-full ${railMode ? '' : 'pt-14 scroll-pt-14 md:pt-0 md:scroll-pt-0'} relative overflow-x-hidden focus:outline-none print:h-auto print:overflow-visible print:pt-0 ${styles.main}`}
      >
        {notice ? <div className={CONTENT_FRAME}>{notice}</div> : null}
        <div
          className={`min-h-full w-full ${
            isFullBleedView
              ? ''
              : CONTENT_FRAME
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
          aria-hidden="true"
          className="fixed inset-0 bg-overlay z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default Layout;
