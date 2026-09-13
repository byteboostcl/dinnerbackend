/**
 * Búsqueda best-effort, insensible a acentos/mayúsculas, de un campo del
 * formulario por una lista de posibles etiquetas. Cada sede puede redactar el
 * mismo campo distinto ("Correo electrónico" vs "Email"); esto evita tener que
 * tocar código cada vez que un formulario nuevo usa una etiqueta ligeramente
 * distinta. `raw` en Lead siempre guarda el payload sin tocar, así que nunca
 * se pierde información aunque el mapeo falle.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export function pickField(data: Record<string, unknown>, candidates: string[]): string | null {
  const normalizedEntries = Object.entries(data).map(([key, value]) => [normalize(key), value] as const);

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    const match = normalizedEntries.find(([key]) => key === normalizedCandidate);
    if (match && match[1] != null && match[1] !== '') {
      return String(match[1]);
    }
  }

  return null;
}
