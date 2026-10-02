import { useEffect, useState } from 'react';
import { Download, FileText, Image, Pill } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { reportsApi, type MedicalReport } from '../../api/reports';
import { prescriptionsApi, type Prescription } from '../../api/prescriptions';
import { apiErrorMessage } from '../../api/client';
import type { Patient } from '../../api/patients';
import styles from './PatientRecord.module.css';

interface PatientRecordProps {
  /** Null mientras no haya nadie elegido: asi no se consulta de mas. */
  patient: Patient | null;
}

/** Igual que en el detalle del turno: la fecha corta, sin hora. */
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR');

const tamano = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * La historia clínica de una persona: sus informes y sus recetas.
 *
 * Hasta ahora había que entrar por un turno para verla, que es al revés de como
 * uno piensa: la historia es de la persona, no de la consulta.
 *
 * Se monta SÓLO cuando alguien la pide, y eso no es por rendimiento. Cada
 * rechazo de la política de acceso queda registrado en auditoría, así que si la
 * pantalla pidiera la historia al abrir cada paciente, un médico recorriendo el
 * listado generaría decenas de "acceso denegado" sobre gente que nunca atendió.
 * La auditoría sirve para detectar accesos indebidos: llenarla de rechazos
 * esperados entierra el día que haya uno real.
 */
export function PatientRecord({ patient }: PatientRecordProps) {
  /*
   * El estado viene ETIQUETADO con el paciente al que pertenece.
   *
   * Sin eso, abrir a una persona, cerrar y abrir a otra mostraba por un instante
   * los informes de la primera: el estado sobrevive al cambio de prop y nadie
   * sabe que ya no corresponde. Atando el dato a su dueño, mostrar algo viejo
   * deja de ser posible por construccion, en vez de depender de acordarse de
   * limpiarlo en el lugar correcto.
   */
  const [datos, setDatos] = useState<{ de: string; informes: MedicalReport[]; recetas: Prescription[] } | null>(null);
  const [fallo, setFallo] = useState<{ de: string; mensaje: string } | null>(null);

  const listo = !!patient && datos?.de === patient.id;
  const error = patient && fallo?.de === patient.id ? fallo.mensaje : null;
  const cargando = !!patient && !listo && !error;

  useEffect(() => {
    if (!patient) return;

    const id = patient.id;
    let vigente = true;

    Promise.all([
      reportsApi.findByPatient(patient.id),
      prescriptionsApi.findByPatient(patient.id),
    ])
      .then(([r, p]) => {
        if (vigente) setDatos({ de: id, informes: r.data, recetas: p.data });
      })
      .catch((e: unknown) => {
        // Un 403 acá NO es una falla: es la regla del dominio diciendo que no
        // hay relación de atención con esta persona. Merece su propio texto,
        // porque un "algo salió mal" genérico haría pensar en un error del
        // sistema cuando el sistema está haciendo exactamente su trabajo.
        if (!vigente) return;
        const status = (e as { status?: number }).status;
        setFallo({
          de: id,
          mensaje: status === 403
            ? 'No atendiste a esta persona, así que su historia clínica no te corresponde.'
            : apiErrorMessage(e, 'No se pudo cargar la historia clínica'),
        });
      });

    // Cerrar el modal mientras la consulta viaja no tiene que pisar el estado
    // del siguiente paciente que se abra.
    return () => { vigente = false; };
  }, [patient]);

  if (!patient) return null;

  return (
    <>
      {cargando && <p className={styles.estado}>Cargando…</p>}

      {error && <p className={styles.denegado}>{error}</p>}

      {!cargando && !error && (
        <div className={styles.contenido}>
          <section>
            <h3 className={styles.titulo}>
              <FileText size={16} aria-hidden="true" /> Informes ({datos?.informes.length ?? 0})
            </h3>

            {(datos?.informes.length ?? 0) === 0 ? (
              <p className={styles.vacio}>Todavía no tiene informes cargados.</p>
            ) : (
              <ul className={styles.lista}>
                {datos?.informes.map((informe) => (
                  <li key={informe.id} className={styles.item}>
                    {informe.mimeType.startsWith('image/')
                      ? <Image size={18} aria-hidden="true" />
                      : <FileText size={18} aria-hidden="true" />}

                    <span className={styles.datos}>
                      <strong>{informe.title}</strong>
                      <small>{fecha(informe.createdAt)} · {tamano(informe.sizeBytes)}</small>
                    </span>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => reportsApi.download(informe)}
                      aria-label={`Descargar ${informe.title}`}
                    >
                      <Download size={16} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className={styles.titulo}>
              <Pill size={16} aria-hidden="true" /> Recetas ({datos?.recetas.length ?? 0})
            </h3>

            {(datos?.recetas.length ?? 0) === 0 ? (
              <p className={styles.vacio}>Todavía no tiene recetas emitidas.</p>
            ) : (
              <ul className={styles.lista}>
                {datos?.recetas.map((receta) => (
                  <li key={receta.id} className={styles.item}>
                    <Pill size={18} aria-hidden="true" />
                    <span className={styles.datos}>
                      <strong>
                        {receta.medications.map((m) => m.name).join(', ')}
                      </strong>
                      <small>{fecha(receta.createdAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
