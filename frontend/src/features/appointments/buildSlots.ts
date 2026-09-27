import type { Availability } from '../../api/doctors';

/**
 * De la disponibilidad de un médico a los horarios que se pueden reservar ese día.
 *
 * Es la regla que decide qué ve la secretaria cuando busca un turno, así que vive
 * afuera del componente y se prueba sola. Adentro sólo se podía verificar
 * renderizando el asistente entero y mirando la grilla.
 */
export function buildSlots(availability: Availability[], date: string): string[] {
  // Mediodía a propósito: leer el día de la semana a las 00:00 es pedirle
  // problemas a cualquier corrimiento de horario.
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const enMinutos = new Set<number>();

  for (const block of availability) {
    if (block.dayOfWeek !== dayOfWeek) continue;
    const [startH, startM] = block.startTime.split(':').map(Number);
    const [endH, endM] = block.endTime.split(':').map(Number);
    const end = endH * 60 + endM;
    const duration = block.slotDuration ?? 30;
    // `+ duration <= end`: no se ofrece un turno que no termina dentro de la franja.
    for (let current = startH * 60 + startM; current + duration <= end; current += duration) {
      enMinutos.add(current);
    }
  }

  // Ordenados y sin repetir: un médico puede tener dos bloques en el mismo día y
  // la API no promete en qué orden los devuelve. Sin esto, la tarde aparecía
  // antes que la mañana, y dos franjas pisadas mostraban el horario dos veces.
  return [...enMinutos]
    .sort((a, b) => a - b)
    .map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}
