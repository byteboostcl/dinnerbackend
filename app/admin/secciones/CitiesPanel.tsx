'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Sedes.
 *
 * Dos cosas que esta pantalla tiene que dejar clarísimas, porque son la causa
 * número uno de confusión al operar sin TuriTop:
 *
 * 1. Dar de alta una ciudad aquí sirve para venderle: temporadas, vuelos,
 *    precios, reservas. Todo eso funciona desde el minuto uno.
 * 2. No la pone en el sitio. La página de una ciudad se construye en el
 *    repositorio del sitio y se despliega. Hasta entonces, publicar su
 *    temporada no la hace visible para nadie.
 *
 * Por eso el estado del sitio se muestra pero no se edita: si fuera una
 * casilla, alguien la marcaría y creería que ya está.
 */

type City = {
  slug: string;
  name: string;
  timezone: string;
  siteStatus: 'LIVE' | 'PENDING';
  position: number;
  active: boolean;
  notes: string | null;
  seasons: number;
};

/** Las zonas que de verdad se usan en México. Sonora no cambia de horario. */
const ZONAS = [
  { valor: 'America/Mexico_City', etiqueta: 'Centro (CDMX, Puebla, Guadalajara)' },
  { valor: 'America/Hermosillo', etiqueta: 'Sonora (Hermosillo, sin horario de verano)' },
  { valor: 'America/Tijuana', etiqueta: 'Pacífico (Tijuana, Ensenada)' },
  { valor: 'America/Monterrey', etiqueta: 'Monterrey' },
  { valor: 'America/Cancun', etiqueta: 'Quintana Roo (Cancún)' },
  { valor: 'America/Merida', etiqueta: 'Yucatán (Mérida)' },
  { valor: 'America/Mazatlan', etiqueta: 'Mazatlán, La Paz' },
  { valor: 'America/Chihuahua', etiqueta: 'Chihuahua' }
] as const;

