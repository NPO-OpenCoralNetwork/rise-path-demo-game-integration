import React, { createContext, useContext, useMemo, useState, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'jp';
export type SelectedLanguage = 'en' | 'jp' | 'fr';

interface LanguageContextType {
  language: Language;
  selectedLanguage: SelectedLanguage;
  setLanguage: (language: SelectedLanguage) => void;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANGUAGE_STORAGE_KEY = 'risepath:language';

const getInitialLanguage = (): SelectedLanguage => {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'jp') return 'jp';
  if (stored === 'fr') return 'fr';
  return 'en';
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<SelectedLanguage>(getInitialLanguage);
  const resolvedLanguage: Language = selectedLanguage === 'fr' ? 'en' : selectedLanguage;

  const setLanguage = (next: SelectedLanguage) => {
    setSelectedLanguage(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    }
  };

  const toggleLanguage = () =>
    setLanguage(selectedLanguage === 'en' ? 'jp' : selectedLanguage === 'jp' ? 'fr' : 'en');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = selectedLanguage === 'jp'
        ? 'ja'
        : selectedLanguage === 'fr'
          ? 'fr'
          : 'en';
    }
  }, [selectedLanguage]);

  const value = useMemo(
    () => ({
      language: resolvedLanguage,
      selectedLanguage,
      setLanguage,
      toggleLanguage
    }),
    [resolvedLanguage, selectedLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
