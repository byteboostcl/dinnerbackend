# dinnerbackend

Backend Next.js, separado del sitio Angular. Recibe los registros de los
formularios de **todas las sedes** (Hermosillo hoy; Ensenada, Puebla, CDMX o
Tijuana después, si les ponen un formulario similar) vía el `_webhook` de
FormSubmit, los guarda en Postgres, y los expone como JSON o descarga
`.xlsx`.

FormSubmit sigue mandando el correo a `joan@dinnerinthesky.com.mx` igual que
hoy — este servicio corre **en paralelo**, no lo reemplaza.

## Qué guarda

Una sola tabla `leads` para todas las sedes (columna `sede`, texto libre —
agregar una sede nueva no requiere tocar el esquema). Cada registro guarda
además el payload completo tal cual llegó (`raw`), así que aunque el mapeo de
campos falle para una sede nueva, no se pierde información.

## 1. Crear la base de datos en Railway

1. En tu proyecto de Railway: **New → Database → PostgreSQL**.
2. Entra al plugin de Postgres → pestaña **Variables** → copia `DATABASE_URL`.

## 2. Desplegar este backend en Railway

1. Sube este repo a GitHub (`byteboostcl/dinnerbackend`) y en Railway: **New
   → GitHub Repo**, elige `dinnerbackend`.
2. En **Variables** del servicio, agrega:
   - `DATABASE_URL` → el valor del plugin de Postgres (si están en el mismo
     proyecto de Railway, puedes referenciarlo directo con
     `${{Postgres.DATABASE_URL}}`).
   - `WEBHOOK_SECRET` → un valor largo y aleatorio que tú generes.
   - `ADMIN_API_KEY` → otro valor largo y aleatorio (distinto al de arriba).
3. Railway detecta que es un proyecto Next.js y corre `npm install` →
   `npm run build` (que ya incluye `prisma generate`) → `npm run start` solo.
4. Cuando termine el deploy, copia la URL pública que te asigna (algo como
   `https://dinnerbackend-production.up.railway.app`).

## 3. Correr la migración (una sola vez)

Desde tu máquina, con `DATABASE_URL` apuntando a la misma base de Railway:

```bash
npm install
cp .env.example .env   # y llena DATABASE_URL con el valor real de Railway
npm run migrate:deploy
```

Esto crea la tabla `leads` a partir de la migración ya incluida en
`prisma/migrations/`. Cambios de esquema futuros van siempre por una
migración nueva (`npx prisma migrate dev` en local, luego `migrate:deploy` en
producción) — nunca por un `db push` a ciegas.

## 4. Conectar el formulario de Hermosillo

En el sitio Angular (`src/app/features/hermosillo/hermosillo.component.ts`),
agrega de vuelta el campo `_webhook` al `FormData` que ya se manda a
formsubmit.co — pero **solo después de confirmar que esta URL responde** (ver
paso 5), para no repetir el incidente del `_webhook` roto:

```ts
formData.append(
  '_webhook',
  'https://TU-BACKEND.up.railway.app/api/webhooks/formsubmit?sede=hermosillo&secret=TU_WEBHOOK_SECRET'
);
```

## 5. Probar el webhook antes de conectarlo al form real

```bash
curl -X POST 'https://TU-BACKEND.up.railway.app/api/webhooks/formsubmit?sede=hermosillo&secret=TU_WEBHOOK_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"form_data": {"Nombre completo": "Prueba", "Correo electrónico": "prueba@test.com", "Invitados": "2", "Ciudad": "Hermosillo, Sonora"}}'
```

Debe responder `{"ok":true}`. Si responde 401, revisa que `WEBHOOK_SECRET`
coincida entre Railway y la URL.

## 6. Ver los registros como Excel

- Todos: `https://TU-BACKEND.up.railway.app/api/leads/export?api_key=TU_ADMIN_API_KEY`
- Solo Hermosillo: `https://TU-BACKEND.up.railway.app/api/leads/export?sede=hermosillo&api_key=TU_ADMIN_API_KEY`

