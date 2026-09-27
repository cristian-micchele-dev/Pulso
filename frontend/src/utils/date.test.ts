import { addDaysLocal, localDateTimeToIso, toLocalDateString } from './date';

describe('date utils (local wall clock)', () => {
  it('toLocalDateString usa la fecha local, no la UTC', () => {
    // 23:30 local del 21 — en UTC-3 sería ya 22 en toISOString()
    const d = new Date(2026, 8, 21, 23, 30);
    expect(toLocalDateString(d)).toBe('2026-09-21');
  });

  it('addDaysLocal suma días sin pasar por UTC', () => {
    expect(addDaysLocal('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysLocal('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('localDateTimeToIso produce el mismo instante que un Date local', () => {
    const expected = new Date(2026, 8, 21, 9, 0).toISOString();
    expect(localDateTimeToIso('2026-09-21', '09:00')).toBe(expected);
  });
});
