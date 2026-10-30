import { NextResponse } from 'next/server';
import { API_URL, AT_COOKIE } from '@/lib/config';
import { isSameOrigin } from '@/lib/proxy-rules';

/**
 * Reautenticação para ações críticas: repassa à API (com o token do cookie httpOnly) o pedido do
 * código por SMS e a confirmação. O código vai para o telefone da própria conta, nunca para um informado.
 */
export async function reauthRoute(req: Request, step: 'request' | 'verify') {
  if (!isSameOrigin('POST', req.headers.get('origin'), req.headers.get('host')))
    return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  const token = new RegExp(`(?:^|; )${AT_COOKIE}=([^;]+)`).exec(
    req.headers.get('cookie') ?? '',
  )?.[1];
  if (!token)
    return NextResponse.json({ message: 'Sessão expirada. Entre de novo.' }, { status: 401 });
  const body = step === 'verify' ? await req.json().catch(() => null) : {};
  if (step === 'verify' && typeof body?.code !== 'string')
    return NextResponse.json({ message: 'Informe o código' }, { status: 400 });
  const r = await fetch(`${API_URL}/auth/reauth/${step}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(step === 'verify' ? { code: body.code } : {}),
    cache: 'no-store',
  });
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}
