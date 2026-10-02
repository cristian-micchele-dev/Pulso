import { renderHook, waitFor, act } from '@testing-library/react';
import { useSlots } from './useSlots';

const { doctorsApi, appointmentsApi } = vi.hoisted(() => ({
  doctorsApi: { getAvailability: vi.fn() },
  appointmentsApi: { findAll: vi.fn() },
}));

vi.mock('../../api/doctors', () => ({ doctorsApi }));
vi.mock('../../api/appointments', () => ({ appointmentsApi }));

/** Disponibilidad que buildSlots convierte en horarios de media hora. */
const franja = [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', slotDurationMinutes: 30 }];

/** 2026-10-05 es lunes: coincide con el dayOfWeek de la franja. */
const LUNES = '2026-10-05';

const turno = (hora: string, status = 'CONFIRMED') => ({
  dateTime: new Date(`${LUNES}T${hora}:00`).toISOString(),
  status,
});

beforeEach(() => {
  vi.clearAllMocks();
  doctorsApi.getAvailability.mockResolvedValue(franja);
  appointmentsApi.findAll.mockResolvedValue({ data: [] });
});

describe('useSlots', () => {
  it('no consulta nada mientras el paso no esta activo', () => {
    renderHook(() => useSlots('d1', LUNES, false));

    // La pantalla monta todos los pasos: pedir horarios antes de llegar al de
    // fecha seria traer datos que nadie va a mirar.
    expect(doctorsApi.getAvailability).not.toHaveBeenCalled();
  });

  it('tampoco consulta sin medico elegido', () => {
    renderHook(() => useSlots(undefined, LUNES, true));

    expect(doctorsApi.getAvailability).not.toHaveBeenCalled();
  });

  it('arma los horarios del dia a partir de la disponibilidad', async () => {
    const { result } = renderHook(() => useSlots('d1', LUNES, true));

    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.todos).toEqual(['09:00', '09:30']);
  });

  it('marca como ocupados los horarios con turno, salvo los cancelados', async () => {
    appointmentsApi.findAll.mockResolvedValue({
      data: [turno('09:00'), turno('09:30', 'CANCELLED')],
    });

    const { result } = renderHook(() => useSlots('d1', LUNES, true));

    await waitFor(() => expect(result.current.cargando).toBe(false));
    // Un turno cancelado libera su horario: si siguiera ocupado, cancelar no
    // serviria de nada.
    expect([...result.current.ocupados]).toEqual(['09:00']);
  });

  it('al cambiar de fecha olvida el horario que estaba elegido', async () => {
    const { result, rerender } = renderHook(({ f }) => useSlots('d1', f, true), {
      initialProps: { f: LUNES },
    });
    await waitFor(() => expect(result.current.cargando).toBe(false));

    act(() => result.current.elegir('09:00'));
    expect(result.current.elegido).toBe('09:00');

    // Las 09:00 del lunes no son las 09:00 del martes: arrastrar la eleccion
    // reservaria un horario que el usuario nunca vio libre.
    rerender({ f: '2026-10-06' });
    expect(result.current.elegido).toBeNull();
  });

  it('ignora la respuesta vieja cuando se cambia de fecha rapido', async () => {
    let resolverPrimera: (v: unknown) => void = () => {};
    doctorsApi.getAvailability
      .mockReturnValueOnce(new Promise((r) => { resolverPrimera = r; }))
      .mockResolvedValueOnce([{ ...franja[0], dayOfWeek: 2, startTime: '15:00', endTime: '16:00' }]);

    const { result, rerender } = renderHook(({ f }) => useSlots('d1', f, true), {
      initialProps: { f: LUNES },
    });
    rerender({ f: '2026-10-06' });

    await waitFor(() => expect(result.current.todos).toEqual(['15:00', '15:30']));

    // La primera consulta vuelve DESPUES de la segunda. Sin descartarla, la
    // pantalla mostraria los horarios de un dia que ya nadie esta mirando.
    await act(async () => { resolverPrimera(franja); });
    expect(result.current.todos).toEqual(['15:00', '15:30']);
  });

  it('informa el error sin dejar horarios viejos a la vista', async () => {
    doctorsApi.getAvailability.mockRejectedValue(new Error('red caida'));

    const { result } = renderHook(() => useSlots('d1', LUNES, true));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.todos).toEqual([]);
    expect(result.current.cargando).toBe(false);
  });
});
