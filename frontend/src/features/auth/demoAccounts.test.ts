import { CUENTAS_DEMO, alternativaA } from './demoAccounts';

describe('cuentas de la demo', () => {
  it('ofrece al menos dos, para que un bloqueo no deje a nadie afuera', () => {
    // El contador de intentos fallidos es por CUENTA, no por visitante: cinco
    // errores de cinco personas distintas bloquean la misma cuenta para todas.
    // Con una sola cuenta publicada, eso deja la demo inaccesible.
    expect(CUENTAS_DEMO.length).toBeGreaterThanOrEqual(2);
  });

  it('todas usan la misma contraseña del seed', () => {
    const claves = new Set(CUENTAS_DEMO.map((c) => c.password));
    expect(claves).toEqual(new Set(['demo pulso 2026']));
  });

  it('propone otra cuenta cuando la elegida quedó bloqueada', () => {
    const otra = alternativaA('marta.recepcion@demo.pulso');

    expect(otra).not.toBeNull();
    expect(otra!.email).not.toBe('marta.recepcion@demo.pulso');
  });

  it('reconoce la cuenta aunque venga con mayúsculas o espacios', () => {
    // El email sale de lo que la persona escribió en el formulario.
    expect(alternativaA('  Marta.Recepcion@Demo.Pulso ')).not.toBeNull();
  });

  it('no propone nada si la cuenta no es de la demo', () => {
    // A quien tiene credenciales reales y quedó bloqueado no se le ofrece
    // entrar con otra identidad: eso seria sugerirle suplantar a alguien.
    expect(alternativaA('alguien@hospital.real')).toBeNull();
  });
});
