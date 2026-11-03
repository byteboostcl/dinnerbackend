'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Panel de temporada: ver la ocupación vuelo por vuelo, cambiar los asientos
 * de uno concreto y abrir o cerrar horarios.
 *
 * Dos decisiones de forma, porque esto no edita contenido sino inventario que
 * se vende:
 *
 * - Los asientos se guardan al salir del campo (o con Enter), y solo si el
 *   número cambió. Guardar en cada tecla mandaría "2" camino de "22" y el
 *   servidor rechazaría con razón por debajo de lo ya vendido.
 * - Cerrar un vuelo con gente dentro pide confirmación y dice cuántas
 *   personas hay. El servidor no cancela esas reservas; alguien tiene que
 *   llamarlas.
 */

interface FlightView {
  id: string;
  startsAt: string;
  capacity: number;
  seatsTaken: number;
  status: 'SCHEDULED' | 'CLOSED' | 'CANCELLED' | string;
  bookings: number;
}

interface TicketTypeView {
  id: string;
  name: string;
  note: string | null;
  priceCents: number;
  occupiesSeat: boolean;
  maxPerBooking: number | null;
  active: boolean;
}

interface PromoView {
  id: string;
  code: string;
  description: string | null;
  kind: string;
  value: number;
  maxRedemptions: number | null;
  timesRedeemed: number;
  validUntil: string | null;
  active: boolean;
}

interface ExperienceView {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  ticketTypes: TicketTypeView[];
  flights: FlightView[];
}

interface SeasonView {
  id: string;
  name: string;
  citySlug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | string;
  timezone: string;
  currency: string;
  experiences: ExperienceView[];
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada'
};

const KIND_LABEL: Record<string, string> = {
  PERCENT: 'Porcentaje',
  FIXED: 'Monto fijo',
  FREE_SEATS: 'Boletos gratis',
  FULL_COMP: 'Cortesía'
};

