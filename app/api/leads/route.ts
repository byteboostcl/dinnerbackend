import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista los leads guardados. Protegido con header x-api-key o ?api_key=. Filtra opcionalmente por ?sede=. */
export async function GET(request: Request): Promise<Response> {
  const authError = checkApiKey(request);
  if (authError) {
    return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sede = searchParams.get('sede') ?? undefined;

  const leads = await prisma.lead.findMany({
    where: sede ? { sede } : {},
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json(leads);
}
