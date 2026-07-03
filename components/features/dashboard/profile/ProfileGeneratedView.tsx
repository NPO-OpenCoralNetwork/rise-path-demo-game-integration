import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Course, ViewState } from '../../../../types';
import { fetchGeneratedCourses } from '../../../../services/curriculumApi';
import { useLanguage } from '../../../../context/LanguageContext';
import { useTheme } from '../../../../context/ThemeContext';
import { useNavigate } from 'react-router-dom';

interface ProfileGeneratedViewProps {
  onNavigate: (view: ViewState) => void;
}

const ProfileGeneratedView: React.FC<ProfileGeneratedViewProps> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    setTheme('default');
  }, [setTheme]);

  useEffect(() => {
    let isMounted = true;
    fetchGeneratedCourses()
      .then((data) => {
        if (!isMounted) return;
        setCourses(data);
      })
      .catch(() => setCourses([]));
    return () => {
      isMounted = false;
    };
  }, []);

  const copy = {
    en: {
      title: 'Generated Content',
      subtitle: 'Courses and documents you created with AI.',
      cta: 'Generate a new course'
    },
    jp: {
      title: '生成物',
      subtitle: 'AIで作成したコースや資料。',
      cta: '新しいコースを生成'
    }
  } as const;

  const t = copy[language];

  const resolveText = (text: string | { en: string; jp: string; fr?: string }) => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text[language] || text.en;
  };

  return (
    <div className="min-h-screen bg-slate-50/50 px-6 pt-12 pb-20">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
          <p className="text-slate-500">{t.subtitle}</p>
        </header>

        {courses.length === 0 ? (
          <div className="rounded-[2.5rem] bg-white border border-slate-100 p-8 shadow-xl text-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-500 text-white flex items-center justify-center mx-auto mb-6">
              <Sparkles className="w-8 h-8" />
            </div>
            <p className="text-slate-500 mb-6">{language === 'jp' ? 'まだ生成したコースがありません。' : 'No generated courses yet.'}</p>
            <button
              type="button"
              onClick={() => onNavigate(ViewState.COURSE_GENERATOR)}
              className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200/60 hover:bg-indigo-500 transition"
            >
              {t.cta} <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <div
                key={course.id}
                onClick={() => navigate(`/generated-course/${course.id}`)}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
              >
                <div className="h-40 overflow-hidden">
                  <img src={course.thumbnail} alt={resolveText(course.title)} className="w-full h-full object-cover" />
                </div>
                <div className="p-5">
                  <div className="text-xs uppercase tracking-widest text-slate-400">{course.category}</div>
                  <h3 className="mt-2 text-lg font-semibold text-slate-800">{resolveText(course.title)}</h3>
                  <p className="mt-2 text-sm text-slate-500 line-clamp-2">{resolveText(course.description)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileGeneratedView;
