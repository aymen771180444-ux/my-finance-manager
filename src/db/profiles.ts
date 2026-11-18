import { db, newId, nowISO } from './schema';
import type { Profile, Settings } from './types';
import { seedDefaultCategories } from './seed';
import { recordMutation } from './audit';

export async function createProfile(name: string, icon = '👤', color = '#1d4ed8'): Promise<Profile> {
  return db.transaction('rw', [db.profiles, db.categories, db.auditLog, db.syncQueue], async () => {
    const ts = nowISO();
    const count = await db.profiles.count();
    const profile: Profile = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      name: name.trim(),
      icon,
      color,
      isDefault: count === 0,
    };
    if (!profile.name) throw new Error('Profile name is required');
    await db.profiles.add(profile);
    await seedDefaultCategories(profile.id);
    await recordMutation({
      profileId: profile.id,
      table: 'profiles',
      rowId: profile.id,
      action: 'create',
      before: null,
      after: profile,
    });
    return profile;
  });
}

export async function updateProfile(
  id: string,
  changes: Partial<Pick<Profile, 'name' | 'icon' | 'color'>>,
): Promise<void> {
  const before = await db.profiles.get(id);
  if (!before) throw new Error('Profile not found');
  await db.profiles.update(id, { ...changes, updatedAt: nowISO() });
}

const SETTINGS_ID = 'settings';


export async function getSettings(): Promise<Settings | undefined> {
  return db.settings.get(SETTINGS_ID);
}

export async function saveSettings(changes: Partial<Settings>): Promise<Settings> {
  const existing = await db.settings.get(SETTINGS_ID);
  const ts = nowISO();
  const next: Settings = existing
    ? { ...existing, ...changes, updatedAt: ts }
    : {
        id: SETTINGS_ID,
        createdAt: ts,
        updatedAt: ts,
        language: 'ar',
        theme: 'auto',
        calendar: 'gregorian',
        activeProfileId: null,
        hideBalances: false,
        dashboardCards: [], // empty = default layout (see features/dashboard/cardRegistry)
        onboardingDone: false,
        ...changes,
      };
  await db.settings.put(next);
  return next;
}
