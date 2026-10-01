# Desplegar Pulso

Frontend en **Vercel**, API en **Render**, base de datos en **Supabase** (ya existente,
con las migraciones corridas).

El orden importa: la API necesita saber el dominio del frontend para CORS, y el
frontend necesita saber la URL de la API. Se resuelve desplegando la API primero
con un valor provisorio y corrigiéndolo al final.

---

## 1. La API en Render

1. **New → Blueprint**, conectá el repositorio `Pulso`. Render lee `render.yaml`
   de la raíz y arma el servicio solo.
2. Completá las variables marcadas como `sync: false`, que Render pide a mano:

   | Variable | De dónde sale |
   |---|---|
   | `DATABASE_URL` | Supabase → Project Settings → Database → **Connection pooling** (puerto `6543`) |
   | `CORS_ORIGIN` | todavía no existe: poné `https://pulso.vercel.app` y corregilo en el paso 3 |
   | `METRICS_TOKEN` | opcional; sin valor, `/api/v1/metrics` queda abierto |

   > **Usá la cadena del pooler, no la directa.** El plan gratuito de Render
   > apaga y reinicia el servicio seguido, y cada arranque abre conexiones
   > nuevas: contra el puerto directo se agota el límite de Supabase.

3. Esperá a que el health check (`/api/v1/health/live`) pase a verde y anotá la
   URL del servicio, de la forma `https://pulso-api.onrender.com`.

**El plan gratuito duerme a los 15 minutos sin tráfico.** La primera visita
después de un rato tarda unos 50 segundos en responder. Conviene decirlo en el
README para que nadie piense que está roto.

---

## 2. El frontend en Vercel

1. **Add New → Project**, importá el mismo repositorio.
2. **Root Directory:** `frontend`. Vercel detecta Vite solo; no hace falta tocar
   los comandos de build.
3. Variable de entorno:

   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | `https://pulso-api.onrender.com/api/v1` |

   > Incluí `/api/v1`: la aplicación concatena las rutas directamente sobre este
   > valor (ver `frontend/src/api/client.ts`).

4. Desplegá y anotá el dominio que te asigna.

`frontend/vercel.json` reescribe todas las rutas a `index.html`. Sin eso, entrar
directo a `/turnos` o recargar una pantalla devuelve 404, porque el enrutado lo
resuelve React Router en el navegador y el servidor no conoce esas rutas.

---

## 3. Cerrar el círculo

Volvé a Render y poné en `CORS_ORIGIN` el dominio real de Vercel, **sin barra
final**. El servicio se redespliega solo.

---

## Por qué `COOKIE_SAMESITE=none`

Está fijo en `render.yaml` y no es un detalle menor.

Frontend y API quedan en dominios distintos (`vercel.app` y `onrender.com`), así
que para el navegador **toda llamada es cross-site**. Una cookie `SameSite=Lax`
—lo correcto cuando todo vive en el mismo origen— no se envía en esas llamadas.

El síntoma es desconcertante: el login entra bien, y al recargar la página el
usuario aparece deslogueado, porque el refresh nunca recibió la cookie. En local
no pasa nunca, porque ahí todo es `localhost`.

`SameSite=None` sólo lo acepta el navegador junto con `Secure`, y eso lo
garantiza `cookie-policy.ts` por construcción, sin depender de que alguien
configure las dos variables de forma coherente.

Si algún día frontend y API quedan bajo el mismo dominio (por ejemplo detrás de
un proxy), hay que volver a `lax`: `None` desactiva una protección contra CSRF
que en ese escenario sí sirve.

---

## Verificación

1. Abrí el frontend y entrá con una cuenta del seed demo.
2. **Recargá la página.** Si la sesión sobrevive, las cookies cross-site están
   bien. Si te saca, revisá `COOKIE_SAMESITE` y `CORS_ORIGIN`.
3. Entrá directo a una ruta interna (`/turnos`). Si da 404, falta `vercel.json`.
4. `curl https://pulso-api.onrender.com/api/v1/health/ready` — esta sonda sí
   toca la base, así que confirma la conexión con Supabase.

---

## Datos de demostración

Están en `backend/src/database/seed-demo.ts` y ya corrieron contra Supabase. Para
recrearlos: `npm run seed:demo` desde `backend/`.
