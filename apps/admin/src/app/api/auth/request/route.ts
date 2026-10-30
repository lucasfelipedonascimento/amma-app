import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/config';

/** Pede o código por SMS. Em modo simulado a API devolve o código (`devCode`) e repassamos. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.phone !== 'string')
    return NextResponse.json({ message: 'Informe o telefone' }, { status: 400 });
  const r = await fetch(`${API_URL}/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: body.phone }),
  });
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}