Eso descarga un `.xlsx` con columnas Sede, Nombre completo, Correo, Teléfono,
Invitados, Origen y Fecha de registro. Para verlos como JSON (sin descargar
nada) usa `/api/leads` en vez de `/api/leads/export`, con el mismo
`?api_key=`.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completa DATABASE_URL con una Postgres local o la de Railway
npm run migrate:deploy
npm run dev
```

## Notas honestas sobre cómo se armó esto

- Se escribió sin poder correr `npm install` / `npm run build` en el entorno
  donde se generó (sin acceso de red a los registries desde ahí), así que no
  se compiló ni se ejecutó localmente antes de entregarlo. Antes de
  desplegar, corran `npm install && npm run build` una vez en su máquina para
  atrapar cualquier error de tipos o de versión de dependencias.
- La migración inicial en `prisma/migrations/20260913000000_init/` se
  escribió a mano (no se generó con `prisma migrate dev` contra una base
  real) porque tampoco había una Postgres disponible en ese entorno. Coincide
  exactamente con `schema.prisma`, pero vale la pena que la primera vez que
  corran `migrate:deploy` revisen que no tire ningún error.
- `git push` a `github.com/byteboostcl/dinnerbackend` tampoco se pudo hacer
  desde ese entorno (sin acceso de red a GitHub) — el repo local se dejó
  listo (`git init` + commit) para que el push se haga desde una máquina con
  acceso real.

---

## Reservas (en construcción)

Sustituye progresivamente al widget de TuriTop. Vive en la **misma base de
datos** que los leads, en tablas aparte: `seasons`, `experiences`, `flights`,
`bookings`, `tickets`, `stripe_events`.

### Modelo

`Season` (temporada de una ciudad) → `Experience` (lo que se vende, con su
precio) → `Flight` (fecha, hora y 22 lugares) → `Booking` → `Ticket`.

El cupo de cada vuelo se lleva en el contador `seatsTaken`, que se actualiza
con un UPDATE condicional atómico. **No contar reservas para decidir si hay
lugar**: eso abre una ventana de sobreventa cuando dos personas compran a la
vez.

Importes siempre en centavos; horas siempre en UTC, con la zona de la
temporada (`timezone`) como única fuente para mostrar e interpretar — Sonora
no cambia de horario y el resto del país sí.

### Endpoints

Público:

- `GET /api/booking/availability?city=hermosillo` — temporada publicada con
  sus vuelos y lugares disponibles. Solo expone `seatsLeft`.

Staff (mismo `x-api-key` / `?api_key=` que los leads):

- `GET  /api/admin/seasons` — temporadas con resumen.
- `POST /api/admin/seasons` — crea temporada y experiencias. Nace en
  borrador: no se ve en el sitio hasta publicarla.
- `GET  /api/admin/flights?seasonId=…` o `?experienceId=…`
- `POST /api/admin/flights` — genera los vuelos de un rango. Idempotente:
  repetirlo no duplica nada, así que sirve para agregar un horario después.
- `PATCH /api/admin/seasons/:id` — publicar, cerrar o corregir datos.
- `PATCH /api/admin/seasons/:id` — publicar, cerrar o corregir datos.
- `PATCH /api/admin/flights/:id` — abrir, cerrar o cambiar capacidad.

Ejemplo de generación (tres semanas, de jueves a domingo, dos horarios):

```bash
curl -X POST "$API/api/admin/flights" \
  -H "x-api-key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "experienceId": "…",
    "from": "2027-03-11",
    "to": "2027-03-29",
    "times": ["19:30", "21:30"],
    "weekdays": [4, 5, 6, 0]
  }'
```

### Pendiente

Stripe (apartado de lugares, sesión de pago y webhook), correos de
confirmación, QR y validación en puerta, y el panel del staff.
