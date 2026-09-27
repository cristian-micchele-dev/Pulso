import { buildSlots } from './buildSlots';
import type { Availability } from '../../api/doctors';

/** 2027-01-18 es lunes (dayOfWeek 1). */
const LUNES = '2027-01-18';
const bloque = (startTime: string, endTime: string, slotDuration = 30, dayOfWeek = 1) =>
  ({ id: `${dayOfWeek}-${startTime}`, doctorId: 'd1', dayOfWeek, startTime, endTime, slotDuration });

describe('buildSlots — de la disponibilidad a los horarios reservables', () => {
  it('parte la franja en turnos de la duración indicada', () => {
    expect(buildSlots([bloque('08:00', '10:00', 30)], LUNES))
      .toEqual(['08:00', '08:30', '09:00', '09:30']);
  });

  it('no ofrece un turno que no entra: 10:00 a 10:20 con turnos de 30 no da ninguno', () => {
    expect(buildSlots([bloque('10:00', '10:20', 30)], LUNES)).toEqual([]);
  });

  it('respeta duraciones distintas de media hora', () => {
    expect(buildSlots([bloque('08:00', '09:00', 20)], LUNES)).toEqual(['08:00', '08:20', '08:40']);
  });

  it('ignora las franjas de otro día de la semana', () => {
    expect(buildSlots([bloque('08:00', '10:00', 30, 3)], LUNES)).toEqual([]);
  });

  // El README dice que un médico puede tener dos bloques por día. Si la API los
  // devuelve en otro orden, la tarde aparecía ANTES que la mañana en la grilla.
  it('dos bloques del mismo día salen en orden, venga como venga la lista', () => {
    const tarde = bloque('16:00', '17:00', 30);
    const maniana = bloque('08:00', '09:00', 30);
    expect(buildSlots([tarde, maniana], LUNES)).toEqual(['08:00', '08:30', '16:00', '16:30']);
  });

  // Datos viejos pueden tener franjas superpuestas: hasta hoy se podían crear.
  // El mismo horario dos veces es una fila repetida en la grilla.
  it('no repite un horario aunque dos franjas se pisen', () => {
    expect(buildSlots([bloque('08:00', '09:00', 30), bloque('08:30', '09:30', 30)], LUNES))
      .toEqual(['08:00', '08:30', '09:00']);
  });

  it('sin disponibilidad no hay horarios', () => {
    expect(buildSlots([], LUNES)).toEqual([]);
  });

  // El tipo dice que slotDuration es obligatorio, pero los tipos no existen en
  // runtime y este dato viene de la red: si falta, media hora es lo razonable.
  it('si la API no manda la duración, asume 30 minutos', () => {
    const sinDuracion = { id: 'x', doctorId: 'd1', dayOfWeek: 1, startTime: '08:00', endTime: '09:00' } as unknown as Availability;
    expect(buildSlots([sinDuracion], LUNES)).toEqual(['08:00', '08:30']);
  });
});
