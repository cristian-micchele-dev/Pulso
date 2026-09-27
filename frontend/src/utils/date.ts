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

/**
 * Los dos extremos de un día del calendario, como instantes.
 *
 * Un rango de fechas escrito por una persona —"del 18 al 20"— incluye los dos
 * días completos. Mandarlo como `new Date('2027-01-20')` da la medianoche UTC:
 * el último día queda entero afuera y, en Buenos Aires, el primero arranca a las
 * 21:00 del día anterior. Con eso, un bloqueo de licencia dejaba libre su
 * último día y se podían agendar pacientes igual.
 */
export function startOfLocalDay(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

export function endOfLocalDay(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/** Local wall-clock date + HH:mm → unambiguous UTC instant for the API. */
export function localDateTimeToIso(dateIso: string, time: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}
