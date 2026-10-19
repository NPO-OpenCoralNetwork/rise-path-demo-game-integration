import React, { useState, useEffect, useRef, useId } from 'react';
import {
  ArrowLeft, List, Clock,
  ChevronRight, AlertTriangle, Info, Lightbulb, CheckCircle2,
  FileText, Presentation, ChevronLeft, Brain,
  ChevronDown
} from 'lucide-react';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { ViewState, DocChapter, LocalizedDocBlock, QuizData, LocalizedText } from '../../../types';
import { useTheme } from '../../../context/ThemeContext';
import { useLanguage } from '../../../context/LanguageContext';
import GlossaryText from '../../common/GlossaryText';
import VibeQuizView from './VibeQuizView';

// Configure PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Lang = 'en' | 'jp';

// Helper to handle both string (legacy/resolved) and LocalizedText
const getText = (content: string | LocalizedText | undefined, lang: Lang): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content[lang] || content['en'] || '';
};

// Track metadata keyed by the chapter id prefix ('vibe-ch3', 'unity-ch0-jp').
const TRACKS: Record<string, { world: string; name: { en: string; jp: string } }> = {
  vibe: { world: 'vibe', name: { en: 'Vibe Coding', jp: 'バイブコーディング' } },
  unity: { world: 'unity', name: { en: 'Unity × AI Game Dev', jp: 'Unity × AI ゲーム開発' } },
};

const parseChapterId = (id: string) => {
  const match = /^([a-z]+)-ch(\d+)/i.exec(id || '');
  if (!match) return { track: null, number: null };
  return { track: TRACKS[match[1].toLowerCase()] || null, number: Number(match[2]) };
};

// Titles carry their own "第0章｜" / "Chapter 1 | " prefix; the badge already shows the number.
const stripChapterPrefix = (title: string) =>
  title.replace(/^\s*(第\s*\d+\s*章|chapter\s*\d+)\s*[｜|:：]\s*/i, '');

const formatReadingTime = (value: string, lang: Lang) => {
  const minutes = /^(\d+)\s*min/i.exec(value);
  return minutes && lang === 'jp' ? `${minutes[1]}分` : value;
};

// Slide PDFs are build artifacts that are often not deployed (*.pdf is git-ignored), and the SPA
// fallback answers a missing file with index.html, so only a real PDF response enables the tab.
const usePdfAvailable = (pdfUrl?: string) => {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(false);
    if (!pdfUrl) return;
    const controller = new AbortController();
    fetch(pdfUrl, { method: 'HEAD', signal: controller.signal })
      .then((res) => setAvailable(res.ok && (res.headers.get('content-type') || '').includes('pdf')))
      .catch(() => {});
    return () => controller.abort();
  }, [pdfUrl]);
  return available;
};

const copy = {
  en: {
    fallbackTrack: 'Curriculum',
    chapter: (n: number) => `Chapter ${n}`,
    onThisPage: 'On this page',
    back: 'Back to course',
    backToCourse: 'Back to Course',
    takeQuiz: 'Take Quiz',
    complete: 'Complete',
    doc: 'Doc',
    slide: 'Slide',
    quiz: 'Quiz',
    viewMode: 'View mode',
    language: 'Language',
    mindMap: 'Interactive mind map',
    table: 'Table',
  },
  jp: {
    fallbackTrack: 'カリキュラム',
    chapter: (n: number) => `第${n}章`,
    onThisPage: 'このページの目次',
    back: 'コース一覧に戻る',
    backToCourse: 'コース一覧に戻る',
    takeQuiz: 'クイズに挑戦',
    complete: '完了',
    doc: 'ドキュメント',
    slide: 'スライド',
    quiz: 'クイズ',
    viewMode: '表示モード',
    language: '言語',
    mindMap: 'インタラクティブ・マインドマップ',
    table: '表',
  },
} as const;

interface VibeDocViewProps {
  onBack: () => void;
  onNavigate: (view: ViewState) => void;
  chapter: DocChapter;
  pdfUrl?: string;
  quizData?: QuizData;
  /** @deprecated The reader follows the app language from LanguageContext. */
  language?: 'en' | 'jp';
  /** @deprecated The reader uses LanguageContext's setLanguage. */
  setLanguage?: (lang: 'en' | 'jp') => void;
}

type ViewMode = 'doc' | 'slide' | 'quiz';

