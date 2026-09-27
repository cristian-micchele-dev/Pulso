import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doctorsApi, type Doctor, type AvailabilitySlot, type ScheduleBlock, type CreateScheduleBlockDto } from '../../api/doctors';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/ui/EmptyState';
import styles from './AvailabilityPage.module.css';
import { apiErrorMessage } from '../../api/client';
import { validateBlock, validateSlot, type BlockErrors, type SlotErrors } from './availability-rules';

const DAY_NAMES: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

const DAY_OPTIONS = [
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
];

const DURATION_OPTIONS = [
  { value: '15', label: '15 minutos' },
  { value: '20', label: '20 minutos' },
  { value: '30', label: '30 minutos' },
  { value: '45', label: '45 minutos' },
  { value: '60', label: '1 hora' },
];

interface SlotRow extends AvailabilitySlot {
  _id: string; // local key for React
}

interface BlockFormState {
  startDate: string;
  endDate: string;
  reason: string;
}

const EMPTY_BLOCK_FORM: BlockFormState = { startDate: '', endDate: '', reason: '' };

interface SlotFormState {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  slotDuration: string;
}

const EMPTY_FORM: SlotFormState = {
  dayOfWeek: '',
  startTime: '',
  endTime: '',
  slotDuration: '30',
};

let localIdCounter = 0;
const nextId = () => `slot-${++localIdCounter}`;

