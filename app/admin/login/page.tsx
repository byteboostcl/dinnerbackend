'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Entrada al panel. El formulario solo habla con /api/auth/login, que
 * devuelve la cookie de sesión; aquí no se guarda ningún token.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      // Un 500 puede responder vacío o con HTML. Leer el cuerpo como JSON a
      // ciegas tapaba el error real con "Unexpected end of JSON input".
      const texto = await response.text();
      let body: { error?: string } = {};
      try {
        body = texto ? (JSON.parse(texto) as { error?: string }) : {};
      } catch {
        body = {};
      }

      if (!response.ok) {
        throw new Error(
          body.error ?? `El servidor respondió ${response.status} sin detalle. Revisa los registros del servidor.`
        );
      }

      // refresh() además revalida el server component que comprueba la sesión.
      router.replace('/admin');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
      setLoading(false);
    }
  }

  return (
    <div className="adm__login">
      <form className="adm__login-card" onSubmit={handleSubmit}>
        {/* Sobre fondo claro hace falta la versión oscura del logo; mientras
            no exista, el bloque azul le da el contraste que el archivo blanco
            necesita sin inventar un logo distinto. */}
        <div
          style={{
            background: 'var(--azul)',
            borderRadius: 12,
            padding: '14px 18px',
            display: 'inline-block',
            marginBottom: 18
          }}
        >
          <img src="/logo-dits-white.webp" alt="Dinner in the Sky" style={{ height: 34, display: 'block' }} />
        </div>
        <h1>Panel</h1>
        <p className="adm__sub">Entra con tu correo de Dinner in the Sky.</p>

        {error && <div className="adm__msg adm__msg--error">{error}</div>}

        <label className="adm__field">
          <span className="adm__label">Correo</span>
          <input
            className="adm__input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>

        <label className="adm__field">
          <span className="adm__label">Contraseña</span>
          <input
            className="adm__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </label>

        <button className="adm__btn adm__btn--primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
