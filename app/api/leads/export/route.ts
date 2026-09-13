import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';
import { buildLeadsWorkbook } from '@/lib/leads-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Descarga los leads como .xlsx. Protegido con header x-api-key o ?api_key=. Filtra opcionalmente por ?sede=. */
export async function GET(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return new Response(JSON.stringify({ ok: false, error: authError }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { searchParams } = new URL(request.url);
  const sede = searchParams.get('sede') ?? undefined;

  const leads = await prisma.lead.findMany({
    where: sede ? { sede } : {},
    orderBy: { createdAt: 'desc' }
  });

  const workbook = buildLeadsWorkbook(leads);
  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `leads${sede ? `-${sede}` : ''}.xlsx`;

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`
    }
  });
}
