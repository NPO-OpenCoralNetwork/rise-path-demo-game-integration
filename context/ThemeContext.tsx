import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Big5Profile } from '../types';

export type ThemeType = 'default' | 'art' | 'vibe' | 'sonic';

interface ThemeContextType {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
    profile: Big5Profile | null;
    setProfile: (profile: Big5Profile) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<ThemeType>('default');
    const [profile, setProfile] = useState<Big5Profile | null>(null);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, profile, setProfile }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