export function AdminPanel({
  seasons,
  promos,
  user
}: {
  seasons: SeasonView[];
  promos: PromoView[];
  user: { email: string; role: string };
}) {
  const router = useRouter();
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'reservas' | 'vuelos' | 'boletos' | 'promos' | 'correo'>('reservas');

  const season = useMemo(() => seasons.find(item => item.id === seasonId), [seasons, seasonId]);

  async function call(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (!response.ok) {
      setMessage({ kind: 'error', text: String(payload.error ?? 'No se pudo guardar.') });
      return null;
    }
    return payload;
  }

  async function updateFlight(flight: FlightView, body: Record<string, unknown>, okText: string) {
    setBusyId(flight.id);
    setMessage(null);

    const payload = await call(`/api/admin/flights/${flight.id}`, body);
    if (payload) {
      const warning = payload['warning'];
      setMessage(
        typeof warning === 'string' && warning
          ? { kind: 'warn', text: warning }
          : { kind: 'ok', text: okText }
      );
      router.refresh();
    }
    setBusyId(null);
  }

  async function changeSeasonStatus(status: string) {
    if (!season) return;
    setMessage(null);
    const payload = await call(`/api/admin/seasons/${season.id}`, { status });
    if (payload) {
      const warning = payload['warning'];
      setMessage(
        typeof warning === 'string' && warning
          ? { kind: 'warn', text: warning }
          : { kind: 'ok', text: `Temporada ${STATUS_LABEL[status]?.toLowerCase() ?? status}.` }
      );
      router.refresh();
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  }

  return (
    <>
      <header className="adm__bar">
        <span className="adm__brand">Dinner in the Sky · Panel</span>
        <span className="adm__spacer" />
        <span className="adm__who">{user.email}</span>
        <button className="adm__btn adm__btn--ghost adm__btn--sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.35)' }} onClick={logout}>
          Salir
        </button>
      </header>

      <main className="adm__main">
        {seasons.length === 0 ? (
          <div className="adm__card">
            <h2>Todavía no hay temporadas</h2>
            <p className="adm__muted">Cuando se cree una temporada aparecerá aquí con sus vuelos.</p>
          </div>
        ) : (
          <>
            <h1>{season?.name}</h1>
            <p className="adm__sub">
              {season?.citySlug} · horarios en {season?.timezone.replace('America/', '')}
            </p>

            {message && <div className={`adm__msg adm__msg--${message.kind}`}>{message.text}</div>}

            <div className="adm__card">
              <div className="adm__row">
                {seasons.length > 1 && (
                  <select className="adm__input" style={{ width: 'auto' }} value={seasonId} onChange={event => setSeasonId(event.target.value)}>
                    {seasons.map(item => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                )}
                <span className={`adm__chip adm__chip--${(season?.status ?? '').toLowerCase()}`}>
                  {STATUS_LABEL[season?.status ?? ''] ?? season?.status}
                </span>
                <span className="adm__spacer" />
                {season?.status === 'PUBLISHED' ? (
                  <>
                    <button className="adm__btn adm__btn--ghost" onClick={() => changeSeasonStatus('DRAFT')}>
                      Quitar del sitio
                    </button>
                    <button className="adm__btn adm__btn--danger" onClick={() => changeSeasonStatus('CLOSED')}>
                      Cerrar venta
                    </button>
                  </>
                ) : (
                  <button className="adm__btn adm__btn--primary" onClick={() => changeSeasonStatus('PUBLISHED')}>
                    Publicar en el sitio
                  </button>
                )}
              </div>
              {season?.status !== 'PUBLISHED' && (
                <p className="adm__muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  Mientras no esté publicada, esta temporada no se ve en la web ni se puede reservar.
                </p>
              )}
            </div>

            <div className="adm__row" style={{ margin: '4px 0 16px' }}>
              {([
                ['reservas', 'Reservas'],
                ['vuelos', 'Vuelos'],
                ['boletos', 'Boletos y extras'],
                ['promos', 'Promociones'],
                ['correo', 'Correo']
              ] as const).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  className={`adm__btn ${tab === clave ? 'adm__btn--primary' : 'adm__btn--ghost'}`}
                  onClick={() => setTab(clave)}
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            {tab === 'reservas' && season && <BookingsPanel seasonId={season.id} currency={season.currency} />}

            {tab === 'correo' && season && <EmailPanel season={season} />}

            {tab === 'promos' && <PromosPanel promos={promos} onDone={() => router.refresh()} />}

            {tab === 'boletos' && season?.experiences.map(experience => (
              <TicketsCard key={experience.id} experience={experience} currency={season.currency} onDone={() => router.refresh()} />
            ))}

            {tab === 'vuelos' && season?.experiences.map(experience => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                timezone={season.timezone}
                currency={season.currency}
                busyId={busyId}
                onSeats={(flight, capacity) =>
                  updateFlight(flight, { capacity }, `Asientos actualizados a ${capacity}.`)
                }
                onStatus={(flight, status) =>
                  updateFlight(
                    flight,
                    { status },
                    status === 'SCHEDULED' ? 'Vuelo abierto.' : 'Vuelo cerrado.'
                  )
                }
                onCreated={() => router.refresh()}
              />
            ))}
          </>
        )}
      </main>
    </>
  );
}

function ExperienceCard({
  experience,
  timezone,
  currency,
  busyId,
  onSeats,
  onStatus,
  onCreated
}: {
  experience: ExperienceView;
  timezone: string;
  currency: string;
  busyId: string | null;
  onSeats: (flight: FlightView, capacity: number) => void;
  onStatus: (flight: FlightView, status: string) => void;
  onCreated: () => void;
}) {
  const [abrirAlta, setAbrirAlta] = useState(false);
  const price = (experience.priceCents / 100).toLocaleString('es-MX', { style: 'currency', currency });
  const totalSeats = experience.flights.reduce((sum, flight) => sum + flight.capacity, 0);
  const takenSeats = experience.flights.reduce((sum, flight) => sum + flight.seatsTaken, 0);

  return (
    <div className="adm__card">
      <div className="adm__row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{experience.name}</h2>
        <span className="adm__muted">{price} por persona</span>
        <span className="adm__spacer" />
        <span className="adm__muted">
          {takenSeats} / {totalSeats} lugares vendidos
        </span>
        <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => setAbrirAlta(v => !v)}>
          {abrirAlta ? 'Cancelar' : '+ Agregar horarios'}
        </button>
      </div>

      {abrirAlta && <NuevoHorario experienceId={experience.id} onDone={onCreated} />}

      <div style={{ overflowX: 'auto' }}>
        <table className="adm__table">
          <thead>
            <tr>
              <th>Día</th>
              <th>Hora</th>
              <th>Ocupación</th>
              <th>Reservas</th>
              <th>Asientos</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {experience.flights.map(flight => (
              <FlightRow
                key={flight.id}
                flight={flight}
                timezone={timezone}
                busy={busyId === flight.id}
                onSeats={onSeats}
                onStatus={onStatus}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlightRow({
  flight,
  timezone,
  busy,
  onSeats,
  onStatus
}: {
  flight: FlightView;
  timezone: string;
  busy: boolean;
  onSeats: (flight: FlightView, capacity: number) => void;
  onStatus: (flight: FlightView, status: string) => void;
}) {
  const [seats, setSeats] = useState(String(flight.capacity));
  const date = new Date(flight.startsAt);

  // Siempre en la zona de la sede: el staff puede estar en otra ciudad y
  // debe ver la hora a la que la gente se sube a la mesa.
  const day = new Intl.DateTimeFormat('es-MX', { timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

  const occupancy = flight.capacity > 0 ? Math.round((flight.seatsTaken / flight.capacity) * 100) : 0;
  const closed = flight.status !== 'SCHEDULED';

  function commitSeats() {
    const value = Number(seats);
    if (!Number.isInteger(value) || value <= 0) {
      setSeats(String(flight.capacity));
      return;
    }
    if (value !== flight.capacity) {
      onSeats(flight, value);
    }
  }

  function toggle() {
    if (!closed && flight.seatsTaken > 0) {
      const ok = window.confirm(
        `Este vuelo tiene ${flight.seatsTaken} lugar(es) vendido(s) en ${flight.bookings} reserva(s).\n\n` +
          'Cerrarlo quita el horario de la venta, pero NO cancela esas reservas: hay que avisar a esas personas.\n\n¿Cerrar de todos modos?'
      );
      if (!ok) return;
    }
    onStatus(flight, closed ? 'SCHEDULED' : 'CLOSED');
  }

  return (
    <tr style={closed ? { opacity: 0.55 } : undefined}>
      <td className="adm__day">{day}</td>
      <td className="adm__time">{time}</td>
      <td>
        <div className="adm__occ">
          <div className="adm__bar-track">
            <div
              className={`adm__bar-fill${flight.seatsTaken >= flight.capacity ? ' adm__bar-fill--full' : ''}`}
              style={{ width: `${Math.min(100, occupancy)}%` }}
            />
          </div>
          <span className="adm__occ-text">
            {flight.seatsTaken}/{flight.capacity}
          </span>
        </div>
      </td>
      <td className="adm__muted">{flight.bookings || '—'}</td>
      <td>
        <input
          className="adm__input adm__input--seats"
          type="number"
          min={flight.seatsTaken || 1}
          value={seats}
          disabled={busy}
          onChange={event => setSeats(event.target.value)}
          onBlur={commitSeats}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </td>
      <td>
        <span className={`adm__chip ${closed ? 'adm__chip--closed' : 'adm__chip--published'}`}>
          {closed ? 'Cerrado' : 'Abierto'}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className={`adm__btn adm__btn--sm ${closed ? 'adm__btn--ghost' : 'adm__btn--danger'}`} onClick={toggle} disabled={busy}>
          {closed ? 'Abrir' : 'Cerrar'}
        </button>
      </td>
    </tr>
  );
}

/**
 * Boletos y extras de una experiencia.
 *
 * Un extra es un boleto que no ocupa asiento: se cobra pero no consume plaza
 * de la mesa de 22. Así están modelados el paquete de anillo, la botella o
 * el pastelito.
 */
function TicketsCard({
  experience,
  currency,
  onDone
}: {
  experience: ExperienceView;
  currency: string;
  onDone: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [ocupaAsiento, setOcupaAsiento] = useState(true);
  const [maximo, setMaximo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const precioTexto = (cents: number) =>
    (cents / 100).toLocaleString('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 });

  async function crear() {
    const pesos = Number(precio);
    if (!nombre.trim() || !Number.isFinite(pesos) || pesos < 0) {
      setMsg({ kind: 'error', text: 'Hace falta nombre y precio.' });
      return;
    }

    setEnviando(true);
    setMsg(null);

    const response = await fetch('/api/admin/ticket-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experienceId: experience.id,
        name: nombre.trim(),
        // El panel pide pesos y aquí se convierte: la base siempre centavos.
        priceCents: Math.round(pesos * 100),
        occupiesSeat: ocupaAsiento,
        maxPerBooking: maximo ? Number(maximo) : null
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      setMsg({ kind: 'error', text: String(payload.error ?? 'No se pudo crear.') });
    } else {
      setNombre('');
      setPrecio('');
      setMaximo('');
      setMsg({ kind: 'ok', text: 'Listo.' });
      onDone();
    }
    setEnviando(false);
  }

  async function alternar(ticket: TicketTypeView) {
    await fetch(`/api/admin/ticket-types/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !ticket.active })
    });
    onDone();
  }

  const boletos = experience.ticketTypes.filter(t => t.occupiesSeat);
  const extras = experience.ticketTypes.filter(t => !t.occupiesSeat);

  return (
    <div className="adm__card">
      <h2>{experience.name}</h2>

      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      {experience.ticketTypes.length === 0 && (
        <p className="adm__muted">
          Todavía no hay boletos. Mientras no exista al menos uno, esta experiencia no se puede vender.
        </p>
      )}

      {[
        { titulo: 'Boletos (ocupan lugar)', lista: boletos },
        { titulo: 'Extras (no ocupan lugar)', lista: extras }
      ].map(grupo =>
        grupo.lista.length > 0 ? (
          <div key={grupo.titulo} style={{ marginBottom: 14 }}>
            <p className="adm__muted" style={{ fontWeight: 700, marginBottom: 6 }}>{grupo.titulo}</p>
            <table className="adm__table">
              <tbody>
                {grupo.lista.map(ticket => (
                  <tr key={ticket.id} style={ticket.active ? undefined : { opacity: 0.5 }}>
                    <td>
                      {ticket.name}
                      {ticket.note && <div className="adm__muted">{ticket.note}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{precioTexto(ticket.priceCents)}</td>
                    <td className="adm__muted">{ticket.maxPerBooking ? `máx ${ticket.maxPerBooking}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => alternar(ticket)}>
                        {ticket.active ? 'Retirar' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null
      )}

      <div className="adm__row" style={{ borderTop: '1px solid var(--borde)', paddingTop: 14 }}>
        <input
          className="adm__input"
          style={{ flex: 2, minWidth: 180 }}
          placeholder="Nombre (Menú vegetariano, Botella…)"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
        />
        <input
          className="adm__input"
          style={{ width: 120 }}
          type="number"
          placeholder="Precio"
          value={precio}
          onChange={e => setPrecio(e.target.value)}
        />
        <label className="adm__row" style={{ gap: 6 }}>
          <input type="checkbox" checked={ocupaAsiento} onChange={e => setOcupaAsiento(e.target.checked)} />
          <span className="adm__muted">Ocupa lugar</span>
        </label>
        {!ocupaAsiento && (
          <input
            className="adm__input"
            style={{ width: 110 }}
            type="number"
            placeholder="Máx."
            value={maximo}
            onChange={e => setMaximo(e.target.value)}
          />
        )}
        <button className="adm__btn adm__btn--primary" disabled={enviando} onClick={crear}>
          {enviando ? 'Agregando…' : 'Agregar'}
        </button>
      </div>
    </div>
  );
}

/** Códigos promocionales. */
function PromosPanel({ promos, onDone }: { promos: PromoView[]; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('PERCENT');
  const [value, setValue] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function crear() {
    setEnviando(true);
    setMsg(null);

    const esMonto = kind === 'FIXED';
    const response = await fetch('/api/admin/promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        kind,
        // El monto fijo se teclea en pesos y se guarda en centavos.
        value: esMonto ? Math.round(Number(value) * 100) : Number(value),
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
        validUntil: validUntil || null
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      setMsg({ kind: 'error', text: String(payload.error ?? 'No se pudo crear.') });
    } else {
      setCode('');
      setValue('');
      setMaxRedemptions('');
      setValidUntil('');
      setMsg({ kind: 'ok', text: 'Código creado.' });
      onDone();
    }
    setEnviando(false);
  }

  async function alternar(promo: PromoView) {
    await fetch(`/api/admin/promos/${promo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !promo.active })
    });
    onDone();
  }

  return (
    <div className="adm__card">
      <h2>Promociones</h2>

      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      <div className="adm__row" style={{ marginBottom: 16 }}>
        <input
          className="adm__input"
          style={{ width: 170, textTransform: 'uppercase' }}
          placeholder="CÓDIGO"
          value={code}
          onChange={e => setCode(e.target.value)}
        />
        <select className="adm__input" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="PERCENT">Porcentaje</option>
          <option value="FIXED">Monto fijo</option>
          <option value="FREE_SEATS">Boletos gratis</option>
          <option value="FULL_COMP">Cortesía 100%</option>
        </select>
        {kind !== 'FULL_COMP' && (
          <input
            className="adm__input"
            style={{ width: 110 }}
            type="number"
            placeholder={kind === 'PERCENT' ? '%' : kind === 'FIXED' ? 'Pesos' : 'Gratis'}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        )}
        <input
          className="adm__input"
          style={{ width: 110 }}
          type="number"
          placeholder="Usos"
          value={maxRedemptions}
          onChange={e => setMaxRedemptions(e.target.value)}
        />
        <input
          className="adm__input"
          style={{ width: 150 }}
          type="date"
          value={validUntil}
          onChange={e => setValidUntil(e.target.value)}
        />
        <button className="adm__btn adm__btn--primary" disabled={enviando} onClick={crear}>
          {enviando ? 'Creando…' : 'Crear'}
        </button>
      </div>

      {kind === 'FULL_COMP' && (
        <p className="adm__muted" style={{ marginTop: -8, marginBottom: 14 }}>
          Una cortesía deja la reserva en cero. Es obligatorio ponerle un límite de usos.
        </p>
      )}

      {promos.length === 0 ? (
        <p className="adm__muted">Todavía no hay códigos.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="adm__table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Usos</th>
                <th>Vence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {promos.map(promo => (
                <tr key={promo.id} style={promo.active ? undefined : { opacity: 0.5 }}>
                  <td style={{ fontWeight: 700 }}>{promo.code}</td>
                  <td className="adm__muted">{KIND_LABEL[promo.kind] ?? promo.kind}</td>
                  <td>
                    {promo.kind === 'PERCENT' && `${promo.value}%`}
                    {promo.kind === 'FIXED' && `$${(promo.value / 100).toLocaleString('es-MX')}`}
                    {promo.kind === 'FREE_SEATS' && `${promo.value} gratis`}
                    {promo.kind === 'FULL_COMP' && '100%'}
                  </td>
                  <td className="adm__muted">
                    {promo.timesRedeemed}
                    {promo.maxRedemptions !== null ? ` / ${promo.maxRedemptions}` : ''}
                  </td>
                  <td className="adm__muted">
                    {promo.validUntil ? new Date(promo.validUntil).toLocaleDateString('es-MX') : 'sin fecha'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => alternar(promo)}>
                      {promo.active ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Alta de horarios: rango de fechas, días de la semana y horas.
 *
 * Es masiva porque una temporada son decenas de vuelos y crearlos uno a uno
 * garantiza erratas. Repetir la operación no duplica nada: el par
 * experiencia + instante es único en la base, así que se puede volver a
 * correr para sumar un horario sin tocar lo ya vendido.
 */
function NuevoHorario({ experienceId, onDone }: { experienceId: string; onDone: () => void }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [horas, setHoras] = useState('');
  const [dias, setDias] = useState<number[]>([4, 5, 6, 0]);
  const [capacidad, setCapacidad] = useState('22');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const DIAS = [
    [1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [0, 'Dom']
  ] as const;

  async function crear() {
    const times = horas.split(',').map(h => h.trim()).filter(Boolean);
    if (!desde || !hasta || times.length === 0) {
      setMsg({ kind: 'error', text: 'Hacen falta fechas y al menos un horario.' });
      return;
    }

    setEnviando(true);
    setMsg(null);

    const response = await fetch('/api/admin/flights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experienceId,
        from: desde,
        to: hasta,
        times,
        weekdays: dias,
        capacity: Number(capacidad) || 22
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      setMsg({ kind: 'error', text: String(payload.error ?? 'No se pudieron crear.') });
    } else {
      const creados = payload.created as number;
      const repetidos = payload.skipped as number;
      setMsg({
        kind: creados === 0 ? 'warn' : 'ok',
        text:
          creados === 0
            ? `No se creó ninguno: los ${repetidos} horarios ya existían.`
            : `${creados} vuelos creados${repetidos ? ` (${repetidos} ya existían)` : ''}.`
      });
      onDone();
    }
    setEnviando(false);
  }

  return (
    <div style={{ background: 'var(--azul-claro)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      <div className="adm__row" style={{ marginBottom: 12 }}>
        <label className="adm__row" style={{ gap: 6 }}>
          <span className="adm__muted">Del</span>
          <input className="adm__input" style={{ width: 160 }} type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </label>
        <label className="adm__row" style={{ gap: 6 }}>
          <span className="adm__muted">al</span>
          <input className="adm__input" style={{ width: 160 }} type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </label>
        <label className="adm__row" style={{ gap: 6 }}>
          <span className="adm__muted">Lugares</span>
          <input className="adm__input" style={{ width: 80 }} type="number" value={capacidad} onChange={e => setCapacidad(e.target.value)} />
        </label>
      </div>

      <div className="adm__row" style={{ marginBottom: 12 }}>
        <span className="adm__muted">Días</span>
        {DIAS.map(([valor, etiqueta]) => (
          <button
            key={valor}
            className={`adm__btn adm__btn--sm ${dias.includes(valor) ? 'adm__btn--primary' : 'adm__btn--ghost'}`}
            onClick={() => setDias(d => (d.includes(valor) ? d.filter(x => x !== valor) : [...d, valor]))}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="adm__row">
        <input
          className="adm__input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Horarios separados por coma: 17:30, 19:30, 21:30"
          value={horas}
          onChange={e => setHoras(e.target.value)}
        />
        <button className="adm__btn adm__btn--primary" disabled={enviando} onClick={crear}>
          {enviando ? 'Creando…' : 'Crear vuelos'}
        </button>
      </div>
      <p className="adm__muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Las horas son las de la sede. Repetir esta operación no duplica vuelos.
      </p>
    </div>
  );
}

/** Reservas de la temporada, con búsqueda y filtros. */
function BookingsPanel({ seasonId, currency }: { seasonId: string; currency: string }) {
  const [bookings, setBookings] = useState<Record<string, unknown>[]>([]);
  const [summary, setSummary] = useState<{ confirmed: number; seats: number; amountCents: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ seasonId, status });
    if (q.trim()) params.set('q', q.trim());

    const response = await fetch(`/api/admin/bookings?${params}`);
    const payload = await response.json();
    if (payload.ok) {
      setBookings(payload.bookings);
      setSummary(payload.summary);
      setTotal(payload.total);
    }
    setCargando(false);
  }, [seasonId, status, q]);

  useEffect(() => {
    // Espera a que se deje de teclear: sin esto cada letra dispara una
    // consulta a la base.
    const id = setTimeout(cargar, q ? 350 : 0);
    return () => clearTimeout(id);
  }, [cargar, q]);

  const dinero = (cents: number) =>
    (cents / 100).toLocaleString('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 });

  const ESTADOS: Record<string, string> = {
    PENDING: 'Pendiente',
    CONFIRMED: 'Confirmada',
    CANCELLED: 'Cancelada',
    REFUNDED: 'Reembolsada',
    EXPIRED: 'Expirada'
  };

  return (
    <div className="adm__card">
      <div className="adm__row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Reservas</h2>
        <span className="adm__spacer" />
        {summary && (
          <span className="adm__muted">
            {summary.confirmed} confirmadas · {summary.seats} lugares · {dinero(summary.amountCents)}
          </span>
        )}
      </div>

      <div className="adm__row" style={{ marginBottom: 14 }}>
        <input
          className="adm__input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Buscar por código, nombre, correo o teléfono"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <select className="adm__input" style={{ width: 'auto' }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="ALL">Todos los estados</option>
          {Object.entries(ESTADOS).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>{etiqueta}</option>
          ))}
        </select>
        <button className="adm__btn adm__btn--ghost" onClick={cargar}>Actualizar</button>
      </div>

      {cargando ? (
        <p className="adm__muted">Cargando…</p>
      ) : bookings.length === 0 ? (
        <p className="adm__muted">No hay reservas que coincidan.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="adm__table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Cliente</th>
                <th>Vuelo</th>
                <th>Lugares</th>
                <th>Importe</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => {
                const flight = b['flight'] as { startsAt: string; experience: string; timezone: string };
                const id = String(b['id']);
                const abiertaEsta = abierta === id;
                const fecha = new Intl.DateTimeFormat('es-MX', {
                  timeZone: flight.timezone,
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23'
                }).format(new Date(flight.startsAt));

                return (
                  <Fragment key={id}>
                    <tr>
                      <td style={{ fontWeight: 700 }}>{String(b['code'])}</td>
                      <td>
                        {String(b['customerName'])}
                        <div className="adm__muted">{String(b['customerEmail'])}</div>
                      </td>
                      <td>
                        {fecha}
                        <div className="adm__muted">{flight.experience}</div>
                      </td>
                      <td>{String(b['seats'])}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {dinero(Number(b['amountCents']))}
                        {Number(b['discountCents']) > 0 && (
                          <div className="adm__muted">−{dinero(Number(b['discountCents']))} {String(b['promoCodeUsed'] ?? '')}</div>
                        )}
                      </td>
                      <td>
                        <span className={`adm__chip ${b['status'] === 'CONFIRMED' ? 'adm__chip--published' : b['status'] === 'PENDING' ? 'adm__chip--draft' : 'adm__chip--closed'}`}>
                          {ESTADOS[String(b['status'])] ?? String(b['status'])}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => setAbierta(abiertaEsta ? null : id)}>
                          {abiertaEsta ? 'Cerrar' : 'Ver'}
                        </button>
                      </td>
                    </tr>
                    {abiertaEsta && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--azul-claro)' }}>
                          <div className="adm__row" style={{ alignItems: 'flex-start', gap: 28 }}>
                            <div>
                              <p className="adm__muted" style={{ margin: 0, fontWeight: 700 }}>Contacto</p>
                              <p style={{ margin: 0 }}>{String(b['customerEmail'])}</p>
                              <p style={{ margin: 0 }}>{String(b['customerPhone'] ?? 'sin teléfono')}</p>
                              {Boolean(b['invoiceRequested']) && <p style={{ margin: '6px 0 0', color: 'var(--rojo)' }}>Pidió factura</p>}
                            </div>
                            <div>
                              <p className="adm__muted" style={{ margin: 0, fontWeight: 700 }}>Boletos</p>
                              {(b['items'] as { name: string; quantity: number; unitPriceCents: number }[]).map((i, n) => (
                                <p key={n} style={{ margin: 0 }}>
                                  {i.quantity} × {i.name} · {dinero(i.unitPriceCents)}
                                </p>
                              ))}
                            </div>
                            {b['preferences'] ? (
                              <div>
                                <p className="adm__muted" style={{ margin: 0, fontWeight: 700 }}>Experiencia</p>
                                <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                                  {JSON.stringify(b['preferences'], null, 1)}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {total > bookings.length && (
            <p className="adm__muted" style={{ marginTop: 10 }}>
              Mostrando {bookings.length} de {total}. Afina la búsqueda para ver el resto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Plantilla del correo de confirmación, con vista previa. */
function EmailPanel({ season }: { season: SeasonView }) {
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [placeholders, setPlaceholders] = useState<{ tag: string; desc: string }[]>([]);
  const [porTemporada, setPorTemporada] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [pruebaPara, setPruebaPara] = useState('');
  const [probando, setProbando] = useState(false);

  async function enviarPrueba() {
    setProbando(true);
    setMsg(null);

    const response = await fetch('/api/admin/email-templates/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pruebaPara, subject, bodyHtml })
    });
    const payload = await response.json();

    setMsg(
      response.ok
        ? { kind: 'ok', text: `Prueba enviada a ${pruebaPara}. Revisa también la carpeta de spam.` }
        : { kind: 'error', text: String(payload.error ?? 'No se pudo enviar.') }
    );
    setProbando(false);
  }

  useEffect(() => {
    (async () => {
      const response = await fetch('/api/admin/email-templates');
      const payload = await response.json();
      if (!payload.ok) return;

      setPlaceholders(payload.placeholders ?? []);
      const lista = payload.templates as { seasonId: string | null; subject: string; bodyHtml: string }[];
      const propia = lista.find(t => t.seasonId === season.id);
      const general = lista.find(t => t.seasonId === null);
      const elegida = propia ?? general;

      setPorTemporada(Boolean(propia));
      setSubject(elegida?.subject ?? 'Confirmación de vuelo — %date_event% para %name%');
      setBodyHtml(
        elegida?.bodyHtml ??
          '<h2>Hola %name%,</h2>\n<p>Tu reserva <strong>%booking_id%</strong> quedó confirmada.</p>\n<p>%product_name% · %date_event% · %time_event%</p>\n<p>%seats% invitados · %total%</p>\n<p>%venue_name%<br>%venue_address%</p>'
      );
    })();
  }, [season.id]);

  async function guardar() {
    setGuardando(true);
    setMsg(null);

    const response = await fetch('/api/admin/email-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'booking_confirmation',
        seasonId: porTemporada ? season.id : null,
        subject,
        bodyHtml
      })
    });
    const payload = await response.json();

    setMsg(
      response.ok
        ? { kind: 'ok', text: 'Plantilla guardada.' }
        : { kind: 'error', text: String(payload.error ?? 'No se pudo guardar.') }
    );
    setGuardando(false);
  }

  // Vista previa con datos de ejemplo: el equipo tiene que poder ver cómo
  // queda antes de que lo reciba un cliente.
  const EJEMPLO: Record<string, string> = {
    name: 'María López',
    booking_id: 'DITS-7F3K2A',
    product_name: season.experiences[0]?.name ?? 'Cena en las alturas',
    date_event: 'jueves 11 de marzo de 2027',
    time_event: '19:30',
    seats: '2',
    total: '$7,000 MXN',
    venue_name: 'Parque La Ruina',
    venue_address: 'Blvd. Fco. Eusebio Kino 9001, Hermosillo',
    email: 'maria@ejemplo.com',
    phone: '662 123 4567',
    company_email: 'reservas@dinnerinthesky.com.mx',
    company_phone: '+52 55 4506 4656'
  };
  const render = (texto: string) => texto.replace(/%([a-z_]+)%/gi, (m, k: string) => EJEMPLO[k] ?? m);

  return (
    <div className="adm__card">
      <h2>Correo de confirmación</h2>
      <p className="adm__muted" style={{ marginTop: -6 }}>
        Se envía cuando se confirma el pago.
      </p>

      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      <div className="adm__row" style={{ marginBottom: 16 }}>
        <input
          className="adm__input"
          style={{ flex: 1, minWidth: 200 }}
          type="email"
          placeholder="Enviar una prueba a…"
          value={pruebaPara}
          onChange={e => setPruebaPara(e.target.value)}
        />
        <button className="adm__btn adm__btn--ghost" disabled={probando} onClick={enviarPrueba}>
          {probando ? 'Enviando…' : 'Enviar prueba'}
        </button>
      </div>

      <label className="adm__field">
        <span className="adm__label">Asunto</span>
        <input className="adm__input" value={subject} onChange={e => setSubject(e.target.value)} />
      </label>

      <label className="adm__field">
        <span className="adm__label">Cuerpo (HTML)</span>
        <textarea
          className="adm__input"
          style={{ minHeight: 220, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          value={bodyHtml}
          onChange={e => setBodyHtml(e.target.value)}
        />
      </label>

      <p className="adm__muted" style={{ marginBottom: 6 }}>Marcadores disponibles (haz clic para copiar):</p>
      <div className="adm__row" style={{ gap: 6, marginBottom: 16 }}>
        {placeholders.map(p => (
          <button
            key={p.tag}
            className="adm__btn adm__btn--ghost adm__btn--sm"
            title={p.desc}
            onClick={() => navigator.clipboard?.writeText(p.tag)}
          >
            {p.tag}
          </button>
        ))}
      </div>

      <label className="adm__row" style={{ gap: 8, marginBottom: 16 }}>
        <input type="checkbox" checked={porTemporada} onChange={e => setPorTemporada(e.target.checked)} />
        <span className="adm__muted">
          Usar solo para «{season.name}» (si no, es la plantilla general de todas las temporadas)
        </span>
      </label>

      <button className="adm__btn adm__btn--primary" disabled={guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar plantilla'}
      </button>

      <div style={{ marginTop: 24 }}>
        <p className="adm__label">Vista previa</p>
        <div style={{ border: '1px solid var(--borde)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ background: 'var(--azul-claro)', padding: '10px 14px', fontSize: 13 }}>
            <strong>Asunto:</strong> {render(subject)}
          </div>
          <div
            style={{ padding: 16, background: '#fff' }}
            dangerouslySetInnerHTML={{ __html: render(bodyHtml) }}
          />
        </div>
      </div>
    </div>
  );
}
