import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { specialtiesApi, type Specialty } from '../../api/specialties';
import { doctorsApi, type Doctor } from '../../api/doctors';
import { appointmentsApi } from '../../api/appointments';
import type { ApiError } from '../../api/client';
import type { UserProfile } from '../../api/auth';
import { patientsApi, type Patient, type PatientInput } from '../../api/patients';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Modal } from '../../components/ui/Modal';
import { PatientForm } from '../patients/PatientForm';
import { Check } from 'lucide-react';
import { addDaysLocal, localDateTimeToIso, todayLocal } from '../../utils/date';
import styles from './NewAppointmentPage.module.css';
import { apiErrorMessage } from '../../api/client';
import { buildSlots } from './buildSlots';

// ── Step kinds ──────────────────────────────────────────────────────────────
type StepKind = 'patient' | 'specialty' | 'doctor' | 'datetime' | 'confirm';

// A doctor books for themselves; whoever books for the hospital must pick the doctor first.
const ROLE_FLOWS: Record<UserProfile['role'], StepKind[]> = {
  DOCTOR:    ['patient', 'datetime', 'confirm'],
  ADMIN:     ['patient', 'specialty', 'doctor', 'datetime', 'confirm'],
  SECRETARY: ['patient', 'specialty', 'doctor', 'datetime', 'confirm'],
};

