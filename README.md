# Pulso — Gestión de turnos médicos

[![CI](https://github.com/cristian-micchele-dev/TurnosMedicos/actions/workflows/ci.yml/badge.svg)](https://github.com/cristian-micchele-dev/TurnosMedicos/actions/workflows/ci.yml)

Sistema interno (HIS) para que el personal de un hospital gestione médicos, pacientes, disponibilidad y turnos.
Monorepo con API REST en **NestJS** (arquitectura hexagonal) y SPA en **React**.

> Proyecto de portfolio. El foco está en decisiones de dominio explícitas, arquitectura limpia y reglas de negocio testeadas — no en la cantidad de features.

![Dashboard de Pulso](docs/img/dashboard.png)

---

## Decisiones de dominio

Estas decisiones definen el producto y explican por qué el código es como es.

| Decisión | Consecuencia |
|---|---|
| **Sistema cerrado.** Nadie se auto-registra. Un ADMIN da de alta cada cuenta. | No existe `POST /auth/register` ni pantalla de registro. Superficie de ataque mínima. |
| **El paciente es un registro, no un usuario.** Solo el personal tiene sesión. | `Patient` tiene identidad propia (`name`, `email`) sin FK a `users`. `Role` = `ADMIN \| SECRETARY \| DOCTOR`. Sin portal de pacientes ni notificaciones a pacientes. |
| **La disponibilidad se expresa en hora del hospital** (`America/Argentina/Buenos_Aires`). | El backend proyecta cada instante UTC al reloj del hospital antes de validar. El frontend envía instantes UTC inequívocos. Los filtros por fecha (`from`/`to`) significan "ese día completo en el hospital". |
| **Un médico puede tener varios bloques por día** (ej. 08:00-12:00 y 16:30-20:00). | `availabilities` es única por `(doctor, día, hora de inicio)`. |
| **Los turnos se crean desde el panel.** | ADMIN y SECRETARY: eligen paciente → especialidad → médico → horario. DOCTOR: elige paciente → horario en su propia agenda. |

---

## Arquitectura

### Backend — Hexagonal (Ports & Adapters)

```
src/modules/<feature>/
├── domain/                 # Entidades y reglas de negocio. Sin NestJS, sin TypeORM.
│   ├── <entity>.ts         #   Ej: Appointment.confirm() valida la transición de estado
│   └── rules/              #   Ej: WithinAvailabilityRule, NoDoubleBookingRule
├── application/            # Casos de uso (services) + DTOs validados con class-validator
├── adapters/
│   ├── http/               # Controllers, guards (JWT + roles)
│   └── persistence/        # Entidades TypeORM + implementación de repositorios
└── <feature>.repository.port.ts   # Interfaz del repositorio (el dominio depende de esto, no de TypeORM)
```

Dos módulos son planos a propósito: `dashboard/` (solo agrega lecturas de otros módulos, no tiene dominio propio) y `notifications/` (un gateway de Socket.IO). Lo transversal a la HTTP — health check, filtro de errores — vive en `shared/infra/http/`.

Puntos que vale la pena mirar:

- **Reglas de negocio como clases puras** — `appointments/domain/rules/*.rule.ts`. Se testean sin base de datos ni framework.
- **Ownership por rol** — `AppointmentService.assertCanAccess`: un DOCTOR solo opera sobre su propia agenda; ADMIN y SECRETARY pasan. `MedicalRecordAccessPolicy`: un médico solo lee historias de pacientes que atendió, y la recepción no lee ninguna.
- **Listados enriquecidos sin N+1** — `AppointmentService.enrich` carga médicos y pacientes en 2 queries por página con `findByIds`.
- **Tiempo del hospital centralizado** — `shared/infra/time/format.ts` (`toClinicClock`, `clinicDayRange`). Un solo lugar sabe de zonas horarias.
- **Migraciones explícitas** (`synchronize: false`), reversibles, incluyendo cambios de enum en Postgres.
- **Errores como Problem Details (RFC 7807)** con `code` estable para el frontend.

### Frontend — Feature-based

```
src/
├── api/            # Cliente HTTP (refresh automático, CSRF) + un módulo por recurso
├── context/        # AuthContext y ThemeContext (providers globales)
├── features/       # Una carpeta por pantalla, con su CSS Module al lado
├── components/     # ui/ (primitivas: Button, Input, Table, Modal, Toast…), Layout, ProtectedRoute
├── hooks/          # useFetch (TanStack Query con invalidación por recurso), useToast…
├── lib/            # queryClient
└── utils/          # date (reloj local, nunca toISOString().split('T'))
```

- **Caché de datos con TanStack Query.** `useFetch(['recurso', ...params], fetcher)`: navegar entre páginas no vuelve a pedir datos; una mutación invalida por prefijo de recurso, así el dropdown de especialidades en Doctores se actualiza cuando creás una en Especialidades.
- **Lazy loading por ruta**, tema claro/oscuro con tokens CSS, `prefers-reduced-motion` y `focus-visible` globales.

---

## Stack

| | Backend | Frontend |
|---|---|---|
| Runtime | Node 24, NestJS 12, TypeScript | React 19, Vite, TypeScript |
| Datos | PostgreSQL 17, TypeORM, índices GIN de trigramas | TanStack Query |
| Auth | JWT access + refresh rotativo en cookie httpOnly (de sesión, o 30 días con "Recordarme"), CSRF, Argon2 | — |
| Seguridad | `helmet`, rate limiting, `ValidationPipe` con whitelist estricta, RBAC, política NIST 800-63B, bloqueo temporal de cuenta, audit log | — |
| Observabilidad | Logs JSON con `pino` y `x-request-id` de punta a punta, métricas Prometheus | — |
| Escala | Sockets repartidos entre instancias vía Postgres `LISTEN/NOTIFY` | — |
| Tests | Jest (unit · e2e · integration) | Vitest + Testing Library |
| Calidad | ESLint, `tsc --noEmit`, coverage ≥ 77 % | oxlint, `tsc --noEmit` |

---

## Puesta en marcha

Requisitos: Node 24 y una PostgreSQL 17 (local o Docker).

```bash
# 1. Base de datos
docker compose up -d postgres          # Postgres en localhost:5432 (turno / turno / turno_medicos)

# 2. Backend
cd backend
cp .env.example .env                   # completar DATABASE_URL y los secretos JWT (≥ 32 chars)
npm ci
npm run migration:run
npm run start:dev                      # http://localhost:3000  ·  Swagger en /api/v1/docs

# 3. Frontend (otra terminal)
cd frontend
npm ci
npm run dev                            # http://localhost:5173 (proxy → :3000)
```

### Primer usuario

Como no hay registro público, el primer ADMIN se crea con el seed (idempotente — si el email ya existe no toca nada):

```bash
cd backend
ADMIN_EMAIL=admin@hospital.com ADMIN_PASSWORD='una-clave-larga' ADMIN_NAME='Administración' npm run seed:admin
```

Desde ahí, todo (médicos, pacientes, otros admins) se gestiona por el panel.

**Contraseñas olvidadas** — no hay email saliente, así que el ADMIN resetea desde Usuarios → "Resetear clave": el sistema genera una clave temporal (se muestra una sola vez), cierra las sesiones del usuario y lo obliga a elegir una contraseña propia en el próximo ingreso.

### Variables de entorno (backend)

Validadas al arrancar con `class-validator` (`src/config/env.schema.ts`). Si falta una, el proceso no levanta.

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | sí | `postgres://user:pass@host:5432/db` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | sí | mínimo 32 caracteres |
| `NODE_ENV` | no | `development` · `test` · `production` |
| `PORT` | no | default `3000` |
| `CORS_ORIGIN` | no | origen del frontend |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `JWT_ISSUER` | no | defaults `15m`, `7d` |
| `JWT_REMEMBER_TTL` | no | vida de la sesión con "Recordarme" (default `30d`) |
| `REFRESH_COOKIE_NAME`, `CSRF_COOKIE_NAME` | no | |
| `SWAGGER_ENABLED` | no | nunca se expone en `production` |
| `DATABASE_SSL` | no | `false` para desactivar SSL en migraciones (CI / Postgres local) |

---

## Tests y calidad

```bash
# Backend
cd backend
npm test                     # unit (con coverage gate 77 %)
npm run test:e2e             # HTTP end-to-end con repositorios en memoria
npm run test:integration     # contra PostgreSQL real (se saltea si no hay DATABASE_URL)
npm run lint && npx tsc --noEmit

# Frontend
cd frontend
npm test
npm run lint && npx tsc --noEmit -p tsconfig.app.json
```

El pipeline de CI (`.github/workflows/ci.yml`) corre todo lo anterior en cada push y PR, levanta un Postgres efímero, aplica **y revierte** la última migración, y hace el build de producción de ambos lados.

Convención: cada cambio de comportamiento arranca con un test en rojo.

**Qué cubre cada suite, y por qué son tres.** Las de integración existen porque los mocks mienten sobre
lo que hace la base: el bug del huso horario en el gráfico mensual, la carrera del código correlativo y
el índice de trigramas que no se usaba sólo aparecen ejecutando SQL de verdad.

| Se rompió esto | Lo encontró |
|---|---|
| Doce reservas simultáneas dejaban once en error 500 (código correlativo calculado con leer-y-sumar) | Prueba de concurrencia contra la API real |
| Los turnos de las 22:00 se contaban en el mes siguiente | Test de integración contra PostgreSQL |
| Un admin podía cambiarse el rol y dejar al sistema sin ningún administrador | Ir a testear `UsersPage` |
| Desactivar a alguien no cerraba sus sesiones | Revisión de inconsistencias |

---

## Roles y permisos

| Acción | ADMIN | SECRETARY | DOCTOR |
|---|---|---|---|
| Gestionar usuarios, especialidades y médicos | ✅ | — | — |
| Registrar y editar pacientes | ✅ | ✅ | ✅ |
| Ver todos los turnos | ✅ | ✅ | solo los propios |
| Crear turno | para cualquier médico | para cualquier médico | solo en su agenda |
| Confirmar / reprogramar turno | ✅ | ✅ | los propios |
| Cancelar turno | ✅ | ✅ | — |
| **Completar turno** (cierra la consulta con diagnóstico) | ✅ | — | los propios |
| **Leer la historia clínica** (diagnóstico, informes, recetas) | ✅ | **—** | de pacientes que atendió |
| Configurar disponibilidad | de cualquier médico | — | la propia |
| Resetear la contraseña de otro usuario | ✅ (genera clave temporal) | — | — |
| Cambiar la propia contraseña | ✅ | ✅ | ✅ |
| Subir informes / recetas | — | — | de pacientes que atendió |

**Por qué existe SECRETARY y no es "un admin sin usuarios":** el mostrador necesita
saber *cuándo* y *con quién*, nunca *qué tiene* el paciente. Si la recepción fuera
ADMIN vería todos los informes y recetas del hospital. El rol se define por lo que
recorta, no por lo que agrega: `MedicalRecordAccessPolicy` lo rechaza con 403 antes
de tocar un repositorio, y el front ni siquiera pide esos datos.

---

## Estructura del repositorio

```
backend/     API NestJS · src/modules/{auth,users,specialties,doctors,patients,appointments,medical-reports,prescriptions,dashboard,notifications}
frontend/    SPA React
backend/docs/alerts.yml   Reglas de alerta para Prometheus/Grafana
design.md    Sistema de diseño (tokens, tipografía, componentes)
SPEC.md      Especificación funcional original
docker-compose.yml   Postgres + API
```

---

## Deuda técnica conocida

Anotada a propósito — son decisiones de alcance, no olvidos.

- **Sin cola de trabajo asíncrono.** Emails y notificaciones se despachan dentro del request. El `Mailer` actual es un no-op.
- **Rate limiting por instancia.** El throttler cuenta en memoria: con N instancias el límite efectivo se multiplica por N. El bloqueo de cuenta, que es la defensa que importa, sí vive en Postgres.
- **Techo de conexiones.** Cada instancia toma hasta `DB_POOL_MAX` (10 por defecto) y el servidor tiene un `max_connections` finito. Medido contra Supabase: ~4 instancias antes de agotarlo. Para más hace falta un pooler.
- **Restore de backup sin probar.** Supabase hace backups; nadie verificó que se puedan recuperar. Un backup no probado es una esperanza.
- **Cinco pantallas del frontend entre 437 y 577 líneas.** El backend resuelve su pieza más compleja en ~230.
- **Alertas sin destino.** `backend/docs/alerts.yml` tiene las reglas listas; falta dónde correr el Prometheus.
