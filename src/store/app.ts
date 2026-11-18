import { create } from 'zustand';
import type { Settings } from '../db/types';
import { getSettings, saveSettings } from '../db/profiles';
import { applyLanguage, type AppLanguage } from '../i18n';
import { deriveTheme, themeCss, THEME_PRESETS, DEFAULT_THEME, type ThemePreset } from '../engine/theme';

interface AppState {
  ready: boolean;
  settings: Settings | null;
  init: () => Promise<void>;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  setTheme: (theme: Settings['theme']) => Promise<void>;
  setCalendar: (cal: Settings['calendar']) => Promise<void>;
  setActiveProfile: (profileId: string) => Promise<void>;
  setHideBalances: (hide: boolean) => Promise<void>;
  setDashboardCards: (cards: Settings['dashboardCards']) => Promise<void>;
  setColorTheme: (colorTheme: string, customColor?: string) => Promise<void>;
  setNotificationPrefs: (p: NonNullable<Settings['notificationPrefs']>) => Promise<void>;
  completeOnboarding: (opts: { language: AppLanguage; profileId: string }) => Promise<void>;
}

function applyTheme(theme: Settings['theme']): void {
  const dark =
    theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  syncThemeColorMeta();
}

/** Inject the chosen color theme; the default teal keeps the hand-tuned stylesheet colors. */
function applyColor(s: Pick<Settings, 'colorTheme' | 'customColor'>): void {
  const name = s.colorTheme ?? DEFAULT_THEME;
  let el = document.getElementById('theme-color-vars') as HTMLStyleElement | null;
  if (name === DEFAULT_THEME) {
    el?.remove();
  } else {
    const base = name === 'custom' ? s.customColor ?? THEME_PRESETS[DEFAULT_THEME] : THEME_PRESETS[name as ThemePreset] ?? THEME_PRESETS[DEFAULT_THEME];
    if (!el) {
      el = document.createElement('style');
      el.id = 'theme-color-vars';
      document.head.appendChild(el);
    }
    el.textContent = themeCss(deriveTheme(base));
  }
  syncThemeColorMeta();
}

/** Android status-bar color follows the theme. */
function syncThemeColorMeta(): void {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && color) meta.setAttribute('content', color);
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: null,

  init: async () => {
    let settings = await getSettings();
    if (!settings) settings = await saveSettings({});
    applyLanguage(settings.language);
    applyTheme(settings.theme);
    applyColor(settings);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => applyTheme(get().settings?.theme ?? 'auto'));
    set({ settings, ready: true });
  },

  setLanguage: async (lang) => {
    applyLanguage(lang);
    set({ settings: await saveSettings({ language: lang }) });
  },
  setTheme: async (theme) => {
    applyTheme(theme);
    set({ settings: await saveSettings({ theme }) });
  },
  setCalendar: async (calendar) => {
    set({ settings: await saveSettings({ calendar }) });
  },
  setActiveProfile: async (activeProfileId) => {
    set({ settings: await saveSettings({ activeProfileId }) });
  },
  setHideBalances: async (hideBalances) => {
    set({ settings: await saveSettings({ hideBalances }) });
  },
  setColorTheme: async (colorTheme, customColor) => {
    const next = await saveSettings(customColor ? { colorTheme, customColor } : { colorTheme });
    applyColor(next);
    set({ settings: next });
  },
  setDashboardCards: async (dashboardCards) => {
    set({ settings: await saveSettings({ dashboardCards }) });
  },
  setNotificationPrefs: async (notificationPrefs) => {
    set({ settings: await saveSettings({ notificationPrefs }) });
  },
  completeOnboarding: async ({ language, profileId }) => {
    applyLanguage(language);
    set({
      settings: await saveSettings({ language, activeProfileId: profileId, onboardingDone: true }),
    });
  },
}));
