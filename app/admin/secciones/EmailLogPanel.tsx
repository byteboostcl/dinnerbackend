'use client';

import { Fragment, useEffect, useState } from 'react';

type Registro = {
  id: string;
  kind: string;
  toEmail: string;
  subject: string;
  ok: boolean;
  providerId: string | null;
  error: string | null;
  sentBy: string | null;
  createdAt: string;
  booking: { id: string; code: string; customerName: string; timezone: string } | null;
};

type Respuesta = {
  page: number;
  pageSize: number;
  total: number;
  failed: number;
  logs: Registro[];
};

type Filtros = { q: string; kind: string; status: string; from: string; to: string };

const FILTROS_VACIOS: Filtros = { q: '', kind: 'all', status: 'all', from: '', to: '' };

const TIPOS: Record<string, string> = {
  booking_confirmation: 'Confirmación',
  booking_reminder: 'Recordatorio',
  test: 'Prueba'
};

/**
 * Los envíos con reserva se muestran en la zona de su temporada. Los que no
 * tienen reserva (pruebas) no pertenecen a ninguna temporada: se muestran en
 * UTC y se rotulan así para no aparentar una hora local que no existe.
 */
function fechaEnvio(iso: string, timezone: string | null): string {
  const texto = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone ?? 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso));
  return timezone ? texto : `${texto} UTC`;
}

export function EmailLogPanel() {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  // Lo escrito en los campos no consulta hasta pulsar Buscar: cada tecla
  // sería una petición a la base.
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_VACIOS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page) });
    if (aplicados.q) params.set('q', aplicados.q);
    if (aplicados.kind !== 'all') params.set('kind', aplicados.kind);
    if (aplicados.status !== 'all') params.set('status', aplicados.status);
    if (aplicados.from) params.set('from', aplicados.from);
    if (aplicados.to) params.set('to', aplicados.to);

    fetch(`/api/admin/email-logs?${params.toString()}`)
      .then(async res => {
        const payload = await res.json();
        if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'No se pudo cargar la bitácora.');
        if (!cancelado) setData(payload as Respuesta);
      })
      .catch(e => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo cargar la bitácora.');
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [aplicados, page]);

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAplicados({ ...filtros, q: filtros.q.trim() });
  };

  const limpiar = () => {
    setFiltros(FILTROS_VACIOS);
    setAplicados(FILTROS_VACIOS);
    setPage(1);
  };

  const campo = (clave: keyof Filtros) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFiltros(f => ({ ...f, [clave]: e.target.value }));

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <form className="adm__card" onSubmit={buscar}>
        <div className="adm__row">
          <label className="adm__field" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
            <span className="adm__label">Correo o código de reserva</span>
            <input
              className="adm__input"
              type="search"
              value={filtros.q}
              onChange={campo('q')}
              placeholder="maria@ejemplo.com o DITS-7F3K2A"
            />
          </label>
          <label className="adm__field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <span className="adm__label">Tipo</span>
            <select className="adm__input" value={filtros.kind} onChange={campo('kind')}>
              <option value="all">Todos</option>
              <option value="booking_confirmation">Confirmación</option>
              <option value="booking_reminder">Recordatorio</option>
              <option value="test">Prueba</option>
            </select>
          </label>
          <label className="adm__field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <span className="adm__label">Estado</span>
            <select className="adm__input" value={filtros.status} onChange={campo('status')}>
              <option value="all">Todos</option>
              <option value="ok">Aceptados</option>
              <option value="failed">Fallidos</option>
            </select>
          </label>
          <label className="adm__field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <span className="adm__label">Desde</span>
            <input className="adm__input" type="date" value={filtros.from} onChange={campo('from')} />
          </label>
          <label className="adm__field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <span className="adm__label">Hasta</span>
            <input className="adm__input" type="date" value={filtros.to} onChange={campo('to')} />
          </label>
        </div>
        <div className="adm__row" style={{ marginTop: 14 }}>
          <button type="submit" className="adm__btn adm__btn--primary" disabled={loading}>
            Buscar
          </button>
          <button type="button" className="adm__btn adm__btn--ghost" onClick={limpiar} disabled={loading}>
            Limpiar
          </button>
          <div className="adm__spacer" />
          {data && (
            <span className="adm__muted">
              {data.total} envíos · {data.failed} fallidos
            </span>
          )}
        </div>
      </form>

      {loading && <div className="adm__muted">Cargando bitácora…</div>}
      {!loading && error && <div className="adm__msg adm__msg--error">{error}</div>}

      {!loading && !error && data && data.logs.length === 0 && (
        <div className="adm__card adm__muted">No hay envíos que coincidan con la búsqueda.</div>
      )}

      {!loading && !error && data && data.logs.length > 0 && (
        <div className="adm__card">
          <div style={{ overflowX: 'auto' }}>
            <table className="adm__table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Reserva</th>
                  <th>Destinatario</th>
                  <th>Asunto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(l => (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="adm__time">{fechaEnvio(l.createdAt, l.booking?.timezone ?? null)}</td>
                      <td>{TIPOS[l.kind] ?? l.kind}</td>
                      <td>{l.booking ? <span className="adm__chip adm__chip--draft">{l.booking.code}</span> : '—'}</td>
                      <td>{l.toEmail}</td>
                      <td>{l.subject || <span className="adm__muted">Sin asunto: no se llegó a generar</span>}</td>
                      <td>
                        <span className={`adm__chip ${l.ok ? 'adm__chip--published' : 'adm__chip--closed'}`}>
                          {l.ok ? 'Aceptado' : 'Falló'}
                        </span>
                        {l.ok && l.providerId && <div className="adm__muted">Resend: {l.providerId}</div>}
                        {l.sentBy && <div className="adm__muted">Por {l.sentBy}</div>}
                      </td>
                    </tr>
                    {l.error && (
                      <tr>
                        <td colSpan={6}>
                          <div className="adm__msg adm__msg--error" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {l.error}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm__row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="adm__btn adm__btn--ghost adm__btn--sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Anterior
            </button>
            <span className="adm__muted">
              Página {data.page} de {totalPaginas}
            </span>
            <button
              type="button"
              className="adm__btn adm__btn--ghost adm__btn--sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPaginas}
            >
              Siguiente
            </button>
            <div className="adm__spacer" />
            <span className="adm__muted">&quot;Aceptado&quot; significa que Resend lo recibió, no que ya llegó a la bandeja.</span>
          </div>
        </div>
      )}
    </div>
  );
}
