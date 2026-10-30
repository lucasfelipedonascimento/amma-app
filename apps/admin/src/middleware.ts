import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, AT_COOKIE, AT_MAX_AGE, RT_COOKIE, RT_MAX_AGE, cookieOptions } from './lib/config';
import { isFresh } from './lib/jwt';

/**
 * Mantém a sessão: com o token de acesso vencido, troca o de renovação por um novo par (e repassa os
 * cookies novos para a própria requisição, que já os usa). Sem sessão, manda para /login.
 */
export async function middleware(req: NextRequest) {
  const at = req.cookies.get(AT_COOKIE)?.value;
  if (isFresh(at)) return NextResponse.next();

  const rt = req.cookies.get(RT_COOKIE)?.value;
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const deny = () => {
    const res = isApi
      ? NextResponse.json({ message: 'Sessão expirada. Entre de novo.' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete(AT_COOKIE);
    res.cookies.delete(RT_COOKIE);
    return res;
  };
  if (!rt) return deny();

  let tokens: { accessToken: string; refreshToken: string };
  try {
    const r = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!r.ok) return deny();
    tokens = await r.json();
  } catch {
    return deny();
  }

  // Cookies novos valem já nesta requisição e ficam gravados no navegador.
  const headers = new Headers(req.headers);
  const rest = (req.headers.get('cookie') ?? '')
    .split('; ')
    .filter((c) => c && !c.startsWith(`${AT_COOKIE}=`) && !c.startsWith(`${RT_COOKIE}=`));
  headers.set(
    'cookie',
    [...rest, `${AT_COOKIE}=${tokens.accessToken}`, `${RT_COOKIE}=${tokens.refreshToken}`].join(
      '; ',
    ),
  );
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(AT_COOKIE, tokens.accessToken, cookieOptions(AT_MAX_AGE));
  res.cookies.set(RT_COOKIE, tokens.refreshToken, cookieOptions(RT_MAX_AGE));
  return res;
}

export const config = {
  // Tudo, menos a tela de entrada, as rotas de login/saída e os arquivos estáticos.
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
