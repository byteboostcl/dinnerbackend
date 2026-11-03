import type { Metadata } from 'next';
import './admin.css';

export const metadata: Metadata = {
  title: 'Panel — Dinner in the Sky',
  // Es una herramienta interna: nunca debe aparecer en buscadores.
  robots: { index: false, follow: false }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="adm">{children}</div>;
}
