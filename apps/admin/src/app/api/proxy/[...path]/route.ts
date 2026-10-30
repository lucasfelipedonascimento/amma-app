import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, AT_COOKIE } from '@/lib/config';
import { isAllowedProxyPath, isSameOrigin } from '@/lib/proxy-rules';

/**
 * Ponte entre o navegador e a API: o token fica em cookie httpOnly (o JavaScript da página nunca o vê).
 * Só repassa /admin/* e /panel/*; o controle de acesso de verdade é da API.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!isAllowedProxyPath(path))
    return NextResponse.json({ message: 'Rota não permitida' }, { status: 404 });
  if (!isSameOrigin(req.method, req.headers.get('origin'), req.headers.get('host')))
    return NextResponse.json({ message: 'Origem não permitida' }, { status: 403 });
  const token = req.cookies.get(AT_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ message: 'Sessão expirada. Entre de novo.' }, { status: 401 });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(`${API_URL}/${path.join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? await req.text() : undefined,
    cache: 'no-store',
  });
  // Corpo repassado como veio (JSON ou arquivo, ex.: documento do motorista).
  const headers = new Headers();
  for (const h of ['content-type', 'cache-control']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
