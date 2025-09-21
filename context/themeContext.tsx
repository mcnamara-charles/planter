import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeName = 'light' | 'dark' | 'system';

type AppTheme = {
  colors: {
    background: string;
    text: string;
    mutedText: string;
    card: string;
    border: string;
    primary: string;
    danger: string;
    input: string;
  };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  fontSizes: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  borderRadius: { sm: number; md: number; lg: number; xl: number };
  shadow: {
    light: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
};

const themes: Record<'light' | 'dark', AppTheme> = {
  light: {
    colors: {
      background: '#ffffff',
      text: '#111111',
      mutedText: '#666666',
      card: '#ffffff',
      border: '#eeeeee',
      primary: '#007aff',
      danger: '#ff3b30',
      input: '#fafafa',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    fontSizes: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
    borderRadius: { sm: 4, md: 8, lg: 12, xl: 20 },
    shadow: {
      light: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
      },
    },
  },
  dark: {
    colors: {
      background: '#121212',
      text: '#eeeeee',
      mutedText: '#aaaaaa',
      card: '#1e1e1e',
      border: '#333333',
      primary: '#0a84ff',
      danger: '#ff453a',
      input: '#1e1e1e',
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    fontSizes: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
    borderRadius: { sm: 4, md: 8, lg: 12, xl: 20 },
    shadow: {
      light: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 2,
      },
    },
  },
};

interface ThemeContextType {
  themeName: 'light' | 'dark';
  themeOverride: ThemeName;
  theme: AppTheme;
  setTheme: (name: ThemeName) => void;
}

const STORAGE_KEY = '@theme-preference';
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeOverride, setThemeOverride] = useState<ThemeName>('system');
  const systemPref: 'light' | 'dark' = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(systemPref);
  const themeName: 'light' | 'dark' = themeOverride === 'system' ? systemTheme : themeOverride;

  useEffect(() => {
    const loadStoredTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedTheme && savedTheme !== themeOverride) setThemeOverride(savedTheme as ThemeName);
      } catch (err) {
        console.warn('Failed to load theme from storage:', err);
      }
    };
    loadStoredTheme();
  }, []);

  useEffect(() => {
    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemTheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, themeOverride);
  }, [themeOverride]);

  const setTheme = (name: ThemeName) => setThemeOverride(name);
  const theme = themes[themeName];

  return (
    <ThemeContext.Provider value={{ themeName, themeOverride, theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};


