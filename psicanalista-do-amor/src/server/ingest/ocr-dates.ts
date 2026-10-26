import "server-only";
import { zonedParts, zonedTimeToUtc } from "./time";

/** Datas das prints: separadores de dia ("Hoje", "Ontem", "12 de outubro") + horário. */

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export type Ymd = { y: number; m: number; d: number };

const strip = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function resolveDayLabel(label: string | null, reference: Date, timeZone: string): Ymd | null {
  if (!label) return null;
  const l = strip(label);
  const ref = zonedParts(reference, timeZone);
  const today: Ymd = { y: ref.year, m: ref.month, d: ref.day };
  if (/^(hoje|today)$/.test(l)) return today;
  if (/^(ontem|yesterday)$/.test(l)) return addDays(today, -1);

  const num = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(l);
  if (num) {
    const d = Number(num[1]);
    const m = Number(num[2]);
    let y = num[3] ? Number(num[3]) : today.y;
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
  }
  const named = /(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?(?:\s*(?:de\s+)?(\d{4}))?/.exec(l) ?? /([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/.exec(l);
  if (named) {
    const [dStr, mStr] = /^\d/.test(named[1]!) ? [named[1]!, named[2]!] : [named[2]!, named[1]!];
    const m = MONTHS[mStr];
    if (m) {
      const d = Number(dStr);
      let y = named[3] ? Number(named[3]) : today.y;
      if (!named[3] && (m > today.m || (m === today.m && d > today.d))) y -= 1;
      return { y, m, d };
    }
  }
  for (const [name, wd] of Object.entries(WEEKDAYS)) {
    if (l.startsWith(name)) {
      const refWd = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
      const diff = ((refWd - wd + 7) % 7) || 7;
      return addDays(today, -diff);
    }
  }
  return null;
}

export function parseClock(time: string | null): { h: number; m: number } | null {
  if (!time) return null;
  const t = /(\d{1,2})[:h.](\d{2})\s*([ap])?\.?\s*m?\.?/i.exec(time.trim());
  if (!t) return null;
  let h = Number(t[1]);
  const m = Number(t[2]);
  const ap = t[3]?.toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/**
 * Atribui data/hora em ordem: o separador define o dia corrente; se o horário "volta"
 * muito (23:50 → 00:10), avança um dia. Sem dia conhecido, fica sem data.
 */
export function assignTimestamps<T extends { time: string | null; dayLabel: string | null }>(
  items: T[],
  reference: Date,
  timeZone: string,
): (Date | null)[] {
  let day: Ymd | null = null;
  let lastMinutes: number | null = null;
  return items.map((it) => {
    const resolved = resolveDayLabel(it.dayLabel, reference, timeZone);
    if (resolved) {
      day = resolved;
      lastMinutes = null;
    }
    const clock = parseClock(it.time);
    if (!clock || !day) return null;
    const minutes = clock.h * 60 + clock.m;
    if (lastMinutes !== null && minutes + 180 < lastMinutes) day = addDays(day, 1);
    lastMinutes = minutes;
    const current: Ymd = day;
    return zonedTimeToUtc(current.y, current.m, current.d, clock.h, clock.m, 0, timeZone);
  });
}