const STEP_LABEL: Record<StepKind, string> = {
  patient:   'Paciente',
  specialty: 'Especialidad',
  doctor:    'Doctor',
  datetime:  'Horario',
  confirm:   'Confirmar',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function getTomorrowDate(): string {
  return addDaysLocal(todayLocal(), 1);
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}


// ── Component ────────────────────────────────────────────────────────────────
export function NewAppointmentPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const flow: StepKind[] = ROLE_FLOWS[user?.role ?? 'DOCTOR'];
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const currentKind = flow[step - 1];
  const totalSteps  = flow.length;

  const [patients, setPatients]               = useState<Patient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patientsError, setPatientsError] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  // The registry can hold thousands of patients: the server searches, the browser only
  // asks — once per pause in typing, never per keystroke.
  const debouncedQuery = useDebouncedValue(patientQuery.trim(), 300);

  // The API caps limit at 100; asking for more is a 400, not a bigger page.
  const loadPatients = (q: string = debouncedQuery) => {
    setPatientsLoading(true);
    setPatientsError(false);
    patientsApi.findAll(1, 50, q || undefined)
      .then(res => setPatients(res.data.filter(p => p.active)))
      .catch(() => setPatientsError(true))
      .finally(() => setPatientsLoading(false));
  };
  const visiblePatients = patients;

  // Walk-in: register the patient here and continue booking without leaving the wizard.
  const handleCreatePatient = async (data: PatientInput) => {
    try {
      const created = await patientsApi.create(data);
      setPatients((prev) => [created, ...prev]);
      setSelectedPatient(created);
      setCreatingPatient(false);
      setPatientQuery('');
      toast.success(`Paciente ${created.name} registrado`);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'No se pudo registrar el paciente'));
    }
  };

  // Specialty (ADMIN only)
  const [specialties, setSpecialties]                   = useState<Specialty[]>([]);
  const [specialtiesLoading, setSpecialtiesLoading]     = useState(false);
  const [selectedSpecialty, setSelectedSpecialty]       = useState<Specialty | null>(null);

  // Doctor (ADMIN picks; auto-set for DOCTOR role)
  const [allDoctors, setAllDoctors]           = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading]   = useState(false);
  const [selectedDoctor, setSelectedDoctor]   = useState<Doctor | null>(null);

  // DateTime
  const [selectedDate, setSelectedDate]           = useState(getTomorrowDate());
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [allSlots, setAllSlots]                   = useState<string[]>([]);
  const [bookedSlots, setBookedSlots]             = useState<Set<string>>(new Set());
  const [selectedTime, setSelectedTime]           = useState<string | null>(null);

  // For DOCTOR role: resolve own profile on mount
  const [initLoading, setInitLoading] = useState(user?.role === 'DOCTOR');

  useEffect(() => {
    if (user?.role !== 'DOCTOR') return;
    doctorsApi.me()
      .then(d => setSelectedDoctor(d))
      .catch(() => toast.error('Error al cargar tu perfil de médico'))
      .finally(() => setInitLoading(false));
  }, [user]);

  // Load data when entering each step
  useEffect(() => {
    if (currentKind === 'patient') loadPatients(debouncedQuery);

    if (currentKind === 'specialty' && specialties.length === 0) {
      setSpecialtiesLoading(true);
      specialtiesApi.findAll(1, 100)
        .then(res => setSpecialties(res.data.filter(s => s.active)))
        .catch(() => toast.error('Error al cargar especialidades'))
        .finally(() => setSpecialtiesLoading(false));
    }

    if (currentKind === 'doctor' && allDoctors.length === 0) {
      setDoctorsLoading(true);
      doctorsApi.findAll(1, 100)
        .then(res => setAllDoctors(res.data.filter(d => d.active)))
        .catch(() => toast.error('Error al cargar doctores'))
        .finally(() => setDoctorsLoading(false));
    }

    if (currentKind === 'datetime') {
      const doctorId = selectedDoctor?.id;
      if (doctorId) loadSlots(doctorId, selectedDate);
    }
  }, [step, debouncedQuery]);

  // Reload slots when date changes (only when on datetime step)
  useEffect(() => {
    if (currentKind !== 'datetime') return;
    const doctorId = selectedDoctor?.id;
    if (doctorId) loadSlots(doctorId, selectedDate);
  }, [selectedDate]);

  const filteredDoctors = selectedSpecialty
    ? allDoctors.filter(d => d.specialtyId === selectedSpecialty.id)
    : allDoctors;

  const loadSlots = async (doctorId: string, date: string) => {
    setAvailabilityLoading(true);
    setAllSlots([]);
    setBookedSlots(new Set());
    setSelectedTime(null);
    try {
      const [avail, apptRes] = await Promise.all([
        doctorsApi.getAvailability(doctorId, date),
        appointmentsApi.findAll({ doctorId, from: date, to: date }),
      ]);
      setAllSlots(buildSlots(avail, date));
      const booked = new Set(
        (apptRes.data ?? [])
          .filter(a => a.status !== 'CANCELLED')
          .map(a => {
            const d = new Date(a.dateTime);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }),
      );
      setBookedSlots(booked);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Error al cargar los horarios disponibles'));
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const handleConfirm = async () => {
    const doctorId = selectedDoctor?.id;
    if (!doctorId || !selectedDate || !selectedTime) return;

    if (!selectedPatient) {
      toast.error('Seleccioná un paciente para continuar');
      return;
    }

    try {
      setSubmitting(true);
      await appointmentsApi.create({
        doctorId,
        patientId: selectedPatient.id,
        dateTime: localDateTimeToIso(selectedDate, selectedTime),
      });
      toast.success('Turno creado correctamente');
      navigate('/turnos');
    } catch (err) {
      // The API explains business-rule rejections (double booking, same-day specialty…) in Spanish: show that.
      toast.error((err as Partial<ApiError>).detail ?? 'No se pudo crear el turno');
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (step > 1) setStep(s => s - 1);
  };

  const goForward = () => {
    if (step < totalSteps) setStep(s => s + 1);
  };

  if (initLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.centered}><Spinner /></div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Nuevo Turno</h1>
          <p className={styles.subtitle}>
            {user?.role === 'DOCTOR' ? 'Asigná un turno a un paciente' : 'Creá un turno para un paciente'}
          </p>
        </div>
      </header>

      {/* Stepper */}
      <div className={styles.stepper}>
        {flow.map((kind, idx) => {
          const s = idx + 1;
          const isActive = s === step;
          const isDone   = s < step;
          return (
            <div key={kind} className={styles.stepItem}>
              <button
                type="button"
                className={[
                  styles.stepCircle,
                  isActive ? styles.stepActive : '',
                  isDone   ? styles.stepDone   : '',
                ].filter(Boolean).join(' ')}
                onClick={() => { if (isDone) setStep(s); }}
                disabled={!isDone}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? '✓' : s}
              </button>
              <span className={[styles.stepLabel, isActive ? styles.stepLabelActive : ''].filter(Boolean).join(' ')}>
                {STEP_LABEL[kind]}
              </span>
              {s < totalSteps && (
                <div className={[styles.stepLine, isDone ? styles.stepLineDone : ''].filter(Boolean).join(' ')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className={styles.card}>

        {/* ── PATIENT SELECTION ── */}
        {currentKind === 'patient' && (
          <div className={styles.stepContent}>
            <div className={styles.stepHeader}>
              <h2 className={styles.stepTitle}>Buscá al paciente</h2>
              <Button variant="secondary" size="sm" onClick={() => setCreatingPatient(true)}>
                + Nuevo paciente
              </Button>
            </div>
            <input
              type="search"
              className={styles.patientSearch}
              placeholder="Nombre, email u obra social…"
              aria-label="Buscar paciente"
              value={patientQuery}
              onChange={(e) => setPatientQuery(e.target.value)}
              autoFocus
            />
            {patientsLoading ? (
              <div className={styles.centered}><Spinner /></div>
            ) : patientsError ? (
              <div className={styles.notFound}>
                <p>No pudimos cargar los pacientes.</p>
                <Button variant="secondary" size="sm" onClick={() => loadPatients()}>Reintentar</Button>
              </div>
            ) : patients.length === 0 && !debouncedQuery ? (
              <p className={styles.emptyMsg}>Todavía no hay pacientes registrados — creá el primero con el botón de arriba.</p>
            ) : visiblePatients.length === 0 ? (
              <div className={styles.notFound}>
                <p>No encontramos a <strong>"{patientQuery.trim()}"</strong> en el registro.</p>
                <Button variant="primary" size="sm" onClick={() => setCreatingPatient(true)}>
                  Registrar a {patientQuery.trim()}
                </Button>
              </div>
            ) : (
              <>
                <p className={styles.resultCount}>
                  {visiblePatients.length} {visiblePatients.length === 1 ? 'paciente' : 'pacientes'}{patientQuery.trim() ? ' encontrados' : ' en el registro'}
                </p>
                <ul className={styles.patientList} role="listbox" aria-label="Pacientes">
                  {visiblePatients.map(p => {
                    const selected = selectedPatient?.id === p.id;
                    const meta = [p.email, p.insuranceNumber && `OS ${p.insuranceNumber}`, p.phone].filter(Boolean).join(' · ');
                    return (
                      <li key={p.id} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          className={`${styles.patientRow} ${selected ? styles.patientRowSelected : ''}`}
                          onClick={() => setSelectedPatient(p)}
                        >
                          <span className={styles.patientAvatar} aria-hidden>{initials(p.name)}</span>
                          <span className={styles.patientText}>
                            <span className={styles.patientName}>{p.name}</span>
                            {meta && <span className={styles.patientMeta}>{meta}</span>}
                          </span>
                          <span className={styles.patientCheck} aria-hidden>{selected && <Check size={16} />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className={styles.stepFooter}>
              <Button variant="primary" disabled={!selectedPatient} onClick={goForward}>
                Siguiente →
              </Button>
            </div>

            <Modal isOpen={creatingPatient} onClose={() => setCreatingPatient(false)} title="Registrar paciente" size="md">
              <PatientForm initialName={visiblePatients.length === 0 ? patientQuery.trim() : ''} onSubmit={handleCreatePatient} onCancel={() => setCreatingPatient(false)} />
            </Modal>
          </div>
        )}

        {/* ── SPECIALTY ── */}
        {currentKind === 'specialty' && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepTitle}>Elegí la especialidad</h2>
            {specialtiesLoading ? (
              <div className={styles.centered}><Spinner /></div>
            ) : specialties.length === 0 ? (
              <p className={styles.emptyMsg}>No hay especialidades disponibles.</p>
            ) : (
              <div className={styles.cardGrid}>
                {specialties.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={[
                      styles.optionCard,
                      selectedSpecialty?.id === s.id ? styles.optionCardSelected : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedSpecialty(s)}
                  >
                    <span className={styles.optionIcon}>🏥</span>
                    <span className={styles.optionName}>{s.name}</span>
                    {s.description && (
                      <span className={styles.optionDesc}>{s.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.stepFooter}>
              <Button variant="secondary" onClick={goBack}>← Volver</Button>
              <Button variant="primary" disabled={!selectedSpecialty} onClick={goForward}>
                Siguiente →
              </Button>
            </div>
          </div>
        )}

        {/* ── DOCTOR ── */}
        {currentKind === 'doctor' && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepTitle}>
              Elegí un doctor
              {selectedSpecialty && (
                <span className={styles.stepSubtitle}> · {selectedSpecialty.name}</span>
              )}
            </h2>
            {doctorsLoading ? (
              <div className={styles.centered}><Spinner /></div>
            ) : filteredDoctors.length === 0 ? (
              <p className={styles.emptyMsg}>No hay doctores disponibles para esta especialidad.</p>
            ) : (
              <div className={styles.cardGrid}>
                {filteredDoctors.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={[
                      styles.optionCard,
                      selectedDoctor?.id === d.id ? styles.optionCardSelected : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedDoctor(d)}
                  >
                    <span className={styles.optionIcon}>👨‍⚕️</span>
                    <span className={styles.optionName}>{d.user?.name ?? '—'}</span>
                    <span className={styles.optionDesc}>Mat. {d.licenseNumber}</span>
                    {d.specialty && (
                      <span className={styles.optionDesc}>{d.specialty.name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.stepFooter}>
              <Button variant="secondary" onClick={goBack}>← Volver</Button>
              <Button variant="primary" disabled={!selectedDoctor} onClick={goForward}>
                Siguiente →
              </Button>
            </div>
          </div>
        )}

        {/* ── DATETIME ── */}
        {currentKind === 'datetime' && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepTitle}>Seleccioná fecha y horario</h2>

            <div className={styles.datePicker}>
              <label htmlFor="appt-date" className={styles.fieldLabel}>Fecha del turno</label>
              <input
                id="appt-date"
                type="date"
                className={styles.dateInput}
                value={selectedDate}
                min={getTomorrowDate()}
                onChange={e => setSelectedDate(e.target.value)}
              />
            </div>

            {availabilityLoading ? (
              <div className={styles.centered}><Spinner /></div>
            ) : allSlots.length === 0 ? (
              <div className={styles.noSlots}>
                <span className={styles.noSlotsIcon}>📅</span>
                <p>
                  {user?.role === 'DOCTOR'
                    ? 'No tenés disponibilidad configurada para esta fecha.'
                    : 'El doctor no tiene disponibilidad para esta fecha.'}
                </p>
                <p className={styles.noSlotsHint}>Probá con otro día de la semana.</p>
              </div>
            ) : (
              <>
                <p className={styles.slotsLabel}>
                  Horarios disponibles para el {formatDisplayDate(selectedDate)}
                </p>
                <div className={styles.slotsGrid}>
                  {allSlots.map(time => {
                    const isBooked = bookedSlots.has(time);
                    return (
                      <button
                        key={time}
                        type="button"
                        disabled={isBooked}
                        className={[
                          styles.slot,
                          isBooked            ? styles.slotBooked   : '',
                          selectedTime === time ? styles.slotSelected : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => !isBooked && setSelectedTime(time)}
                      >
                        {time}
                        {isBooked && <span className={styles.slotTag}>Ocupado</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className={styles.stepFooter}>
              <Button variant="secondary" onClick={goBack}>← Volver</Button>
              <Button variant="primary" disabled={!selectedTime} onClick={goForward}>
                Siguiente →
              </Button>
            </div>
          </div>
        )}

        {/* ── CONFIRM ── */}
        {currentKind === 'confirm' && (
          <div className={styles.stepContent}>
            <h2 className={styles.stepTitle}>Confirmá el turno</h2>
            <p className={styles.stepHint}>
              Revisá los datos antes de confirmar. El turno quedará pendiente de confirmación.
            </p>

            <div className={styles.summaryCard}>
              {selectedPatient && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Paciente</span>
                  <span className={styles.summaryValue}>{selectedPatient.name ?? '—'}</span>
                </div>
              )}
              {selectedSpecialty && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Especialidad</span>
                  <span className={styles.summaryValue}>{selectedSpecialty.name}</span>
                </div>
              )}
              {selectedDoctor && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Doctor</span>
                  <span className={styles.summaryValue}>{selectedDoctor.user?.name ?? '—'}</span>
                </div>
              )}
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Fecha</span>
                <span className={styles.summaryValue}>{formatDisplayDate(selectedDate)}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Hora</span>
                <span className={styles.summaryValue}>{selectedTime}</span>
              </div>
            </div>

            <div className={styles.stepFooter}>
              <Button variant="secondary" onClick={goBack} disabled={submitting}>← Volver</Button>
              <Button variant="primary" isLoading={submitting} onClick={handleConfirm}>
                Confirmar Turno
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
