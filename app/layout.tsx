import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dinner in the Sky — Leads API',
  description: 'Servicio interno de captura de leads para todas las sedes.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
