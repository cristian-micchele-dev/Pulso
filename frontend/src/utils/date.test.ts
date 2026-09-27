import { addDaysLocal, localDateTimeToIso, toLocalDateString, startOfLocalDay, endOfLocalDay } from './date';

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

describe('un día entero, de punta a punta', () => {
  it('startOfLocalDay arranca a las 00:00 del reloj de la clínica, no a las 00:00 UTC', () => {
    const inicio = new Date(startOfLocalDay('2027-01-20'));
    expect(inicio.getFullYear()).toBe(2027);
    expect(inicio.getMonth()).toBe(0);
    expect(inicio.getDate()).toBe(20);
    expect(inicio.getHours()).toBe(0);
    expect(inicio.getMinutes()).toBe(0);
  });

  // Lo que fallaba: el bloqueo terminaba a las 00:00 del último día, así que ese
  // día quedaba entero sin bloquear y se podían agendar pacientes igual.
  it('endOfLocalDay llega hasta el último instante del día, no hasta su comienzo', () => {
    const fin = new Date(endOfLocalDay('2027-01-20'));
    expect(fin.getDate()).toBe(20);
    expect(fin.getHours()).toBe(23);
    expect(fin.getMinutes()).toBe(59);
    expect(fin.getSeconds()).toBe(59);
  });

  it('un turno de las 10 de la mañana cae dentro del día', () => {
    const turno = new Date(2027, 0, 20, 10, 0).getTime();
    expect(turno).toBeGreaterThan(new Date(startOfLocalDay('2027-01-20')).getTime());
    expect(turno).toBeLessThan(new Date(endOfLocalDay('2027-01-20')).getTime());
  });

  it('un solo día es un rango válido: alguien se toma UN día', () => {
    expect(new Date(endOfLocalDay('2027-01-20')).getTime())
      .toBeGreaterThan(new Date(startOfLocalDay('2027-01-20')).getTime());
  });
});
