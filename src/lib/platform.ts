import { Capacitor } from '@capacitor/core';

/** True inside the installed Android app (APK); false in the browser / web app. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
