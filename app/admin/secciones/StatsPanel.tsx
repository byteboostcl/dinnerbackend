'use client';

import { useEffect, useState } from 'react';

type Stats = {
  totals: { bookings: number; seats: number; amountCents: number; discountCents: number };
  occupancy: { seatsSold: number; capacity: number; percent: number };
  salesByDay: { date: string; bookings: number; amountCents: number }[];
  topPromoCodes: { code: string | null; uses: number; discountCents: number }[];
  byExperience: { name: string; bookings: number; seats: number; amountCents: number }[];
};

const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const pesos = (centavos: number) => moneda.format(centavos / 100);

export function StatsPanel({ seasonId }: { seasonId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/stats?seasonId=${encodeURIComponent(seasonId)}`)
      .then(async res => {
        const payload = await res.json();
        if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'No se pudo cargar el resumen.');
        if (!cancelado) setStats(payload as Stats);
      })
      .catch(e => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo cargar el resumen.');
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [seasonId]);

  if (loading) return <div className="adm__muted">Cargando resumen…</div>;
  if (error) return <div className="adm__muted">{error}</div>;
  if (!stats) return <div className="adm__muted">Sin datos para esta temporada.</div>;

  const maxDia = Math.max(1, ...stats.salesByDay.map(d => d.amountCents));
  const tarjetas = [
    { label: 'Reservas confirmadas', value: String(stats.totals.bookings) },
    { label: 'Lugares vendidos', value: String(stats.totals.seats) },
    { label: 'Importe total', value: pesos(stats.totals.amountCents) },
    { label: 'Descuento total', value: pesos(stats.totals.discountCents) }
  ];

  return (
    <div>
      <div className="adm__row">
        {tarjetas.map(t => (
          <div key={t.label} className="adm__card">
            <div className="adm__muted">{t.label}</div>
            <strong>{t.value}</strong>
          </div>
        ))}
        <div className="adm__spacer" />
        <a
          className="adm__btn adm__btn--primary"
          href={`/api/admin/bookings/export?seasonId=${encodeURIComponent(seasonId)}`}
        >
          Descargar Excel
        </a>
      </div>

      <div className="adm__card">
        <div className="adm__row">
          <strong>Ocupación</strong>
          <div className="adm__spacer" />
          <span className="adm__muted">
            {stats.occupancy.seatsSold} de {stats.occupancy.capacity} lugares · {stats.occupancy.percent}%
          </span>
        </div>
        <div className="adm__bar-track">
          <div className="adm__bar-fill" style={{ width: `${Math.min(100, stats.occupancy.percent)}%` }} />
        </div>
      </div>

      <div className="adm__card">
        <strong>Ventas de los últimos 30 días</strong>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, marginTop: 12 }}>
          {stats.salesByDay.map(d => (
            <div
              key={d.date}
              title={`${d.date}: ${pesos(d.amountCents)} (${d.bookings} reservas)`}
              style={{
                flex: 1,
                height: `${(d.amountCents / maxDia) * 100}%`,
                minHeight: d.amountCents > 0 ? 2 : 0,
                background: 'currentColor',
                opacity: 0.7
              }}
            />
          ))}
        </div>
      </div>

      <div className="adm__card">
        <strong>Por experiencia</strong>
        {stats.byExperience.length === 0 ? (
          <div className="adm__muted">Aún no hay reservas confirmadas.</div>
        ) : (
          <table className="adm__table">
            <thead>
              <tr>
                <th>Experiencia</th>
                <th>Reservas</th>
                <th>Lugares</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {stats.byExperience.map(e => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td>{e.bookings}</td>
                  <td>{e.seats}</td>
                  <td>{pesos(e.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="adm__card">
        <strong>Códigos promocionales más usados</strong>
        {stats.topPromoCodes.length === 0 ? (
          <div className="adm__muted">Ninguna reserva confirmada usó código.</div>
        ) : (
          <table className="adm__table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Usos</th>
                <th>Descuento</th>
              </tr>
            </thead>
            <tbody>
              {stats.topPromoCodes.map(p => (
                <tr key={p.code}>
                  <td>
                    <span className="adm__chip">{p.code}</span>
                  </td>
                  <td>{p.uses}</td>
                  <td>{pesos(p.discountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
