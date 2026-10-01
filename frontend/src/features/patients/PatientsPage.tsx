import { useState } from 'react';
import { patientsApi, type Patient, type PatientInput } from '../../api/patients';
import type { PaginatedResponse } from '../../api/users';
import { useToast } from '../../hooks/useToast';
import { useFetch } from '../../hooks/useFetch';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAuth } from '../../context/AuthContext';
import { Table } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { PatientRecordModal } from './PatientRecordModal';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { PatientForm } from './PatientForm';
import styles from './PatientsPage.module.css';

export function PatientsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // The server searches the whole registry; the browser asks once per pause in typing.
  const query = useDebouncedValue(search.trim(), 300);

  const { data: result, loading, refetch: refetchPatients } = useFetch<PaginatedResponse<Patient>>(
    ['patients', page, query],
    () => patientsApi.findAll(page, 20, query || undefined),
  );
  const patients = result?.data ?? [];
  const totalPages = result?.totalPages ?? 1;

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | undefined>(undefined);

  const handleOpenCreate = () => {
    setSelectedPatient(undefined);
    setModalOpen(true);
  };

  const handleOpenEdit = (patient: Patient) => {
    setSelectedPatient(patient);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedPatient(undefined);
  };

  const handleSubmit = async (data: PatientInput) => {
    if (selectedPatient) {
      await patientsApi.update(selectedPatient.id, data);
      toast.success(`Paciente ${data.name} actualizado`);
    } else {
      await patientsApi.create(data);
      toast.success(`Paciente ${data.name} creado`);
    }
    handleCloseModal();
    await refetchPatients();
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'DOCTOR' || user?.role === 'SECRETARY';

  /*
   * La historia clinica no es un dato administrativo. La politica del backend
   * dice SECRETARY: nunca —"the front desk schedules care, it does not read
   * it"— asi que para la recepcion el boton no se deshabilita: no existe.
   * Mostrar algo que siempre va a dar error es peor que no mostrarlo.
   *
   * Esto es cortesia de interfaz, no seguridad: aunque alguien forzara el
   * boton, la API rechaza y lo deja auditado.
   */
  const puedeVerHistoria = user?.role === 'ADMIN' || user?.role === 'DOCTOR';
  const [historiaDe, setHistoriaDe] = useState<Patient | null>(null);

  const columns = [
    {
      key: 'name',
      header: 'Nombre',
      sortable: true,
      render: (p: Patient) => (
        <span className={styles.nameCell}>{p.name}</span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (p: Patient) => (
        <span className={styles.emailCell}>{p.email ?? '—'}</span>
      ),
    },
    {
      key: 'phone',
      header: 'Teléfono',
      render: (p: Patient) => (
        <span className={styles.secondaryCell}>{p.phone ?? '—'}</span>
      ),
    },
    {
      key: 'insuranceNumber',
      header: 'Obra Social',
      render: (p: Patient) => (
        <span className={styles.secondaryCell}>{p.insuranceNumber ?? '—'}</span>
      ),
    },
    {
      key: 'notes',
      header: 'Notas',
      render: (p: Patient) => (
        <span className={styles.notesCell}>{p.notes ?? '—'}</span>
      ),
    },
    {
      key: 'active',
      header: 'Estado',
      width: '120px',
      render: (p: Patient) =>
        p.active ? (
          <Badge variant="success">Activo</Badge>
        ) : (
          <Badge variant="neutral">Inactivo</Badge>
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Acciones',
            hideUntilHover: true,
            align: 'right' as const,
            width: '200px',
            render: (p: Patient) => (
              <div className={styles.actions}>
                {puedeVerHistoria && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoriaDe(p);
                    }}
                  >
                    Historia
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(p);
                  }}
                >
                  Editar
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Pacientes</h1>
          <p className={styles.subtitle}>
            Registro general de pacientes del hospital
          </p>
        </div>
        <div className={styles.headerActions}>
          <input
            className={styles.searchBar}
            type="search"
            placeholder="Nombre, email, obra social o teléfono…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          {canManage && (
            <Button variant="primary" onClick={handleOpenCreate}>
              + Nuevo Paciente
            </Button>
          )}
        </div>
      </header>

      <div className={styles.tableContainer}>
        <Table
          columns={columns}
          data={patients}
          keyExtractor={(p) => p.id}
          loading={loading}
          filtered={query.length > 0}
          total={result?.total}
          page={page}
          empty={{
            title: 'Todavía no hay pacientes',
            description: 'El paciente es un registro del hospital: cargalo con nombre y datos de contacto.',
            ...(canManage ? { action: { label: '+ Nuevo paciente', onClick: handleOpenCreate } } : {}),
          }}
          onRowClick={canManage ? handleOpenEdit : undefined}
        />
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {canManage && (
        <Modal
          isOpen={modalOpen}
          onClose={handleCloseModal}
          title={selectedPatient ? 'Editar Paciente' : 'Nuevo Paciente'}
          size="md"
        >
          <PatientForm
            patient={selectedPatient}
            onSubmit={handleSubmit}
            onCancel={handleCloseModal}
          />
        </Modal>
      )}

      {puedeVerHistoria && (
        <PatientRecordModal patient={historiaDe} onClose={() => setHistoriaDe(null)} />
      )}
    </div>
  );
}
