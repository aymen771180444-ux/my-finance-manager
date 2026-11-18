import { Shapes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_ICONS } from './iconMap';
import type { Category } from '../db/types';

export function categoryName(cat: Category | undefined | null, lang: string): string {
  if (!cat) return '—';
  return lang.startsWith('ar') ? cat.nameAr : cat.nameEn;
}

export function CategoryIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  const Ico = CATEGORY_ICONS[name] ?? Shapes;
  return <Ico size={size} color={color} />;
}

export function CategoryBadge({ category }: { category: Category | undefined | null }) {
  const { i18n } = useTranslation();
  if (!category) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: `${category.color}22`, color: category.color }}
    >
      <CategoryIcon name={category.icon} size={13} color={category.color} />
      {categoryName(category, i18n.language)}
    </span>
  );
}
