/**
 * Plantillas de correo: marcadores y relleno.
 *
 * Se mantienen los mismos nombres de marcador que usaba TuriTop (%name%,
 * %date_event%, …) para que el equipo pueda pegar sus textos actuales sin
 * reescribirlos.
 */

export const MARCADORES = [
  { tag: '%name%', desc: 'Nombre de quien reserva' },
  { tag: '%booking_id%', desc: 'Código de la reserva' },
  { tag: '%product_name%', desc: 'Experiencia' },
  { tag: '%date_event%', desc: 'Fecha del vuelo' },
  { tag: '%time_event%', desc: 'Hora del vuelo' },
  { tag: '%seats%', desc: 'Número de invitados' },
  { tag: '%total%', desc: 'Importe pagado' },
  { tag: '%venue_name%', desc: 'Sede' },
  { tag: '%venue_address%', desc: 'Dirección de la sede' },
  { tag: '%email%', desc: 'Correo del cliente' },
  { tag: '%phone%', desc: 'Teléfono del cliente' },
  { tag: '%company_email%', desc: 'Correo de la empresa' },
  { tag: '%company_phone%', desc: 'Teléfono de la empresa' }
] as const;

export interface DatosCorreo {
  name: string;
  booking_id: string;
  product_name: string;
  date_event: string;
  time_event: string;
  seats: string;
  total: string;
  venue_name: string;
  venue_address: string;
  email: string;
  phone: string;
  company_email: string;
  company_phone: string;
}

/**
 * Sustituye los marcadores. Lo que no se reconoce se deja tal cual: es
 * preferible que el equipo vea un %marcador_mal_escrito% en la vista previa
 * a que desaparezca en silencio y el cliente reciba un hueco.
 */
export function render(plantilla: string, datos: Partial<DatosCorreo>): string {
  return plantilla.replace(/%([a-z_]+)%/gi, (completo, clave: string) => {
    const valor = datos[clave as keyof DatosCorreo];
    return valor === undefined ? completo : String(valor);
  });
}

/** Datos de ejemplo para la vista previa del panel. */
export const EJEMPLO: DatosCorreo = {
  name: 'María López',
  booking_id: 'DITS-7F3K2A',
  product_name: 'Cena con Estrellas',
  date_event: 'jueves 11 de marzo de 2027',
  time_event: '19:30',
  seats: '2',
  total: '$7,000 MXN',
  venue_name: 'Parque La Ruina',
  venue_address: 'Blvd. Fco. Eusebio Kino 9001, Hermosillo, Sonora',
  email: 'maria@ejemplo.com',
  phone: '662 123 4567',
  company_email: 'reservas@dinnerinthesky.com.mx',
  company_phone: '+52 55 4506 4656'
};
