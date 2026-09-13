import { Workbook } from 'exceljs';
import type { Lead } from '@prisma/client';

export function buildLeadsWorkbook(leads: Lead[]): Workbook {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Leads');

  sheet.columns = [
    { header: 'Sede', key: 'sede', width: 18 },
    { header: 'Nombre completo', key: 'fullName', width: 28 },
    { header: 'Correo', key: 'email', width: 30 },
    { header: 'Teléfono', key: 'phone', width: 18 },
    { header: 'Invitados', key: 'guestCount', width: 14 },
    { header: 'Origen', key: 'source', width: 20 },
    { header: 'Fecha de registro', key: 'createdAt', width: 22 }
  ];
  sheet.getRow(1).font = { bold: true };

  for (const lead of leads) {
    sheet.addRow({
      sede: lead.sede,
      fullName: lead.fullName ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      guestCount: lead.guestCount ?? '',
      source: lead.source,
      createdAt: lead.createdAt.toISOString()
    });
  }

  return workbook;
}
