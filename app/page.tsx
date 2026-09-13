export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, maxWidth: 640 }}>
      <h1>Dinner in the Sky — Leads API</h1>
      <p>Servicio interno, sin interfaz pública. Endpoints disponibles:</p>
      <ul>
        <li>
          <code>POST /api/webhooks/formsubmit?sede=hermosillo&amp;secret=...</code> — recibe el <code>_webhook</code> de FormSubmit.
        </li>
        <li>
          <code>GET /api/leads?sede=...</code> — lista los leads en JSON (header <code>x-api-key</code> o <code>?api_key=</code>).
        </li>
        <li>
          <code>GET /api/leads/export?sede=...</code> — descarga los leads como <code>.xlsx</code> (mismo auth).
        </li>
      </ul>
    </main>
  );
}