export function CitiesPanel({ onDone }: { onDone: () => void }) {
  const [cities, setCities] = useState<City[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [alta, setAlta] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const response = await fetch('/api/admin/cities', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(String(payload?.error ?? 'No se pudieron cargar las ciudades.'));
      } else {
        setCities(payload.cities as City[]);
        setError('');
      }
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function editar(slug: string, body: Record<string, unknown>, okText: string) {
    setMsg(null);
    const response = await fetch(`/api/admin/cities/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      setMsg({ kind: 'error', text: String(payload?.error ?? 'No se pudo guardar.') });
      return;
    }
    setMsg(
      typeof payload.warning === 'string' && payload.warning
        ? { kind: 'warn', text: payload.warning }
        : { kind: 'ok', text: okText }
    );
    void cargar();
    onDone();
  }

  return (
    <div>
      {msg && <div className={`adm__msg adm__msg--${msg.kind}`}>{msg.text}</div>}

      <div className="adm__card">
        <div className="adm__row">
          <h2 style={{ margin: 0 }}>Sedes</h2>
          <span className="adm__spacer" />
          <button
            className={`adm__btn ${alta ? 'adm__btn--ghost' : 'adm__btn--primary'} adm__btn--sm`}
            onClick={() => setAlta(!alta)}
          >
            {alta ? 'Cerrar' : '+ Nueva ciudad'}
          </button>
        </div>

        {alta && (
          <NuevaCiudad
            onCreada={(text) => {
              setAlta(false);
              setMsg({ kind: 'warn', text });
              void cargar();
              onDone();
            }}
            onError={text => setMsg({ kind: 'error', text })}
          />
        )}

        {cargando && <p className="adm__muted">Cargando ciudades…</p>}
        {error && <p className="adm__msg adm__msg--error">{error}</p>}

        {!cargando && !error && cities.length === 0 && (
          <p className="adm__muted">Todavía no hay ciudades dadas de alta.</p>
        )}

        {!cargando && cities.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm__table">
              <thead>
                <tr>
                  <th>Ciudad</th>
                  <th>En el sitio</th>
                  <th>Horario</th>
                  <th>Temporadas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cities.map(city => (
                  <tr key={city.slug} style={city.active ? undefined : { opacity: 0.5 }}>
                    <td>
                      <strong>{city.name}</strong>
                      <div className="adm__muted">/{city.slug}</div>
                      {city.notes && <div className="adm__muted">{city.notes}</div>}
                    </td>
                    <td>
                      {city.siteStatus === 'LIVE' ? (
                        <span className="adm__chip adm__chip--published">Publicada</span>
                      ) : (
                        <>
                          <span className="adm__chip adm__chip--draft">Sin página</span>
                          <div className="adm__muted" style={{ maxWidth: 260 }}>
                            Se le puede vender, pero no aparece en el sitio hasta que se construya su página.
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <select
                        className="adm__input"
                        style={{ width: 'auto' }}
                        value={city.timezone}
                        onChange={e => editar(city.slug, { timezone: e.target.value }, 'Zona horaria actualizada.')}
                      >
                        {ZONAS.some(z => z.valor === city.timezone) ? null : (
                          <option value={city.timezone}>{city.timezone}</option>
                        )}
                        {ZONAS.map(z => (
                          <option key={z.valor} value={z.valor}>{z.etiqueta}</option>
                        ))}
                      </select>
                    </td>
                    <td className="adm__muted">{city.seasons || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={`adm__btn adm__btn--sm ${city.active ? 'adm__btn--ghost' : 'adm__btn--primary'}`}
                        onClick={() =>
                          editar(
                            city.slug,
                            { active: !city.active },
                            city.active ? `${city.name} desactivada.` : `${city.name} reactivada.`
                          )
                        }
                      >
                        {city.active ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="adm__muted" style={{ marginBottom: 0 }}>
          Una ciudad no se borra nunca: sus reservas vendidas tienen que poder explicarse después. Si ya no opera,
          se desactiva.
        </p>
      </div>
    </div>
  );
}

function NuevaCiudad({
  onCreada,
  onError
}: {
  onCreada: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState<string>(ZONAS[0].valor);
  const [notes, setNotes] = useState('');
  const [guardando, setGuardando] = useState(false);

  // El slug se propone solo desde el nombre y se puede corregir. Tiene que
  // coincidir exactamente con la ruta que tendrá la página en el sitio.
  const sugerido =
    slug ||
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  async function crear() {
    if (name.trim().length < 3) {
      onError('Escribe el nombre de la ciudad.');
      return;
    }

    setGuardando(true);
    const response = await fetch('/api/admin/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), slug: sugerido, timezone, notes })
    });
    const payload = await response.json().catch(() => null);
    setGuardando(false);

    if (!response.ok || !payload?.ok) {
      onError(String(payload?.error ?? 'No se pudo crear la ciudad.'));
      return;
    }

    setName('');
    setSlug('');
    setNotes('');
    onCreada(`${payload.city.name} creada. ${payload.aviso ?? ''}`);
  }

  return (
    <div style={{ background: 'var(--azul-claro)', borderRadius: 12, padding: 16, margin: '12px 0' }}>
      <div className="adm__row">
        <div className="adm__field">
          <label className="adm__label">Ciudad</label>
          <input className="adm__input" placeholder="Monterrey" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="adm__field">
          <label className="adm__label">Dirección en el sitio</label>
          <input
            className="adm__input"
            placeholder={sugerido || 'monterrey'}
            value={slug}
            onChange={e => setSlug(e.target.value)}
          />
        </div>
        <div className="adm__field">
          <label className="adm__label">Horario local</label>
          <select className="adm__input" value={timezone} onChange={e => setTimezone(e.target.value)}>
            {ZONAS.map(z => (
              <option key={z.valor} value={z.valor}>{z.etiqueta}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="adm__row">
        <div className="adm__field" style={{ flex: 1 }}>
          <label className="adm__label">Nota (opcional)</label>
          <input
            className="adm__input"
            placeholder="Contacto de la sede, pendientes…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
        <button className="adm__btn adm__btn--primary" onClick={crear} disabled={guardando || name.trim().length < 3}>
          {guardando ? 'Creando…' : 'Crear ciudad'}
        </button>
      </div>
      {sugerido && (
        <p className="adm__muted" style={{ marginBottom: 0 }}>
          Vivirá en dinnerinthesky.com.mx/{sugerido} cuando su página esté construida. Mientras tanto se le puede
          cargar temporada, vuelos y precios, y capturar reservas desde el panel.
        </p>
      )}
    </div>
  );
}
