/**
 * CORS para el único endpoint pensado para llamarse desde el navegador en un
 * origen distinto (POST /api/leads, invocado por el sitio Angular en
 * dinnerinthesky.com.mx). El resto de endpoints (GET /api/leads, /export,
 * el webhook de FormSubmit) se llaman server-to-server o desde la barra de
 * direcciones/curl, así que no necesitan esto — el navegador es el único que
 * exige CORS, no un cliente HTTP genérico.
 *
 * Se restringe a una lista de orígenes conocidos (en vez de "*") para que un
 * sitio cualquiera no pueda usar este endpoint público como su propio
 * formulario de leads.
 */
const ALLOWED_ORIGINS = new Set([
  'https://dinnerinthesky.com.mx',
  'https://www.dinnerinthesky.com.mx',
  'https://staging.dinnerinthesky.com.mx'
]);

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
