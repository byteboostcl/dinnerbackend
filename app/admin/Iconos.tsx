/**
 * Iconos del panel.
 *
 * Son SVG escritos a mano y no una librería a propósito: son doce dibujos de
 * veinte líneas cada uno, y meter una dependencia de iconos por esto
 * significaría arrastrar miles de iconos que nadie va a usar en cada
 * despliegue.
 *
 * Todos comparten la misma rejilla de 24, el mismo grosor de trazo y
 * `currentColor`, para que hereden el color del texto que acompañan y no haya
 * que repintarlos en cada sitio.
 */

type Props = { size?: number };

function Svg({ size = 20, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** La mesa colgando de la grúa: es literalmente lo que se vende. */
export function IconoMesa(p: Props) {
  return (
    <Svg {...p}>
      <path d="M12 2v4" />
      <path d="M5 10h14" />
      <path d="M7 10v3a5 5 0 0 0 10 0v-3" />
      <path d="M9 18v3" />
      <path d="M15 18v3" />
    </Svg>
  );
}

export function IconoCiudad(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 21h18" />
      <path d="M5 21V8l5-4v17" />
      <path d="M14 21V11h5v10" />
      <path d="M8 9h.01M8 13h.01M16 15h.01" />
    </Svg>
  );
}

export function IconoResumen(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </Svg>
  );
}

export function IconoReservas(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4Z" />
      <path d="M12 7v10" strokeDasharray="2 3" />
    </Svg>
  );
}

export function IconoPuerta(p: Props) {
  return (
    <Svg {...p}>
      <path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" />
      <path d="M7 12h10" />
      <path d="M10 9l-3 3 3 3" />
    </Svg>
  );
}

export function IconoTemporadas(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M8 15h3" />
    </Svg>
  );
}

export function IconoVuelos(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconoBoletos(p: Props) {
  return (
    <Svg {...p}>
      <path d="M20 12.5 12.5 20a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.6a2 2 0 0 1 1.4.6l5.9 5.9a2 2 0 0 1 0 2.8Z" />
      <path d="M7.5 7.5h.01" />
    </Svg>
  );
}

export function IconoPromos(p: Props) {
  return (
    <Svg {...p}>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </Svg>
  );
}

export function IconoCorreo(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Svg>
  );
}

export function IconoBitacora(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </Svg>
  );
}

export function IconoConfig(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function IconoAtras(p: Props) {
  return (
    <Svg {...p}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </Svg>
  );
}

export function IconoCandado(p: Props) {
  return (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function IconoSalir(p: Props) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Svg>
  );
}

/** Mapa sección → icono, para no repetir el switch en cada sitio. */
export const ICONO_SECCION: Record<string, (p: Props) => React.JSX.Element> = {
  resumen: IconoResumen,
  reservas: IconoReservas,
  puerta: IconoPuerta,
  ciudades: IconoCiudad,
  temporadas: IconoTemporadas,
  vuelos: IconoVuelos,
  boletos: IconoBoletos,
  promos: IconoPromos,
  correo: IconoCorreo,
  bitacora: IconoBitacora,
  config: IconoConfig
};
