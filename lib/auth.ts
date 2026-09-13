/**
 * FormSubmit no permite mandar headers custom en su _webhook, solo una URL.
 * Por eso el secreto va en el query string (?secret=...) en vez de un header.
 * Falla cerrado: si WEBHOOK_SECRET no está configurado en el server, nadie pasa.
 * Devuelve null si todo bien, o un mensaje de error si no.
 */
export function checkWebhookSecret(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const expected = process.env['WEBHOOK_SECRET'];

  if (!expected) {
    return 'WEBHOOK_SECRET no está configurado en el servidor.';
  }
  if (searchParams.get('secret') !== expected) {
    return 'Secret inválido o ausente en la URL del webhook.';
  }
  return null;
}

/**
 * Protege /api/leads y /api/leads/export. Acepta la key por header
 * (x-api-key) o por query (?api_key=), porque el segundo caso es el único
 * práctico para abrir el export directo en el navegador. Falla cerrado si no
 * hay ADMIN_API_KEY configurado.
 */
export function checkApiKey(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const expected = process.env['ADMIN_API_KEY'];

  if (!expected) {
    return 'ADMIN_API_KEY no está configurado en el servidor.';
  }
  const provided = request.headers.get('x-api-key') ?? searchParams.get('api_key');
  if (provided !== expected) {
    return 'API key inválida o ausente.';
  }
  return null;
}
