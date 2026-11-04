'use client';

import { useCallback, useEffect, useState } from 'react';

type ExperienceView = {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  position: number;
};

type SeasonView = {
  id: string;
  citySlug: string;
  name: string;
  venueName: string | null;
  startsOn: string;
  endsOn: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  experiences: ExperienceView[];
};

type Message = { kind: 'ok' | 'error'; text: string };

type ExperienceDraft = { name: string; pesos: string };

type CityOption = {
  slug: string;
  name: string;
  timezone: string;
  siteStatus: 'LIVE' | 'PENDING';
  active: boolean;
};

const ESTADOS: Record<SeasonView['status'], string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  CLOSED: 'Cerrada'
};

const pesosACentavos = (pesos: string): number => Math.round(Number(pesos) * 100);
const centavosAPesos = (cents: number): string => (cents / 100).toFixed(2);
const pesosValidos = (pesos: string): boolean => Number.isFinite(Number(pesos)) && pesosACentavos(pesos) > 0;
const fecha = (iso: string): string => iso.slice(0, 10);

async function enviar(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) return { ok: false, error: String(payload.error ?? 'No se pudo guardar.') };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
}

export function SeasonsPanel({ onDone }: { onDone: () => void }) {
  const [seasons, setSeasons] = useState<SeasonView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/seasons', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        setLoadError(String(payload.error ?? 'No se pudieron cargar las temporadas.'));
      } else {
        setSeasons(payload.seasons as SeasonView[]);
        setLoadError(null);
      }
    } catch {
      setLoadError('No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Se recarga la lista propia y se avisa al padre para que refresque el resto.
  function terminado(text: string) {
    setMessage({ kind: 'ok', text });
    void load();
    onDone();
  }

  return (
    <div>
      {message ? <p className={`adm__msg adm__msg--${message.kind}`}>{message.text}</p> : null}

      <NewSeasonForm onCreated={terminado} onError={text => setMessage({ kind: 'error', text })} />

      <div className="adm__spacer" />

      {loading ? <p className="adm__muted">Cargando temporadas…</p> : null}
      {loadError ? <p className="adm__msg adm__msg--error">{loadError}</p> : null}
      {!loading && !loadError && seasons.length === 0 ? (
        <p className="adm__muted">Todavía no hay temporadas. Crea la primera con el formulario de arriba.</p>
      ) : null}

      {seasons.map(season => (
        <SeasonCard
          key={season.id}
          season={season}
          onSaved={terminado}
          onError={text => setMessage({ kind: 'error', text })}
        />
      ))}
    </div>
  );
}

function NewSeasonForm({ onCreated, onError }: { onCreated: (text: string) => void; onError: (text: string) => void }) {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [citySlug, setCitySlug] = useState('');
  const [name, setName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  // La zona sale de la ciudad y no se teclea: equivocarla corre todos los
  // vuelos de la temporada, y es un error que nadie nota hasta que alguien
  // llega una hora tarde.
  const [timezone, setTimezone] = useState<string>('America/Mexico_City');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [experiences, setExperiences] = useState<ExperienceDraft[]>([{ name: '', pesos: '' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const response = await fetch('/api/admin/cities', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (!payload?.ok) return;

      const lista = (payload.cities as CityOption[]).filter(c => c.active);
      setCities(lista);
      if (lista[0]) {
        setCitySlug(lista[0].slug);
        setTimezone(lista[0].timezone);
      }
    })();
  }, []);

  const ciudad = cities.find(c => c.slug === citySlug);

  function elegirCiudad(slug: string) {
    setCitySlug(slug);
    const elegida = cities.find(c => c.slug === slug);
    if (elegida) setTimezone(elegida.timezone);
  }

  function cambiarExperiencia(index: number, cambio: Partial<ExperienceDraft>) {
    setExperiences(list => list.map((item, i) => (i === index ? { ...item, ...cambio } : item)));
  }

  async function crear() {
    if (!citySlug.trim() || !name.trim() || !startsOn || !endsOn) {
      onError('Completa ciudad, nombre y las fechas de inicio y fin.');
      return;
    }
    if (experiences.some(e => !e.name.trim() || !pesosValidos(e.pesos))) {
      onError('Cada experiencia necesita nombre y un precio en pesos mayor a cero.');
      return;
    }

    setSaving(true);
    const result = await enviar('/api/admin/seasons', 'POST', {
      citySlug: citySlug.trim().toLowerCase(),
      name: name.trim(),
      venueName,
      venueAddress,
      timezone,
      startsOn,
      endsOn,
      // Los precios se capturan en pesos y la base solo guarda centavos.
      experiences: experiences.map(e => ({
        slug: e.name
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
        name: e.name.trim(),
        priceCents: pesosACentavos(e.pesos)
      }))
    });
    setSaving(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }

    // La ciudad se queda elegida: quien acaba de crear la temporada de una
    // sede casi siempre va a crear otra de la misma.
    setName('');
    setVenueName('');
    setVenueAddress('');
    setStartsOn('');
    setEndsOn('');
    setExperiences([{ name: '', pesos: '' }]);
    onCreated('Temporada creada en borrador. Genera sus vuelos antes de publicarla.');
  }

  return (
    <div className="adm__card">
      <h2>Nueva temporada</h2>
      <div className="adm__row">
        <div className="adm__field">
          <label className="adm__label">Ciudad</label>
          <select className="adm__input" value={citySlug} onChange={e => elegirCiudad(e.target.value)}>
            {cities.length === 0 && <option value="">Cargando…</option>}
            {cities.map(c => (
              <option key={c.slug} value={c.slug}>
                {c.name}
                {c.siteStatus === 'PENDING' ? ' — sin página' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="adm__field">
          <label className="adm__label">Nombre de la temporada</label>
          <input
            className="adm__input"
            placeholder="Hermosillo marzo 2027"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="adm__field">
          <label className="adm__label">Horario local</label>
          <input className="adm__input" value={timezone} readOnly disabled />
        </div>
      </div>

      {ciudad?.siteStatus === 'PENDING' && (
        <p className="adm__msg adm__msg--warn">
          {ciudad.name} todavía no tiene página en el sitio. Puedes cargarle la temporada, los vuelos y los precios,
          y capturar reservas desde el panel, pero publicarla no la hace visible en dinnerinthesky.com.mx hasta que
          su página esté construida y desplegada.
        </p>
      )}
      <div className="adm__row">
        <div className="adm__field">
          <label className="adm__label">Sede</label>
          <input className="adm__input" value={venueName} onChange={e => setVenueName(e.target.value)} />
        </div>
        <div className="adm__field">
          <label className="adm__label">Dirección</label>
          <input className="adm__input" value={venueAddress} onChange={e => setVenueAddress(e.target.value)} />
        </div>
      </div>
      <div className="adm__row">
        <div className="adm__field">
          <label className="adm__label">Fecha de inicio</label>
          <input className="adm__input" type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} />
        </div>
        <div className="adm__field">
          <label className="adm__label">Fecha de fin</label>
          <input className="adm__input" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} />
        </div>
      </div>

      <h3>Experiencias</h3>
      {experiences.map((item, index) => (
        <div className="adm__row" key={index}>
          <div className="adm__field">
            <label className="adm__label">Nombre</label>
            <input
              className="adm__input"
              value={item.name}
              onChange={e => cambiarExperiencia(index, { name: e.target.value })}
            />
          </div>
          <div className="adm__field">
            <label className="adm__label">Precio por persona (MXN)</label>
            <input
              className="adm__input"
              type="number"
              min="0"
              step="0.01"
              value={item.pesos}
              onChange={e => cambiarExperiencia(index, { pesos: e.target.value })}
            />
          </div>
          {experiences.length > 1 ? (
            <button
              type="button"
              className="adm__btn adm__btn--ghost adm__btn--sm"
              onClick={() => setExperiences(list => list.filter((_, i) => i !== index))}
            >
              Quitar
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="adm__btn adm__btn--ghost adm__btn--sm"
        onClick={() => setExperiences(list => [...list, { name: '', pesos: '' }])}
      >
        Agregar otra experiencia
      </button>

      <div className="adm__spacer" />
      <button type="button" className="adm__btn adm__btn--primary" disabled={saving} onClick={() => void crear()}>
        {saving ? 'Creando…' : 'Crear temporada'}
      </button>
    </div>
  );
}

function SeasonCard({
  season,
  onSaved,
  onError
}: {
  season: SeasonView;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [nuevo, setNuevo] = useState<ExperienceDraft | null>(null);
  const [saving, setSaving] = useState(false);

  async function agregar() {
    if (!nuevo) return;
    if (!nuevo.name.trim() || !pesosValidos(nuevo.pesos)) {
      onError('La experiencia necesita nombre y un precio en pesos mayor a cero.');
      return;
    }

    setSaving(true);
    const result = await enviar('/api/admin/experiences', 'POST', {
      seasonId: season.id,
      name: nuevo.name.trim(),
      priceCents: pesosACentavos(nuevo.pesos)
    });
    setSaving(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }
    setNuevo(null);
    onSaved('Experiencia agregada. Genera los vuelos para que tenga horarios.');
  }

  return (
    <div className="adm__card">
      <h2>
        {season.name} <span className="adm__chip">{ESTADOS[season.status]}</span>
      </h2>
      <p className="adm__muted">
        {season.citySlug} · {fecha(season.startsOn)} a {fecha(season.endsOn)}
        {season.venueName ? ` · ${season.venueName}` : ''}
      </p>

      <table className="adm__table">
        <thead>
          <tr>
            <th>Experiencia</th>
            <th>Precio (MXN)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {season.experiences.map(experience => (
            <ExperienceRow key={experience.id} experience={experience} onSaved={onSaved} onError={onError} />
          ))}
        </tbody>
      </table>

      <div className="adm__spacer" />
      {nuevo ? (
        <div className="adm__row">
          <div className="adm__field">
            <label className="adm__label">Nombre</label>
            <input
              className="adm__input"
              value={nuevo.name}
              onChange={e => setNuevo({ ...nuevo, name: e.target.value })}
            />
          </div>
          <div className="adm__field">
            <label className="adm__label">Precio por persona (MXN)</label>
            <input
              className="adm__input"
              type="number"
              min="0"
              step="0.01"
              value={nuevo.pesos}
              onChange={e => setNuevo({ ...nuevo, pesos: e.target.value })}
            />
          </div>
          <button type="button" className="adm__btn adm__btn--primary adm__btn--sm" disabled={saving} onClick={() => void agregar()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="adm__btn adm__btn--ghost adm__btn--sm" onClick={() => setNuevo(null)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="adm__btn adm__btn--ghost adm__btn--sm"
          onClick={() => setNuevo({ name: '', pesos: '' })}
        >
          Agregar experiencia
        </button>
      )}
    </div>
  );
}

function ExperienceRow({
  experience,
  onSaved,
  onError
}: {
  experience: ExperienceView;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState(experience.name);
  const [pesos, setPesos] = useState(centavosAPesos(experience.priceCents));
  const [saving, setSaving] = useState(false);

  const cambiado = name.trim() !== experience.name || pesosACentavos(pesos) !== experience.priceCents;

  async function guardar() {
    if (!name.trim() || !pesosValidos(pesos)) {
      onError('El nombre no puede estar vacío y el precio debe ser mayor a cero.');
      return;
    }

    setSaving(true);
    const result = await enviar(`/api/admin/experiences/${experience.id}`, 'PATCH', {
      name: name.trim(),
      priceCents: pesosACentavos(pesos)
    });
    setSaving(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }
    const warning = typeof result.payload['warning'] === 'string' ? ` ${result.payload['warning']}` : '';
    onSaved(`Experiencia guardada.${warning}`);
  }

  return (
    <tr>
      <td>
        <input className="adm__input" value={name} onChange={e => setName(e.target.value)} />
      </td>
      <td>
        <input
          className="adm__input"
          type="number"
          min="0"
          step="0.01"
          value={pesos}
          onChange={e => setPesos(e.target.value)}
        />
      </td>
      <td>
        <button
          type="button"
          className="adm__btn adm__btn--primary adm__btn--sm"
          disabled={!cambiado || saving}
          onClick={() => void guardar()}
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </td>
    </tr>
  );
}
