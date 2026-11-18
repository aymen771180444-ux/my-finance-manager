/** Date display helpers — Gregorian or Hijri, per the user's calendar setting. */

export function formatDate(
  isoDate: string,
  lang: string,
  calendar: 'gregorian' | 'hijri',
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const locale = `${lang.startsWith('ar') ? 'ar' : 'en'}${calendar === 'hijri' ? '-u-ca-islamic-umalqura' : ''}`;
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function monthRange(d = new Date()): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}
