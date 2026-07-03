import React, { useEffect, useState } from 'react';
import { Course } from '../../../types';
import { COURSES_DATA } from '../../../services/curriculumData';
import { fetchGeneratedCourses } from '../../../services/curriculumApi';
import { Briefcase, Clock, Filter, Search, X } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface CourseListProps {
  onSelectCourse: (course: Course) => void;
}

const CourseList: React.FC<CourseListProps> = ({ onSelectCourse }) => {
  const { language } = useLanguage();
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [selectedDurations, setSelectedDurations] = useState<string[]>([]);
  const [selectedProgress, setSelectedProgress] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const copy = {
    en: {
      title: 'Curriculum',
      subtitle: 'Choose a path to boost your fluency.',
      lessons: 'Lessons',
      completed: 'Completed',
      startLearning: 'Start Learning',
      searchPlaceholder: 'Search courses, topics, or tags...',
      filters: 'Filters',
      clear: 'Clear',
      results: 'results',
      groups: {
        level: 'Level',
        duration: 'Duration',
        progress: 'Progress',
        category: 'Category',
        format: 'Format',
        goal: 'Goal'
      },
      levels: {
        beginner: 'Beginner',
        intermediate: 'Intermediate',
        advanced: 'Advanced'
      },
      durations: {
        short: 'Short (≤30m)',
        medium: 'Medium (30–90m)',
        long: 'Long (90m+)'
      },
      progress: {
        notStarted: 'Not started',
        inProgress: 'In progress',
        completed: 'Completed'
      },
      formats: {
        doc: 'Docs',
        quiz: 'Quiz',
        project: 'Project',
        workshop: 'Workshop'
      },
      goals: {
        career: 'Career',
        travel: 'Travel',
        hobby: 'Hobby',
        research: 'Research',
        culture: 'Culture',
        wellness: 'Wellness',
        academia: 'Academic'
      },
      categories: {
        ai: 'AI & Tech',
        language: 'Language',
        math: 'Math',
        history: 'History',
        craft: 'Craft',
        culture: 'Culture',
        wellness: 'Wellness',
        research: 'Research',
        art: 'Art',
        game: 'Game Dev'
      }
    },
    jp: {
      title: 'カリキュラム',
      subtitle: '学習パスを選択してください。',
      lessons: 'レッスン',
      completed: '完了',
      startLearning: '学習を開始',
      searchPlaceholder: 'コース名・トピック・タグで検索...',
      filters: 'フィルター',
      clear: 'クリア',
      results: '件',
      groups: {
        level: 'レベル',
        duration: '所要時間',
        progress: '進捗',
        category: 'カテゴリ',
        format: '形式',
        goal: '目的'
      },
      levels: {
        beginner: '初級',
        intermediate: '中級',
        advanced: '上級'
      },
      durations: {
        short: '短時間（〜30分）',
        medium: '中時間（30〜90分）',
        long: '長時間（90分〜）'
      },
      progress: {
        notStarted: '未着手',
        inProgress: '進行中',
        completed: '完了'
      },
      formats: {
        doc: 'ドキュメント',
        quiz: 'クイズ',
        project: 'プロジェクト',
        workshop: 'ワークショップ'
      },
      goals: {
        career: '仕事',
        travel: '旅行',
        hobby: '趣味',
        research: '研究',
        culture: '文化',
        wellness: 'ウェルネス',
        academia: '学術'
      },
      categories: {
        ai: 'AI・テック',
        language: '言語',
        math: '数学',
        history: '歴史',
        craft: 'クラフト',
        culture: '文化',
        wellness: 'ウェルネス',
        research: '研究',
        art: 'アート',
        game: 'ゲーム開発'
      }
    }
  } as const;
  const t = copy[language];

  const levelOptions = ['beginner', 'intermediate', 'advanced'] as const;
  const durationOptions = ['short', 'medium', 'long'] as const;
  const progressOptions = ['notStarted', 'inProgress', 'completed'] as const;
  const formatOptions = ['doc', 'quiz', 'project', 'workshop'] as const;
  const goalOptions = ['career', 'travel', 'hobby', 'research', 'culture', 'wellness', 'academia'] as const;

  const getDurationBucket = (minutes?: number) => {
    if (!minutes) return 'medium';
    if (minutes <= 30) return 'short';
    if (minutes <= 90) return 'medium';
    return 'long';
  };

  const getProgressBucket = (progress: number) => {
    if (progress <= 0) return 'notStarted';
    if (progress >= 100) return 'completed';
    return 'inProgress';
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  };

  const resolveCategoryLabel = (course: Course) => {
    const key = course.categoryKey || course.category;
    return (t.categories as any)?.[key] || course.category;
  };

  const resolveText = (text: string | { en: string; jp: string; fr?: string }) => {
    if (typeof text === 'string') return text;
    return text[language] || text.en;
  };

  const getUniqueValues = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

  const categoryOptions = React.useMemo(() => {
    const keys = courses.map(c => c.categoryKey || c.category).filter(Boolean) as string[];
    const unique = getUniqueValues(keys);
    return unique.length > 0 ? unique : Object.keys(t.categories);
  }, [courses, t.categories]);

  const toggleValue = (value: string, list: string[], setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    setList(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const clearFilters = () => {
    setQuery('');
    setSelectedLevels([]);
    setSelectedDurations([]);
    setSelectedProgress([]);
    setSelectedCategories([]);
    setSelectedFormats([]);
    setSelectedGoals([]);
  };

  const filteredCourses = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter(course => {
      const categoryKey = course.categoryKey || course.category;
      const tags = (course.tags || []).join(' ').toLowerCase();
      const title = resolveText(course.title);
      const description = resolveText(course.description);

      const haystack = [
        title,
        description,
        course.category,
        categoryKey,
        tags
      ].filter(Boolean).join(' ').toLowerCase();
      if (q && !haystack.includes(q)) return false;

      if (selectedLevels.length > 0 && (!course.level || !selectedLevels.includes(course.level))) return false;

      const durationBucket = getDurationBucket(course.durationMinutes);
      if (selectedDurations.length > 0 && !selectedDurations.includes(durationBucket)) return false;

      const progressBucket = getProgressBucket(course.progress);
      if (selectedProgress.length > 0 && !selectedProgress.includes(progressBucket)) return false;

      if (selectedCategories.length > 0 && !selectedCategories.includes(categoryKey)) return false;

      if (selectedFormats.length > 0) {
        const formats = course.formats || [];
        if (!selectedFormats.some(f => formats.includes(f))) return false;
      }

      if (selectedGoals.length > 0) {
        const goals = course.goals || [];
        if (!selectedGoals.some(g => goals.includes(g))) return false;
      }

      return true;
    });
  }, [courses, query, selectedLevels, selectedDurations, selectedProgress, selectedCategories, selectedFormats, selectedGoals, language]);

  useEffect(() => {
    let isMounted = true;

    const loadCourses = async () => {
      try {
        const generated = await fetchGeneratedCourses();
        if (!isMounted) return;
        setCourses(generated);
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load generated curricula:', error);
        setCourses([]); // Set empty array on failure
      }
    };

    loadCourses();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl xl:max-w-[1440px] w-full mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 break-words">{t.title}</h1>
        <p className="text-slate-500 mt-2 break-words">{t.subtitle}</p>

        <div className="mt-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                  showFilters ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Filter size={16} />
                {t.filters}
              </button>
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <X size={16} />
                {t.clear}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="px-3 py-1 rounded-full bg-slate-100 font-semibold">
              {filteredCourses.length} {t.results}
            </span>
          </div>

          {showFilters && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.level}</p>
                <div className="flex flex-wrap gap-2">
                  {levelOptions.map((level) => (
                    <button
                      key={level}
                      onClick={() => toggleValue(level, selectedLevels, setSelectedLevels)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedLevels.includes(level)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.levels as any)[level]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.duration}</p>
                <div className="flex flex-wrap gap-2">
                  {durationOptions.map((duration) => (
                    <button
                      key={duration}
                      onClick={() => toggleValue(duration, selectedDurations, setSelectedDurations)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedDurations.includes(duration)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.durations as any)[duration]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.progress}</p>
                <div className="flex flex-wrap gap-2">
                  {progressOptions.map((status) => (
                    <button
                      key={status}
                      onClick={() => toggleValue(status, selectedProgress, setSelectedProgress)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedProgress.includes(status)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.progress as any)[status]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.category}</p>
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => toggleValue(cat, selectedCategories, setSelectedCategories)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedCategories.includes(cat)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.categories as any)[cat] || cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.format}</p>
                <div className="flex flex-wrap gap-2">
                  {formatOptions.map((format) => (
                    <button
                      key={format}
                      onClick={() => toggleValue(format, selectedFormats, setSelectedFormats)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedFormats.includes(format)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.formats as any)[format]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{t.groups.goal}</p>
                <div className="flex flex-wrap gap-2">
                  {goalOptions.map((goal) => (
                    <button
                      key={goal}
                      onClick={() => toggleValue(goal, selectedGoals, setSelectedGoals)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selectedGoals.includes(goal)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {(t.goals as any)[goal]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCourses.map((course, index) => {
          const cardDelay = `${index * 90}ms`;
          const shimmerDelay = `${index * 90 + 160}ms`;
          const durationLabel = formatDuration(course.durationMinutes);
          const levelLabel = course.level ? (t.levels as any)[course.level] : null;
          const categoryLabel = resolveCategoryLabel(course);
          const title = resolveText(course.title);
          const description = resolveText(course.description);

          return (
            <div 
              key={course.id} 
              onClick={() => onSelectCourse(course)}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group cursor-pointer flex flex-col h-full relative course-card-animate min-w-0"
              style={{ animationDelay: cardDelay }}
            >
              <div
                className="course-card-shimmer"
                style={{ animationDelay: shimmerDelay }}
                aria-hidden="true"
              />
              <div className="relative h-40 sm:h-48 overflow-hidden">
                <img 
                  src={course.thumbnail} 
                  alt={title} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-4 left-4">
                  <span className="bg-white/90 backdrop-blur-sm px-3 py-1 rounded-lg text-xs font-bold text-slate-900 shadow-sm uppercase tracking-wider">
                    {categoryLabel}
                  </span>
                </div>
              </div>
              
              <div className="p-5 flex-1 flex flex-col relative z-10 min-w-0">
                <h3 className="font-bold text-lg text-slate-900 mb-2 break-words">{title}</h3>
                <p className="text-slate-500 text-sm mb-4 flex-1 break-words line-clamp-3">{description}</p>
                
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 font-medium mb-4">
                   <div className="flex items-center gap-1">
                     <Briefcase size={14} /> 
                     <span>{course.totalLessons} {t.lessons}</span>
                   </div>
                   {durationLabel && (
                     <div className="flex items-center gap-1">
                       <Clock size={14} />
                       <span>{durationLabel}</span>
                     </div>
                   )}
                   {levelLabel && (
                     <div className="flex items-center gap-1">
                       <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">{levelLabel}</span>
                     </div>
                   )}
                </div>

                {course.progress > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap justify-between gap-2 text-xs font-bold text-slate-700">
                      <span>{course.progress}% {t.completed}</span>
                      <span>{course.completedLessons}/{course.totalLessons}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className={`${course.color} h-full rounded-full`} 
                        style={{ width: `${course.progress}%` }} 
                      />
                    </div>
                  </div>
                ) : (
                  <button className="w-full py-3 text-center text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors">
                    {t.startLearning}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CourseList;
