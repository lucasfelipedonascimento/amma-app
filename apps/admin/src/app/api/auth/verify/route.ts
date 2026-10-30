import { NextResponse } from 'next/server';
import type { PanelRole } from '@amma/shared';
import { API_URL, AT_COOKIE, AT_MAX_AGE, RT_COOKIE, RT_MAX_AGE, cookieOptions } from '@/lib/config';

/** Confere o código e só abre sessão para quem tem papel de painel (admin ou sócio). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.phone !== 'string' || typeof body.code !== 'string')
    return NextResponse.json({ message: 'Informe telefone e código' }, { status: 400 });

  const r = await fetch(`${API_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: body.phone, code: body.code }),
  });
  const tokens = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json(tokens, { status: r.status });

  const meRes = await fetch(`${API_URL}/panel/me`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  const me = (await meRes.json().catch(() => null)) as {
    name: string | null;
    panelRoles: PanelRole[];
  } | null;
  if (!meRes.ok || !me || me.panelRoles.length === 0) {
    // Quem não é admin nem sócio não ganha sessão no painel; a sessão aberta na API é encerrada.
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => undefined);
    return NextResponse.json(
      { message: 'Este telefone não tem acesso ao painel (só administradores e sócios).' },
      { status: 403 },
    );
  }

  const res = NextResponse.json({ name: me.name, panelRoles: me.panelRoles });
  res.cookies.set(AT_COOKIE, tokens.accessToken, cookieOptions(AT_MAX_AGE));
  res.cookies.set(RT_COOKIE, tokens.refreshToken, cookieOptions(RT_MAX_AGE));
  return res;
}
