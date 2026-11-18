import i18n from '../../i18n';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../engine/money';
import type { AppNotification } from '../../db/types';

/** Notification text in the current language: dates per calendar, `…Minor` params as YER. */
export function notificationText(n: Pick<AppNotification, 'titleKey' | 'params'>, calendar: 'gregorian' | 'hijri'): string {
  let params: Record<string, string | number> = {};
  try {
    params = JSON.parse(n.params);
  } catch {
    /* malformed params: show the bare title */
  }
  const lang = i18n.language;
  for (const [k, v] of Object.entries(params)) {
    if (k.endsWith('Minor') && typeof v === 'number') params[k] = formatMoney(v, 'YER', lang);
    else if ((k === 'date' || k === 'from' || k === 'to') && typeof v === 'string') params[k] = formatDate(v, lang, calendar);
  }
  return String(i18n.t(n.titleKey, params as never));
}
