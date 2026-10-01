import { cookiePolicy } from './cookie-policy';

describe('cookiePolicy', () => {
  it('usa Lax por defecto, que es lo correcto con todo en el mismo origen', () => {
    expect(cookiePolicy({})).toEqual({ sameSite: 'lax', secure: false });
  });

  it('marca Secure en produccion aunque siga en Lax', () => {
    expect(cookiePolicy({ NODE_ENV: 'production' })).toEqual({ sameSite: 'lax', secure: true });
  });

  it('acepta None para cuando el frontend vive en otro dominio', () => {
    // Sin esto, con el frontend en Vercel y la API en Render el navegador no
    // manda la cookie: el login entra y al recargar la sesion se pierde.
    expect(cookiePolicy({ COOKIE_SAMESITE: 'none' }).sameSite).toBe('none');
  });

  it('fuerza Secure junto con None, aunque no sea produccion', () => {
    // El navegador descarta una cookie None sin Secure y no avisa a nadie. Que
    // la combinacion sea imposible de armar mal es el punto de este modulo.
    expect(cookiePolicy({ COOKIE_SAMESITE: 'none' }).secure).toBe(true);
    expect(cookiePolicy({ COOKIE_SAMESITE: 'NONE', NODE_ENV: 'development' })).toEqual({
      sameSite: 'none',
      secure: true,
    });
  });

  it('acepta strict para un despliegue de un solo origen que quiera cerrarse mas', () => {
    expect(cookiePolicy({ COOKIE_SAMESITE: 'strict' }).sameSite).toBe('strict');
  });

  it('ignora un valor invalido y cae en Lax en vez de romper el arranque', () => {
    // Un valor mal escrito tiene que degradar al comportamiento seguro, no
    // propagarse hasta el navegador y dejar cookies con una politica inventada.
    expect(cookiePolicy({ COOKIE_SAMESITE: 'ninguna' }).sameSite).toBe('lax');
    expect(cookiePolicy({ COOKIE_SAMESITE: '' }).sameSite).toBe('lax');
  });
});
