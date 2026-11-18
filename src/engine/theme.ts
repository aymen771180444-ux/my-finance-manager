/**
 * Color themes (PRD §26: preset color themes + custom theme colors).
 * Any chosen color is adapted per light/dark mode so that text stays readable:
 * every derived pair is pushed until it meets WCAG AA (4.5:1).
 */

export const THEME_PRESETS = {
  sapphire: '#1d4ed8', // default, hand-tuned in index.css
  emerald: '#047857',
  teal: '#0f766e',
  ocean: '#0369a1',
  indigo: '#4338ca',
  gold: '#a16207',
  graphite: '#334155',
  burgundy: '#9f1239',
} as const;
export type ThemePreset = keyof typeof THEME_PRESETS;
export const DEFAULT_THEME: ThemePreset = 'sapphire';

/**
 * Surfaces the derived colors must contrast with: the darkest glass a text can
 * sit on (translucent white over the darkest blob) and the lightest dark glass.
 */
export const LIGHT_SURFACE = '#e8eef7';
export const DARK_SURFACE = '#1f2c47';
const DARK_BG = '#0b1324';

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Invalid color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Linear mix: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t) as RGB);
}

/** Move `color` toward `target` in small steps until it contrasts ≥ min with `against`. */
function pushUntil(color: string, target: string, against: string, min = 4.5): string {
  let c = color;
  for (let t = 0; t <= 1.0001 && contrast(c, against) < min; t += 0.04) c = mix(color, target, t);
  return c;
}

export interface ModeColors {
  primary: string;
  /** Second stop of the primary gradient (a violet-shifted partner). */
  primary2: string;
  primarySoft: string;
  onPrimary: string;
}

export interface DerivedTheme {
  light: ModeColors;
  dark: ModeColors;
}

export function deriveTheme(base: string): DerivedTheme {
  // light mode: primary is a fill behind white text and also text on white surfaces
  const lightPrimary = pushUntil(base, '#000000', LIGHT_SURFACE);
  const lightSoft = mix(lightPrimary, '#ffffff', 0.86);
  // dark mode: primary is text/icon on dark surfaces; fills carry dark text
  const darkPrimary = pushUntil(base, '#ffffff', DARK_SURFACE);
  const darkSoft = mix(darkPrimary, DARK_BG, 0.72);
  const darkOn = contrast('#000000', darkPrimary) >= contrast('#ffffff', darkPrimary) ? mix(darkPrimary, '#000000', 0.85) : '#ffffff';
  return {
    light: { primary: lightPrimary, primary2: pushUntil(mix(lightPrimary, '#0e7490', 0.55), '#000000', LIGHT_SURFACE), primarySoft: pushSoft(lightSoft, lightPrimary), onPrimary: '#ffffff' },
    dark: { primary: darkPrimary, primary2: pushFill(mix(darkPrimary, '#5eead4', 0.55), darkOn), primarySoft: pushSoft(darkSoft, darkPrimary), onPrimary: darkOn },
  };
}

/** A dark-mode gradient stop still carries the on-primary text. */
function pushFill(fill: string, text: string): string {
  return pushUntil(fill, luminance(text) > luminance(fill) ? '#000000' : '#ffffff', text);
}

/** Soft backgrounds carry primary-colored text: keep that pair ≥ 4.5 too. */
function pushSoft(soft: string, text: string): string {
  const lightText = luminance(text) > luminance(soft);
  return pushUntil(soft, lightText ? '#000000' : '#ffffff', text);
}

/** CSS for the chosen theme, scoped to screen (print keeps its own palette). */
export function themeCss(t: DerivedTheme): string {
  const block = (m: ModeColors) => `--c-primary:${m.primary};--c-primary-2:${m.primary2};--c-primary-soft:${m.primarySoft};--c-on-primary:${m.onPrimary};--c-glow:${m.primary}33;`;
  return `@media screen{:root,:root[data-theme='light']{${block(t.light)}}:root[data-theme='dark']{${block(t.dark)}}}`;
}
