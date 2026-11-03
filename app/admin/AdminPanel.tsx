'use client';

import { useMemo, useState } from 'react';
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

interface ExperienceView {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
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

export function AdminPanel({
  seasons,
  user
}: {
  seasons: SeasonView[];
  user: { email: string; role: string };
}) {
  const router = useRouter();
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? '');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

            {season?.experiences.map(experience => (
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
  onStatus
}: {
  experience: ExperienceView;
  timezone: string;
  currency: string;
  busyId: string | null;
  onSeats: (flight: FlightView, capacity: number) => void;
  onStatus: (flight: FlightView, status: string) => void;
}) {
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
      </div>

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
