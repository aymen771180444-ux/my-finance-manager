// Customizes the Android project that `npx cap add android` generates:
// app icons, launch screen, version numbers. Run from the project root after `cap add`/`cap sync`.
// Usage: node scripts/android-setup.mjs <versionCode> <versionName>
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderIcon } from './icon-render.mjs';

const [versionCode = '1', versionName = '1.0.0'] = process.argv.slice(2);
const RES = 'android/app/src/main/res';
const NAVY = '#0b1324';
const BLUE = '#2563eb';
if (!existsSync(RES)) throw new Error('Run `npx cap add android` first');

// ——— launcher icons (legacy, round, and adaptive foreground) ———
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ic_launcher.png'), renderIcon(Math.round(48 * k), 'rounded'));
  writeFileSync(join(dir, 'ic_launcher_round.png'), renderIcon(Math.round(48 * k), 'circle'));
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), renderIcon(Math.round(108 * k), 'adaptive'));
}
writeFileSync(
  join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLUE}</color>\n</resources>\n`,
);
// the template's vector foreground (Capacitor logo) would win over our PNG on Android 7+
rmSync(join(RES, 'drawable-v24/ic_launcher_foreground.xml'), { force: true });

// ——— launch screen: navy background with the icon centered (never stretched) ———
for (const dir of readdirSync(RES)) {
  if (dir.startsWith('drawable')) rmSync(join(RES, dir, 'splash.png'), { force: true });
}
mkdirSync(join(RES, 'drawable-nodpi'), { recursive: true });
writeFileSync(join(RES, 'drawable-nodpi/splash_icon.png'), renderIcon(288, 'rounded'));
writeFileSync(
  join(RES, 'drawable/splash.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="${NAVY}"/></item>
    <item android:width="144dp" android:height="144dp" android:gravity="center" android:drawable="@drawable/splash_icon"/>
</layer-list>
`,
);
const stylesPath = join(RES, 'values/styles.xml');
let styles = readFileSync(stylesPath, 'utf8');
styles = styles.replace(
  '<item name="android:background">@drawable/splash</item>',
  `<item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">${NAVY}</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>`,
);
writeFileSync(stylesPath, styles);

// ——— version numbers (must rise for Android to accept an update) ———
const gradlePath = 'android/app/build.gradle';
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode \d+/, `versionCode ${Number(versionCode)}`).replace(/versionName "[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, gradle);

console.log(`Android project ready: versionCode ${versionCode}, versionName ${versionName}`);
