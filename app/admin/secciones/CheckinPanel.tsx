'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type FlightOption = {
  id: string;
  startsAt: string;
  status: string;
  experience: { name: string };
};

type ManifestTicket = {
  id: string;
  passengerName: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
};

type ManifestBooking = {
  id: string;
  code: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  seats: number;
  items: { name: string; quantity: number; seats: number }[];
  preferences: { menu: string | null; allergies: string | null; celebration: string | null } | null;
  internalNotes: string | null;
  invoiceRequested: boolean;
  checkedIn: number;
  pending: number;
  tickets: ManifestTicket[];
};

type Manifest = {
  flight: {
    id: string;
    status: string;
    startsAt: string;
    startsAtLocal: string;
    timezone: string;
    capacity: number;
    seatsTaken: number;
    experience: string;
  };
  summary: { bookings: number; totalSeats: number; checkedIn: number; remaining: number };
  bookings: ManifestBooking[];
  notConfirmed: { code: string; customerName: string; seats: number; status: string; cancelReason: string | null }[];
};

type CheckinResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  alreadyCheckedIn?: boolean;
  marked?: number;
  code?: string;
  customerName?: string;
  seats?: number;
  checkedIn?: number;
  warning?: string | null;
  context?: { code: string; customerName: string; seats: number; checkedIn: number } | null;
};

type Target = { qrToken: string } | { code: string };

type Outcome = {
  tone: 'ok' | 'warn' | 'error';
  headline: string;
  detail: string | null;
  /** Solo si esta acción marcó algo: es lo que "Deshacer" revierte. */
  undo: { target: Target; quantity: number } | null;
};

const ESTADO_NO_CONFIRMADA: Record<string, string> = {
  PENDING: 'Pago pendiente',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Reembolsada',
  EXPIRED: 'Expirada'
};

// Un QR es un UUID más 16 hex (52 caracteres); el código dictado mide 11.
// Cualquier valor largo se trata como QR, el resto como código de reserva.
const QR_MIN_LENGTH = 20;

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatear(fechaIso: string, timeZone: string, soloHora = false): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    ...(soloHora ? {} : { weekday: 'short', day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(fechaIso));
}

async function leerJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error('El servidor respondió algo inesperado. Intenta de nuevo.');
  }
}

