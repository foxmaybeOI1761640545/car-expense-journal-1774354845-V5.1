import { loadThemePreference, saveThemePreference, type ThemePreference } from './localStorageService';

export type AppTheme = ThemePreference;

const THEME_ATTRIBUTE = 'data-theme';

function normalizeTheme(theme: string | null | undefined): AppTheme {
  return theme === 'night' ? 'night' : 'day';
}

export function applyAppTheme(theme: AppTheme): AppTheme {
  const normalized = normalizeTheme(theme);

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, normalized);
  }

  return normalized;
}

export function loadAppTheme(): AppTheme {
  return normalizeTheme(loadThemePreference());
}

export function initializeAppTheme(): AppTheme {
  const theme = loadAppTheme();
  applyAppTheme(theme);
  return theme;
}

export function setAppTheme(theme: AppTheme): AppTheme {
  const normalized = applyAppTheme(theme);
  saveThemePreference(normalized);
  return normalized;
}
