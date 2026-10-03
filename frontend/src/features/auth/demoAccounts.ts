/**
 * Las cuentas de la demo pública, para entrar sin tipear.
 *
 * La contraseña tiene espacios y se copia de un posteo o del README: entre el
 * autocorrector y los espacios de más, errar es lo normal. Y cinco errores
 * sobre la MISMA cuenta —aunque los cometan cinco personas distintas— la
 * bloquean para todo el mundo, porque el contador es por cuenta y no por
 * visitante. Ya pasó con la cuenta publicada.
 *
 * Esto ataca la causa en vez de debilitar el bloqueo, que es una funcionalidad
 * del producto y no un estorbo.
 *
 * Tener varias también es defensa: si una queda bloqueada, las otras entran.
 */
export interface CuentaDemo {
  etiqueta: string;
  email: string;
  password: string;
}

/** La misma para todas, definida en `backend/src/database/seed-demo.ts`. */
const PASSWORD = 'demo pulso 2026';

export const CUENTAS_DEMO: CuentaDemo[] = [
  { etiqueta: 'Secretaría', email: 'marta.recepcion@demo.pulso', password: PASSWORD },
  { etiqueta: 'Médica', email: 'valeria.sosa@demo.pulso', password: PASSWORD },
];

/**
 * Qué cuenta sugerir cuando la que se intentó quedó bloqueada.
 *
 * El bloqueo se vence solo en unos minutos, pero quien llega en ese momento no
 * lo sabe: ve un error y se va pensando que la demo está rota. Ofrecerle otra
 * cuenta lo deja entrar igual.
 */
export function alternativaA(email: string): CuentaDemo | null {
  const normalizado = email.trim().toLowerCase();
  if (!CUENTAS_DEMO.some((c) => c.email === normalizado)) return null;
  return CUENTAS_DEMO.find((c) => c.email !== normalizado) ?? null;
}
