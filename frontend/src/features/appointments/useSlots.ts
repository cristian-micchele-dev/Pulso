import { useEffect, useRef, useState } from 'react';
import { doctorsApi } from '../../api/doctors';
import { appointmentsApi } from '../../api/appointments';
import { buildSlots } from './buildSlots';

export interface Slots {
  /** Todos los horarios que el médico atiende ese día. */
  todos: string[];
  /** Los que ya están tomados: se muestran, pero no se pueden elegir. */
  ocupados: Set<string>;
  elegido: string | null;
  elegir: (hora: string | null) => void;
  cargando: boolean;
  error: string | null;
}

/** La hora del turno en el reloj de quien mira, que es como se eligen los horarios. */
function horaLocal(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Los horarios de un médico para un día: cuáles atiende y cuáles ya están tomados.
 *
 * Estaba disuelto en la pantalla de alta de turnos, que llegó a tener veintiún
 * trozos de estado y cuatro efectos mirándose entre sí. Dos de esos efectos
 * llamaban a una función declarada más abajo —funcionaba por el orden en que
 * corren las cosas, no por diseño— y ninguno declaraba de qué dependía.
 *
 * Acá el estado es de este hook y de nadie más, así que el orden deja de
 * emerger: hay un solo efecto y dice exactamente qué lo despierta.
 */
export function useSlots(doctorId: string | undefined, fecha: string, activo: boolean): Slots {
  const [todos, setTodos] = useState<string[]>([]);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());
  const [elegido, setElegido] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Cuántas consultas se dispararon.
   *
   * Cambiar de fecha rápido deja varias en vuelo, y la primera en salir puede
   * volver última: sin esto, la pantalla termina mostrando los horarios de un
   * día que ya nadie está mirando. Se ignora toda respuesta que no sea de la
   * consulta más reciente.
   */
  const pedido = useRef(0);

  useEffect(() => {
    if (!activo || !doctorId) return;

    const mio = ++pedido.current;
    setCargando(true);
    setError(null);
    // Los horarios del día anterior no son una opción válida ni por un cuadro.
    setTodos([]);
    setOcupados(new Set());
    setElegido(null);

    Promise.all([
      doctorsApi.getAvailability(doctorId, fecha),
      appointmentsApi.findAll({ doctorId, from: fecha, to: fecha }),
    ])
      .then(([disponibilidad, turnos]) => {
        if (mio !== pedido.current) return;
        setTodos(buildSlots(disponibilidad, fecha));
        setOcupados(
          new Set(
            (turnos.data ?? [])
              .filter((t) => t.status !== 'CANCELLED')
              .map((t) => horaLocal(t.dateTime)),
          ),
        );
      })
      .catch(() => {
        if (mio === pedido.current) setError('Error al cargar los horarios disponibles');
      })
      .finally(() => {
        if (mio === pedido.current) setCargando(false);
      });
  }, [doctorId, fecha, activo]);

  return { todos, ocupados, elegido, elegir: setElegido, cargando, error };
}