export function AvailabilityPage() {
  const { id: routeDoctorId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [resolvedDoctorId, setResolvedDoctorId] = useState<string | undefined>(routeDoctorId);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SlotFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<SlotErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockForm, setBlockForm] = useState<BlockFormState>(EMPTY_BLOCK_FORM);
  const [blockFormErrors, setBlockErrors] = useState<BlockErrors>({});
  const [savingBlock, setSavingBlock] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        let effectiveDoctorId = routeDoctorId;
        if (!effectiveDoctorId) {
          // DOCTOR viewing own availability via /disponibilidad
          const me = await doctorsApi.me();
          setDoctor(me);
          setResolvedDoctorId(me.id);
          effectiveDoctorId = me.id;
          const [availability, blocksData] = await Promise.all([
            doctorsApi.getAvailability(effectiveDoctorId),
            doctorsApi.getBlocks(effectiveDoctorId),
          ]);
          setSlots(
            availability.map((a) => ({
              _id: nextId(),
              dayOfWeek: a.dayOfWeek,
              startTime: a.startTime,
              endTime: a.endTime,
              slotDuration: a.slotDuration,
            })),
          );
          setBlocks(blocksData);
        } else {
          const [doctorData, availability, blocksData] = await Promise.all([
            doctorsApi.findOne(effectiveDoctorId),
            doctorsApi.getAvailability(effectiveDoctorId),
            doctorsApi.getBlocks(effectiveDoctorId),
          ]);
          setDoctor(doctorData);
          setSlots(
            availability.map((a) => ({
              _id: nextId(),
              dayOfWeek: a.dayOfWeek,
              startTime: a.startTime,
              endTime: a.endTime,
              slotDuration: a.slotDuration,
            })),
          );
          setBlocks(blocksData);
        }
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Error al cargar la disponibilidad'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [routeDoctorId]);

  const validateForm = (): boolean => {
    const errs = validateSlot(form, slots.map((s) => ({ id: s._id, ...s })), editingId ?? undefined);
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddSlot = () => {
    if (!validateForm()) return;

    const newSlot: SlotRow = {
      _id: editingId ?? nextId(),
      dayOfWeek: Number(form.dayOfWeek),
      startTime: form.startTime,
      endTime: form.endTime,
      slotDuration: Number(form.slotDuration),
    };

    if (editingId) {
      setSlots((prev) => prev.map((s) => (s._id === editingId ? newSlot : s)));
      setEditingId(null);
    } else {
      setSlots((prev) => [...prev, newSlot]);
    }

    setForm(EMPTY_FORM);
    setFormErrors({});
    setShowForm(false);
  };

  const handleEditSlot = (slot: SlotRow) => {
    setForm({
      dayOfWeek: String(slot.dayOfWeek),
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotDuration: String(slot.slotDuration),
    });
    setEditingId(slot._id);
    setShowForm(true);
  };

  const handleRemoveSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s._id !== id));
  };

  const handleCancelForm = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!resolvedDoctorId) return;
    try {
      setSaving(true);
      const payload: AvailabilitySlot[] = slots.map(({ dayOfWeek, startTime, endTime, slotDuration }) => ({
        dayOfWeek,
        startTime,
        endTime,
        slotDuration,
      }));
      await doctorsApi.setAvailability(resolvedDoctorId, payload);
      toast.success('Disponibilidad guardada correctamente');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Error al guardar la disponibilidad'));
    } finally {
      setSaving(false);
    }
  };

  const formatBlockDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const validateBlockForm = (): boolean => {
    const errs = validateBlock(blockForm);
    setBlockErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddBlock = async () => {
    if (!resolvedDoctorId || !validateBlockForm()) return;
    try {
      setSavingBlock(true);
      const dto: CreateScheduleBlockDto = {
        // El formulario pide fecha Y hora (datetime-local), asi que el valor ya
        // viene como instante local: 'new Date' lo interpreta en la zona del
        // navegador, que es la del hospital. No hay que redondear a dia completo.
        startDate: new Date(blockForm.startDate).toISOString(),
        endDate: new Date(blockForm.endDate).toISOString(),
        ...(blockForm.reason.trim() ? { reason: blockForm.reason.trim() } : {}),
      };
      const saved = await doctorsApi.addBlock(resolvedDoctorId, dto);
      setBlocks((prev) => [...prev, saved].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      setBlockForm(EMPTY_BLOCK_FORM);
      setBlockErrors({});
      setShowBlockForm(false);
      toast.success('Bloqueo agregado correctamente');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Error al agregar el bloqueo'));
    } finally {
      setSavingBlock(false);
    }
  };

  const handleRemoveBlock = async (blockId: string) => {
    if (!resolvedDoctorId) return;
    try {
      await doctorsApi.removeBlock(resolvedDoctorId, blockId);
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      toast.success('Bloqueo eliminado');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Error al eliminar el bloqueo'));
    }
  };

  const sortedSlots = [...slots].sort((a, b) => {
    const dayDiff = a.dayOfWeek - b.dayOfWeek;
    if (dayDiff !== 0) return dayDiff;
    return a.startTime.localeCompare(b.startTime);
  });

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>
          <span className={styles.spinner} />
          <p>Cargando disponibilidad...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate(user?.role === 'ADMIN' ? '/doctores' : '/dashboard')}>
            ← Volver
          </button>
          <div>
            <h1 className={styles.title}>Disponibilidad Semanal</h1>
            {doctor && (
              <p className={styles.subtitle}>
                {doctor.user?.name ?? `Matrícula: ${doctor.licenseNumber}`}
                {doctor.specialty && (
                  <span className={styles.specialtyTag}>{doctor.specialty.name}</span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className={styles.headerActions}>
          {!showForm && (
            <Button variant="secondary" size="sm" onClick={() => setShowForm(true)}>
              + Agregar Horario
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} isLoading={saving} disabled={saving}>
            Guardar cambios
          </Button>
        </div>
      </header>

      {showForm && (
        <div className={styles.formCard}>
          <h2 className={styles.formTitle}>
            {editingId ? 'Editar horario' : 'Nuevo horario'}
          </h2>
          <div className={styles.formGrid}>
            <Select
              label="Día"
              required
              options={DAY_OPTIONS}
              value={form.dayOfWeek}
              onChange={(val) => {
                setForm((prev) => ({ ...prev, dayOfWeek: val }));
                if (formErrors.dayOfWeek) setFormErrors((prev) => ({ ...prev, dayOfWeek: undefined }));
              }}
              placeholder="Seleccionar día"
              error={formErrors.dayOfWeek}
            />

            <Input
              label="Hora de inicio"
              type="time"
              value={form.startTime}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, startTime: e.target.value }));
                if (formErrors.startTime) setFormErrors((prev) => ({ ...prev, startTime: undefined }));
              }}
              error={formErrors.startTime}
            />

            <Input
              label="Hora de fin"
              type="time"
              value={form.endTime}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, endTime: e.target.value }));
                if (formErrors.endTime) setFormErrors((prev) => ({ ...prev, endTime: undefined }));
              }}
              error={formErrors.endTime}
            />

            <Select
              label="Duración del turno"
              options={DURATION_OPTIONS}
              value={form.slotDuration}
              onChange={(val) => setForm((prev) => ({ ...prev, slotDuration: val }))}
            />
          </div>

          <div className={styles.formActions}>
            <Button variant="secondary" size="sm" onClick={handleCancelForm}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleAddSlot}>
              {editingId ? 'Actualizar' : 'Agregar'}
            </Button>
          </div>
        </div>
      )}

      {sortedSlots.length === 0 ? (
        <div className={styles.emptyWrapper}>
          <EmptyState
            icon="📅"
            title="Sin horarios configurados"
            description="Agregá los horarios de atención para que los pacientes puedan reservar turnos."
            action={{ label: '+ Agregar Horario', onClick: () => setShowForm(true) }}
          />
        </div>
      ) : (
        <div className={styles.scheduleContainer}>
          <div className={styles.scheduleHeader}>
            <span>Día</span>
            <span>Inicio</span>
            <span>Fin</span>
            <span>Duración por turno</span>
            <span>Acciones</span>
          </div>

          {sortedSlots.map((slot) => (
            <div key={slot._id} className={styles.scheduleRow}>
              <span className={styles.dayName}>{DAY_NAMES[slot.dayOfWeek]}</span>
              <span className={styles.timeValue}>{slot.startTime}</span>
              <span className={styles.timeValue}>{slot.endTime}</span>
              <span className={styles.durationValue}>{slot.slotDuration} min</span>
              <div className={styles.rowActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEditSlot(slot)}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.removeBtn}
                  onClick={() => handleRemoveSlot(slot._id)}
                >
                  Quitar
                </Button>
              </div>
            </div>
          ))}

          <div className={styles.scheduleFooter}>
            <span className={styles.slotCount}>
              {sortedSlots.length} {sortedSlots.length === 1 ? 'horario' : 'horarios'} configurado{sortedSlots.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* ── Schedule Blocks ── */}
      <section className={styles.blocksSection}>
        <div className={styles.blocksSectionHeader}>
          <div>
            <h2 className={styles.blocksSectionTitle}>Bloqueos de Agenda</h2>
            <p className={styles.blocksSectionSubtitle}>Períodos en los que el médico no estará disponible (vacaciones, licencias, etc.)</p>
          </div>
          {!showBlockForm && (
            <Button variant="secondary" size="sm" onClick={() => setShowBlockForm(true)}>
              + Agregar Bloqueo
            </Button>
          )}
        </div>

        {showBlockForm && (
          <div className={styles.blockFormCard}>
            <h3 className={styles.formTitle}>Nuevo bloqueo</h3>
            <div className={styles.blockFormGrid}>
              <Input
                label="Fecha y hora de inicio"
                type="datetime-local"
                value={blockForm.startDate}
                onChange={(e) => {
                  setBlockForm((prev) => ({ ...prev, startDate: e.target.value }));
                  if (blockFormErrors.startDate) setBlockErrors((prev) => ({ ...prev, startDate: undefined }));
                }}
                error={blockFormErrors.startDate}
              />
              <Input
                label="Fecha y hora de fin"
                type="datetime-local"
                value={blockForm.endDate}
                onChange={(e) => {
                  setBlockForm((prev) => ({ ...prev, endDate: e.target.value }));
                  if (blockFormErrors.endDate) setBlockErrors((prev) => ({ ...prev, endDate: undefined }));
                }}
                error={blockFormErrors.endDate}
              />
              <Input
                label="Motivo (opcional)"
                type="text"
                value={blockForm.reason}
                onChange={(e) => setBlockForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Ej: Vacaciones, Congreso médico..."
              />
            </div>
            <div className={styles.formActions}>
              <Button variant="secondary" size="sm" onClick={() => { setShowBlockForm(false); setBlockForm(EMPTY_BLOCK_FORM); setBlockErrors({}); }}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleAddBlock} isLoading={savingBlock} disabled={savingBlock}>
                Agregar
              </Button>
            </div>
          </div>
        )}

        {blocks.length === 0 ? (
          <div className={styles.blocksEmpty}>
            <p>No hay bloqueos configurados</p>
          </div>
        ) : (
          <ul className={styles.blocksList}>
            {blocks.map((block) => (
              <li key={block.id} className={styles.blockCard}>
                <div className={styles.blockDates}>
                  <span className={styles.blockDateRange}>
                    {formatBlockDate(block.startDate)} — {formatBlockDate(block.endDate)}
                  </span>
                  {block.reason && (
                    <span className={styles.blockReason}>{block.reason}</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.removeBtn}
                  onClick={() => handleRemoveBlock(block.id)}
                >
                  Eliminar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
