import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS para las rutas de API.
 *
 * El sitio (Angular, servido desde cPanel en dinnerinthesky.com.mx) y este
 * backend (Railway) están en orígenes distintos, así que sin estas cabeceras
 * el navegador bloquea cualquier POST con JSON antes de que salga la
 * petición. No es un detalle de configuración: sin esto el checkout no
 * funciona desde el sitio.
 *
 * Es una lista blanca y no un comodín a propósito. Con `*` cualquier página
 * podría llamar a esta API desde el navegador de un visitante; y además el
 * comodín es incompatible con enviar credenciales si algún día hacen falta.
 *
 * El webhook de Stripe y el de FormSubmit no pasan por aquí en la práctica:
 * son llamadas servidor a servidor, sin origen, y se autentican por firma o
 * por secreto en la URL.
 */
const ALLOWED_ORIGINS = [
  'https://dinnerinthesky.com.mx',
  'https://www.dinnerinthesky.com.mx',
  'https://staging.dinnerinthesky.com.mx',
  // Desarrollo local del sitio Angular.
  'http://localhost:4200',
  'http://127.0.0.1:4200'
];

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);

  // Preflight: el navegador pregunta antes de mandar el POST real.
  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: allowed ? 204 : 403 });
    if (allowed) {
      applyCorsHeaders(preflight, origin);
    }
    return preflight;
  }

  const response = NextResponse.next();
  if (allowed) {
    applyCorsHeaders(response, origin);
  }
  return response;
}

function applyCorsHeaders(response: NextResponse, origin: string): void {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  response.headers.set('Access-Control-Max-Age', '86400');
  // Cachés intermedias deben distinguir por origen, o servirían la cabecera
  // de un origen a otro.
  response.headers.set('Vary', 'Origin');
}

export const config = {
  matcher: '/api/:path*'
};
