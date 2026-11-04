'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { SettingsPanel } from './secciones/SettingsPanel';
import { StatsPanel } from './secciones/StatsPanel';
import { SeasonsPanel } from './secciones/SeasonsPanel';
import { CheckinPanel } from './secciones/CheckinPanel';
import { CitiesPanel } from './secciones/CitiesPanel';
import { EmailLogPanel } from './secciones/EmailLogPanel';
import { useRouter } from 'next/navigation';
import {
  ICONO_SECCION,
  IconoAtras,
  IconoCandado,
  IconoCiudad,
  IconoMesa,
  IconoSalir,
  IconoTemporadas
} from './Iconos';

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

/**
 * El título de la página es la sección, no la temporada.
 *
 * Antes el `<h1>` era el nombre de la temporada activa, y con una sola sede
 * eso parecía razonable. Con varias ciudades deja de serlo: el panel entero
 * decía "Hermosillo marzo 2027" incluso estando en Ciudades o en Bitácora,
 * que no tienen nada que ver con una temporada.
 */
const TITULOS: Record<string, string> = {
  portada: 'Sedes',
  resumen: 'Resumen',
  reservas: 'Reservas',
  puerta: 'Puerta',
  ciudades: 'Sedes',
  temporadas: 'Temporadas',
  vuelos: 'Vuelos',
  boletos: 'Boletos y extras',
  promos: 'Promociones',
  correo: 'Correos automáticos',
  bitacora: 'Bitácora de correos',
  config: 'Configuración'
};

/**
 * Secciones que trabajan sobre UNA temporada. El resto son transversales, y
 * mostrarles encima el selector de temporada hacía creer que lo que se ve ahí
 * depende de la que esté elegida.
 */
