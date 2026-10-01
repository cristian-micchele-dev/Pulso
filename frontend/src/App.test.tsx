import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

/**
 * El dominio pelado tiene que llevar a algún lado.
 *
 * Hasta el primer despliegue no existía ninguna ruta para `/`: todo caía en el
 * comodín y mostraba la pantalla de "no encontrado". En desarrollo no se nota
 * nunca, porque uno siempre entra a `/login` directo — pero es exactamente lo
 * primero que ve cualquiera que abre el enlace.
 */

const { auth } = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: false, user: null },
}));

vi.mock('./context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./hooks/useSocket', () => ({ useSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock('./hooks/useToast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }),
}));

const renderEn = (ruta: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[ruta]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('App — la raíz del sitio', () => {
  it('sin sesión, la raíz termina en el login y no en "no encontrado"', async () => {
    renderEn('/');

    // `/` manda al panel y el guardia rebota a /login por no haber sesión. Lo
    // que importa es dónde se termina, no cuántos saltos hubo en el medio.
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
  });

  it('una ruta inventada sí muestra "no encontrado"', async () => {
    renderEn('/esto-no-existe');

    // La contracara del test de arriba: si el comodín dejara de funcionar, el
    // primero pasaría igual y no nos enteraríamos de nada.
    expect(await screen.findByText(/no encontrad/i)).toBeInTheDocument();
  });
});
