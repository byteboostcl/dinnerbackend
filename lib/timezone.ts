/**
 * Conversión de hora local de una sede a UTC.
 *
 * El staff piensa en hora local ("los vuelos son a las 19:30 en Hermosillo")
 * y la base guarda UTC. Traducir eso restando un número fijo de horas es un
 * error: Sonora no aplica horario de verano, pero Ciudad de México sí, así
 * que el desfase de una misma sede cambia dentro del año y entre sedes.
 *
 * Se resuelve con la base de zonas horarias que ya trae Node (Intl), sin
 * dependencias: se calcula el desfase real de esa zona en ese instante
 * concreto.
 */

/** Desfase de la zona respecto a UTC, en minutos, para un instante dado. */
function offsetMinutes(timeZone: string, date: Date): number {
  // 'en-US' con hourCycle h23 da partes numéricas estables en todas las
  // versiones de Node.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);

  const get = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');

  // La misma marca de tiempo, leída como si fuera UTC: la diferencia con el
  // instante real es exactamente el desfase de la zona.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Convierte una fecha y hora local de una zona al instante UTC equivalente.
 *
 * @param isoLocal 'YYYY-MM-DDTHH:mm' tal como lo piensa el staff, sin zona.
 * @param timeZone zona IANA de la sede, p. ej. 'America/Hermosillo'.
 *
 * Se calcula en dos pasos porque el desfase depende del instante, y el
 * instante es justo lo que se está buscando: la primera aproximación casi
 * siempre acierta, y la segunda corrige los pocos casos que caen cerca de un
 * cambio de horario.
 */
export function zonedTimeToUtc(isoLocal: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(isoLocal.trim());
  if (!match) {
    throw new Error(`Fecha y hora local inválida: "${isoLocal}". Se esperaba YYYY-MM-DDTHH:mm.`);
  }

  const [, year, month, day, hour, minute, second] = match;
  const naiveUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0')
  );

  const firstGuess = new Date(naiveUtc - offsetMinutes(timeZone, new Date(naiveUtc)) * 60000);
  const corrected = new Date(naiveUtc - offsetMinutes(timeZone, firstGuess) * 60000);
  return corrected;
}

/** Día de la semana (0 domingo … 6 sábado) de una fecha en la zona indicada. */
export function zonedWeekday(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.indexOf(name);
}
