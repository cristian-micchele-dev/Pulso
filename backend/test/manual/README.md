# Sondas manuales

Pruebas que **no** corren en CI porque necesitan la base real y uno o dos
procesos del servidor levantados. Están acá porque encontraron los dos bugs más
caros del proyecto, y una sonda que vive en la carpeta temporal de alguien es una
sonda que se pierde.

Todas crean sus propios datos y **los borran al terminar**, incluso si fallan.

## Antes de correr cualquiera

```bash
cd backend
npm run build
```

## `concurrencia.js` — varias personas reservando a la vez

Doce reservas simultáneas, en horarios distintos y después todas por el mismo.

```bash
PORT=3099 node -r dotenv/config dist/src/main.js &
node test/manual/concurrencia.js
```

Esperado:

```
A) horarios DISTINTOS: {"201":12}
B) mismo horario:      {"201":1, "409":11}
   turnos que quedaron en la base para ese horario: 1
```

Encontró que el código del turno se calculaba con leer-y-sumar: de doce reservas
simultáneas entraban una y once devolvían 500. Hoy el código sale de una
secuencia de Postgres. Lo cubre también `appointment-concurrency.integration-spec.ts`
a nivel repositorio; esta sonda agrega el camino HTTP completo.

## `carga-sostenida.js` — throughput y pool de conexiones

Sube la concurrencia (5 → 20 → 50) sobre una ruta de lectura y reporta rps y
percentiles.

```bash
THROTTLE_LIMIT=1000000 PORT=3099 node -r dotenv/config dist/src/main.js &
node test/manual/carga-sostenida.js
```

`THROTTLE_LIMIT` alto a propósito: con el límite normal (100/min por IP) se mide
el limitador y no la aplicación.

**Lo que se lee acá es la tasa de error y la FORMA de la latencia, no los
milisegundos.** La base está del otro lado de internet: los valores absolutos
miden sobre todo la red. Lo importante es que no aparezcan 5xx con la
concurrencia muy por encima del pool (`DB_POOL_MAX`, 10 por defecto): la app
tiene que hacer cola, no caerse.

## `dos-instancias.js` — sockets entre procesos

Levanta dos backends. El médico abre su socket contra uno y la secretaria le
manda un mensaje contra el otro.

```bash
PORT=3101 node -r dotenv/config dist/src/main.js &
PORT=3102 node -r dotenv/config dist/src/main.js &
node test/manual/dos-instancias.js
```

Esperado: `✅ cruzó: el socket en A recibió "..."`.

Es la **única** verificación de que el adaptador de Postgres (`LISTEN/NOTIFY`)
está enchufado. Si alguien saca `app.useWebSocketAdapter` de `main.ts`, ningún
test automático se entera: el chat sigue andando con una instancia y se rompe
recién en producción con dos.

---

## La regla que hace que estas sondas sirvan

**La sonda tiene que armar su entrada exactamente como la arma el código de
producción.**

Ya pasó una vez al revés: una sonda mandaba `new Date('2027-01-20')` para probar
los bloqueos de agenda, pero el formulario usa un campo `datetime-local` y manda
`'2027-01-20T18:00'`. JavaScript parsea el primero como UTC y el segundo como
hora local. La sonda "demostró" un bug que no existía, y el arreglo rompió la
pantalla.

Una sonda mal construida es peor que un mock: viene con el sello de "esto corre
contra el sistema real", así que nadie la discute.