const SECCION_DE_TEMPORADA = new Set(['resumen', 'reservas', 'puerta', 'vuelos', 'boletos', 'correo']);

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
  /**
   * Ninguna temporada elegida al entrar: el panel abre en la portada de
   * sedes. Entrar directo a la primera temporada hacía creer que el panel
   * "era" de esa ciudad, y con cinco sedes eso es sencillamente falso.
   */
  const [seasonId, setSeasonId] = useState('');
  /** Sede abierta en la portada. Todas empiezan cerradas. */
  const [sedeAbierta, setSedeAbierta] = useState('');
  const [clave, setClave] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<
    | 'portada'
    | 'resumen'
    | 'reservas'
    | 'puerta'
    | 'ciudades'
    | 'temporadas'
    | 'vuelos'
    | 'boletos'
    | 'promos'
    | 'correo'
    | 'bitacora'
    | 'config'
  >('portada');

  const season = useMemo(() => seasons.find(item => item.id === seasonId), [seasons, seasonId]);

  /**
   * Si la ciudad de esta temporada ya tiene página en el sitio.
   *
   * Se consulta aquí y no en cada sección porque es lo que cambia el
   * significado del botón "Publicar": en una ciudad sin página, publicar no
   * hace que nadie pueda reservar, y el panel tiene que decirlo antes y no
   * después.
   */
  const [ciudades, setCiudades] = useState<{ slug: string; name: string; siteStatus: string }[]>([]);

  useEffect(() => {
    (async () => {
      const response = await fetch('/api/admin/cities', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (payload?.ok) {
        setCiudades(payload.cities as { slug: string; name: string; siteStatus: string }[]);
      }
    })();
  }, []);

  /**
   * El nombre de la sede, no su slug. "hermosillo" es lo que va en la URL;
   * lo que el equipo lee tiene que ser "Hermosillo", y "ciudad-de-mexico"
   * directamente no se puede enseñar.
   *
   * Si la ciudad no está dada de alta se muestra el slug tal cual: inventar
   * un nombre bonito escondería justo el problema que hay que ver.
   */
  function nombreCiudad(slug: string | undefined): string {
    if (!slug) return '';
    return ciudades.find(c => c.slug === slug)?.name ?? slug;
  }

  function seccionIcono(clave: string) {
    const Icono = ICONO_SECCION[clave];
    return Icono ? <Icono size={21} /> : null;
  }

  const ciudadActual = ciudades.find(c => c.slug === season?.citySlug);
  // Si la ciudad ni siquiera está dada de alta, también cuenta como sin
  // página: nadie construyó nada para ese slug. Se espera a tener la lista
  // cargada para no avisar en falso durante el primer render.
  const ciudadSinPagina = ciudades.length > 0 && ciudadActual?.siteStatus !== 'LIVE';

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
        <span className="adm__brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <IconoMesa size={18} />
          Dinner in the Sky · Panel
        </span>
        <span className="adm__spacer" />
        <span className="adm__who">{user.email}</span>
        <button
          className="adm__btn adm__btn--ghost adm__btn--sm"
          style={{
            color: '#fff',
            borderColor: 'rgba(255,255,255,.35)',
            marginRight: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
          onClick={() => setClave(v => !v)}
        >
          <IconoCandado size={14} />
          Contraseña
        </button>
        <button
          className="adm__btn adm__btn--ghost adm__btn--sm"
          style={{
            color: '#fff',
            borderColor: 'rgba(255,255,255,.35)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6
          }}
          onClick={logout}
        >
          <IconoSalir size={14} />
          Salir
        </button>
      </header>

      <main className="adm__main">
        {clave && <CambiarClave onListo={() => setClave(false)} />}

        {tab === 'portada' ? (
          <Portada
            seasons={seasons}
            ciudades={ciudades}
            sedeAbierta={sedeAbierta}
            onAbrirSede={slug => setSedeAbierta(sedeAbierta === slug ? '' : slug)}
            onElegirTemporada={id => {
              setSeasonId(id);
              setTab('resumen');
            }}
            onIrA={destino => {
              setSeasonId('');
              setTab(destino);
            }}
          />
        ) : (
          <>
            <div className="adm__migas">
              <button
                className="adm__volver"
                onClick={() => {
                  setSeasonId('');
                  setTab('portada');
                }}
              >
                <IconoAtras size={15} />
                Sedes
              </button>
              {season && (
                <>
                  <span>/</span>
                  <span>{nombreCiudad(season.citySlug)}</span>
                  <span>/</span>
                  <span>{season.name}</span>
                </>
              )}
            </div>

            <div className="adm__titulo">
              <span className="adm__titulo-ico">{seccionIcono(tab)}</span>
              <div>
                <h1>{TITULOS[tab]}</h1>
                <p className="adm__sub" style={{ margin: 0 }}>
                  {season && SECCION_DE_TEMPORADA.has(tab)
                    ? `${nombreCiudad(season.citySlug)} · ${season.name} · horarios en ${season.timezone}`
                    : 'Afecta a todas las sedes'}
                </p>
              </div>
            </div>
            <div style={{ height: 20 }} />

            {message && <div className={`adm__msg adm__msg--${message.kind}`}>{message.text}</div>}

            {SECCION_DE_TEMPORADA.has(tab) && (
            <div className="adm__card">
              <div className="adm__row">
                {/*
                  El selector va siempre, aunque solo haya una temporada: es lo
                  único que dice sobre qué se está trabajando, y esconderlo
                  cuando hay una sola convierte la primera temporada nueva en
                  una sorpresa.
                */}
                <select className="adm__input" style={{ width: 'auto' }} value={seasonId} onChange={event => setSeasonId(event.target.value)}>
                  {seasons.map(item => (
                    <option key={item.id} value={item.id}>
                      {nombreCiudad(item.citySlug)} · {item.name}
                    </option>
                  ))}
                </select>
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
              {ciudadSinPagina && (
                <p className="adm__msg adm__msg--warn" style={{ marginTop: 10, marginBottom: 0 }}>
                  {nombreCiudad(season?.citySlug)} todavía no tiene página en el sitio. Aquí puedes cargar vuelos,
                  precios y capturar reservas, pero publicar esta temporada no la hace visible en
                  dinnerinthesky.com.mx: esa página hay que construirla y desplegarla.
                </p>
              )}
            </div>
            )}

            <nav className="adm__nav">
              {([
                ['resumen', 'Resumen'],
                ['reservas', 'Reservas'],
                ['puerta', 'Puerta'],
                ['vuelos', 'Vuelos'],
                ['boletos', 'Boletos y extras'],
                ['correo', 'Correo'],
                ['ciudades', 'Sedes'],
                ['temporadas', 'Temporadas'],
                ['promos', 'Promociones'],
                ['bitacora', 'Bitácora'],
                ['config', 'Configuración']
              ] as const)
                // Sin temporada elegida solo tienen sentido las secciones que
                // no dependen de una. Enseñar "Puerta" sin saber de qué vuelo
                // sería una pantalla vacía sin explicación.
                .filter(([clave]) => season || !SECCION_DE_TEMPORADA.has(clave))
                .map(([clave, etiqueta]) => {
                  const Icono = ICONO_SECCION[clave];
                  return (
                    <button
                      key={clave}
                      className={`adm__tab ${tab === clave ? 'adm__tab--on' : ''}`}
                      onClick={() => setTab(clave)}
                    >
                      {Icono && <Icono size={16} />}
                      {etiqueta}
                    </button>
                  );
                })}
            </nav>

            {tab === 'resumen' && season && <StatsPanel seasonId={season.id} />}

            {tab === 'temporadas' && <SeasonsPanel onDone={() => router.refresh()} />}

            {tab === 'puerta' && season && (
              <CheckinPanel seasonId={season.id} timezone={season.timezone} />
            )}

            {tab === 'ciudades' && <CitiesPanel onDone={() => router.refresh()} />}

            {tab === 'bitacora' && <EmailLogPanel />}

            {tab === 'config' && <SettingsPanel />}

            {tab === 'reservas' && season && <BookingsPanel season={season} />}

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

/**
 * Manda el recordatorio a todo un vuelo.
 *
 * Consulta primero cuántos lo recibirían y lo dice antes de enviar: un botón
 * que dispara 22 correos sin avisar es un botón que nadie se atreve a tocar.
 * El servidor ya omite a quien ya lo recibió; aquí solo se muestra.
 */
function BotonRecordatorio({ flightId }: { flightId: string }) {
  const [estado, setEstado] = useState<'listo' | 'consultando' | 'confirmar' | 'enviando'>('listo');
  const [previo, setPrevio] = useState<{ pending: number; alreadySent: number } | null>(null);
  const [resultado, setResultado] = useState('');

  async function consultar() {
    setEstado('consultando');
    setResultado('');

    const response = await fetch(`/api/admin/flights/${flightId}/reminder`);
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setResultado(String(payload?.error ?? 'No se pudo consultar.'));
      setEstado('listo');
      return;
    }
    setPrevio({ pending: Number(payload.pending ?? 0), alreadySent: Number(payload.alreadySent ?? 0) });
    setEstado('confirmar');
  }

  async function enviar() {
    setEstado('enviando');

    const response = await fetch(`/api/admin/flights/${flightId}/reminder`, { method: 'POST' });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setResultado(String(payload?.error ?? 'No se pudo enviar.'));
    } else {
      const fallidos = Number(payload.failed ?? 0);
      setResultado(
        `${payload.sent} enviados` +
          (payload.skippedAlreadySent ? `, ${payload.skippedAlreadySent} ya lo tenían` : '') +
          (fallidos ? `, ${fallidos} fallaron` : '')
      );
    }
    setEstado('listo');
    setPrevio(null);
  }

  if (estado === 'confirmar' && previo) {
    return (
      <span className="adm__row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <span className="adm__muted" style={{ fontSize: 13 }}>
          {previo.pending === 0
            ? `Ya lo recibieron ${previo.alreadySent}`
            : `Enviar a ${previo.pending}`}
        </span>
        {previo.pending > 0 && (
          <button className="adm__btn adm__btn--primary adm__btn--sm" onClick={enviar}>
            Sí
          </button>
        )}
        <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => setEstado('listo')}>
          No
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        className="adm__btn adm__btn--ghost adm__btn--sm"
        onClick={consultar}
        disabled={estado !== 'listo'}
        style={{ marginRight: 6 }}
      >
        {estado === 'enviando' ? 'Enviando…' : estado === 'consultando' ? '…' : 'Recordatorio'}
      </button>
      {resultado && (
        <div className="adm__muted" style={{ fontSize: 12 }}>
          {resultado}
        </div>
      )}
    </>
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
        {flight.bookings > 0 && <BotonRecordatorio flightId={flight.id} />}
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
function BookingsPanel({ season }: { season: SeasonView }) {
  const seasonId = season.id;
  const currency = season.currency;
  const [manual, setManual] = useState(false);
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
        <button
          className={`adm__btn ${manual ? 'adm__btn--ghost' : 'adm__btn--primary'} adm__btn--sm`}
          onClick={() => setManual(!manual)}
        >
          {manual ? 'Cerrar' : 'Capturar reserva'}
        </button>
      </div>

      {manual && (
        <ReservaManual
          season={season}
          onCreada={() => {
            setManual(false);
            cargar();
          }}
        />
      )}

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

                          <AccionesReserva
                            bookingId={id}
                            code={String(b['code'])}
                            status={String(b['status'])}
                            amountCents={Number(b['amountCents'])}
                            notasIniciales={typeof b['internalNotes'] === 'string' ? b['internalNotes'] : ''}
                            motivoCancelacion={typeof b['cancelReason'] === 'string' ? b['cancelReason'] : ''}
                            currency={currency}
                            onCambio={cargar}
                          />
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

/**
 * Portada del panel: elegir sede.
 *
 * Abre con todas las sedes cerradas. Se abre una y entonces aparecen sus
 * temporadas; se elige una temporada y recién ahí se entra a trabajar.
 *
 * El orden importa: el panel no es "el panel de Hermosillo", es el panel de
 * Dinner in the Sky. Entrar directo a una temporada hacía creer lo contrario,
 * y con cinco sedes eso lleva a editar la ciudad equivocada.
 */
function Portada({
  seasons,
  ciudades,
  sedeAbierta,
  onAbrirSede,
  onElegirTemporada,
  onIrA
}: {
  seasons: SeasonView[];
  ciudades: { slug: string; name: string; siteStatus: string }[];
  sedeAbierta: string;
  onAbrirSede: (slug: string) => void;
  onElegirTemporada: (id: string) => void;
  onIrA: (destino: 'ciudades' | 'temporadas' | 'promos' | 'bitacora' | 'config') => void;
}) {
  // Se listan las sedes dadas de alta, más cualquier ciudad que tenga
  // temporadas sin estar en la tabla: si existe una temporada apuntando a un
  // slug desconocido, esconderla dejaría reservas invisibles.
  const huerfanas = [...new Set(seasons.map(s => s.citySlug))].filter(
    slug => !ciudades.some(c => c.slug === slug)
  );

  const sedes = [
    ...ciudades.map(c => ({ slug: c.slug, name: c.name, siteStatus: c.siteStatus })),
    ...huerfanas.map(slug => ({ slug, name: slug, siteStatus: 'PENDING' }))
  ];

  const abiertas = (slug: string) => seasons.filter(s => s.citySlug === slug);

  const ATAJOS = [
    ['ciudades', 'Sedes'],
    ['temporadas', 'Temporadas'],
    ['promos', 'Promociones'],
    ['bitacora', 'Bitácora'],
    ['config', 'Configuración']
  ] as const;

  return (
    <>
      <div className="adm__titulo">
        <span className="adm__titulo-ico">
          <IconoMesa size={21} />
        </span>
        <div>
          <h1>¿Con qué sede trabajamos?</h1>
          <p className="adm__sub" style={{ margin: 0 }}>
            Elige una ciudad y después su temporada.
          </p>
        </div>
      </div>
      <div style={{ height: 22 }} />

      {sedes.length === 0 ? (
        <div className="adm__card adm__vacio">
          <IconoCiudad size={40} />
          <h2>Todavía no hay sedes</h2>
          <p className="adm__muted">Da de alta la primera desde Sedes y después créale su temporada.</p>
          <button className="adm__btn adm__btn--primary" onClick={() => onIrA('ciudades')}>
            Ir a Sedes
          </button>
        </div>
      ) : (
        <div className="adm__sedes">
          {sedes.map(sede => {
            const temporadas = abiertas(sede.slug);
            const abierta = sedeAbierta === sede.slug;
            const vendiendo = temporadas.filter(t => t.status === 'PUBLISHED').length;

            return (
              <div key={sede.slug}>
                <button
                  className={`adm__sede ${abierta ? 'adm__sede--activa' : ''} ${
                    temporadas.length === 0 ? 'adm__sede--muda' : ''
                  }`}
                  onClick={() => onAbrirSede(sede.slug)}
                  style={{ width: '100%' }}
                >
                  <span className="adm__sede-top">
                    <span className="adm__sede-ico">
                      <IconoCiudad size={24} />
                    </span>
                    <span>
                      <span className="adm__sede-nombre" style={{ display: 'block' }}>
                        {sede.name}
                      </span>
                      <span className="adm__sede-slug">/{sede.slug}</span>
                    </span>
                  </span>

                  <span className="adm__sede-pie">
                    {temporadas.length === 0
                      ? 'Sin temporadas'
                      : `${temporadas.length} temporada${temporadas.length === 1 ? '' : 's'}`}
                    {vendiendo > 0 && <span className="adm__chip adm__chip--published">Vendiendo</span>}
                    {sede.siteStatus !== 'LIVE' && <span className="adm__chip adm__chip--draft">Sin página</span>}
                  </span>
                </button>

                {abierta && (
                  <div className="adm__temporadas" style={{ marginTop: 10 }}>
                    {temporadas.length === 0 ? (
                      <p className="adm__muted" style={{ padding: '0 4px' }}>
                        Esta sede no tiene temporadas. Créale una desde Temporadas.
                      </p>
                    ) : (
                      temporadas.map(t => (
                        <button key={t.id} className="adm__temporada" onClick={() => onElegirTemporada(t.id)}>
                          <IconoTemporadas size={18} />
                          <span style={{ flex: 1 }}>
                            <span className="adm__temporada-nombre" style={{ display: 'block' }}>
                              {t.name}
                            </span>
                            <span className="adm__muted">
                              {t.experiences.length} experiencia{t.experiences.length === 1 ? '' : 's'}
                            </span>
                          </span>
                          <span className={`adm__chip adm__chip--${t.status.toLowerCase()}`}>
                            {STATUS_LABEL[t.status] ?? t.status}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="adm__card">
        <h2>Sin entrar a una temporada</h2>
        <p className="adm__muted" style={{ marginTop: -6 }}>
          Estas secciones valen para todas las sedes a la vez.
        </p>
        <nav className="adm__nav" style={{ margin: 0 }}>
          {ATAJOS.map(([clave, etiqueta]) => {
            const Icono = ICONO_SECCION[clave];
            return (
              <button key={clave} className="adm__tab" onClick={() => onIrA(clave)}>
                {Icono && <Icono size={16} />}
                {etiqueta}
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/**
 * Cambio de la propia contraseña.
 *
 * Las cuentas nacen con una contraseña aleatoria que alguien tuvo que mandar
 * por WhatsApp o correo. Sin esta pantalla, esa contraseña se queda viviendo
 * en esa conversación para siempre.
 */
function CambiarClave({ onListo }: { onListo: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const problema =
    nueva.length > 0 && nueva.length < 10
      ? 'La nueva debe tener al menos 10 caracteres.'
      : repetida.length > 0 && nueva !== repetida
        ? 'Las dos contraseñas nuevas no coinciden.'
        : '';

  async function guardar() {
    setEnviando(true);
    setMsg(null);

    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: actual, newPassword: nueva })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setMsg({ kind: 'error', text: String(payload?.error ?? 'No se pudo cambiar.') });
      setEnviando(false);
      return;
    }

    setMsg({ kind: 'ok', text: String(payload.aviso ?? 'Contraseña actualizada.') });
    setActual('');
    setNueva('');
    setRepetida('');
    setEnviando(false);
  }

  return (
    <div className="adm__card">
      <div className="adm__row">
        <h2 style={{ margin: 0 }}>Cambiar mi contraseña</h2>
        <span className="adm__spacer" />
        <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={onListo}>Cerrar</button>
      </div>

      {msg && <div className={`adm__msg adm__msg--${msg.kind}`} style={{ marginTop: 12 }}>{msg.text}</div>}

      <div className="adm__row" style={{ marginTop: 12 }}>
        <input className="adm__input" type="password" autoComplete="current-password" placeholder="Contraseña actual" value={actual} onChange={e => setActual(e.target.value)} />
        <input className="adm__input" type="password" autoComplete="new-password" placeholder="Nueva" value={nueva} onChange={e => setNueva(e.target.value)} />
        <input className="adm__input" type="password" autoComplete="new-password" placeholder="Repite la nueva" value={repetida} onChange={e => setRepetida(e.target.value)} />
        <button
          className="adm__btn adm__btn--primary"
          onClick={guardar}
          disabled={enviando || !actual || nueva.length < 10 || nueva !== repetida}
        >
          {enviando ? 'Guardando…' : 'Cambiar'}
        </button>
      </div>
      {problema && <p className="adm__muted" style={{ marginBottom: 0 }}>{problema}</p>}
    </div>
  );
}

/**
 * Captura de una venta que no entró por la web: teléfono, WhatsApp, mostrador
 * o cortesía.
 *
 * Es lo que permite apagar TuriTop. Mientras Joan no pueda meter aquí la
 * venta que cerró por WhatsApp, tiene que seguir metiéndola allá, y entonces
 * hay dos sistemas peleándose por los mismos 22 asientos.
 *
 * El cobro no pasa por aquí: el dinero ya entró por transferencia, efectivo o
 * es una cortesía. Por eso la nota de cobro es obligatoria — es el único
 * rastro de cómo se pagó algo que no tiene pago en Stripe.
 */
function ReservaManual({ season, onCreada }: { season: SeasonView; onCreada: () => void }) {
  const [experienceId, setExperienceId] = useState(season.experiences[0]?.id ?? '');
  const [flightId, setFlightId] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [promo, setPromo] = useState('');
  const [notaCobro, setNotaCobro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);

  const experiencia = season.experiences.find(e => e.id === experienceId);
  const boletos = experiencia?.ticketTypes.filter(t => t.active) ?? [];

  // Un vuelo que ya salió o está cerrado no admite reservas, y ofrecerlo en
  // la lista solo lleva a un error del servidor después de teclear todo.
  const vuelos = (experiencia?.flights ?? []).filter(
    f => f.status === 'SCHEDULED' && new Date(f.startsAt).getTime() > Date.now()
  );

  const lugares = boletos.reduce(
    (total, t) => total + (t.occupiesSeat ? (cantidades[t.id] ?? 0) : 0),
    0
  );
  const subtotal = boletos.reduce((total, t) => total + t.priceCents * (cantidades[t.id] ?? 0), 0);
  const vuelo = vuelos.find(f => f.id === flightId);
  const libres = vuelo ? vuelo.capacity - vuelo.seatsTaken : 0;

  const dinero = (cents: number) =>
    (cents / 100).toLocaleString('es-MX', { style: 'currency', currency: season.currency, maximumFractionDigits: 0 });

  const hora = (iso: string) =>
    new Intl.DateTimeFormat('es-MX', {
      timeZone: season.timezone,
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(iso));

  const falta =
    !flightId
      ? 'Elige un horario.'
      : lugares === 0
        ? 'Agrega al menos un boleto que ocupe lugar.'
        : lugares > libres
          ? `Ese horario solo tiene ${libres} lugares libres.`
          : nombre.trim().length < 3
            ? 'Escribe el nombre de quien reserva.'
            : !correo.includes('@')
              ? 'Falta un correo válido: ahí llega la confirmación.'
              : notaCobro.trim().length < 3
                ? 'Escribe cómo se cobró (transferencia, efectivo, cortesía).'
                : '';

  async function capturar() {
    setEnviando(true);
    setMsg(null);

    const lines = boletos
      .filter(t => (cantidades[t.id] ?? 0) > 0)
      .map(t => ({ ticketTypeId: t.id, quantity: cantidades[t.id] }));

    const response = await fetch('/api/admin/bookings/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flightId,
        lines,
        customerName: nombre.trim(),
        customerEmail: correo.trim().toLowerCase(),
        customerPhone: telefono.trim() || null,
        promoCode: promo.trim() || null,
        paymentNote: notaCobro.trim()
      })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setMsg({ kind: 'error', text: String(payload?.error ?? 'No se pudo capturar la reserva.') });
      setEnviando(false);
      return;
    }

    const avisos = Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean) : [];
    setMsg({
      kind: avisos.length ? 'warn' : 'ok',
      text: `Reserva ${payload.booking?.code ?? ''} creada.${avisos.length ? ' ' + avisos.join(' ') : ''}`
    });
    setEnviando(false);
    onCreada();
  }

  return (
    <div style={{ background: 'var(--azul-claro)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>Capturar reserva</h3>
      <p className="adm__muted" style={{ marginTop: 0 }}>
        Para ventas por teléfono o WhatsApp y cortesías. Queda confirmada y aparta los lugares de inmediato.
      </p>

      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      <div className="adm__row" style={{ marginBottom: 10 }}>
        <select
          className="adm__input"
          value={experienceId}
          onChange={e => {
            setExperienceId(e.target.value);
            setFlightId('');
            setCantidades({});
          }}
        >
          {season.experiences.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <select className="adm__input" value={flightId} onChange={e => setFlightId(e.target.value)}>
          <option value="">Elige horario…</option>
          {vuelos.map(f => (
            <option key={f.id} value={f.id}>
              {hora(f.startsAt)} · {f.capacity - f.seatsTaken} libres
            </option>
          ))}
        </select>
      </div>

      {vuelos.length === 0 && (
        <p className="adm__muted">Esta experiencia no tiene horarios abiertos por delante.</p>
      )}

      {boletos.length === 0 ? (
        <p className="adm__muted">Esta experiencia todavía no tiene boletos cargados.</p>
      ) : (
        boletos.map(t => (
          <div className="adm__row" key={t.id} style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>
              {t.name} · {dinero(t.priceCents)}
              {!t.occupiesSeat && <span className="adm__muted"> (extra, no ocupa lugar)</span>}
            </span>
            <input
              className="adm__input"
              type="number"
              min={0}
              style={{ width: 90 }}
              value={cantidades[t.id] ?? 0}
              onChange={e =>
                setCantidades({ ...cantidades, [t.id]: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>
        ))
      )}

      <div className="adm__row" style={{ margin: '10px 0' }}>
        <input className="adm__input" style={{ flex: 1 }} placeholder="Nombre de quien reserva" value={nombre} onChange={e => setNombre(e.target.value)} />
        <input className="adm__input" style={{ flex: 1 }} placeholder="Correo" value={correo} onChange={e => setCorreo(e.target.value)} />
        <input className="adm__input" style={{ width: 170 }} placeholder="Teléfono" value={telefono} onChange={e => setTelefono(e.target.value)} />
      </div>

      <div className="adm__row" style={{ marginBottom: 10 }}>
        <input className="adm__input" style={{ width: 200 }} placeholder="Código promocional (opcional)" value={promo} onChange={e => setPromo(e.target.value)} />
        <input className="adm__input" style={{ flex: 1 }} placeholder="Cómo se cobró: transferencia, efectivo, cortesía…" value={notaCobro} onChange={e => setNotaCobro(e.target.value)} />
      </div>

      <div className="adm__row">
        <strong>{lugares} lugares · {dinero(subtotal)}</strong>
        <span className="adm__muted">antes de descuento; el total lo calcula el servidor</span>
        <span className="adm__spacer" />
        <button className="adm__btn adm__btn--primary" onClick={capturar} disabled={enviando || Boolean(falta)}>
          {enviando ? 'Capturando…' : 'Capturar y confirmar'}
        </button>
      </div>
      {falta && <p className="adm__muted" style={{ marginBottom: 0 }}>{falta}</p>}
      <p className="adm__muted" style={{ marginBottom: 0, fontSize: 13 }}>
        Al confirmarse se le manda el correo de confirmación al cliente.
      </p>
    </div>
  );
}

/**
 * Lo que el equipo puede hacer con una reserva ya creada: dejar una nota y
 * cancelarla.
 *
 * La cancelación pide un motivo escrito a propósito. Un reembolso sin motivo
 * es imposible de explicar tres meses después, cuando ya nadie se acuerda de
 * la llamada.
 */
function AccionesReserva({
  bookingId,
  code,
  status,
  amountCents,
  notasIniciales,
  motivoCancelacion,
  currency,
  onCambio
}: {
  bookingId: string;
  code: string;
  status: string;
  amountCents: number;
  notasIniciales: string;
  motivoCancelacion: string;
  currency: string;
  onCambio: () => void;
}) {
  const [notas, setNotas] = useState(notasIniciales);
  const [guardandoNotas, setGuardandoNotas] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [reembolso, setReembolso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const viva = status === 'PENDING' || status === 'CONFIRMED';
  const dinero = (cents: number) =>
    (cents / 100).toLocaleString('es-MX', { style: 'currency', currency, maximumFractionDigits: 2 });

  async function enviar(body: Record<string, unknown>, okText: string) {
    setEnviando(true);
    setMsg(null);

    const response = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setMsg({ kind: 'error', text: String(payload?.error ?? 'No se pudo guardar.') });
    } else {
      setMsg({ kind: 'ok', text: okText });
      onCambio();
    }
    setEnviando(false);
  }

  async function guardarNotas() {
    setGuardandoNotas(true);
    await enviar({ internalNotes: notas }, 'Nota guardada.');
    setGuardandoNotas(false);
  }

  async function cancelar() {
    // El importe se manda en centavos porque es lo único que entiende el
    // backend; aquí se escribe en pesos porque es lo que tiene a la mano
    // quien hizo la devolución.
    const pesos = reembolso.trim() ? Number(reembolso.replace(',', '.')) : 0;
    if (reembolso.trim() && (!Number.isFinite(pesos) || pesos < 0)) {
      setMsg({ kind: 'error', text: 'El reembolso tiene que ser un importe en pesos.' });
      return;
    }

    await enviar(
      { action: 'cancel', reason: motivo.trim(), refundCents: Math.round(pesos * 100) },
      `Reserva ${code} cancelada.`
    );
    setCancelando(false);
    setMotivo('');
    setReembolso('');
  }

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 14 }}>
      {msg && <div className={`adm__msg adm__msg--${msg.kind}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      {!viva && motivoCancelacion && (
        <p className="adm__muted" style={{ marginTop: 0 }}>
          Motivo registrado: {motivoCancelacion}
        </p>
      )}

      <label className="adm__muted" style={{ fontWeight: 700, display: 'block', marginBottom: 6 }}>
        Nota interna
      </label>
      <textarea
        className="adm__input"
        rows={2}
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="Acuerdos por teléfono, avisos para puerta. El cliente no ve esto."
        value={notas}
        onChange={e => setNotas(e.target.value)}
      />
      <div className="adm__row">
        <button
          className="adm__btn adm__btn--ghost adm__btn--sm"
          onClick={guardarNotas}
          disabled={enviando || notas === notasIniciales}
        >
          {guardandoNotas ? 'Guardando…' : 'Guardar nota'}
        </button>
        <span className="adm__spacer" />
        {viva && !cancelando && (
          <button className="adm__btn adm__btn--danger adm__btn--sm" onClick={() => setCancelando(true)}>
            Cancelar reserva
          </button>
        )}
      </div>

      {cancelando && (
        <div style={{ marginTop: 14, padding: 14, background: '#fff', borderRadius: 10 }}>
          <p style={{ marginTop: 0, fontWeight: 700 }}>
            Cancelar {code}: los {status === 'CONFIRMED' ? 'lugares vuelven a la venta' : 'lugares apartados se liberan'}.
          </p>
          <input
            className="adm__input"
            style={{ width: '100%', marginBottom: 8 }}
            placeholder="Motivo (quién pidió la cancelación y por qué)"
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
          />
          {status === 'CONFIRMED' && (
            <>
              <input
                className="adm__input"
                style={{ width: '100%', marginBottom: 6 }}
                placeholder={`Reembolso en pesos (máximo ${dinero(amountCents)}); vacío si no se devolvió dinero`}
                value={reembolso}
                onChange={e => setReembolso(e.target.value)}
              />
              <p className="adm__muted" style={{ marginTop: 0, fontSize: 13 }}>
                Esto solo deja constancia. La devolución del dinero se hace aparte, en Stripe o por donde se cobró.
              </p>
            </>
          )}
          <div className="adm__row">
            <button
              className="adm__btn adm__btn--danger adm__btn--sm"
              onClick={cancelar}
              disabled={enviando || motivo.trim().length < 3}
            >
              {enviando ? 'Cancelando…' : 'Confirmar cancelación'}
            </button>
            <button className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => setCancelando(false)}>
              Mejor no
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Plantilla del correo de confirmación, con vista previa. */
function EmailPanel({ season }: { season: SeasonView }) {
  // Dos correos distintos comparten esta pantalla porque comparten todo lo
  // demás: los mismos marcadores, la misma jerarquía temporada/global y la
  // misma vista previa. Duplicar el panel solo duplicaría los errores.
  const [clave, setClave] = useState<'booking_confirmation' | 'booking_reminder'>('booking_confirmation');
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
      const lista = payload.templates as {
        key: string;
        seasonId: string | null;
        subject: string;
        bodyHtml: string;
      }[];
      const deEsta = lista.filter(t => t.key === clave);
      const propia = deEsta.find(t => t.seasonId === season.id);
      const general = deEsta.find(t => t.seasonId === null);
      const elegida = propia ?? general;

      setPorTemporada(Boolean(propia));

      const ejemplo =
        clave === 'booking_reminder'
          ? {
              subject: 'Mañana vuelas con nosotros, %name% — %time_event%',
              body:
                '<h2>Hola %name%,</h2>\n<p>Te esperamos en <strong>%venue_name%</strong> el %date_event% a las %time_event%.</p>\n<p>Llega 30 minutos antes. Tu reserva es <strong>%booking_id%</strong> para %seats% personas.</p>\n<p>%venue_address%</p>\n<p>Si algo cambia, escríbenos a %company_phone%.</p>'
            }
          : {
              subject: 'Confirmación de vuelo — %date_event% para %name%',
              body:
                '<h2>Hola %name%,</h2>\n<p>Tu reserva <strong>%booking_id%</strong> quedó confirmada.</p>\n<p>%product_name% · %date_event% · %time_event%</p>\n<p>%seats% invitados · %total%</p>\n<p>%venue_name%<br>%venue_address%</p>'
            };

      setSubject(elegida?.subject ?? ejemplo.subject);
      setBodyHtml(elegida?.bodyHtml ?? ejemplo.body);
    })();
  }, [season.id, clave]);

  async function guardar() {
    setGuardando(true);
    setMsg(null);

    const response = await fetch('/api/admin/email-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: clave,
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
      <div className="adm__row" style={{ marginBottom: 2 }}>
        <h2 style={{ margin: 0 }}>Correos automáticos</h2>
        <span className="adm__spacer" />
        <select
          className="adm__input"
          style={{ width: 'auto' }}
          value={clave}
          onChange={e => setClave(e.target.value as 'booking_confirmation' | 'booking_reminder')}
        >
          <option value="booking_confirmation">Confirmación</option>
          <option value="booking_reminder">Recordatorio</option>
        </select>
      </div>
      <p className="adm__muted" style={{ marginTop: 6 }}>
        {clave === 'booking_confirmation'
          ? 'Se envía solo, al confirmarse el pago.'
          : 'Se envía desde la pestaña Vuelos, cuando el equipo lo manda para un horario. No sale solo.'}
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
