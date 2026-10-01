/**
 * Cómo se marcan las cookies de sesión, según dónde viva el frontend.
 *
 * Con todo en el mismo origen —un `localhost` en desarrollo, o un proxy que
 * sirve frontend y API bajo el mismo dominio— `SameSite=Lax` es lo correcto:
 * protege de CSRF y la cookie viaja igual.
 *
 * Pero si el frontend está en un dominio y la API en otro (por ejemplo Vercel
 * contra Render), el navegador considera cross-site a cada llamada y una cookie
 * `Lax` NO SE ENVÍA. El síntoma es desconcertante: el login funciona, y al
 * recargar la página el usuario aparece deslogueado, porque el refresh nunca
 * recibió la cookie. En local no pasa nunca, y por eso se descubre en producción.
 *
 * Para ese caso hace falta `SameSite=None`, que el navegador sólo acepta junto
 * con `Secure`. Acá eso se garantiza por construcción y no se deja librado a que
 * alguien se acuerde de poner las dos variables bien.
 */

export type SameSite = 'lax' | 'strict' | 'none';

export interface CookiePolicy {
  sameSite: SameSite;
  secure: boolean;
}

const VALIDOS: SameSite[] = ['lax', 'strict', 'none'];

/**
 * `COOKIE_SAMESITE` describe la TOPOLOGÍA del despliegue, no el entorno: puede
 * haber producción en un mismo dominio y desarrollo repartido en dos. Por eso es
 * una variable propia y no se deduce de `NODE_ENV`.
 */
export function cookiePolicy(env: NodeJS.ProcessEnv = process.env): CookiePolicy {
  const pedido = (env.COOKIE_SAMESITE ?? '').toLowerCase() as SameSite;
  const sameSite = VALIDOS.includes(pedido) ? pedido : 'lax';

  // `None` sin `Secure` lo rechaza el navegador entero: la cookie no se guarda y
  // el login queda roto sin un solo error en el servidor.
  const secure = sameSite === 'none' || env.NODE_ENV === 'production';

  return { sameSite, secure };
}
