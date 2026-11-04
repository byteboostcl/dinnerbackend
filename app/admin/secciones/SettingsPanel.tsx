'use client';

import { useEffect, useState } from 'react';

type Settings = {
  companyName: string;
  contactEmail: string;
  bookingsEmail: string;
  phone: string;
  website: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  timezone: string;
  currency: string;
  gtmId: string;
  metaPixelId: string;
  ga4Id: string;
  confirmationUrl: string;
  cancellationPolicy: string;
  termsUrl: string;
  privacyUrl: string;
};

type FieldDef = { key: keyof Settings; label: string; type?: string; placeholder?: string; hint?: string };

type Block = { title: string; fields: FieldDef[] };

const BLOCKS: Block[] = [
  {
    title: 'Empresa',
    fields: [
      { key: 'companyName', label: 'Nombre de la empresa' },
      { key: 'timezone', label: 'Zona horaria', placeholder: 'America/Mexico_City' },
      { key: 'currency', label: 'Moneda', placeholder: 'MXN' }
    ]
  },
  {
    title: 'Contacto',
    fields: [
      { key: 'contactEmail', label: 'Correo de contacto', type: 'email' },
      { key: 'bookingsEmail', label: 'Correo de reservaciones', type: 'email' },
      { key: 'phone', label: 'Teléfono', type: 'tel' },
      { key: 'website', label: 'Sitio web', type: 'url', placeholder: 'https://' }
    ]
  },
  {
    title: 'Redes',
    fields: [
      { key: 'facebook', label: 'Facebook', type: 'url', placeholder: 'https://' },
      { key: 'instagram', label: 'Instagram', type: 'url', placeholder: 'https://' },
      { key: 'tiktok', label: 'TikTok', type: 'url', placeholder: 'https://' }
    ]
  },
  {
    title: 'Medición',
    fields: [
      { key: 'gtmId', label: 'Google Tag Manager', placeholder: 'GTM-XXXXXXX' },
      { key: 'ga4Id', label: 'Google Analytics 4', placeholder: 'G-XXXXXXXXXX' },
      { key: 'metaPixelId', label: 'Pixel de Meta', placeholder: '123456789012345' }
    ]
  }
];

const LEGAL_URLS: FieldDef[] = [
  {
    key: 'confirmationUrl',
    label: 'URL de confirmación',
    type: 'url',
    placeholder: 'https://',
    hint: 'A dónde se envía al cliente después de pagar.'
  },
  { key: 'termsUrl', label: 'Términos y condiciones', type: 'url', placeholder: 'https://' },
  { key: 'privacyUrl', label: 'Aviso de privacidad', type: 'url', placeholder: 'https://' }
];

export function SettingsPanel() {
  const [form, setForm] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/admin/settings');
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(String(payload.error ?? 'No se pudo cargar la configuración.'));
        }
        if (!cancelled) setForm(toForm(payload.settings));
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'No se pudo cargar la configuración.');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function update(key: keyof Settings, value: string) {
    setForm(current => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setMessage({ kind: 'error', text: String(payload.error ?? 'No se pudo guardar.') });
        return;
      }
      setForm(toForm(payload.settings));
      setMessage({ kind: 'ok', text: 'Configuración guardada.' });
    } catch {
      setMessage({ kind: 'error', text: 'No se pudo conectar con el servidor.' });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <div className="adm__msg adm__msg--error">{loadError}</div>;
  }
  if (!form) {
    return <p className="adm__muted">Cargando configuración…</p>;
  }

  function renderField(field: FieldDef) {
    return (
      <label key={field.key} className="adm__field">
        <span className="adm__label">{field.label}</span>
        <input
          className="adm__input"
          type={field.type ?? 'text'}
          placeholder={field.placeholder}
          value={form ? form[field.key] : ''}
          onChange={event => update(field.key, event.target.value)}
        />
        {field.hint && <span className="adm__muted">{field.hint}</span>}
      </label>
    );
  }

  return (
    <div>
      <h1>Configuración</h1>

      {message && <div className={`adm__msg adm__msg--${message.kind}`}>{message.text}</div>}

      {BLOCKS.map(block => (
        <div key={block.title} className="adm__card">
          <h2>{block.title}</h2>
          {block.fields.map(renderField)}
        </div>
      ))}

      <div className="adm__card">
        <h2>Legal</h2>
        {LEGAL_URLS.map(renderField)}
        <label className="adm__field">
          <span className="adm__label">Política de cancelación</span>
          <textarea
            className="adm__input"
            rows={6}
            value={form.cancellationPolicy}
            onChange={event => update('cancellationPolicy', event.target.value)}
          />
        </label>
      </div>

      <div className="adm__row">
        <button className="adm__btn adm__btn--primary" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

/** La API devuelve null en los opcionales vacíos; los inputs controlados necesitan string. */
function toForm(settings: Record<string, unknown>): Settings {
  const value = (key: keyof Settings): string => (typeof settings[key] === 'string' ? (settings[key] as string) : '');
  return {
    companyName: value('companyName'),
    contactEmail: value('contactEmail'),
    bookingsEmail: value('bookingsEmail'),
    phone: value('phone'),
    website: value('website'),
    facebook: value('facebook'),
    instagram: value('instagram'),
    tiktok: value('tiktok'),
    timezone: value('timezone'),
    currency: value('currency'),
    gtmId: value('gtmId'),
    metaPixelId: value('metaPixelId'),
    ga4Id: value('ga4Id'),
    confirmationUrl: value('confirmationUrl'),
    cancellationPolicy: value('cancellationPolicy'),
    termsUrl: value('termsUrl'),
    privacyUrl: value('privacyUrl')
  };
}
