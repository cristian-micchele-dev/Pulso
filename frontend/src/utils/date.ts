/** Calendar date (YYYY-MM-DD) on the browser's local clock — never `toISOString().split('T')`, which is UTC. */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayLocal(): string {
  return toLocalDateString(new Date());
}

export function addDaysLocal(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return toLocalDateString(new Date(y, m - 1, d + days));
}

/** Local wall-clock date + HH:mm → unambiguous UTC instant for the API. */
export function localDateTimeToIso(dateIso: string, time: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}