const VibeDocView: React.FC<VibeDocViewProps> = ({ onBack, chapter, pdfUrl, quizData }) => {
  const { setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const [activeSection, setActiveSection] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('doc');
  const observer = useRef<IntersectionObserver | null>(null);
  const slidesAvailable = usePdfAvailable(pdfUrl);
  const t = copy[language];

  const { track, number: chapterNumber } = parseChapterId(chapter.id);
  const trackName = track ? track.name[language] : t.fallbackTrack;
  const title = getText(chapter.title, language);

  const modes: { id: ViewMode; label: string; icon: typeof FileText }[] = [
    { id: 'doc', label: t.doc, icon: FileText },
    ...(slidesAvailable ? [{ id: 'slide' as const, label: t.slide, icon: Presentation }] : []),
    ...(quizData ? [{ id: 'quiz' as const, label: t.quiz, icon: Brain }] : []),
  ];

  useEffect(() => {
    setTheme('default');
    return () => setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    if (viewMode === 'slide' && !slidesAvailable) setViewMode('doc');
  }, [viewMode, slidesAvailable]);

  // Scroll Spy Logic
  useEffect(() => {
    if (viewMode !== 'doc') return;

    observer.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    }, { rootMargin: '-20% 0px -60% 0px' });

    chapter.sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.current?.observe(el);
    });

    return () => observer.current?.disconnect();
  }, [chapter, viewMode]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
    }
  };

  const renderModeToggle = () => (
    <div role="group" aria-label={t.viewMode} className="flex bg-slate-100 p-1 rounded-lg">
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={viewMode === id}
          onClick={() => setViewMode(id)}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
            viewMode === id
              ? 'bg-white text-purple-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans" data-world={track?.world}>
      <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-slate-100 flex items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label={t.back}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors shrink-0"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="eyebrow text-fg-3 truncate">{trackName}</span>
            <span className="text-sm font-bold text-slate-800 truncate">{title}</span>
          </div>
        </div>

        {modes.length > 1 && (
          <div className="hidden lg:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            {renderModeToggle()}
          </div>
        )}

        <div className="flex items-center gap-3 shrink-0">
          <div role="group" aria-label={t.language} className="flex bg-slate-50 rounded-lg p-1 border border-slate-200/60">
            {(['en', 'jp'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                aria-pressed={language === lang}
                onClick={() => setLanguage(lang)}
                className={`px-2 py-1 rounded-md text-xs font-bold transition-all ${language === lang ? 'bg-white text-slate-800 shadow-sm border border-slate-100' : 'text-fg-3 hover:text-slate-700'}`}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="hidden sm:flex text-xs font-medium text-fg-3 items-center gap-1">
            <Clock size={14} aria-hidden="true" /> {formatReadingTime(getText(chapter.readingTime, language), language)}
          </span>
        </div>
      </header>

      {modes.length > 1 && (
        <div className="lg:hidden sticky top-16 z-20 bg-white/90 backdrop-blur border-b border-slate-100 px-4 py-2 flex justify-center">
          {renderModeToggle()}
        </div>
      )}

      {viewMode === 'doc' && (
      <div className="pt-10 md:pt-14 pb-20 max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-12">

        {/* Main Content */}
        <article className="lg:col-span-8 lg:col-start-2 xl:col-span-7 xl:col-start-3 min-w-0">
          <header className="mb-12 text-center">
            {chapterNumber !== null && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-world-soft text-world eyebrow mb-6">
                {t.chapter(chapterNumber)}
              </div>
            )}
            <h1 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight tracking-tight break-words">
              {stripChapterPrefix(title)}
            </h1>
            <p className="text-lg md:text-xl text-fg-2 leading-relaxed break-words">
              {getText(chapter.subtitle, language)}
            </p>
          </header>

          <div className="space-y-16">
            {chapter.sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-24">
                <h2 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-3 group cursor-pointer break-words" onClick={() => scrollToSection(section.id)}>
                   <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-sm shrink-0 group-hover:bg-purple-100 group-hover:text-purple-600 transition-colors" aria-hidden="true">#</span>
                   {getText(section.title, language)}
                </h2>
                <div className="space-y-8">
                  {section.content.map((block, idx) => (
                    <BlockRenderer key={idx} block={block} language={language} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Chapter Footer */}
          <div className="mt-20 pt-10 border-t border-slate-100 flex flex-wrap justify-between items-center gap-4">
             <button type="button" onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-medium transition-colors">
                <ArrowLeft size={16} aria-hidden="true" /> {t.backToCourse}
             </button>
             <button
               type="button"
               onClick={() => {
                 if (quizData) setViewMode('quiz');
                 else onBack();
               }}
               className="bg-slate-900 text-white px-6 py-3 rounded-full font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
             >
                {quizData ? t.takeQuiz : t.complete} <CheckCircle2 size={18} aria-hidden="true" />
             </button>
          </div>
        </article>

        {/* Right Sidebar (TOC) */}
        <aside className="hidden xl:block col-span-2 relative">
          <nav className="sticky top-32" aria-label={t.onThisPage}>
             <h3 className="eyebrow text-fg-3 mb-4 flex items-center gap-2">
                <List size={14} aria-hidden="true" /> {t.onThisPage}
             </h3>
             <ul className="space-y-1 relative border-l border-slate-100">
                {chapter.sections.map((section) => (
                  <li key={section.id} className="relative">
                     <button
                        type="button"
                        onClick={() => scrollToSection(section.id)}
                        className={`text-sm py-1.5 pl-4 text-left w-full transition-colors border-l-2 -ml-0.5 ${
                           activeSection === section.id
                             ? 'border-purple-500 text-purple-600 font-medium'
                             : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                     >
                        {(getText(section.title, language).split('. ')[1] || getText(section.title, language))}
                     </button>
                  </li>
                ))}
             </ul>
          </nav>
        </aside>

      </div>
      )}

      {viewMode === 'slide' && pdfUrl && slidesAvailable && (
         <SlideViewer pdfUrl={pdfUrl} onBack={() => setViewMode('doc')} language={language} />
      )}

      {viewMode === 'quiz' && quizData && (
         <div className="min-h-screen bg-slate-50">
            <VibeQuizView
               quiz={quizData}
               // The quiz renders its own result screen; nothing to record here yet.
               onComplete={() => {}}
               onBack={() => setViewMode('doc')}
            />
         </div>
      )}
    </div>
  );
};

// --- Custom Slide Viewer ---
const SLIDE_TIMINGS = [
  0, 28, 55, 75, 95, 125, 145, 160, 185, 205, 220, 240, 255, 275, 290, 9999
];

// --- MindMap Block Component ---
const MindMapNode: React.FC<{
  node: { text: LocalizedText | string; details?: LocalizedText | string; children?: any[] };
  language: Lang;
  isRoot?: boolean;
}> = ({ node, language, isRoot }) => {
  const [isOpen, setIsOpen] = useState(isRoot); // Root is open by default

  return (
    <div className="flex flex-col gap-2">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`
          p-4 rounded-xl border-2 transition-all cursor-pointer group relative
          ${isRoot
            ? 'bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-200'
            : 'bg-white border-slate-100 hover:border-purple-200 text-slate-700 shadow-sm'}
        `}
      >
        <div className="flex items-center justify-between gap-4">
          <span className={`font-bold ${isRoot ? 'text-lg' : 'text-sm'}`}>{getText(node.text, language)}</span>
          {node.children && (
            <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
              <ChevronDown size={16} className={isRoot ? 'text-white/70' : 'text-fg-3'} />
            </div>
          )}
        </div>

        {isOpen && node.details && (
          <div className={`mt-2 text-xs leading-relaxed animate-in fade-in slide-in-from-top-1 duration-300 ${isRoot ? 'text-purple-100' : 'text-slate-500'}`}>
            {getText(node.details, language)}
          </div>
        )}

        {/* Connecting Line (Visual only) */}
        {!isRoot && <div className="absolute -left-4 top-1/2 w-4 h-0.5 bg-slate-100 group-hover:bg-purple-100" />}
      </div>

      {isOpen && node.children && (
        <div className="pl-8 border-l-2 border-purple-50 flex flex-col gap-4 mt-2 ml-4">
          {node.children.map((child, idx) => (
            <MindMapNode key={idx} node={child} language={language} />
          ))}
        </div>
      )}
    </div>
  );
};

const MindMapBlock: React.FC<{ root: any; language: Lang }> = ({ root, language }) => {
  return (
    <div className="my-12 p-8 bg-slate-50/50 rounded-3xl border border-slate-100">
      <div className="flex items-center gap-2 mb-8 eyebrow text-fg-3">
        <Brain size={14} className="text-purple-500" aria-hidden="true" /> {copy[language].mindMap}
      </div>
      <div className="max-w-xl mx-auto">
        <MindMapNode node={root} language={language} isRoot />
      </div>
    </div>
  );
};

const SlideViewer: React.FC<{ pdfUrl: string; onBack: () => void; language: Lang }> = ({ pdfUrl, onBack, language }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState(0.9);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);

  const t = {
    en: { exit: "Exit", loading: "Loading Slides...", failed: "The slides are not available right now.", autoSync: "Auto-Sync", prev: 'Previous slide', next: 'Next slide', play: 'Play narration', pause: 'Pause narration', seek: 'Narration position' },
    jp: { exit: "終了", loading: "スライドを読み込み中...", failed: "スライドは現在表示できません。", autoSync: "自動同期", prev: '前のスライド', next: '次のスライド', play: 'ナレーションを再生', pause: 'ナレーションを一時停止', seek: 'ナレーションの再生位置' }
  }[language];

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPage = prevPageNumber + offset;
      return Math.min(Math.max(1, newPage), numPages);
    });
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current || !autoAdvance) return;
    const currentTime = audioRef.current.currentTime;
    let nextSlide = 1;
    for (let i = 0; i < SLIDE_TIMINGS.length; i++) {
      if (currentTime >= SLIDE_TIMINGS[i]) nextSlide = i + 1;
      else break;
    }
    if (nextSlide !== pageNumber && nextSlide <= numPages) setPageNumber(nextSlide);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') changePage(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') changePage(-1);
      else if (event.key === 'Escape') onBack();
      else if (event.key === ' ') { event.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [numPages, isPlaying]);

  return (
    <div className="fixed inset-0 bg-[#0f172a] flex flex-col items-center justify-center z-[100]">
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-50 bg-gradient-to-b from-black/50 to-transparent">
        <button type="button" onClick={onBack} className="text-white/80 hover:text-white flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors">
          <ArrowLeft size={20} aria-hidden="true" /> {t.exit}
        </button>
        <div className="flex items-center gap-4">
           <button
             type="button"
             onClick={() => setAutoAdvance(!autoAdvance)}
             aria-pressed={autoAdvance}
             className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${autoAdvance ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-transparent border-white/20 text-white/50'}`}
           >
             {t.autoSync}: {autoAdvance ? 'ON' : 'OFF'}
           </button>
           <div className="text-white/80 text-sm font-medium tabular">{pageNumber} / {numPages}</div>
        </div>
      </div>

      <audio ref={audioRef} src="/audio/vibe/chapter1.wav" onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} />

      <div className="flex-1 flex items-center justify-center w-full h-full p-4 md:p-8 overflow-hidden relative">
        <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess} className="flex items-center justify-center shadow-2xl" loading={<div className="flex flex-col items-center text-white/70 gap-3"><div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div><span className="text-sm">{t.loading}</span></div>} error={<div className="text-white/80 bg-white/10 px-4 py-2 rounded-lg text-sm">{t.failed}</div>}>
          <div className="relative rounded-xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/5">
             <Page pageNumber={pageNumber} scale={scale} renderAnnotationLayer={false} renderTextLayer={false} className="transition-opacity duration-200" />
             <div className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize z-10" onClick={() => changePage(-1)} />
             <div className="absolute inset-y-0 right-0 w-1/3 cursor-e-resize z-10" onClick={() => changePage(1)} />
          </div>
        </Document>
        <button type="button" aria-label={t.prev} onClick={() => changePage(-1)} disabled={pageNumber <= 1} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all disabled:opacity-0"><ChevronLeft size={32} aria-hidden="true" /></button>
        <button type="button" aria-label={t.next} onClick={() => changePage(1)} disabled={pageNumber >= numPages} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all disabled:opacity-0"><ChevronRight size={32} aria-hidden="true" /></button>
      </div>

      <div className="w-full bg-black/40 backdrop-blur-md border-t border-white/10 p-4 flex items-center justify-center gap-4 relative z-50">
         <button type="button" aria-label={isPlaying ? t.pause : t.play} onClick={togglePlay} className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform">
            {isPlaying ? <span className="w-4 h-4 bg-black rounded-sm" /> : <Presentation size={20} className="ml-1" aria-hidden="true" />}
         </button>
         <div aria-label={t.seek} className="flex-1 max-w-2xl h-1.5 bg-white/10 rounded-full overflow-hidden relative cursor-pointer" onClick={(e) => { if (audioRef.current) { const rect = e.currentTarget.getBoundingClientRect(); const percent = (e.clientX - rect.left) / rect.width; audioRef.current.currentTime = percent * audioRef.current.duration; } }}>
            <div className="absolute inset-y-0 left-0 bg-purple-500 transition-all duration-100" style={{ width: `${audioRef.current ? (audioRef.current.currentTime / audioRef.current.duration) * 100 : 0}%` }} />
         </div>
      </div>
    </div>
  );
};

// --- Mermaid Helpers ---
type MermaidDiagramType = 'flowchart' | 'sequence' | 'er' | 'other';

// Lesson content can come from external authors and LLMs, so diagrams render in strict mode
// (no click handlers, no raw HTML in labels) and the SVG is sanitized again before injection.
const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'strict',
  suppressErrorRendering: true,
  fontFamily: '"IBM Plex Sans","Noto Sans JP",ui-sans-serif,system-ui,sans-serif',
  flowchart: {
    curve: 'basis',
    nodeSpacing: 40,
    rankSpacing: 50
  },
  themeVariables: {
    primaryColor: '#ffffff',
    primaryTextColor: '#0f172a',
    primaryBorderColor: '#e2e8f0',
    lineColor: '#94a3b8',
    secondaryColor: '#fff7ed',
    tertiaryColor: '#f1f5f9',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f8fafc',
    clusterBorder: '#e2e8f0',
    noteBkgColor: '#ecfeff',
    noteTextColor: '#0f172a',
    noteBorderColor: '#67e8f9',
    fontSize: '14px'
  }
} as const;

// Mermaid draws flowchart labels as HTML inside <foreignObject>, so that element is allowed
// as the only SVG-to-HTML switch; the HTML inside it still goes through the HTML allow-list.
const sanitizeMermaidSvg = (svg: string) =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });

const detectMermaidType = (chart: string): MermaidDiagramType => {
  const stripped = chart
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^%%.*$/gm, '')
    .trim();
  const firstLine = stripped.split('\n').find((line) => line.trim().length > 0)?.trim().toLowerCase() || '';
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) return 'flowchart';
  if (firstLine.startsWith('sequencediagram')) return 'sequence';
  if (firstLine.startsWith('erdiagram')) return 'er';
  return 'other';
};

const getMermaidThemeForType = (type: MermaidDiagramType) => {
  switch (type) {
    case 'sequence':
      return {
        primaryColor: '#ffffff',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#bae6fd',
        lineColor: '#38bdf8',
        secondaryColor: '#ecfeff',
        tertiaryColor: '#f0f9ff',
        edgeLabelBackground: '#ffffff',
        noteBkgColor: '#cffafe',
        noteTextColor: '#0f172a',
        noteBorderColor: '#22d3ee',
        actorBkg: '#f0f9ff',
        actorBorder: '#38bdf8',
        actorTextColor: '#0f172a',
        actorLineColor: '#38bdf8',
        signalColor: '#0284c7',
        signalTextColor: '#0f172a'
      };
    case 'er':
      return {
        primaryColor: '#ffffff',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#c4b5fd',
        lineColor: '#8b5cf6',
        secondaryColor: '#f5f3ff',
        tertiaryColor: '#f8fafc',
        edgeLabelBackground: '#ffffff'
      };
    case 'flowchart':
      return {
        primaryColor: '#ffffff',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#fed7aa',
        lineColor: '#f59e0b',
        secondaryColor: '#fff7ed',
        tertiaryColor: '#f8fafc',
        edgeLabelBackground: '#ffffff',
        clusterBkg: '#fff7ed',
        clusterBorder: '#fed7aa',
        noteBkgColor: '#fef9c3',
        noteTextColor: '#0f172a',
        noteBorderColor: '#fbbf24'
      };
    default:
      return null;
  }
};

const injectMermaidTheme = (chart: string, type: MermaidDiagramType) => {
  if (/%%\{\s*init:/i.test(chart)) return chart;
  const themeVariables = getMermaidThemeForType(type);
  if (!themeVariables) return chart;
  const directive = `%%{init: ${JSON.stringify({ theme: 'base', themeVariables })}}%%`;
  return `${directive}\n${chart}`;
};

const injectFlowchartClasses = (chart: string) => {
  const importantKeywords = [/重要/, /Important/i, /Key/i, /Critical/i, /必須/];
  const warningKeywords = [/注意/, /Warning/i, /Caution/i, /Risk/i, /危険/];
  const patterns = [
    /\b([A-Za-z0-9_]+)\s*\[\[([^\]]+)\]\]/g,
    /\b([A-Za-z0-9_]+)\s*\[([^\]]+)\]/g,
    /\b([A-Za-z0-9_]+)\s*\(\(([^)]+)\)\)/g,
    /\b([A-Za-z0-9_]+)\s*\(([^)]+)\)/g,
    /\b([A-Za-z0-9_]+)\s*\{([^}]+)\}/g
  ];

  const importantNodes = new Set<string>();
  const warningNodes = new Set<string>();

  patterns.forEach((pattern) => {
    for (const match of chart.matchAll(pattern)) {
      const id = match[1];
      const rawLabel = match[2] || '';
      const label = rawLabel.replace(/^["'`]|["'`]$/g, '').trim();
      if (!label) continue;
      if (warningKeywords.some((r) => r.test(label))) {
        warningNodes.add(id);
      } else if (importantKeywords.some((r) => r.test(label))) {
        importantNodes.add(id);
      }
    }
  });

  if (importantNodes.size === 0 && warningNodes.size === 0) return chart;

  const classLines: string[] = [];
  if (!/classDef\s+important\b/i.test(chart)) {
    classLines.push('classDef important fill:#fff7ed,stroke:#fb923c,stroke-width:2.5px,color:#7c2d12;');
  }
  if (!/classDef\s+warning\b/i.test(chart)) {
    classLines.push('classDef warning fill:#fff1f2,stroke:#f97316,stroke-width:2px,stroke-dasharray:4 2,color:#7f1d1d;');
  }
  if (importantNodes.size > 0) {
    classLines.push(`class ${Array.from(importantNodes).join(',')} important;`);
  }
  if (warningNodes.size > 0) {
    classLines.push(`class ${Array.from(warningNodes).join(',')} warning;`);
  }

  return `${chart}\n\n%% auto styles %%\n${classLines.join('\n')}\n`;
};

// --- Mermaid Block Component ---
const MermaidBlock: React.FC<{ chart: string; caption?: LocalizedText | string; language: Lang }> = ({ chart, caption, language }) => {
  const [svgContent, setSvgContent] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const id = useId().replace(/:/g, '');
  const diagramType = detectMermaidType(chart);
  const containerStyleByType: Record<MermaidDiagramType, { bg: string; border: string; label: string }> = {
    flowchart: {
      bg: 'from-amber-50/70 via-white to-slate-50',
      border: 'border-amber-200/60',
      label: 'text-amber-600'
    },
    sequence: {
      bg: 'from-cyan-50/70 via-white to-slate-50',
      border: 'border-cyan-200/60',
      label: 'text-cyan-600'
    },
    er: {
      bg: 'from-violet-50/70 via-white to-slate-50',
      border: 'border-violet-200/60',
      label: 'text-violet-600'
    },
    other: {
      bg: 'from-slate-50 via-white to-amber-50/60',
      border: 'border-slate-200',
      label: 'text-slate-500'
    }
  };
  const containerStyle = containerStyleByType[diagramType];
  const labelTextByType: Record<MermaidDiagramType, { en: string; jp: string }> = {
    flowchart: { en: 'Flow', jp: 'フロー' },
    sequence: { en: 'Sequence', jp: 'シーケンス' },
    er: { en: 'ER', jp: 'ER' },
    other: { en: 'Diagram', jp: '図' }
  };
  const failedText = {
    en: 'This diagram could not be drawn. Its source is shown instead.',
    jp: '図を描画できませんでした。代わりに元のテキストを表示しています。'
  }[language];
  const captionText = caption ? getText(caption, language) : '';

  useEffect(() => {
    let cancelled = false;
    const renderChart = async () => {
      try {
        mermaid.initialize(MERMAID_CONFIG);
        const themedChart = injectMermaidTheme(
          diagramType === 'flowchart' ? injectFlowchartClasses(chart) : chart,
          diagramType
        );
        const uniqueRenderId = `mermaid-svg-${id}-${Date.now()}`;
        const { svg } = await mermaid.render(uniqueRenderId, themedChart);
        if (cancelled) return;
        setSvgContent(sanitizeMermaidSvg(svg));
        setFailed(false);
      } catch {
        if (cancelled) return;
        setSvgContent('');
        setFailed(true);
      }
    };
    renderChart();
    return () => { cancelled = true; };
  }, [chart, id]);

  return (
    <figure className={`my-10 p-6 sm:p-8 bg-gradient-to-br ${containerStyle.bg} rounded-2xl border ${containerStyle.border} shadow-[0_12px_30px_rgba(15,23,42,0.08)] flex flex-col items-center justify-center relative`}>
       <div className={`absolute top-4 right-4 px-2 py-1 bg-white/90 backdrop-blur rounded-full border border-slate-200 text-xs font-bold uppercase tracking-widest ${containerStyle.label}`} aria-hidden="true">
         {labelTextByType[diagramType][language]}
       </div>
       {failed ? (
         <div className="w-full pt-8">
           <p className="text-sm text-fg-2 mb-3">{failedText}</p>
           <pre className="overflow-x-auto rounded-lg bg-sunken p-4 text-xs font-mono text-fg-2 whitespace-pre">{chart}</pre>
         </div>
       ) : (
         <div
           role="img"
           aria-label={captionText || labelTextByType[diagramType][language]}
           className="w-full flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:rounded-lg [&_svg]:drop-shadow-[0_8px_16px_rgba(15,23,42,0.08)]"
           dangerouslySetInnerHTML={{ __html: svgContent }}
         />
       )}
       {captionText && <figcaption className="mt-4 text-sm text-slate-500 font-medium text-center">{captionText}</figcaption>}
    </figure>
  );
};

// --- Table Block Component ---
// Mirrors the lesson reader's TableBlock: 1px rules, a sunken header row, and a sticky first
// column so wide comparison tables scroll sideways on phones instead of squeezing the text.
const TableBlock: React.FC<{ headers: LocalizedText[]; rows: LocalizedText[][]; language: Lang }> = ({ headers, rows, language }) => {
  const headerTexts = headers.map((header) => getText(header, language));
  return (
    <figure className="my-8">
      <div
        role="region"
        tabIndex={0}
        aria-label={`${copy[language].table}: ${headerTexts.join(' / ')}`}
        className="overflow-x-auto rounded-card border border-line bg-surface"
      >
        <table className="w-full border-separate border-spacing-0 text-left text-sm leading-relaxed">
          <thead>
            <tr>
              {headerTexts.map((header, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`bg-sunken px-4 py-3 align-bottom font-semibold text-fg border-b border-line ${i === 0 ? 'sticky left-0 z-10 min-w-28 border-r' : 'min-w-40'}`}
                >
                  <GlossaryText text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isLast = ri === rows.length - 1;
              return (
                <tr key={ri}>
                  {row.map((cell, ci) =>
                    ci === 0 ? (
                      <th
                        key={ci}
                        scope="row"
                        className={`sticky left-0 z-10 bg-surface px-4 py-3 align-top font-medium text-fg border-r border-line ${isLast ? '' : 'border-b'}`}
                      >
                        <GlossaryText text={getText(cell, language)} />
                      </th>
                    ) : (
                      <td key={ci} className={`px-4 py-3 align-top text-fg-2 border-line ${isLast ? '' : 'border-b'}`}>
                        <GlossaryText text={getText(cell, language)} />
                      </td>
                    )
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
};

// --- Block Renderers ---

const BlockRenderer: React.FC<{ block: LocalizedDocBlock; language: Lang }> = ({ block, language }) => {
   switch (block.type) {
      case 'mindmap':
         return <MindMapBlock root={block.root} language={language} />;
      case 'text':
         return (
            <p className={`
               leading-8 text-slate-700
               ${block.style === 'lead' ? 'text-xl font-light text-slate-600 mb-8' : 'text-base'}
               ${block.style === 'quote' ? 'text-lg text-slate-600 border-l-4 border-slate-200 pl-4 py-1' : ''}
            `}>
               {/* Use localized text AND GlossaryText */}
               <GlossaryText text={getText(block.text, language)} />
            </p>
         );

      case 'image':
         {
            const src = block.src || block.fallbackSrc;
            if (!src) return null;
            return (
               <figure className={`my-8 ${block.layout === 'full' ? '-mx-4 sm:-mx-6 md:-mx-12' : ''}`}>
                  <img src={src} alt={block.alt} className="w-full rounded-xl shadow-md border border-slate-100" />
                  {block.caption && <figcaption className="text-center text-xs text-fg-3 mt-2 font-medium">{getText(block.caption, language)}</figcaption>}
               </figure>
            );
         }

      case 'code':
         return (
            <div className="my-6 rounded-xl overflow-hidden bg-[#1e1e1e] shadow-lg border border-slate-800/50 group">
               {block.filename && <div className="bg-[#252526] px-4 py-2 text-xs text-slate-400 font-mono border-b border-white/5 flex justify-between items-center"><span>{block.filename}</span><span className="uppercase opacity-50">{block.language}</span></div>}
               <pre className="p-4 overflow-x-auto text-sm font-mono text-blue-100 leading-relaxed"><code>{block.code}</code></pre>
            </div>
         );

      case 'callout': {
         const variants = {
            info: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-900', icon: Info, iconColor: 'text-blue-500' },
            warning: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-900', icon: AlertTriangle, iconColor: 'text-amber-500' },
            tip: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-900', icon: Lightbulb, iconColor: 'text-emerald-500' },
            success: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-900', icon: CheckCircle2, iconColor: 'text-green-500' },
         };
         const style = variants[block.variant] || variants.info;
         const Icon = style.icon;
         return (
            <div className={`my-8 p-6 rounded-xl border ${style.bg} ${style.border} flex gap-4`}>
               <div className={`mt-0.5 shrink-0 ${style.iconColor}`}><Icon size={20} aria-hidden="true" /></div>
               <div className="min-w-0">
                  {block.title && <h4 className={`font-bold text-sm uppercase tracking-wide mb-2 ${style.text} opacity-80`}>{getText(block.title, language)}</h4>}
                  <p className={`text-sm leading-relaxed ${style.text}`}>
                     <GlossaryText text={getText(block.text, language)} />
                  </p>
               </div>
            </div>
         );
      }

      case 'list': {
         const listStyle = block.style || 'bullet';
         const isKeyed = listStyle === 'key';
         const renderListItem = (item: LocalizedText) => {
            const text = getText(item, language);
            if (!isKeyed) return <GlossaryText text={text} />;
            const match = text.match(/^(.+?)([:：])(.*)$/);
            if (!match) return <GlossaryText text={text} />;
            const label = match[1].trim();
            const separator = match[2];
            const rest = match[3].trim();
            const spacer = separator === '：' ? '' : ' ';
            return (
               <span>
                  <span className="font-semibold underline decoration-amber-300 decoration-2 underline-offset-4">
                     <GlossaryText text={`${label}${separator}`} />
                  </span>
                  {rest ? (
                     <span>
                        {spacer}
                        <GlossaryText text={rest} />
                     </span>
                  ) : null}
               </span>
            );
         };
         if (listStyle === 'number') {
            // A real <ol>: list items must stay display:list-item for the numbers to render.
            return (
               <ol className="my-6 list-decimal space-y-3 pl-6 text-slate-700 leading-relaxed marker:font-semibold marker:text-fg-3">
                  {block.items.map((item, i) => (
                     <li key={i} className="pl-1">{renderListItem(item)}</li>
                  ))}
               </ol>
            );
         }
         return (
            <ul className="my-6 space-y-3">
               {block.items.map((item, i) => (
                  <li key={i} className="flex gap-3 text-slate-700 leading-relaxed group">
                     <span
                        aria-hidden="true"
                        className={`mt-2 shrink-0 transition-transform ${isKeyed ? 'w-1 h-5 rounded bg-amber-300/80' : 'w-1.5 h-1.5 rounded-full bg-purple-400 group-hover:scale-125'}`}
                     />
                     <span className="min-w-0">{renderListItem(item)}</span>
                  </li>
               ))}
            </ul>
         );
      }

      case 'table':
         if (!block.headers || !block.rows) return null;
         return <TableBlock headers={block.headers} rows={block.rows} language={language} />;

      case 'mermaid':
         return <MermaidBlock chart={block.chart} caption={block.caption} language={language} />;

      default:
         return null;
   }
};

export default VibeDocView;
