// Generates the web app (PWA) PNG icons.
// Usage: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderIcon } from './icon-render.mjs';

mkdirSync('public/icons', { recursive: true });
for (const [name, size, shape] of [
  ['icon-192.png', 192, 'rounded'],
  ['icon-512.png', 512, 'rounded'],
  ['maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'maskable'],
]) {
  writeFileSync(`public/icons/${name}`, renderIcon(size, shape));
  console.log('wrote', name);
}
