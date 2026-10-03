import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

const { navigate, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { login: vi.fn() },
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const renderPage = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);
const submit = async () => {
  await userEvent.type(screen.getByLabelText(/email/i), 'admin@h.com');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'Admin1234');
  await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
};

beforeEach(() => { vi.clearAllMocks(); auth.login.mockResolvedValue(undefined); });

describe('LoginPage — recordarme', () => {
  it('por defecto no recuerda la sesión', async () => {
    renderPage();
    expect(screen.getByRole('checkbox', { name: /recordarme/i })).not.toBeChecked();
    await submit();
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('admin@h.com', 'Admin1234', false));
  });

  it('con el checkbox marcado envía rememberMe=true', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('checkbox', { name: /recordarme/i }));
    await submit();
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('admin@h.com', 'Admin1234', true));
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });
});

describe('LoginPage — qué le dice al que no puede entrar', () => {
  it('muestra el motivo real del servidor: el cliente rechaza con un objeto, no con un Error', async () => {
    auth.login.mockRejectedValue({
      status: 429,
      code: 'ACCOUNT_LOCKED',
      detail: 'Demasiados intentos fallidos. Volvé a probar en 5 minutos.',
    });
    renderPage();
    await submit();
    expect(await screen.findByText(/volvé a probar en 5 minutos/i)).toBeInTheDocument();
  });

  it('sin motivo del servidor cae al mensaje de siempre', async () => {
    auth.login.mockRejectedValue({ status: 401, code: 'UNAUTHORIZED' });
    renderPage();
    await submit();
    expect(await screen.findByText(/credenciales incorrectas/i)).toBeInTheDocument();
  });
});

describe('LoginPage — acceso a la demo', () => {
  it('un clic entra sin que nadie tipee la contraseña', async () => {
    // La contrasena tiene espacios y se copia de un posteo: el tipeo es la
    // causa real de los bloqueos, y esto lo elimina.
    auth.login.mockResolvedValueOnce(undefined);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Secretaría' }));

    expect(auth.login).toHaveBeenCalledWith('marta.recepcion@demo.pulso', 'demo pulso 2026', false);

    // Los campos quedan completos, no solo se envia por detras: quien mira la
    // pantalla tiene que ver con que entro, sobre todo en una demo que se usa
    // para mostrarle el sistema a alguien.
    expect(screen.getByLabelText(/email/i)).toHaveValue('marta.recepcion@demo.pulso');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('demo pulso 2026');
  });

  it('con la cuenta bloqueada ofrece entrar con otra', async () => {
    // El bloqueo se vence solo, pero quien llega en ese momento ve un error y
    // se va creyendo que la demo esta rota. Con la salida a mano, entra igual.
    auth.login.mockRejectedValueOnce({ code: 'ACCOUNT_LOCKED', message: 'Demasiados intentos fallidos.' });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Secretaría' }));

    const salida = await screen.findByRole('button', { name: /entrar como médica en su lugar/i });

    auth.login.mockResolvedValueOnce(undefined);
    await userEvent.click(salida);
    expect(auth.login).toHaveBeenLastCalledWith('valeria.sosa@demo.pulso', 'demo pulso 2026', false);
  });

  it('una credencial equivocada cualquiera NO ofrece otra cuenta', async () => {
    // Solo el bloqueo habilita la salida. Ofrecerla ante cualquier error seria
    // invitar a entrar con otra identidad a quien se equivoco de contrasena.
    auth.login.mockRejectedValueOnce({ code: 'UNAUTHORIZED', message: 'Credenciales inválidas' });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Secretaría' }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /en su lugar/i })).not.toBeInTheDocument();
  });
});
