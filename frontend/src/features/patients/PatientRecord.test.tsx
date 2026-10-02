import { render, screen, waitFor } from '@testing-library/react';
import { PatientRecord } from './PatientRecord';

const { reportsApi, prescriptionsApi } = vi.hoisted(() => ({
  reportsApi: { findByPatient: vi.fn(), download: vi.fn() },
  prescriptionsApi: { findByPatient: vi.fn() },
}));

vi.mock('../../api/reports', () => ({ reportsApi }));
vi.mock('../../api/prescriptions', () => ({ prescriptionsApi }));

const paciente = { id: 'p1', name: 'Ana Gómez', email: 'ana@demo.pulso' } as never;

const pagina = <T,>(data: T[]) => ({ data, total: data.length, page: 1, limit: 20, totalPages: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  reportsApi.findByPatient.mockResolvedValue(pagina([]));
  prescriptionsApi.findByPatient.mockResolvedValue(pagina([]));
});

describe('PatientRecord', () => {
  it('no pide nada mientras no haya un paciente elegido', () => {
    render(<PatientRecord patient={null} />);

    // Es la razon de ser del componente: cada rechazo queda auditado, asi que
    // no se consulta la historia hasta que alguien la pide de verdad.
    expect(reportsApi.findByPatient).not.toHaveBeenCalled();
    expect(prescriptionsApi.findByPatient).not.toHaveBeenCalled();
  });

  it('muestra informes y recetas de esa persona', async () => {
    reportsApi.findByPatient.mockResolvedValue(
      pagina([{
        id: 'r1', title: 'Radiografía de tórax', mimeType: 'application/pdf',
        sizeBytes: 2048, createdAt: '2026-03-10T12:00:00.000Z',
      }]),
    );
    prescriptionsApi.findByPatient.mockResolvedValue(
      pagina([{
        id: 'rx1', medications: [{ name: 'Ibuprofeno 400mg' }],
        createdAt: '2026-03-10T12:30:00.000Z',
      }]),
    );

    render(<PatientRecord patient={paciente} />);

    expect(await screen.findByText('Radiografía de tórax')).toBeInTheDocument();
    expect(await screen.findByText('Ibuprofeno 400mg')).toBeInTheDocument();
    expect(reportsApi.findByPatient).toHaveBeenCalledWith('p1');
  });

  it('un 403 se explica como regla, no como falla del sistema', async () => {
    // El medico que nunca atendio a esta persona no ve su historia, y eso es
    // la politica funcionando. Un "algo salio mal" generico le haria pensar
    // que el sistema esta roto.
    reportsApi.findByPatient.mockRejectedValue({ status: 403 });

    render(<PatientRecord patient={paciente} />);

    expect(await screen.findByText(/no atendiste a esta persona/i)).toBeInTheDocument();
  });

  it('un error cualquiera no se disfraza de regla de acceso', async () => {
    // La contracara del test de arriba: si todo error dijera "no te
    // corresponde", una caida de red se leeria como falta de permisos y nadie
    // reportaria el problema real.
    reportsApi.findByPatient.mockRejectedValue({ status: 500 });

    render(<PatientRecord patient={paciente} />);

    await waitFor(() => expect(screen.queryByText(/no atendiste/i)).not.toBeInTheDocument());
    expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument();
  });

  it('al cambiar de paciente no muestra la historia del anterior', async () => {
    // El estado sobrevive al cambio de prop: sin etiquetarlo con su dueño,
    // abrir a una persona y despues a otra mostraba los informes de la primera
    // mientras llegaban los de la segunda. En una historia clinica, mostrar
    // datos de otra persona aunque sea un instante es inaceptable.
    reportsApi.findByPatient.mockResolvedValueOnce(
      pagina([{ id: 'r1', title: 'Estudio de Ana', mimeType: 'application/pdf', sizeBytes: 10, createdAt: '2026-01-01T00:00:00.000Z' }]),
    );

    const { rerender } = render(<PatientRecord patient={paciente} />);
    expect(await screen.findByText('Estudio de Ana')).toBeInTheDocument();

    let resolver: (v: unknown) => void = () => {};
    reportsApi.findByPatient.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
    rerender(<PatientRecord patient={{ id: 'p2', name: 'Beto Díaz' } as never} />);

    // Mientras la consulta del segundo viaja, lo del primero ya no esta.
    await waitFor(() => expect(screen.queryByText('Estudio de Ana')).not.toBeInTheDocument());
    resolver(pagina([]));
  });

  it('avisa cuando la persona todavia no tiene nada cargado', async () => {
    render(<PatientRecord patient={paciente} />);

    expect(await screen.findByText(/todavía no tiene informes/i)).toBeInTheDocument();
    expect(screen.getByText(/todavía no tiene recetas/i)).toBeInTheDocument();
  });
});
