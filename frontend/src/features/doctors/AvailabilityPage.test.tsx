import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AvailabilityPage } from './AvailabilityPage';

const { toast, auth, doctorsApi, navigate } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  auth: { user: { id: 'u1', email: 'doc@h.com', name: 'Doc', role: 'DOCTOR' as const, mustChangePassword: false } },
  doctorsApi: {
    me: vi.fn(), findOne: vi.fn(), getAvailability: vi.fn(), getBlocks: vi.fn(),
    setAvailability: vi.fn(), addBlock: vi.fn(), removeBlock: vi.fn(),
  },
  navigate: vi.fn(),
}));

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../api/doctors', () => ({ doctorsApi }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
  useParams: () => ({}),
}));

const renderPage = () => render(<MemoryRouter><AvailabilityPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  doctorsApi.me.mockResolvedValue({ id: 'd1', licenseNumber: 'MP-1', user: { id: 'u1', name: 'Doc' } });
  doctorsApi.getAvailability.mockResolvedValue([]);
  doctorsApi.getBlocks.mockResolvedValue([]);
  doctorsApi.addBlock.mockResolvedValue({ id: 'b1', startDate: '', endDate: '', reason: '' });
});

/** Abre el formulario de bloqueos y carga los dos instantes. */
const cargarBloqueo = async (desde: string, hasta: string) => {
  await userEvent.click(await screen.findByRole('button', { name: /Agregar Bloqueo/i }));
  await userEvent.type(screen.getByLabelText(/fecha y hora de inicio/i), desde);
  await userEvent.type(screen.getByLabelText(/fecha y hora de fin/i), hasta);
};

const guardar = () => userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

describe('AvailabilityPage — bloquear la agenda', () => {
  /**
   * El campo es `datetime-local`: el usuario elige fecha Y hora, y el valor llega
   * como '2027-01-18T09:00'. `new Date` lo interpreta en la zona del navegador
   * —la del hospital— y no en UTC, que es lo que pasaría con una fecha sola.
   * Este test fija esa forma: si alguien cambia el input a `date`, o intenta
   * redondear a día completo, el instante deja de ser el que la persona eligió.
   */
  it('manda el instante exacto que eligió la persona, en su propia zona horaria', async () => {
    renderPage();
    await cargarBloqueo('2027-01-18T09:00', '2027-01-20T18:00');
    await guardar();

    await waitFor(() => expect(doctorsApi.addBlock).toHaveBeenCalled());
    const [, dto] = doctorsApi.addBlock.mock.calls[0];

    const inicio = new Date(dto.startDate);
    expect(inicio.getDate()).toBe(18);
    expect(inicio.getHours()).toBe(9);

    const fin = new Date(dto.endDate);
    expect(fin.getDate()).toBe(20);
    expect(fin.getHours()).toBe(18);
  });

  it('bloquear una sola tarde es válido: no hace falta que sean días distintos', async () => {
    renderPage();
    await cargarBloqueo('2027-01-20T14:00', '2027-01-20T20:00');
    await guardar();
    await waitFor(() => expect(doctorsApi.addBlock).toHaveBeenCalled());
  });

  it('un bloqueo que empieza y termina en el mismo instante no bloquea nada', async () => {
    renderPage();
    await cargarBloqueo('2027-01-20T14:00', '2027-01-20T14:00');
    await guardar();
    await waitFor(() => expect(screen.getByText(/posterior al inicio/i)).toBeInTheDocument());
    expect(doctorsApi.addBlock).not.toHaveBeenCalled();
  });

  it('el fin anterior al inicio se rechaza sin llegar al servidor', async () => {
    renderPage();
    await cargarBloqueo('2027-01-20T14:00', '2027-01-18T09:00');
    await guardar();
    await waitFor(() => expect(screen.getByText(/posterior al inicio/i)).toBeInTheDocument());
    expect(doctorsApi.addBlock).not.toHaveBeenCalled();
  });
});
