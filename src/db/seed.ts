import { db, newId, nowISO } from './schema';
import type { Category, CategoryGroup, CategoryKind } from './types';

interface SeedCat {
  key: string;
  ar: string;
  en: string;
  kind: CategoryKind;
  group: CategoryGroup;
  color: string;
  icon: string;
  children?: { key: string; ar: string; en: string; icon: string }[];
}

/** Default editable categories per PRD §7, seeded per profile in both languages. */
const DEFAULT_CATEGORIES: SeedCat[] = [
  // ——— Essentials ———
  {
    key: 'food', ar: 'الطعام', en: 'Food', kind: 'expense', group: 'essentials', color: '#f59e0b', icon: 'UtensilsCrossed',
    children: [
      { key: 'groceries', ar: 'البقالة', en: 'Groceries', icon: 'ShoppingBasket' },
      { key: 'restaurants', ar: 'المطاعم', en: 'Restaurants', icon: 'ChefHat' },
      { key: 'cafes', ar: 'المقاهي', en: 'Cafes', icon: 'Coffee' },
    ],
  },
  {
    key: 'transport', ar: 'المواصلات', en: 'Transportation', kind: 'expense', group: 'essentials', color: '#3b82f6', icon: 'Car',
    children: [
      { key: 'fuel', ar: 'الوقود', en: 'Fuel', icon: 'Fuel' },
      { key: 'taxi', ar: 'أجرة المواصلات', en: 'Taxi', icon: 'CarTaxiFront' },
      { key: 'maintenance', ar: 'صيانة المركبة', en: 'Vehicle maintenance', icon: 'Wrench' },
    ],
  },
  { key: 'housing', ar: 'السكن', en: 'Housing', kind: 'expense', group: 'essentials', color: '#8b5cf6', icon: 'Home' },
  { key: 'health', ar: 'الصحة', en: 'Health', kind: 'expense', group: 'essentials', color: '#ef4444', icon: 'HeartPulse' },
  { key: 'education', ar: 'التعليم', en: 'Education', kind: 'expense', group: 'essentials', color: '#06b6d4', icon: 'GraduationCap' },
  { key: 'family', ar: 'الأسرة', en: 'Family', kind: 'expense', group: 'essentials', color: '#ec4899', icon: 'Users' },
  // ——— Wants & entertainment ———
  { key: 'entertainment', ar: 'الترفيه', en: 'Entertainment', kind: 'expense', group: 'wants', color: '#f97316', icon: 'Gamepad2' },
  { key: 'shopping', ar: 'التسوق', en: 'Shopping', kind: 'expense', group: 'wants', color: '#d946ef', icon: 'ShoppingBag' },
  { key: 'travel', ar: 'السفر', en: 'Travel', kind: 'expense', group: 'wants', color: '#14b8a6', icon: 'Plane' },
  // ——— Bills & obligations ———
  {
    key: 'bills', ar: 'الفواتير', en: 'Bills', kind: 'expense', group: 'bills', color: '#64748b', icon: 'Receipt',
    children: [
      { key: 'electricity', ar: 'الكهرباء', en: 'Electricity', icon: 'Zap' },
      { key: 'water', ar: 'الماء', en: 'Water', icon: 'Droplets' },
      { key: 'internet', ar: 'الإنترنت', en: 'Internet', icon: 'Wifi' },
      { key: 'phone', ar: 'الهاتف', en: 'Phone', icon: 'Smartphone' },
    ],
  },
  { key: 'rent', ar: 'الإيجار', en: 'Rent', kind: 'expense', group: 'bills', color: '#78716c', icon: 'Building2' },
  { key: 'subscriptions', ar: 'الاشتراكات', en: 'Subscriptions', kind: 'expense', group: 'bills', color: '#6366f1', icon: 'RefreshCw' },
  // ——— Savings & investments ———
  { key: 'savings_contrib', ar: 'مساهمات الادخار', en: 'Savings contributions', kind: 'expense', group: 'savings_investments', color: '#10b981', icon: 'PiggyBank' },
  // ——— Emergencies ———
  { key: 'emergency', ar: 'الطوارئ', en: 'Emergencies', kind: 'expense', group: 'emergencies', color: '#dc2626', icon: 'Siren' },
  // ——— Work expenses ———
  { key: 'work_expenses', ar: 'مصاريف العمل', en: 'Work expenses', kind: 'expense', group: 'work', color: '#0ea5e9', icon: 'Briefcase' },
  // ——— Income sources (PRD §16) ———
  { key: 'salary', ar: 'الراتب', en: 'Salary', kind: 'income', group: 'income', color: '#16a34a', icon: 'Banknote' },
  { key: 'side_work', ar: 'عمل إضافي', en: 'Side work', kind: 'income', group: 'income', color: '#65a30d', icon: 'Hammer' },
  { key: 'business', ar: 'مشروع خاص', en: 'Private business', kind: 'income', group: 'income', color: '#0d9488', icon: 'Store' },
  { key: 'gifts', ar: 'هدايا وحوالات', en: 'Gifts & transfers', kind: 'income', group: 'income', color: '#9333ea', icon: 'Gift' },
  { key: 'investment_returns', ar: 'عوائد استثمارية', en: 'Investment returns', kind: 'income', group: 'income', color: '#ca8a04', icon: 'TrendingUp' },
  { key: 'other_income', ar: 'دخل آخر', en: 'Other income', kind: 'income', group: 'income', color: '#71717a', icon: 'CirclePlus' },
];

export async function seedDefaultCategories(profileId: string): Promise<void> {
  const ts = nowISO();
  for (const c of DEFAULT_CATEGORIES) {
    const parent: Category = {
      id: newId(),
      createdAt: ts,
      updatedAt: ts,
      profileId,
      parentId: null,
      kind: c.kind,
      group: c.group,
      nameKey: c.key,
      nameAr: c.ar,
      nameEn: c.en,
      color: c.color,
      icon: c.icon,
      isArchived: false,
    };
    await db.categories.add(parent);
    for (const child of c.children ?? []) {
      await db.categories.add({
        id: newId(),
        createdAt: ts,
        updatedAt: ts,
        profileId,
        parentId: parent.id,
        kind: c.kind,
        group: c.group,
        nameKey: child.key,
        nameAr: child.ar,
        nameEn: child.en,
        color: c.color,
        icon: child.icon,
        isArchived: false,
      });
    }
  }
}
