import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2 } from 'lucide-react';
import { useCategories, useActiveProfileId } from '../../hooks/data';
import { Card, Button, Sheet, Field, TextInput, Select, Segmented, ConfirmDialog } from '../../components/ui';
import { CategoryIcon, categoryName } from '../../components/CategoryBadge';
import { PICKER_ICONS } from '../../components/iconMap';
import { createCategory, updateCategory, deleteCategory } from '../../db/categories';
import type { Category, CategoryKind, CategoryGroup } from '../../db/types';

const GROUPS: CategoryGroup[] = ['essentials', 'wants', 'bills', 'savings_investments', 'emergencies', 'work', 'income'];
const PALETTE = ['#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#64748b', '#16a34a', '#d946ef'];
const ICONS = PICKER_ICONS;

export default function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileId = useActiveProfileId();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const cats = useCategories(kind);
  const Back = i18n.dir() === 'rtl' ? ArrowRight : ArrowLeft;

  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [notice, setNotice] = useState('');

  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [parentId, setParentId] = useState('');
  const [group, setGroup] = useState<CategoryGroup>('essentials');
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState('Shapes');

  const topCats = cats.filter((c) => !c.parentId);

  function openNew() {
    setEditing(null);
    setNameAr(''); setNameEn(''); setParentId('');
    setGroup(kind === 'income' ? 'income' : 'essentials');
    setColor(PALETTE[0]); setIcon('Shapes');
    setShowForm(true);
  }
  function openEdit(c: Category) {
    setEditing(c);
    setNameAr(c.nameAr); setNameEn(c.nameEn); setParentId(c.parentId ?? '');
    setGroup(c.group); setColor(c.color); setIcon(c.icon);
    setShowForm(true);
  }
  async function save() {
    if (!profileId) return;
    if (editing) {
      await updateCategory(editing.id, { nameAr, nameEn, color, icon, group });
    } else {
      await createCategory({ profileId, parentId: parentId || null, kind, group, nameAr, nameEn, color, icon });
    }
    setShowForm(false);
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 active:bg-surface-2" aria-label={t('common.back')}>
          <Back size={20} />
        </button>
        <h1 className="flex-1 text-xl font-bold">{t('categories.title')}</h1>
        <Button variant="soft" onClick={openNew}>
          <span className="inline-flex items-center gap-1"><Plus size={16} /> {t('common.add')}</span>
        </Button>
      </div>

      <div className="mb-3">
        <Segmented
          options={[
            { value: 'expense' as const, label: t('categories.expenseCats') },
            { value: 'income' as const, label: t('categories.incomeCats') },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>

      {notice && <p className="mb-2 rounded-2xl bg-liability-soft px-3 py-2 text-xs text-liability">{notice}</p>}

      <Card className="px-2">
        {topCats.map((c) => (
          <div key={c.id}>
            <CatRow cat={c} onEdit={() => openEdit(c)} onDelete={() => setToDelete(c)} />
            {cats
              .filter((s) => s.parentId === c.id)
              .map((s) => (
                <div key={s.id} className="ms-8">
                  <CatRow cat={s} onEdit={() => openEdit(s)} onDelete={() => setToDelete(s)} />
                </div>
              ))}
          </div>
        ))}
      </Card>

      <Sheet open={showForm} onClose={() => setShowForm(false)} title={editing ? t('categories.editTitle') : t('categories.addTitle')}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('categories.nameAr')}>
              <TextInput dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label={t('categories.nameEn')}>
              <TextInput dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
          </div>
          {!editing && (
            <Field label={t('categories.parent')}>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {topCats.map((c) => (
                  <option key={c.id} value={c.id}>{categoryName(c, i18n.language)}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('categories.group')}>
            <Select value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>{t(`categories.groups.${g}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.color')}>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>
          <Field label={t('common.icon')}>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${icon === ic ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-dim'}`}
                  aria-label={ic}
                >
                  <CategoryIcon name={ic} size={16} />
                </button>
              ))}
            </div>
          </Field>
          <Button className="w-full" onClick={() => void save()} disabled={!nameAr.trim() && !nameEn.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('common.confirmDeleteTitle')}
        body={t('categories.inUse')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) {
            void deleteCategory(toDelete.id).then((result) => {
              if (result === 'archived') setNotice(t('categories.inUse'));
            });
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}

function CatRow({ cat, onEdit, onDelete }: { cat: Category; onEdit: () => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${cat.color}22`, color: cat.color }}>
        <CategoryIcon name={cat.icon} size={16} color={cat.color} />
      </span>
      <span className="flex-1 truncate text-sm font-medium">{categoryName(cat, i18n.language)}</span>
      <button onClick={onEdit} className="p-2 text-ink-dim" aria-label={t('common.edit')}><Pencil size={15} /></button>
      <button onClick={onDelete} className="p-2 text-ink-dim" aria-label={t('common.delete')}><Trash2 size={15} /></button>
    </div>
  );
}
