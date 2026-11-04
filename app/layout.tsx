import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dinner in the Sky — Leads API',
  description: 'Servicio interno de captura de leads para todas las sedes.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning solo en <html> y <body>: las extensiones del
    // navegador (LanguageTool, gestores de contraseñas, traductores) les
    // cuelgan atributos propios antes de que React hidrate, y eso levanta un
    // error de hidratación que no viene de nuestro código y que no se puede
    // evitar desde aquí.
    //
    // No es una forma de callar errores reales: silencia exactamente estas dos
    // etiquetas y solo sus atributos, no el árbol que hay debajo. Un desajuste
    // de verdad dentro del panel sigue avisando igual.
    <html lang="es" suppressHydrationWarning>
      <body style={{ margin: 0 }} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
