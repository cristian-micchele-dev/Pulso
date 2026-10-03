import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { apiErrorMessage } from '../../api/client';
import { CUENTAS_DEMO, alternativaA, type CuentaDemo } from './demoAccounts';
import styles from './LoginPage.module.css';

/**
 * El fondo 3D se carga aparte del formulario.
 *
 * Arrastra three.js, casi un megabyte, y ésta es la primera pantalla que abre
 * cualquiera: metido en este chunk, el formulario esperaría a que baje una
 * decoración para poder usarse. Así entra cuando llega, sin frenar a nadie.
 */
const NeuralTissue = lazy(() =>
  import('../../components/ui/NeuralTissue').then((m) => ({ default: m.NeuralTissue })),
);

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  /** Cuenta que ofrecer cuando la elegida quedó bloqueada por intentos fallidos. */
  const [sugerida, setSugerida] = useState<CuentaDemo | null>(null);

  async function entrar(unEmail: string, unaPassword: string) {
    setError('');
    setSugerida(null);
    setIsLoading(true);

    try {
      await login(unEmail, unaPassword, rememberMe);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      // El cliente rechaza con un objeto plano (ApiError), no con un Error: un
      // `instanceof Error` acá se comía el motivo y mostraba siempre el genérico.
      setError(apiErrorMessage(err, 'Credenciales incorrectas. Intentá de nuevo.'));

      // El bloqueo se vence solo en unos minutos, pero quien llega justo en ese
      // momento ve un error y se va creyendo que la demo está rota. Si la
      // cuenta es de la demo, se le ofrece otra que sí entra.
      if ((err as { code?: string }).code === 'ACCOUNT_LOCKED') {
        setSugerida(alternativaA(unEmail));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await entrar(email, password);
  }

  /** Completa el formulario y entra: un clic, sin tipear la contraseña. */
  async function entrarComo(cuenta: CuentaDemo) {
    setEmail(cuenta.email);
    setPassword(cuenta.password);
    await entrar(cuenta.email, cuenta.password);
  }

  return (
    <div className={styles.page}>
      {/*
        Sin `fallback`: mientras el tejido no está, se ve la gradiente que ya
        pinta `.page`. Un spinner acá sería peor que nada, porque anunciaría que
        falta algo que el usuario no vino a buscar.
      */}
      <Suspense fallback={null}>
        <NeuralTissue />
      </Suspense>
      <div className={styles.card} role="main">
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <rect width="36" height="36" rx="10" fill="var(--primary)" />
              <path
                d="M18 8v20M8 18h20"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className={styles.appName}>Pulso</h1>
          <p className={styles.subtitle}>Gestión de turnos médicos</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Input
            label="Email"
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            autoComplete="email"
            autoFocus
            required
          />

          <Input
            label="Contraseña"
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Recordarme en este equipo</span>
          </label>

          {error && (
            <div className={styles.errorBanner} role="alert" aria-live="polite">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          {sugerida && (
            <button
              type="button"
              className={styles.sugerencia}
              onClick={() => entrarComo(sugerida)}
              disabled={isLoading}
            >
              Entrar como {sugerida.etiqueta.toLowerCase()} en su lugar
            </button>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            className={styles.submitBtn}
          >
            Iniciar Sesión
          </Button>
        </form>

        <div className={styles.demo}>
          <p className={styles.demoLabel}>Demo pública — entrá con un clic</p>
          <div className={styles.demoBotones}>
            {CUENTAS_DEMO.map((cuenta) => (
              <button
                key={cuenta.email}
                type="button"
                className={styles.demoBoton}
                onClick={() => entrarComo(cuenta)}
                disabled={isLoading}
              >
                {cuenta.etiqueta}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <Link to="/forgot-password" className={styles.link}>
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
      </div>
    </div>
  );
}