export function CheckinPanel({ seasonId, timezone }: { seasonId: string; timezone: string }) {
  const [flights, setFlights] = useState<FlightOption[]>([]);
  const [flightId, setFlightId] = useState('');
  const [flightsLoading, setFlightsLoading] = useState(true);
  const [flightsError, setFlightsError] = useState<string | null>(null);

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [scan, setScan] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Vuelos de la temporada. Se preselecciona el más cercano a "ahora": la
  // noche del evento es el que se va a usar, y evita que el equipo tenga que
  // buscarlo con una mano y bajo presión.
  useEffect(() => {
    let cancelado = false;
    setFlightsLoading(true);
    setFlightsError(null);
    setFlights([]);
    setFlightId('');
    setManifest(null);

    fetch(`/api/admin/flights?seasonId=${encodeURIComponent(seasonId)}`)
      .then(async res => {
        const payload = await leerJson<{ ok: boolean; error?: string; flights?: FlightOption[] }>(res);
        if (!res.ok || !payload.ok || !payload.flights) throw new Error(payload.error ?? 'No se pudieron cargar los vuelos.');
        if (cancelado) return;
        setFlights(payload.flights);
        const ahora = Date.now();
        const cercano = payload.flights
          .filter(f => f.status !== 'CANCELLED')
          .sort((a, b) => Math.abs(new Date(a.startsAt).getTime() - ahora) - Math.abs(new Date(b.startsAt).getTime() - ahora))[0];
        if (cercano) setFlightId(cercano.id);
      })
      .catch(e => {
        if (!cancelado) setFlightsError(e instanceof Error ? e.message : 'No se pudieron cargar los vuelos.');
      })
      .finally(() => {
        if (!cancelado) setFlightsLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [seasonId]);

  const cargarManifiesto = useCallback(
    async (silencioso: boolean) => {
      if (!flightId) return;
      if (!silencioso) setManifestLoading(true);
      try {
        const res = await fetch(`/api/admin/flights/${encodeURIComponent(flightId)}/manifest`);
        const payload = await leerJson<{ ok: boolean; error?: string } & Partial<Manifest>>(res);
        if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'No se pudo cargar el manifiesto.');
        setManifest(payload as Manifest);
        setManifestError(null);
      } catch (e) {
        // En un refresco silencioso un error de red no debe borrar la lista
        // que el equipo está usando; solo se avisa.
        setManifestError(e instanceof Error ? e.message : 'No se pudo cargar el manifiesto.');
      } finally {
        if (!silencioso) setManifestLoading(false);
      }
    },
    [flightId]
  );

  useEffect(() => {
    setManifest(null);
    setOutcome(null);
    cargarManifiesto(false);
    // Varios teléfonos marcan a la vez en puerta: el refresco periódico evita
    // que uno vea "faltan" lugares que otro ya abordó.
    const id = setInterval(() => cargarManifiesto(true), 20000);
    return () => clearInterval(id);
  }, [cargarManifiesto]);

  async function enviar(method: 'POST' | 'DELETE', target: Target, cantidad: number | null, passengerName?: string) {
    const res = await fetch('/api/admin/checkin', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...target,
        ...('code' in target && cantidad !== null ? { quantity: cantidad } : {}),
        ...(passengerName ? { passengerName } : {})
      })
    });
    return leerJson<CheckinResponse>(res);
  }

  async function marcar(target: Target, cantidad: number, passengerName?: string) {
    setBusy(true);
    try {
      const r = await enviar('POST', target, cantidad, passengerName);
      const ctx = r.ok ? r : r.context;
      const quien = ctx?.customerName ? `${ctx.customerName} · ${ctx.code}` : (r.error ?? 'Error');
      const avance = ctx && ctx.checkedIn !== undefined ? `${ctx.checkedIn} de ${ctx.seats} abordados en esta reserva` : null;

      if (!r.ok) {
        setOutcome({ tone: 'error', headline: r.error ?? 'No se pudo marcar.', detail: ctx?.customerName ? quien : null, undo: null });
      } else if (r.alreadyCheckedIn) {
        setOutcome({ tone: 'warn', headline: r.message ?? 'Ya tenía check-in.', detail: [quien, avance].filter(Boolean).join(' · '), undo: null });
      } else {
        setOutcome({
          tone: 'ok',
          headline: `Abordó: ${r.customerName ?? ''}`,
          detail: [r.code, avance, r.warning].filter(Boolean).join(' · '),
          undo: { target, quantity: r.marked ?? cantidad }
        });
        setQuantity(1);
      }
      await cargarManifiesto(true);
    } catch (e) {
      setOutcome({ tone: 'error', headline: e instanceof Error ? e.message : 'No se pudo marcar.', detail: null, undo: null });
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  async function deshacer(target: Target, cantidad: number) {
    setBusy(true);
    try {
      const r = await enviar('DELETE', target, cantidad);
      setOutcome({
        tone: r.ok ? 'warn' : 'error',
        headline: r.ok ? (r.message ?? 'Check-in deshecho.') : (r.error ?? 'No se pudo deshacer.'),
        detail: r.ok && r.customerName ? `${r.customerName} · ${r.code}` : null,
        undo: null
      });
      await cargarManifiesto(true);
    } catch (e) {
      setOutcome({ tone: 'error', headline: e instanceof Error ? e.message : 'No se pudo deshacer.', detail: null, undo: null });
    } finally {
      setBusy(false);
      scanRef.current?.focus();
    }
  }

  function enviarEscaneo(event: React.FormEvent) {
    event.preventDefault();
    const valor = scan.trim();
    if (!valor || busy) return;
    setScan('');
    const target: Target = valor.length > QR_MIN_LENGTH ? { qrToken: valor } : { code: valor };
    marcar(target, quantity);
  }

  const visibles = useMemo(() => {
    if (!manifest) return [];
    const q = sinAcentos(search.trim());
    if (!q) return manifest.bookings;
    return manifest.bookings.filter(b =>
      [b.customerName, b.code, b.customerEmail, b.customerPhone ?? '', ...b.tickets.map(t => t.passengerName ?? '')].some(campo =>
        sinAcentos(campo).includes(q)
      )
    );
  }, [manifest, search]);

  if (flightsLoading) return <div className="adm__muted">Cargando vuelos…</div>;
  if (flightsError) return <div className="adm__msg adm__msg--error">{flightsError}</div>;
  if (flights.length === 0) return <div className="adm__muted">Esta temporada aún no tiene vuelos.</div>;

  const resumen = manifest?.summary;
  const porcentaje = resumen && resumen.totalSeats > 0 ? Math.round((resumen.checkedIn / resumen.totalSeats) * 100) : 0;

  return (
    <div>
      <div className="adm__card">
        <div className="adm__row">
          <select
            className="adm__input"
            style={{ flex: 1, minWidth: 220, fontSize: 16, minHeight: 48 }}
            value={flightId}
            onChange={e => setFlightId(e.target.value)}
            aria-label="Vuelo"
          >
            {flights.map(f => (
              <option key={f.id} value={f.id}>
                {formatear(f.startsAt, timezone)} · {f.experience.name}
                {f.status !== 'SCHEDULED' ? ` (${f.status === 'CANCELLED' ? 'cancelado' : 'cerrado'})` : ''}
              </option>
            ))}
          </select>
          <button className="adm__btn adm__btn--ghost" style={{ minHeight: 48 }} onClick={() => cargarManifiesto(false)} disabled={manifestLoading}>
            Actualizar
          </button>
        </div>

        {resumen && (
          <div style={{ marginTop: 16 }}>
            <div className="adm__row">
              <strong style={{ fontSize: 36, lineHeight: 1.1 }}>
                {resumen.checkedIn} de {resumen.totalSeats} abordados
              </strong>
              <div className="adm__spacer" />
              <span className="adm__muted">
                Faltan {resumen.remaining} · {resumen.bookings} reservas
              </span>
            </div>
            <div className="adm__bar-track" style={{ height: 12, marginTop: 10 }}>
              <div
                className={`adm__bar-fill${resumen.remaining === 0 && resumen.totalSeats > 0 ? ' adm__bar-fill--full' : ''}`}
                style={{ width: `${porcentaje}%` }}
              />
            </div>
            {manifest.flight.status !== 'SCHEDULED' && (
              <div className="adm__msg adm__msg--warn" style={{ marginTop: 12, marginBottom: 0 }}>
                Este vuelo está {manifest.flight.status === 'CANCELLED' ? 'CANCELADO' : 'cerrado a la venta'}.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="adm__card">
        <form onSubmit={enviarEscaneo}>
          <label className="adm__label" htmlFor="checkin-scan">
            Escanea el QR o escribe el código
          </label>
          <div className="adm__row">
            <input
              id="checkin-scan"
              ref={scanRef}
              className="adm__input"
              style={{ flex: 1, minWidth: 200, fontSize: 20, minHeight: 56 }}
              placeholder="DITS-XXXXXX"
              value={scan}
              onChange={e => setScan(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={!manifest}
            />
            <input
              className="adm__input adm__input--seats"
              style={{ minHeight: 56, fontSize: 20 }}
              type="number"
              min={1}
              value={quantity}
              onChange={e => setQuantity(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
              aria-label="Boletos a marcar por código"
              title="Boletos a marcar cuando se captura el código"
            />
            <button className="adm__btn adm__btn--primary" style={{ minHeight: 56, fontSize: 16, padding: '0 28px' }} type="submit" disabled={busy || !scan.trim() || !manifest}>
              Marcar
            </button>
          </div>
        </form>

        {outcome && (
          <div className={`adm__msg adm__msg--${outcome.tone}`} style={{ marginTop: 14, marginBottom: 0 }} role="status">
            <div style={{ fontSize: 20, fontWeight: 800 }}>{outcome.headline}</div>
            {outcome.detail && <div style={{ marginTop: 4 }}>{outcome.detail}</div>}
            {outcome.undo && (
              <button
                className="adm__btn adm__btn--danger"
                style={{ marginTop: 10, minHeight: 48 }}
                disabled={busy}
                onClick={() => outcome.undo && deshacer(outcome.undo.target, outcome.undo.quantity)}
              >
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>

      {manifestError && <div className="adm__msg adm__msg--error">{manifestError}</div>}
      {manifestLoading && !manifest && <div className="adm__muted">Cargando manifiesto…</div>}

      {manifest && (
        <>
          <input
            className="adm__input"
            style={{ minHeight: 52, fontSize: 16, marginBottom: 18 }}
            placeholder="Buscar por nombre, código, correo o teléfono"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Buscar en el manifiesto"
          />

          {manifest.bookings.length === 0 ? (
            <div className="adm__card adm__muted">Este vuelo no tiene reservas confirmadas.</div>
          ) : visibles.length === 0 ? (
            <div className="adm__card adm__muted">Nadie coincide con “{search}”.</div>
          ) : (
            visibles.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                timezone={manifest.flight.timezone}
                busy={busy}
                onMark={cantidad => marcar({ code: b.code }, cantidad)}
                onUndo={() => deshacer({ code: b.code }, 1)}
              />
            ))
          )}

          {manifest.notConfirmed.length > 0 && (
            <details className="adm__card">
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                Sin derecho a entrar ({manifest.notConfirmed.length}) — no cuentan como asistentes
              </summary>
              <table className="adm__table" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Código</th>
                    <th>Lugares</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.notConfirmed.map(n => (
                    <tr key={n.code}>
                      <td>{n.customerName}</td>
                      <td>{n.code}</td>
                      <td>{n.seats}</td>
                      <td>
                        <span className="adm__chip adm__chip--closed">{ESTADO_NO_CONFIRMADA[n.status] ?? n.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function BookingCard({
  booking: b,
  timezone,
  busy,
  onMark,
  onUndo
}: {
  booking: ManifestBooking;
  timezone: string;
  busy: boolean;
  onMark: (cantidad: number) => void;
  onUndo: () => void;
}) {
  const completo = b.pending === 0;
  const prefs = b.preferences;
  const ultimo = b.tickets
    .filter(t => t.checkedInAt)
    .sort((x, y) => String(y.checkedInAt).localeCompare(String(x.checkedInAt)))[0];

  return (
    <div className="adm__card" style={completo ? { opacity: 0.75 } : undefined}>
      <div className="adm__row">
        <strong style={{ fontSize: 20 }}>{b.customerName}</strong>
        <span className="adm__chip adm__chip--draft">{b.code}</span>
        <div className="adm__spacer" />
        <strong style={{ fontSize: 18 }}>
          {b.checkedIn} de {b.seats}
        </strong>
        {completo && <span className="adm__chip adm__chip--published">Completo</span>}
      </div>

      <div className="adm__muted" style={{ marginTop: 6 }}>
        {b.customerPhone ? `${b.customerPhone} · ` : ''}
        {b.customerEmail}
        {b.invoiceRequested ? ' · Pidió factura' : ''}
      </div>

      {b.items.length > 0 && (
        <div className="adm__muted" style={{ marginTop: 4 }}>
          {b.items.map(i => `${i.quantity} × ${i.name}`).join(' · ')}
        </div>
      )}

      {prefs?.allergies && (
        <div className="adm__msg adm__msg--error" style={{ marginTop: 10, marginBottom: 0, fontWeight: 700 }}>
          ALERGIAS: {prefs.allergies}
        </div>
      )}
      {(prefs?.menu || prefs?.celebration) && (
        <div className="adm__muted" style={{ marginTop: 6 }}>
          {prefs.menu ? `Menú: ${prefs.menu}` : ''}
          {prefs.menu && prefs.celebration ? ' · ' : ''}
          {prefs.celebration ? `Celebra: ${prefs.celebration}` : ''}
        </div>
      )}
      {b.internalNotes && (
        <div className="adm__msg adm__msg--warn" style={{ marginTop: 10, marginBottom: 0 }}>
          Nota: {b.internalNotes}
        </div>
      )}

      {ultimo?.checkedInAt && (
        <div className="adm__muted" style={{ marginTop: 6 }}>
          Último check-in {formatear(ultimo.checkedInAt, timezone, true)}
          {ultimo.checkedInBy ? ` por ${ultimo.checkedInBy}` : ''}
        </div>
      )}

      <div className="adm__row" style={{ marginTop: 12 }}>
        {!completo && (
          <button className="adm__btn adm__btn--primary" style={{ minHeight: 52, fontSize: 16, padding: '0 24px' }} disabled={busy} onClick={() => onMark(1)}>
            Marcar 1
          </button>
        )}
        {b.pending > 1 && (
          <button className="adm__btn adm__btn--primary" style={{ minHeight: 52, fontSize: 16, padding: '0 24px' }} disabled={busy} onClick={() => onMark(b.pending)}>
            Marcar todos ({b.pending})
          </button>
        )}
        {b.checkedIn > 0 && (
          <button className="adm__btn adm__btn--danger" style={{ minHeight: 52, fontSize: 16, padding: '0 24px' }} disabled={busy} onClick={onUndo}>
            Deshacer 1
          </button>
        )}
      </div>
    </div>
  );
}
