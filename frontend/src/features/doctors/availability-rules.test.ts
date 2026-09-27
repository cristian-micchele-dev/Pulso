import { validateBlock, validateSlot, type SlotDraft } from './availability-rules';

const franja = (p: Partial<SlotDraft> = {}): SlotDraft =>
  ({ dayOfWeek: '1', startTime: '08:00', endTime: '12:00', slotDuration: '30', ...p });

describe('validateSlot — cuándo atiende un médico', () => {
  it('una franja completa y coherente no tiene errores', () => {
    expect(validateSlot(franja(), [])).toEqual({});
  });

  it('pide los campos que faltan, cada uno con su mensaje', () => {
    const errores = validateSlot(franja({ dayOfWeek: '', startTime: '', endTime: '' }), []);
    expect(errores.dayOfWeek).toBeTruthy();
    expect(errores.startTime).toBeTruthy();
    expect(errores.endTime).toBeTruthy();
  });

  it('el fin tiene que ser posterior al inicio', () => {
    expect(validateSlot(franja({ startTime: '12:00', endTime: '08:00' }), []).endTime).toBeTruthy();
  });

  // Antes pasaba: la comparación aceptaba el caso igual y se guardaba una franja
  // de duración cero, en la que nunca hay un turno disponible.
  it('una franja de duración cero no es una franja', () => {
    expect(validateSlot(franja({ startTime: '08:00', endTime: '08:00' }), []).endTime).toBeTruthy();
  });

  // Antes pasaba: un turno de 60 minutos dentro de una franja de 30 no entra
  // nunca, así que la franja queda sin un solo horario disponible.
  it('el turno tiene que entrar en la franja', () => {
    expect(validateSlot(franja({ startTime: '08:00', endTime: '08:30', slotDuration: '60' }), []).slotDuration)
      .toBeTruthy();
  });

  it('un turno que entra justo es válido: 30 minutos en media hora', () => {
    expect(validateSlot(franja({ startTime: '08:00', endTime: '08:30', slotDuration: '30' }), [])).toEqual({});
  });

  // Antes pasaba: dos franjas superpuestas el mismo día dejan al médico
  // atendiendo dos turnos a la vez.
  it('dos franjas del mismo día no se pueden pisar', () => {
    const existentes = [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }];
    expect(validateSlot(franja({ startTime: '10:00', endTime: '14:00' }), existentes).startTime).toBeTruthy();
  });

  it('pegadas sí: de 08 a 12 y de 12 a 16 no se pisan', () => {
    const existentes = [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }];
    expect(validateSlot(franja({ startTime: '12:00', endTime: '16:00' }), existentes)).toEqual({});
  });

  it('el mismo horario en OTRO día no molesta: para eso hay varios días', () => {
    const existentes = [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }];
    expect(validateSlot(franja({ dayOfWeek: '2' }), existentes)).toEqual({});
  });

  it('al editar, la franja no se pisa consigo misma', () => {
    const existentes = [{ id: 'a', dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }];
    expect(validateSlot(franja({ startTime: '09:00', endTime: '13:00' }), existentes, 'a')).toEqual({});
  });
});

describe('validateBlock — cuándo NO atiende', () => {
  const bloque = (startDate: string, endDate: string) => ({ startDate, endDate, reason: '' });

  it('un bloqueo con fechas coherentes no tiene errores', () => {
    expect(validateBlock(bloque('2027-01-10', '2027-01-20'))).toEqual({});
  });

  it('pide las dos fechas', () => {
    const errores = validateBlock(bloque('', ''));
    expect(errores.startDate).toBeTruthy();
    expect(errores.endDate).toBeTruthy();
  });

  it('el fin no puede ser anterior al inicio', () => {
    expect(validateBlock(bloque('2027-01-20', '2027-01-10')).endDate).toBeTruthy();
  });

  it('un bloqueo de un solo día es válido: alguien se toma UN día', () => {
    expect(validateBlock(bloque('2027-01-10', '2027-01-10'))).toEqual({});
  });
});
