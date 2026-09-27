/**
 * Cuándo atiende un médico, y cuándo no.
 *
 * Son las reglas del dominio, así que viven fuera del componente: adentro sólo
 * se podían probar renderizando la pantalla entera, y una regla que cuesta
 * probar es una regla que nadie prueba. Acá además no tocan estado — reciben
 * datos y devuelven errores.
 */

export interface SlotDraft {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  slotDuration: string;
}

export interface SlotErrors {
  dayOfWeek?: string;
  startTime?: string;
  endTime?: string;
  slotDuration?: string;
}

/** Una franja ya cargada, para detectar superposiciones. */
export interface ExistingSlot {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface BlockDraft {
  startDate: string;
  endDate: string;
  reason: string;
}

export interface BlockErrors {
  startDate?: string;
  endDate?: string;
}

/** 'HH:mm' a minutos desde medianoche. Comparar strings alcanza para ordenar, no para restar. */
const minutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const seSuperponen = (aDesde: string, aHasta: string, bDesde: string, bHasta: string): boolean =>
  minutos(aDesde) < minutos(bHasta) && minutos(bDesde) < minutos(aHasta);

/**
 * `excludeId` es la franja que se está editando: no tiene sentido que choque
 * consigo misma.
 */
export function validateSlot(draft: SlotDraft, existentes: ExistingSlot[], excludeId?: string): SlotErrors {
  const errors: SlotErrors = {};

  if (!draft.dayOfWeek) errors.dayOfWeek = 'Seleccioná un día';
  if (!draft.startTime) errors.startTime = 'Ingresá la hora de inicio';
  if (!draft.endTime) errors.endTime = 'Ingresá la hora de fin';

  if (!draft.startTime || !draft.endTime) return errors;

  // Igual también es error: una franja de duración cero nunca ofrece un turno.
  if (minutos(draft.endTime) <= minutos(draft.startTime)) {
    errors.endTime = 'La hora de fin debe ser posterior al inicio';
    return errors;
  }

  // Un turno de 60 minutos en una franja de 30 no entra nunca: la franja queda
  // cargada y sin un solo horario disponible, que es peor que no cargarla.
  const duracion = Number(draft.slotDuration);
  if (duracion > minutos(draft.endTime) - minutos(draft.startTime)) {
    errors.slotDuration = 'El turno no entra en la franja';
  }

  // Dos franjas pisadas el mismo día dejan al médico con dos turnos a la vez.
  // `excludeId !== undefined` explícito: sin eso, dos franjas SIN id se comparan
  // como `undefined !== undefined` —falso— y se salteaban entre sí.
  const choque = existentes.some((s) =>
    !(excludeId !== undefined && s.id === excludeId)
    && s.dayOfWeek === Number(draft.dayOfWeek)
    && seSuperponen(draft.startTime, draft.endTime, s.startTime, s.endTime));
  if (choque) errors.startTime = 'Se superpone con otra franja de ese día';

  return errors;
}

export function validateBlock(draft: BlockDraft): BlockErrors {
  const errors: BlockErrors = {};

  if (!draft.startDate) errors.startDate = 'Ingresá la fecha de inicio';
  if (!draft.endDate) errors.endDate = 'Ingresá la fecha de fin';

  // Un solo día es un rango válido: alguien se toma UN día.
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'La fecha de fin no puede ser anterior al inicio';
  }

  return errors;
}
