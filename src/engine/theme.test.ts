import { describe, it, expect } from 'vitest';
import { deriveTheme, contrast, THEME_PRESETS, hexToRgb, themeCss, LIGHT_SURFACE, DARK_SURFACE } from './theme';

function assertReadable(base: string) {
  const t = deriveTheme(base);
  expect(contrast(t.light.onPrimary, t.light.primary), `${base} light fill`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.light.onPrimary, t.light.primary2), `${base} light gradient end`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.dark.onPrimary, t.dark.primary2), `${base} dark gradient end`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.light.primary, LIGHT_SURFACE), `${base} light text`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.light.primary, t.light.primarySoft), `${base} light soft`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.dark.primary, DARK_SURFACE), `${base} dark text`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.dark.onPrimary, t.dark.primary), `${base} dark fill`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(t.dark.primary, t.dark.primarySoft), `${base} dark soft`).toBeGreaterThanOrEqual(4.5);
}

describe('theme derivation keeps WCAG AA', () => {
  it('for every preset', () => {
    for (const hex of Object.values(THEME_PRESETS)) assertReadable(hex);
  });
  it('for hard custom colors (very light, very dark, saturated, grey)', () => {
    for (const hex of ['#ffff00', '#fde68a', '#ffffff', '#000000', '#00ff00', '#ff00ff', '#808080', '#0ea5e9', '#f97316']) assertReadable(hex);
  });
  it('keeps the default sapphire blue unchanged in light mode', () => {
    expect(deriveTheme(THEME_PRESETS.sapphire).light.primary).toBe('#1d4ed8');
  });
  it('rejects invalid colors', () => {
    expect(() => hexToRgb('nope')).toThrow();
  });
  it('emits screen-only CSS so printing keeps the print palette', () => {
    expect(themeCss(deriveTheme('#1d4ed8')).startsWith('@media screen{')).toBe(true);
  });
});
