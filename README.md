# Pulso — Gestión de turnos médicos

[![CI](https://github.com/cristian-micchele-dev/Pulso/actions/workflows/ci.yml/badge.svg)](https://github.com/cristian-micchele-dev/Pulso/actions/workflows/ci.yml)

Sistema interno (HIS) para que el personal de un hospital gestione médicos, pacientes, disponibilidad y turnos.
Monorepo con API REST en **NestJS** (arquitectura hexagonal) y SPA en **React**.

> Proyecto de portfolio. El foco está en decisiones de dominio explícitas, arquitectura limpia y reglas de negocio testeadas — no en la cantidad de features.

## Probarlo

**https://pulso-six-mauve.vercel.app**

Entrá con cualquiera de estas cuentas. La contraseña es la misma para todas: **`demo pulso 2026`**

| Cuenta | Rol | Qué se ve desde ahí |
|---|---|---|
| `marta.recepcion@demo.pulso` | Secretaría | Alta de pacientes, reserva y reprogramación de turnos |
| `valeria.sosa@demo.pulso` | Médica — Cardiología | Agenda propia, disponibilidad, informes y recetas |
| `ramiro.alcorta@demo.pulso` | Médico — Traumatología | Lo mismo, con otra especialidad y otros horarios |
| `ingrid.vallejos@demo.pulso` | Médica — Dermatología | Ídem |

Los datos son ficticios y están generados por `npm run seed:demo`. Se puede crear,
cancelar y reprogramar sin romper nada.

> **La primera carga puede tardar hasta un minuto.** La API corre en el plan
> gratuito de Render, que apaga el servicio a los 15 minutos sin tráfico; la
> primera visita lo despierta. No está roto, está arrancando.

![Dashboard de Pulso](docs/img/dashboard.png)

<details>
<summary><b>Más pantallas</b> — cada una muestra una decisión, no una feature</summary>

<br>

**Turnos.** Los turnos se acumulan para siempre: la historia clínica se guarda 10 años y de cada turno cuelgan informes, recetas y auditoría. Por eso no se borran — se deja de mostrarlos. El selector **Próximos · Historial · Todos** recorta, y la búsqueda la resuelve la base, no el navegador. Cada turno lleva un código `TM-` que sale de una secuencia de Postgres, así que es único aunque dos personas reserven a la vez.

![Listado de turnos](docs/img/turnos.png)

**Mensajes.** Chat interno del personal. Cada código `TM-` que alguien escribe se vuelve un enlace al turno, para cerrar la distancia entre la conversación y la reserva de la que habla. El aviso de arriba no es decorativo: las notas clínicas viven en el turno, no acá.

![Chat interno](docs/img/mensajes.png)

**Historia clínica.** Los informes y las recetas cuelgan de la persona, no de la consulta, así que se ven desde el paciente. La pestaña sólo existe para ADMIN y médicos: la política del backend dice que la recepción agenda la atención, no la lee. Y se consulta recién al abrirla, nunca al listar pacientes — cada rechazo queda auditado, y llenar ese registro de "acceso denegado" esperados enterraría el día que haya uno real.

![Historia clínica de un paciente](docs/img/historia.png)

**Calendario.** Los puntos de cada día salen de una consulta que agrupa por día y estado en el huso del hospital, no de traerse los turnos y contarlos en el navegador.

![Calendario mensual](docs/img/calendario.png)

**Login.** El tejido neuronal del fondo está **generado por código**, no es un video ni un modelo descargado: las dendritas se ramifican de forma recursiva y se tubulan con radio decreciente, y cada soma se deforma hacia sus propios troncos. La matemática vive aparte de three.js y está testeada. Se carga con `lazy` para que el formulario no espere al motor 3D.

![Pantalla de acceso](docs/img/login.png)

</details>

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
- **El almacén de archivos es un puerto** — `shared/application/file-storage.port.ts`, con adaptador de disco para desarrollo y de Supabase Storage para producción.

Ese último merece la explicación larga, porque es el caso donde la arquitectura
dejó de ser teoría:

> Los informes médicos se escribían con `fs` directo **desde la capa de
> aplicación**. Parecía una impureza menor. Pero el disco de un servicio en la
> nube es efímero, así que al desplegar los archivos subidos desaparecían al
> primer reinicio mientras sus filas en la base seguían apuntándolos.
>
> **El bug de producción y la violación arquitectónica eran el mismo problema.**
> Como no existía el puerto, arreglar algo de infraestructura obligaba a meter
> mano en la lógica de negocio.
>
> Después de extraerlo, `fs` quedó en **un solo archivo** de todo `src` —el
> adaptador de disco— y cambiar de almacén pasó a ser una variable de entorno.
> Eso es lo que compra la disciplina de puertos y adaptadores: no elegancia,
> sino no tener que operar a corazón abierto cuando la infraestructura traiciona.

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
- **Las piezas con estado que se mira entre sí viven en hooks propios** — `useSlots` (horarios de un médico para un día), `useDebouncedValue`, `useFetch`. No es para acortar archivos: es que un componente con veinte trozos de estado tiene un orden de asentamiento que **emerge** en vez de estar escrito. `useSlots` tiene siete tests, y dos de ellos cubren comportamientos que la pantalla no tenía: olvidar la hora elegida al cambiar de fecha, y descartar la respuesta de una consulta que quedó vieja cuando se cambia de día rápido.

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

### Clínica de muestra

Para ver el sistema con contenido —y para las capturas de este README— hay un seed
de demo con tres médicos, doce pacientes y turnos repartidos entre pasados,
próximos y cancelados:

```bash
cd backend
npm run seed:demo
```

Es idempotente: correrlo dos veces no duplica nada. Los nombres son inventados a
propósito — en un sistema cuya tesis es el cuidado de la historia clínica,
mostrar datos que parecen reales sería incoherente. Imprime los usuarios y la
contraseña para entrar.

**Contraseñas olvidadas** — no hay email saliente, así que el ADMIN resetea desde Usuarios → "Resetear clave": el sistema genera una clave temporal (se muestra una sola vez), cierra las sesiones del usuario y lo obliga a elegir una contraseña propia en el próximo ingreso.

### Variables de entorno (backend)

Las de la primera tabla se validan al arrancar con `class-validator`
(`src/config/env.schema.ts`): si falta una, el proceso no levanta.

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | sí | `postgres://user:pass@host:5432/db` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | sí | mínimo 32 caracteres |
| `NODE_ENV` | no | `development` · `test` · `production` |
| `PORT` | no | default `3000` |
| `CORS_ORIGIN` | no | origen del frontend, **sin barra final** |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `JWT_ISSUER` | no | defaults `15m`, `7d` |
| `REFRESH_COOKIE_NAME`, `CSRF_COOKIE_NAME` | no | |
| `SWAGGER_ENABLED` | no | nunca se expone en `production` |

Las de abajo **no** pasan por el esquema: se leen donde se usan y tienen valor por
defecto, así que el proyecto arranca sin ninguna de ellas. Eso es cómodo en
desarrollo y **peligroso al desplegar**, porque un servicio mal configurado
levanta igual y falla más tarde. Por eso las dos que pueden causar pérdida de
datos —`STORAGE_DRIVER` con sus credenciales— sí interrumpen el arranque si
quedan a medias.

| Variable | Default | Notas |
|---|---|---|
| `JWT_REMEMBER_TTL` | `30d` | vida de la sesión con "Recordarme" |
| `DATABASE_SSL` | activo | `false` para Postgres local o CI |
| `DB_POOL_MAX` | `10` | conexiones por instancia |
| `THROTTLE_LIMIT`, `THROTTLE_TTL` | `100`, `60s` | límite de peticiones por IP |
| `METRICS_TOKEN` | — | sin valor, `/api/v1/metrics` queda abierto |
| `COOKIE_SAMESITE` | `lax` | **`none` si el frontend vive en otro dominio.** Ver [despliegue](#despliegue) |
| `STORAGE_DRIVER` | `disk` | `supabase` para almacén remoto |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | — | obligatorias con `STORAGE_DRIVER=supabase`; si falta una, el proceso **no** levanta |

---

## Despliegue

Frontend en **Vercel**, API en **Render**, base y archivos en **Supabase**. El
paso a paso está en **[DEPLOY.md](DEPLOY.md)**; acá va lo que no es obvio y sólo
se descubre desplegando.

| Lo que parecía un detalle | Lo que pasaba |
|---|---|
| **La cookie de refresh era `SameSite=Lax`** | Con el frontend en un dominio y la API en otro, el navegador considera cross-site cada llamada y **no manda la cookie**. El login entraba y al recargar la sesión se perdía, sin un solo error en el servidor. En `localhost` no se reproduce nunca. |
| **Los archivos iban al disco** | El disco de Render es efímero y el plan gratuito apaga el servicio a los 15 minutos. Un informe subido desaparecía al rato mientras su fila en la base seguía apuntándolo. |
| **El pooler de Supabase en modo transacción** | Es el que recomienda casi toda la documentación, y acá rompe los WebSockets: el adaptador de Socket.IO usa `LISTEN`/`NOTIFY` y pgBouncer devuelve la conexión después de cada transacción. Hace falta el de **modo sesión**. |
| **No existía ruta para `/`** | Entrar al dominio pelado caía en el comodín y mostraba el "no encontrado". En desarrollo no se nota porque uno entra a `/login` directo. |

Ninguno de los cuatro era código mal escrito: eran **supuestos que sólo se rompen
fuera de la máquina de uno**. Desplegar no fue el último paso del proyecto, fue
un test que nunca se había corrido.

De ahí salió la herramienta que más tiempo ahorró: `backend/test/manual/probar-conexion.js`
valida una cadena de conexión en dos segundos —autenticación, modo del pooler y
`LISTEN`/`NOTIFY`— sin imprimir la contraseña y sin gastar un despliegue de
cinco minutos.

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
- **Techo de conexiones.** Cada instancia toma hasta `DB_POOL_MAX` (10 por defecto) y el servidor tiene un `max_connections` finito. Medido contra la conexión directa de Supabase: ~4 instancias antes de agotarlo. En producción se usa el pooler en modo sesión, que corre bastante ese techo — pero no lo elimina, porque el modo sesión sostiene una conexión por cliente.
- **`tsconfig.json` incluye `src` y `test`.** Por eso hizo falta un `tsconfig.build.json` con `rootDir` explícito: sin él, TypeScript 6 falla con `TS5011` al compilar sólo `src` dentro de la imagen. Funciona, pero son dos configuraciones donde debería alcanzar una.
- **Nada limpia el bucket.** Borrar un informe borra su archivo, pero no hay proceso que detecte huérfanos: si una fila se pierde sin pasar por la aplicación, el PDF queda ocupando espacio para siempre. Con el volumen de una clínica chica no molesta; con historia de diez años, sí.
- **Restore de backup sin probar.** Supabase hace backups; nadie verificó que se puedan recuperar. Un backup no probado es una esperanza.
- **Siete pantallas del frontend pasan las 400 líneas** (419 a 546). El backend resuelve su pieza más compleja en ~230. Pero el largo resultó ser mala métrica: `DashboardPage` tiene 437 líneas de las cuales 152 son JSX y 7 hooks — describe mucho, no hace mucho. Lo que sí medía el riesgo era **cuántos trozos de estado se miran entre sí**: `NewAppointmentPage` tenía 21 y cuatro efectos, y era la única con una dependencia circular real. Ya se le extrajo `useSlots`; quedan `AvailabilityPage` y `UsersPage` con 15 cada una.
- **Alertas sin destino.** `backend/docs/alerts.yml` tiene las reglas listas; falta dónde correr el Prometheus.
